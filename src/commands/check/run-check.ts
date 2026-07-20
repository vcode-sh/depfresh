import { isAbsolute, relative, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import c from 'ansis'
import { createAddonLifecycle } from '../../addons'
import { createSqliteCache } from '../../cache/index'
import type { InvocationScopeExclusions } from '../../cli/scope-exclusions'
import { hasInvocationScopeExclusions } from '../../cli/scope-exclusions'
import { createInvocationAuthority, snapshotInvocationAuthority } from '../../invocation-authority'
import { loadPackages, loadPackagesWithLogger } from '../../io/packages'
import type { PackageLoadObserver } from '../../io/packages/discovery'
import { resolveDiscoveryContext } from '../../io/packages/root-detection'
import { createResolveContext, resolvePackage, resolvePackageWithLogger } from '../../io/resolve'
import { resolvePhysicalValues } from '../../io/write/occurrence'
import { readInvocationSelectionReceipt, type SelectionReceipt } from '../../selection'
import type {
  depfreshOptions,
  GlobalApplyResult,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
  WriteOutcome,
} from '../../types'
import { summarizeWriteOutcomes } from '../../types'
import { sanitizeTerminalText } from '../../utils/format'
import { createLogger } from '../../utils/logger'
import { loadNpmrc } from '../../utils/npmrc'
import { getSafeErrorDetails } from '../../utils/redact'
import { isLocked } from '../../utils/versions'
import { validateOptions } from '../../validate-options'
import type { LegacyWriteDiagnostic } from '../apply/legacy'
import {
  createLegacyPlan,
  type LegacyCommandApplyResult,
  type LegacyCommandSelection,
  type LegacySelectionEvidence,
  type LegacySelectionEvidenceResult,
} from '../apply/legacy-plan'
import {
  buildJsonPackage,
  type JsonError,
  type JsonExecutionState,
  type JsonPackage,
  outputJsonEnvelope,
  outputJsonError,
} from './json-output'
import { runInstall, runUpdate } from './package-manager'
import {
  completePreparedPackage,
  type PreparedPackage,
  preparePackage,
} from './package-preparation'
import { renderUpToDate, runExecute } from './post-write-actions'
import type { ProcessPackageHooks } from './process-package'
import { type CheckProgress, createCheckProgress } from './progress'
import { renderResolutionErrors, renderTable, renderVisualPlusResolutionErrors } from './render'
import { type CheckRunController, createCheckRunController } from './run-controller'
import type {
  CheckRunChange,
  CheckRunDiagnostic,
  CheckRunOperationResult,
  CheckRunTarget,
  CheckRunTargetOutcome,
  CheckRunTargetResult,
} from './run-model'
import {
  detectVisualPlusCapabilities,
  type VisualPlusCapabilities,
} from './visual-plus/capabilities'
import type {
  VisualPlusRunMetadata,
  VisualPlusSectionInput,
  VisualPlusWriteReceiptEvidence,
} from './visual-plus/input'
import {
  createVisualPlusSelectionProjection,
  isVisualPlusEligible,
  type VisualPlusSelectionProjection,
} from './visual-plus/integration'
import { createVisualPlusRenderer, type VisualPlusRenderer } from './visual-plus/renderer'
import { deriveVisualPlusRunMetadata } from './visual-plus/run-metadata'
import { createVisualPlusTheme, wrapVisualPlusText } from './visual-plus/theme'
import { applyLegacyCommandWrite, applyPackageWrite, type PackageWriteResult } from './write-flow'
import {
  buildWriteReceipt,
  type CommandWriteReceiptEvidence,
  formatWriteReceipt,
  type WriteReceipt,
} from './write-receipt'

export interface CliTerminalLifecycle {
  registerSignalCleanup(cleanup: () => void): () => void
}

interface DurableOutputOwner {
  suspend<T>(write: () => T): T
  suspendAsync<T>(write: () => Promise<T>): Promise<T>
}

export async function check(
  options: depfreshOptions,
  requestedAuthority: InvocationAuthority = createInvocationAuthority(options),
): Promise<number> {
  return runCheck(options, requestedAuthority, false)
}

export async function checkFromCli(
  options: depfreshOptions,
  requestedAuthority: InvocationAuthority = createInvocationAuthority(options),
  invocationSelection?: InvocationScopeExclusions,
  terminalLifecycle?: CliTerminalLifecycle,
): Promise<number> {
  return runCheck(
    options,
    requestedAuthority,
    true,
    invocationSelection,
    undefined,
    terminalLifecycle,
  )
}

export async function runCheck(
  options: depfreshOptions,
  requestedAuthority: InvocationAuthority,
  renderProgress: boolean,
  invocationSelection?: InvocationScopeExclusions,
  injectedRunController?: CheckRunController,
  terminalLifecycle?: CliTerminalLifecycle,
): Promise<number> {
  const authority = snapshotInvocationAuthority(requestedAuthority)
  const totalStart = performance.now()
  let runController = shouldModelRun(options) ? injectedRunController : undefined
  const logLevel = options.output === 'json' ? 'silent' : options.loglevel
  const addonOptions: depfreshOptions = {
    ...options,
    loglevel: logLevel,
  }
  let logger = createLogger(logLevel)
  const addons = createAddonLifecycle(addonOptions)
  let progress: CheckProgress | null = null
  let durableOwner: DurableOutputOwner | null = null
  let visualRenderer: VisualPlusRenderer | undefined
  let visualCapabilities: VisualPlusCapabilities | undefined
  let visualProjection: VisualPlusSelectionProjection | undefined
  let visualEvidence: LegacySelectionEvidence | undefined
  let visualWallClockMs: number | undefined
  let rendererError: unknown
  let unregisterSignalCleanup: (() => void) | undefined
  let visualResolutionSuspended = false
  let visualRun: VisualPlusRunMetadata = {
    detailLevel: options.long ? 'full' : 'compact',
    display: {
      group: options.group,
      sort: options.sort,
      timediff: options.timediff,
      nodecompat: options.nodecompat,
    },
    workspaceScope: 'unknown',
    packageManager: { status: 'unknown', sources: [] },
  }
  const runtimeOptions: depfreshOptions = {
    ...addonOptions,
    onDependencyResolved: (pkg, dep) => {
      const callback = () => addons.onDependencyResolved(pkg, dep)
      const onFailure = (error: unknown) =>
        logger.debug(
          `Ignored onDependencyResolved callback failure: ${error instanceof Error ? error.message : String(error)}`,
        )
      if (!visualRenderer) return callback()
      return visualResolutionSuspended
        ? runContainedBestEffortCallback(callback, onFailure)
        : runBestEffortVisualCallback(visualRenderer, callback, onFailure)
    },
  }

  try {
    validateOptions(runtimeOptions, authority)

    const visualPlus = isVisualPlusEligible(options, renderProgress)
    if (visualPlus) {
      const wallClockMs = Date.now()
      if (!(Number.isFinite(wallClockMs) && Number.isInteger(wallClockMs) && wallClockMs >= 0)) {
        throw new CheckRunInstrumentationError('wall clock must be a finite nonnegative integer')
      }
      visualWallClockMs = wallClockMs
      visualCapabilities = detectVisualPlusCapabilities({
        stdoutIsTTY: process.stdout.isTTY === true,
        stderrIsTTY: process.stderr.isTTY === true,
        ...(process.stdout.columns === undefined ? {} : { columns: process.stdout.columns }),
        ...(process.env.CI === undefined ? {} : { ci: process.env.CI }),
        ...(process.env.TERM === undefined ? {} : { term: process.env.TERM }),
        ...(process.env.NO_COLOR === undefined ? {} : { noColor: process.env.NO_COLOR }),
      })
      const loggerTheme = createVisualPlusTheme(visualCapabilities)
      logger = createLogger(logLevel, {
        color: visualCapabilities.color,
        sanitize: true,
        width: visualCapabilities.width,
        wrap: (value, width) => wrapVisualPlusText(value, width, loggerTheme),
      })
      runController =
        injectedRunController ??
        createCheckRunController({
          mode: options.mode,
          write: options.write,
          now: () => performance.now(),
        })
      visualRenderer = createVisualPlusRenderer({
        capabilities: visualCapabilities,
        writer: { write: (chunk) => void process.stdout.write(chunk) },
        scheduler: {
          schedule: (callback, delayMs) => {
            const timeout = setTimeout(callback, delayMs)
            timeout.unref()
            let active = true
            return () => {
              if (!active) return
              active = false
              clearTimeout(timeout)
            }
          },
        },
        onError: (error) => {
          rendererError ??= error
        },
      })
      visualRenderer.start(runController, visualRun)
      unregisterSignalCleanup = terminalLifecycle?.registerSignalCleanup(() =>
        visualRenderer?.dispose(),
      )
    }

    const hasPerDependencyLifecycle = Boolean(
      options.onDependencyResolved || options.addons?.some((addon) => addon.onDependencyResolved),
    )
    progress =
      renderProgress && !visualPlus && !hasPerDependencyLifecycle
        ? createCheckProgress(options)
        : null
    durableOwner = visualRenderer ?? progress
    const discoveryStart = performance.now()
    const activeProgress = progress
    let packagesDiscovered = false
    let selectionReceipt: SelectionReceipt | undefined
    const hasSelection = Boolean(
      invocationSelection && hasInvocationScopeExclusions(invocationSelection),
    )
    const packageObserver: PackageLoadObserver | undefined =
      activeProgress || runController
        ? {
            onPackagesDiscovered: (discoveredPackages: PackageMeta[]) => {
              packagesDiscovered = true
              activeProgress?.onPackagesDiscovered(discoveredPackages)
              if (runController) {
                const discoveredDeclarations = discoveredPackages.reduce(
                  (sum, pkg) => sum + pkg.deps.length,
                  0,
                )
                runController.emit({
                  type: 'packages-discovered',
                  packages: discoveredPackages.length,
                  declared: discoveredDeclarations,
                })
                runController.emit({ type: 'repository-inspection-started' })
              }
              if (activeProgress && !(runtimeOptions.global || runtimeOptions.globalAll)) {
                activeProgress.onRepositoryInspectionStart()
              }
              if (runController && !activeProgress && !visualRenderer) {
                logger.info(
                  `Found ${discoveredPackages.length} packages with ${discoveredPackages.reduce((sum, pkg) => sum + pkg.deps.length, 0)} dependencies`,
                )
              }
            },
            ...(durableOwner
              ? { writeDurable: <T>(write: () => T): T => writeDurable(durableOwner, write) }
              : {}),
          }
        : undefined
    const packages = visualRenderer
      ? await loadPackagesWithLogger(
          runtimeOptions,
          packageObserver,
          hasSelection ? invocationSelection : undefined,
          logger,
        )
      : packageObserver
        ? hasSelection
          ? await loadPackages(runtimeOptions, packageObserver, invocationSelection)
          : await loadPackages(runtimeOptions, packageObserver)
        : hasSelection
          ? await loadPackages(runtimeOptions, undefined, invocationSelection)
          : await loadPackages(runtimeOptions)
    if (runController && !packagesDiscovered) {
      runController.emit({
        type: 'packages-discovered',
        packages: packages.length,
        declared: packages.reduce((sum, pkg) => sum + pkg.deps.length, 0),
      })
      runController.emit({ type: 'repository-inspection-started' })
    }
    if (visualRenderer) {
      const visualRoot =
        runtimeOptions.effectiveRoot ?? resolveDiscoveryContext(runtimeOptions.cwd).effectiveRoot
      visualRun = deriveVisualPlusRunMetadata(visualRoot, packages, visualRun)
      visualRenderer.setRunMetadata(visualRun)
      throwRetainedRendererError(rendererError)
    }
    const declaredDependencies = packages.reduce((sum, pkg) => sum + pkg.deps.length, 0)
    runController?.emit({ type: 'repository-inspection-completed', status: 'passed' })
    selectionReceipt = readInvocationSelectionReceipt(runtimeOptions)
    const discoveryMs = performance.now() - discoveryStart
    progress?.onPackagesReady(packages)
    if (selectionReceipt && hasSelection && runtimeOptions.output === 'table') {
      writeDurable(durableOwner, () => renderSelectionReceipt(selectionReceipt!))
    }
    if (runtimeOptions.explainDiscovery && runtimeOptions.output === 'table') {
      writeDurable(durableOwner, () => logDiscoveryReport(runtimeOptions, logger))
    }
    await writeDurableAsync(durableOwner, () => addons.setup())
    const executionState: JsonExecutionState = {
      scannedPackages: packages.length,
      packagesWithUpdates: 0,
      plannedUpdates: 0,
      appliedUpdates: 0,
      revertedUpdates: 0,
      skippedUpdates: 0,
      conflictedUpdates: 0,
      failedWrites: 0,
      unknownWrites: 0,
      writeOutcomes: [],
      globalResults: [],
      failedResolutions: 0,
      noPackagesFound: packages.length === 0,
      didWrite: false,
    }

    if (packages.length === 0) {
      runController?.emit({
        type: 'resolution-completed',
        eligible: 0,
        unresolved: 0,
        updates: 0,
        status: 'passed',
      })
      runController?.emit({
        type: 'selection-completed',
        operations: 0,
        targets: 0,
        changes: [],
        selectedTargets: [],
      })
      if (visualRenderer && runController && visualCapabilities) {
        visualProjection = { changes: [], targets: [], metadata: [] }
        visualRenderer.writeReview(
          visualSectionInput(runController, visualCapabilities, visualRun, visualProjection),
        )
      }
      progress?.done()
      if (runtimeOptions.profile) {
        runtimeOptions.profileReport = {
          discoveryMs,
          resolutionMs: 0,
          postWriteMs: 0,
          totalMs: performance.now() - totalStart,
          cacheHits: 0,
          cacheMisses: 0,
          cacheEntries: 0,
          networkFetches: 0,
          dedupeHits: 0,
          scannedPackages: 0,
          scannedDependencies: 0,
          failedResolutions: 0,
        }
      }
      if (!visualRenderer) logger.warn('No packages found')
      if (options.output === 'json') {
        outputJsonEnvelope([], runtimeOptions, executionState, [], selectionReceipt)
      }
      const noPackagesExitCode = options.failOnNoPackages ? 2 : 0
      throwRetainedRendererError(rendererError)
      finalizeReadOnlyRun(runController, noPackagesExitCode)
      finalizeVisualRun(
        visualRenderer,
        runController,
        visualCapabilities,
        visualRun,
        visualProjection,
        undefined,
        undefined,
        () => rendererError,
      )
      if (visualRenderer) renderNonTtyHint(options)
      return noPackagesExitCode
    }

    await writeDurableAsync(durableOwner, () => addons.afterPackagesLoaded(packages))

    let hasUpdates = false
    let didWrite = false
    let availableUpdates = 0
    const jsonPackages: JsonPackage[] = []
    const jsonErrors: JsonError[] = []
    const writeDiagnostics: LegacyWriteDiagnostic[] = []
    const totalDependencies = packages.reduce(
      (sum, pkg) => sum + pkg.deps.filter((d) => d.update).length,
      0,
    )

    const cache = createSqliteCache()
    const executionRoot =
      options.effectiveRoot ?? resolveDiscoveryContext(options.cwd).effectiveRoot
    const npmrc = loadNpmrc(executionRoot)
    const workspacePackageNames = new Set(packages.map((p) => p.name).filter(Boolean))
    const resolveContext = createResolveContext(runtimeOptions)

    const packageHooks = (pkg: PackageMeta): ProcessPackageHooks => ({
      cache,
      npmrc,
      workspacePackageNames,
      beforePackageStart: (currentPkg) => addons.beforePackageStart(currentPkg),
      beforePackageWrite: (currentPkg, changes: ResolvedDepChange[]) =>
        addons.beforePackageWrite(currentPkg, changes),
      afterPackageWrite: (currentPkg, changes: ResolvedDepChange[]) =>
        addons.afterPackageWrite(currentPkg, changes),
      afterPackageEnd: (currentPkg) => addons.afterPackageEnd(currentPkg),
      onDependencyProcessed: () => undefined,
      onHasUpdates: (updates: ResolvedDepChange[]) => {
        hasUpdates = true
        availableUpdates += updates.length
        executionState.packagesWithUpdates += 1
        if (options.output === 'json') {
          jsonPackages.push(buildJsonPackage(pkg.name, updates))
        } else if (!visualRenderer) {
          writeDurable(durableOwner, () => renderTable(pkg.name, updates, options))
        }
      },
      onErrorDeps: (errors: ResolvedDepChange[]) => {
        executionState.failedResolutions += errors.length
        if (options.output === 'json') {
          for (const dep of errors) {
            jsonErrors.push({
              name: dep.name,
              source: dep.source,
              currentVersion: dep.currentVersion,
              message: 'Failed to resolve from registry',
            })
          }
        } else {
          writeDurable(durableOwner, () => {
            if (visualRenderer && visualCapabilities) {
              renderVisualPlusResolutionErrors(
                pkg.name,
                errors,
                visualCapabilities,
                (chunk) => void process.stdout.write(chunk),
              )
            } else {
              renderResolutionErrors(pkg.name, errors)
            }
          })
        }
      },
      onAllModeNoUpdates: () => {
        if (!options.all) return
        if (options.output === 'json') {
          jsonPackages.push(buildJsonPackage(pkg.name, []))
        } else if (!visualRenderer) {
          writeDurable(durableOwner, () => renderUpToDate(pkg.name))
        }
      },
      onPlannedUpdates: (count: number) => {
        executionState.plannedUpdates += count
      },
      onWriteResult: (result) => {
        executionState.writeOutcomes.push(...result.outcomes)
        writeDiagnostics.push(...result.diagnostics)
        if (result.globalResult) executionState.globalResults.push(result.globalResult)
        const summary = summarizeWriteOutcomes(executionState.writeOutcomes)
        executionState.plannedUpdates = summary.planned
        executionState.appliedUpdates = summary.applied
        executionState.skippedUpdates = summary.skipped
        executionState.conflictedUpdates = summary.conflicted
        executionState.revertedUpdates = summary.reverted
        executionState.failedWrites = summary.failed
        executionState.unknownWrites = summary.unknown
      },
      onDidWrite: () => {
        didWrite = true
        executionState.didWrite = true
      },
      logger,
    })

    const resolutionStart = performance.now()
    let commandReceiptEvidence: CommandWriteReceiptEvidence | undefined
    let resolutionBodyFailed = false
    try {
      const pendingResolutions = new Map<PackageMeta, Promise<ResolvedDepChange[]>>()

      const launchPendingResolutions = async (): Promise<void> => {
        for (const pkg of packages) {
          await addons.beforePackageStart(pkg)
          const onDependencyProcessed = progress
            ? () => progress?.onDependencyProcessed()
            : undefined
          const pending = visualRenderer
            ? resolvePackageWithLogger(
                pkg,
                runtimeOptions,
                cache,
                npmrc,
                workspacePackageNames,
                onDependencyProcessed,
                resolveContext,
                logger,
              )
            : resolvePackage(
                pkg,
                runtimeOptions,
                cache,
                npmrc,
                workspacePackageNames,
                onDependencyProcessed,
                resolveContext,
              )
          pendingResolutions.set(pkg, pending)
        }
      }

      const completedResolutions = new Map<PackageMeta, ResolvedDepChange[]>()
      const awaitPendingResolutions = () =>
        Promise.all(
          packages.map(async (pkg) => {
            const pending = pendingResolutions.get(pkg)
            if (pending) completedResolutions.set(pkg, await pending)
          }),
        ).then(() => undefined)
      if (visualRenderer) {
        visualResolutionSuspended = true
        try {
          await visualRenderer.suspendAsync(async () => {
            await launchPendingResolutions()
            await awaitPendingResolutions()
          })
        } finally {
          visualResolutionSuspended = false
        }
      } else {
        await writeDurableAsync(durableOwner, launchPendingResolutions)
        await awaitPendingResolutions()
      }
      if (runController) {
        const resolutionFacts = readResolutionFacts(completedResolutions, totalDependencies)
        emitResolution(runController, resolutionFacts)
      }
      progress?.onRenderingStart()
      const preparedPackages = await prepareAllPackages(
        packages,
        completedResolutions,
        runtimeOptions,
        authority,
        packageHooks,
        progress,
        durableOwner,
      )
      const observeVisualSelection = (result: LegacySelectionEvidenceResult): void => {
        if (!visualRenderer) return
        throwRetainedRendererError(rendererError)
        if (result.status !== 'ready') {
          throw new CheckRunInstrumentationError(
            `Visual+ selection evidence is unavailable: ${result.reason}`,
          )
        }
        const controller = runController
        const capabilities = visualCapabilities
        const wallClockMs = visualWallClockMs
        if (!(controller && capabilities && wallClockMs !== undefined)) {
          throw new CheckRunInstrumentationError('Visual+ runtime is incomplete')
        }
        visualEvidence = result.evidence
        visualProjection = createVisualPlusSelectionProjection(
          result.evidence,
          wallClockMs,
          visualRun.display,
        )
        emitVisualSelection(controller, visualProjection)
        visualRenderer.writeReview(
          visualSectionInput(controller, capabilities, visualRun, visualProjection),
        )
        throwRetainedRendererError(rendererError)
      }
      if (visualRenderer && !runtimeOptions.write) {
        const selections = createReadOnlyLegacySelections(preparedPackages)
        observeVisualSelection(createLegacyPlan(executionRoot, selections).selectionEvidence)
      }
      if (
        visualRenderer &&
        runtimeOptions.write &&
        !preparedPackages.some((prepared) => prepared.writeApproved && prepared.kind === 'local')
      ) {
        observeVisualSelection(createLegacyPlan(executionRoot, []).selectionEvidence)
      }
      const applyExecution = await applyPreparedPackages(
        preparedPackages,
        runtimeOptions,
        authority,
        executionRoot,
        packageHooks,
        visualRenderer ? observeVisualSelection : undefined,
      )
      if (visualRenderer && runtimeOptions.write && !visualProjection) {
        throw new CheckRunInstrumentationError('Visual+ write selection was not observed')
      }
      throwRetainedRendererError(rendererError)
      let modelEmission: PackageCompletion = { ok: true }
      if (runtimeOptions.write) {
        try {
          if (visualRenderer) {
            if (!(visualEvidence && visualProjection)) {
              throw new CheckRunInstrumentationError('Visual+ result projection is unavailable')
            }
            emitVisualWriteResult(
              runController,
              executionRoot,
              applyExecution,
              visualEvidence,
              visualProjection,
            )
          } else {
            emitLocalWriteResult(runController, executionRoot, applyExecution)
          }
        } catch (error) {
          modelEmission = { ok: false, error }
        }
      }
      const completion = await writeDurableAsync(durableOwner, () =>
        completeAllPackagesRetainingError(
          preparedPackages,
          applyExecution.packageResults,
          packageHooks,
        ),
      )
      if (!modelEmission.ok) throw modelEmission.error
      if (!completion.ok) throw completion.error
      await writeDurableAsync(durableOwner, () => addons.afterPackagesEnd(packages))
      commandReceiptEvidence =
        runtimeOptions.output === 'table'
          ? createCommandReceiptEvidence(executionRoot, applyExecution.localExecution)
          : undefined
      if (!(runtimeOptions.write || visualRenderer)) {
        emitReadOnlySelection(runController, packages, executionRoot)
      }
    } catch (error) {
      resolutionBodyFailed = true
      throw error
    } finally {
      progress?.done()
      const stats = cache.stats()
      cache.close()
      const logCacheStats = () =>
        logger.debug(
          `Cache stats: ${stats.hits} hits, ${stats.misses} misses, ${stats.size} entries`,
        )
      if (resolutionBodyFailed) {
        try {
          writeDurable(durableOwner, logCacheStats)
        } catch {
          // Debug output cannot replace the body error already being unwound.
        }
      } else {
        writeDurable(durableOwner, logCacheStats)
      }
      runtimeOptions.profileReport = {
        discoveryMs,
        resolutionMs: performance.now() - resolutionStart,
        postWriteMs: 0,
        totalMs: 0,
        cacheHits: stats.hits,
        cacheMisses: stats.misses,
        cacheEntries: stats.size,
        networkFetches: resolveContext.metrics.fetchesStarted,
        dedupeHits: resolveContext.metrics.dedupeHits,
        scannedPackages: packages.length,
        scannedDependencies: totalDependencies,
        failedResolutions: executionState.failedResolutions,
      }
    }

    if (progress && options.output === 'table') {
      const skippedDependencies = Math.max(0, declaredDependencies - totalDependencies)
      const pinnedDependencies = packages.reduce(
        (sum, pkg) =>
          sum +
          pkg.deps.filter((dependency) => !dependency.update && isLocked(dependency.currentVersion))
            .length,
        0,
      )
      const otherSkippedDependencies = Math.max(0, skippedDependencies - pinnedDependencies)
      const skippedLabel =
        otherSkippedDependencies === 0
          ? `${pinnedDependencies} pinned`
          : `${pinnedDependencies} pinned · ${otherSkippedDependencies} other skipped`
      const updateLabel = availableUpdates === 1 ? 'update' : 'updates'
      const packageLabel = executionState.packagesWithUpdates === 1 ? 'package' : 'packages'
      logger.info(
        `Checked ${packages.length} packages · ${declaredDependencies} declared · ${totalDependencies} eligible · ${skippedLabel} · ${availableUpdates} ${updateLabel} in ${executionState.packagesWithUpdates} ${packageLabel}`,
      )
    }

    let postWriteFailed = false
    const postWriteStart = performance.now()
    const localWriteFailed = executionState.writeOutcomes.some(
      (outcome) =>
        !outcome.occurrence.file.startsWith('global:') && isBlockingWriteStatus(outcome.status),
    )
    const globalWriteFailed = executionState.writeOutcomes.some(
      (outcome) =>
        outcome.occurrence.file.startsWith('global:') && isBlockingWriteStatus(outcome.status),
    )
    const writeFailed = localWriteFailed || globalWriteFailed

    if (authority.execute && options.execute && authority.write && didWrite && !writeFailed) {
      const executeSucceeded = await writeDurableAsync(durableOwner, () =>
        runExecute(options.execute!, executionRoot, logger),
      )
      postWriteFailed = postWriteFailed || !executeSucceeded
    }

    if (authority.write && didWrite && !writeFailed) {
      if (authority.update && options.update) {
        const updateSucceeded = await writeDurableAsync(durableOwner, () =>
          runUpdate(executionRoot, packages, logger),
        )
        postWriteFailed = postWriteFailed || !updateSucceeded
      } else if (authority.install && options.install) {
        const installSucceeded = await writeDurableAsync(durableOwner, () =>
          runInstall(executionRoot, packages, logger),
        )
        postWriteFailed = postWriteFailed || !installSucceeded
      }
    }

    if (runtimeOptions.profileReport) {
      runtimeOptions.profileReport.postWriteMs = performance.now() - postWriteStart
      runtimeOptions.profileReport.totalMs = performance.now() - totalStart
      runtimeOptions.profileReport.failedResolutions = executionState.failedResolutions
    }

    const exitCauses: CheckExitCauses = {
      strictResolutionFailed:
        executionState.failedResolutions > 0 && options.failOnResolutionErrors,
      localWriteFailed,
      globalWriteFailed,
      strictPostWriteFailed: postWriteFailed && options.strictPostWrite === true,
      failOnOutdated: hasUpdates && !options.write && options.failOnOutdated,
    }
    const finalExitCode = resolveCheckExitCode(exitCauses)

    let canonicalWriteReceipt: WriteReceipt | undefined
    if (options.output === 'json') {
      outputJsonEnvelope(jsonPackages, runtimeOptions, executionState, jsonErrors, selectionReceipt)
    } else {
      renderGlobalWriteOutcomes(executionState.writeOutcomes, executionState.globalResults, logger)
      const localWriteOutcomes = executionState.writeOutcomes.filter(
        (outcome) => !outcome.occurrence.file.startsWith('global:'),
      )
      if (localWriteOutcomes.length > 0) {
        const receiptOutcomes = visualRenderer
          ? createVisualPhysicalWriteOutcomes(
              executionRoot,
              localWriteOutcomes,
              commandReceiptEvidence,
              visualEvidence,
            )
          : localWriteOutcomes
        canonicalWriteReceipt = buildWriteReceipt({
          outcomes: receiptOutcomes,
          diagnostics: writeDiagnostics,
          cwd: executionRoot,
          ...(commandReceiptEvidence ? { commandEvidence: commandReceiptEvidence } : {}),
        })
        if (!visualRenderer) {
          renderWriteReceipt(
            formatWriteReceipt(canonicalWriteReceipt, {
              code: finalExitCode,
              strictResolutionFailed: exitCauses.strictResolutionFailed,
              globalWriteFailed: exitCauses.globalWriteFailed,
              strictPostWriteFailed: exitCauses.strictPostWriteFailed,
            }),
            logger,
          )
        }
      }
    }

    if (!(visualRenderer || hasUpdates) && executionState.failedResolutions === 0) {
      logger.success('All dependencies are up to date')
    } else if (
      !visualRenderer &&
      executionState.failedResolutions > 0 &&
      options.output === 'table'
    ) {
      logger.warn(`${executionState.failedResolutions} dependencies failed to resolve`)
    }

    if (!visualRenderer && hasUpdates && options.output === 'table') {
      if (options.mode === 'default') {
        logger.info(c.gray('Tip: Run `depfresh major` to check for major updates'))
      }
      if (!options.write) {
        logger.info(c.gray('Tip: Add `-w` to write changes to package files'))
      }
    }

    if (!visualRenderer) renderNonTtyHint(options)

    if (executionState.failedResolutions > 0 && options.failOnResolutionErrors) {
      throwRetainedRendererError(rendererError)
      finalizeReadOnlyRun(runController, finalExitCode)
      finalizeVisualRun(
        visualRenderer,
        runController,
        visualCapabilities,
        visualRun,
        visualProjection,
        visualEvidence,
        canonicalWriteReceipt,
        () => rendererError,
      )
      if (visualRenderer) renderNonTtyHint(options)
      return finalExitCode
    }

    if (writeFailed) {
      throwRetainedRendererError(rendererError)
      finalizeReadOnlyRun(runController, finalExitCode)
      finalizeVisualRun(
        visualRenderer,
        runController,
        visualCapabilities,
        visualRun,
        visualProjection,
        visualEvidence,
        canonicalWriteReceipt,
        () => rendererError,
      )
      if (visualRenderer) renderNonTtyHint(options)
      return finalExitCode
    }

    if (
      runtimeOptions.profile &&
      runtimeOptions.output === 'table' &&
      runtimeOptions.profileReport
    ) {
      writeDurable(durableOwner, () => logProfileReport(runtimeOptions.profileReport!, logger))
    }

    if (postWriteFailed && options.strictPostWrite) {
      throwRetainedRendererError(rendererError)
      finalizeReadOnlyRun(runController, finalExitCode)
      finalizeVisualRun(
        visualRenderer,
        runController,
        visualCapabilities,
        visualRun,
        visualProjection,
        visualEvidence,
        canonicalWriteReceipt,
        () => rendererError,
      )
      if (visualRenderer) renderNonTtyHint(options)
      return finalExitCode
    }

    throwRetainedRendererError(rendererError)
    finalizeReadOnlyRun(runController, finalExitCode)
    finalizeVisualRun(
      visualRenderer,
      runController,
      visualCapabilities,
      visualRun,
      visualProjection,
      visualEvidence,
      canonicalWriteReceipt,
      () => rendererError,
    )
    if (visualRenderer) renderNonTtyHint(options)
    return finalExitCode
  } catch (error) {
    progress?.done()
    try {
      visualRenderer?.dispose()
    } catch {
      // The command failure remains authoritative.
    }
    tryFailReadOnlyRun(
      runController,
      error instanceof CheckRunInstrumentationError ? 'CHECK_RUN_INVARIANT' : 'CHECK_RUN_FAILED',
    )
    if (options.output === 'json') {
      outputJsonError(error, { cwd: options.cwd, mode: options.mode })
    } else {
      logger.error('Check failed:', getSafeErrorDetails(error).message)
    }
    return 2
  } finally {
    unregisterSignalCleanup?.()
  }
}

async function prepareAllPackages(
  packages: readonly PackageMeta[],
  completedResolutions: ReadonlyMap<PackageMeta, ResolvedDepChange[]>,
  options: depfreshOptions,
  authority: InvocationAuthority,
  hooksFor: (pkg: PackageMeta) => ProcessPackageHooks,
  progress: CheckProgress | null,
  durableOwner: DurableOutputOwner | null,
): Promise<PreparedPackage[]> {
  const preparedPackages: PreparedPackage[] = []
  try {
    for (const pkg of packages) {
      const prepared = await writeDurableAsync(durableOwner, () =>
        preparePackage(
          pkg,
          options,
          authority,
          hooksFor(pkg),
          Promise.resolve(completedResolutions.get(pkg) ?? []),
          true,
        ),
      )
      preparedPackages.push(prepared)
      progress?.onPackageRendered()
    }
    return preparedPackages
  } catch (error) {
    const cleanup = await completeAllPackagesRetainingError(preparedPackages, new Map(), hooksFor)
    if (!cleanup.ok) throw cleanup.error
    throw error
  }
}

interface LocalCommandExecution {
  result: LegacyCommandApplyResult
  selections: readonly LegacyCommandSelection[]
}

interface PreparedApplyExecution {
  packageResults: ReadonlyMap<PreparedPackage, PackageWriteResult>
  localExecution: LocalCommandExecution | undefined
}

function createVisualPhysicalWriteOutcomes(
  root: string,
  outcomes: readonly WriteOutcome[],
  commandEvidence: CommandWriteReceiptEvidence | undefined,
  selectionEvidence: LegacySelectionEvidence | undefined,
): WriteOutcome[] {
  if (!(commandEvidence && selectionEvidence)) {
    throw new CheckRunInstrumentationError('Visual+ physical receipt evidence is unavailable')
  }

  const selectedByKey = new Map<string, LegacySelectionEvidence['operations'][number]>()
  for (const operation of selectionEvidence.operations) {
    const key = physicalKey(operation.physicalTarget, operation.occurrencePath)
    if (selectedByKey.has(key)) {
      throw new CheckRunInstrumentationError('Visual+ selection has duplicate physical operations')
    }
    selectedByKey.set(key, operation)
  }

  const commandKeys = new Set<string>()
  for (const operation of commandEvidence.operations) {
    const file = requireRepositoryPath(root, operation.file)
    if (!isSafePhysicalPath(operation.path)) {
      throw new CheckRunInstrumentationError('Visual+ command occurrence path is unsafe')
    }
    const key = physicalKey(file, operation.path)
    if (commandKeys.has(key) || !selectedByKey.has(key)) {
      throw new CheckRunInstrumentationError(
        'Visual+ command operations differ from selection evidence',
      )
    }
    commandKeys.add(key)
  }
  if (commandKeys.size !== selectedByKey.size) {
    throw new CheckRunInstrumentationError('Visual+ command operation inventory is incomplete')
  }

  const projectionsByKey = new Map<string, WriteOutcome[]>()
  for (const outcome of outcomes) {
    const file = requireRepositoryPath(root, outcome.occurrence.file)
    if (!isSafePhysicalPath(outcome.occurrence.path)) {
      throw new CheckRunInstrumentationError('Visual+ projected occurrence path is unsafe')
    }
    const key = physicalKey(file, outcome.occurrence.path)
    if (!commandKeys.has(key)) {
      throw new CheckRunInstrumentationError(
        'Visual+ projected outcome has no command operation evidence',
      )
    }
    const projections = projectionsByKey.get(key)
    if (projections) projections.push(outcome)
    else projectionsByKey.set(key, [outcome])
  }

  return selectionEvidence.operations.map((selected) => {
    const key = physicalKey(selected.physicalTarget, selected.occurrencePath)
    const projections = projectionsByKey.get(key)
    if (!projections || projections.length === 0) {
      throw new CheckRunInstrumentationError('Visual+ projected outcome inventory is incomplete')
    }
    const canonical = projections[0]!
    for (const projection of projections) {
      if (
        projection.name !== selected.name ||
        projection.expectedValue !== selected.current ||
        projection.requestedValue !== selected.target ||
        projection.observedValue !== canonical.observedValue ||
        Object.hasOwn(projection, 'observedValue') !== Object.hasOwn(canonical, 'observedValue')
      ) {
        throw new CheckRunInstrumentationError(
          'Visual+ shared outcome projections are inconsistent',
        )
      }
    }
    return {
      ...canonical,
      occurrence: {
        file: selected.physicalTarget,
        path: [...selected.occurrencePath],
      },
    }
  })
}

function createCommandReceiptEvidence(
  root: string,
  execution: LocalCommandExecution | undefined,
): CommandWriteReceiptEvidence | undefined {
  if (execution?.result.status !== 'executed') return undefined
  const projected = projectedChangesByPhysicalKey(root, execution)
  const operationsById = new Map<
    string,
    Extract<LegacyCommandApplyResult, { status: 'executed' }>['applyResult']['operations'][number]
  >()
  const operationKeys = new Set<string>()
  for (const operation of execution.result.applyResult.operations) {
    const file = requireRepositoryPath(root, operation.file)
    const key = physicalKey(file, operation.path)
    if (
      operationsById.has(operation.operationId) ||
      operationKeys.has(key) ||
      !projected.has(key)
    ) {
      throw new CheckRunInstrumentationError('command receipt operations do not reconcile')
    }
    operationsById.set(operation.operationId, operation)
    operationKeys.add(key)
  }
  if (operationKeys.size !== projected.size) {
    throw new CheckRunInstrumentationError('command receipt operation inventory is incomplete')
  }

  const attemptedByOperation = new Map<string, boolean>()
  const attemptTargets = new Set<string>()
  for (const attempt of execution.result.attempts) {
    const target = requireRepositoryPath(root, attempt.targetPath)
    if (attemptTargets.has(target) || attempt.operationIds.length === 0) {
      throw new CheckRunInstrumentationError('command receipt target evidence is duplicated')
    }
    attemptTargets.add(target)
    for (const operationId of attempt.operationIds) {
      const operation = operationsById.get(operationId)
      if (
        !operation ||
        requireRepositoryPath(root, operation.file) !== target ||
        attemptedByOperation.has(operationId)
      ) {
        throw new CheckRunInstrumentationError(
          'command receipt attempt evidence does not reconcile',
        )
      }
      attemptedByOperation.set(operationId, attempt.replacementAttempted)
    }
  }
  if (attemptedByOperation.size !== operationsById.size) {
    throw new CheckRunInstrumentationError('command receipt attempt inventory is incomplete')
  }

  return {
    operations: execution.result.applyResult.operations.map((operation) => ({
      file: requireRepositoryPath(root, operation.file),
      path: [...operation.path],
      status: operation.status,
      reason: sanitizeTerminalText(operation.reason),
      replacementAttempted: attemptedByOperation.get(operation.operationId)!,
    })),
    recovery: execution.result.applyResult.recovery,
    cleanupUncertain: execution.result.applyResult.phases.some(
      (phase) => phase.name === 'cleanup' && phase.status !== 'passed',
    ),
  }
}

async function applyPreparedPackages(
  preparedPackages: readonly PreparedPackage[],
  options: depfreshOptions,
  authority: InvocationAuthority,
  executionRoot: string,
  hooksFor: (pkg: PackageMeta) => ProcessPackageHooks,
  selectionObserver?: (evidence: LegacySelectionEvidenceResult) => void,
): Promise<PreparedApplyExecution> {
  const packageResults = new Map<PreparedPackage, PackageWriteResult>()
  let localExecution: LocalCommandExecution | undefined
  try {
    const localSelections: LegacyCommandSelection[] = []
    for (const [packageIndex, prepared] of preparedPackages.entries()) {
      if (prepared.writeApproved && prepared.kind === 'local') {
        localSelections.push({ packageIndex, pkg: prepared.pkg, changes: prepared.selected })
      }
    }
    if (localSelections.length > 0) {
      const commandResult = selectionObserver
        ? await applyLegacyCommandWrite(
            executionRoot,
            localSelections,
            authority,
            selectionObserver,
          )
        : await applyLegacyCommandWrite(executionRoot, localSelections, authority)
      projectCommandResults(commandResult, localSelections, preparedPackages, packageResults)
      localExecution = { result: commandResult, selections: localSelections }
    }

    for (const prepared of preparedPackages) {
      if (!(prepared.writeApproved && prepared.kind === 'global')) continue
      const result = await applyPackageWrite(
        prepared.pkg,
        prepared.selected,
        options,
        authority,
        hooksFor(prepared.pkg).logger,
      )
      packageResults.set(prepared, result)
    }
    return { packageResults, localExecution }
  } catch (error) {
    const cleanup = await completeAllPackagesRetainingError(
      preparedPackages,
      packageResults,
      hooksFor,
    )
    if (!cleanup.ok) throw cleanup.error
    throw error
  }
}

function projectCommandResults(
  result: LegacyCommandApplyResult,
  selections: readonly LegacyCommandSelection[],
  preparedPackages: readonly PreparedPackage[],
  packageResults: Map<PreparedPackage, PackageWriteResult>,
): void {
  const selectedIndexes = new Set(selections.map((selection) => selection.packageIndex))
  const projectedByIndex = new Map<number, LegacyCommandApplyResult['packages'][number]>()
  for (const projected of result.packages) {
    if (
      !selectedIndexes.has(projected.packageIndex) ||
      projectedByIndex.has(projected.packageIndex)
    ) {
      throw new CheckRunInstrumentationError('command package results do not match selections')
    }
    projectedByIndex.set(projected.packageIndex, projected)
  }

  let diagnosticsAvailable = true
  for (const selection of selections) {
    const prepared = preparedPackages[selection.packageIndex]
    const projected = projectedByIndex.get(selection.packageIndex)
    if (!(prepared && projected) || projected.outcomes.length !== selection.changes.length) {
      throw new CheckRunInstrumentationError('command package result inventory is incomplete')
    }
    const summary = summarizeWriteOutcomes(projected.outcomes)
    packageResults.set(prepared, {
      ...summary,
      outcomes: projected.outcomes,
      diagnostics: diagnosticsAvailable ? result.diagnostics : [],
      didWrite: summary.applied > 0,
    })
    diagnosticsAvailable = false
  }
}

type PackageCompletion = { ok: true } | { ok: false; error: unknown }

async function completeAllPackagesRetainingError(
  preparedPackages: readonly PreparedPackage[],
  packageResults: ReadonlyMap<PreparedPackage, PackageWriteResult>,
  hooksFor: (pkg: PackageMeta) => ProcessPackageHooks,
): Promise<PackageCompletion> {
  let failed = false
  let firstError: unknown
  for (const prepared of preparedPackages) {
    try {
      await completePreparedPackage(prepared, packageResults.get(prepared), hooksFor(prepared.pkg))
    } catch (error) {
      if (!failed) {
        failed = true
        firstError = error
      }
    }
  }
  return failed ? { ok: false, error: firstError } : { ok: true }
}

interface CommandModelInventory {
  changes: CheckRunChange[]
  targets: CheckRunTarget[]
  results: {
    operations: CheckRunOperationResult[]
    targets: CheckRunTargetResult[]
  }
}

function emitVisualWriteResult(
  controller: CheckRunController | undefined,
  root: string,
  execution: PreparedApplyExecution,
  evidence: LegacySelectionEvidence,
  projection: VisualPlusSelectionProjection,
): void {
  if (!controller) return
  const localExecution = execution.localExecution
  if (!localExecution) {
    if (evidence.operations.length !== 0 || projection.targets.length !== 0) {
      throw new CheckRunInstrumentationError('missing command result for reviewed selection')
    }
    controller.emit({ type: 'phase-completed', phase: 'preflight', status: 'passed' })
    controller.emit({ type: 'phase-completed', phase: 'stage', status: 'skipped' })
    controller.emit({ type: 'results-recorded', operations: [], targets: [] })
    return
  }
  if (localExecution.result.status !== 'executed') {
    throw new CheckRunInstrumentationError('reviewed selection has no executable result evidence')
  }

  const diagnostics = commandDiagnostics(root, localExecution.result)
  const operationsById = new Map(
    localExecution.result.applyResult.operations.map((operation) => [
      operation.operationId,
      operation,
    ]),
  )
  const attempted = reconcileVisualAttempts(
    root,
    localExecution.result.attempts,
    projection.targets,
  )
  if (
    operationsById.size !== evidence.operations.length ||
    evidence.operations.some((operation) => !operationsById.has(operation.operationId))
  ) {
    throw new CheckRunInstrumentationError('command operation IDs differ from review evidence')
  }
  const operations = evidence.operations.map((selected) => {
    const operation = operationsById.get(selected.operationId)
    if (
      !operation ||
      requireRepositoryPath(root, operation.file) !== selected.physicalTarget ||
      JSON.stringify(operation.path) !== JSON.stringify(selected.occurrencePath) ||
      operation.name !== selected.name ||
      operation.expectedValue !== selected.current ||
      operation.requestedValue !== selected.target
    ) {
      throw new CheckRunInstrumentationError('command result differs from review evidence')
    }
    return operationModelResult(
      operation.operationId,
      operation.status,
      operation.reason,
      attempted.get(operation.operationId),
    )
  })
  if (diagnostics.length > 0) controller.emit({ type: 'diagnostics-recorded', diagnostics })
  emitApplyPhases(controller, localExecution.result)
  controller.emit({
    type: 'results-recorded',
    operations,
    targets: targetModelResults(projection.targets, operations),
  })
}

function reconcileVisualAttempts(
  root: string,
  attempts: LegacyCommandApplyResult['attempts'],
  targets: readonly CheckRunTarget[],
): Map<string, boolean> {
  const expected = new Map(targets.map((target) => [target.path, target.operationIds]))
  const receipts = new Map<string, boolean>()
  if (attempts.length !== expected.size) {
    throw new CheckRunInstrumentationError('command attempt targets differ from review evidence')
  }
  for (const attempt of attempts) {
    const path = requireRepositoryPath(root, attempt.targetPath)
    const operationIds = expected.get(path)
    if (!operationIds || JSON.stringify(operationIds) !== JSON.stringify(attempt.operationIds)) {
      throw new CheckRunInstrumentationError(
        'command attempt membership differs from review evidence',
      )
    }
    for (const operationId of attempt.operationIds) {
      if (receipts.has(operationId)) {
        throw new CheckRunInstrumentationError('command operation has duplicate attempt evidence')
      }
      receipts.set(operationId, attempt.replacementAttempted)
    }
  }
  return receipts
}

function emitLocalWriteResult(
  controller: CheckRunController | undefined,
  root: string,
  execution: PreparedApplyExecution,
): void {
  if (!controller) return
  const localExecution = execution.localExecution
  if (!localExecution) {
    controller.emit({
      type: 'selection-completed',
      operations: 0,
      targets: 0,
      changes: [],
      selectedTargets: [],
    })
    controller.emit({ type: 'phase-completed', phase: 'preflight', status: 'passed' })
    controller.emit({ type: 'phase-completed', phase: 'stage', status: 'skipped' })
    controller.emit({ type: 'results-recorded', operations: [], targets: [] })
    return
  }

  const diagnostics = commandDiagnostics(root, localExecution.result)
  if (localExecution.result.status === 'blocked') {
    const inventory = blockedCommandInventory(root, {
      ...localExecution,
      result: localExecution.result,
    })
    if (!inventory) {
      controller.emit({
        type: 'diagnostics-recorded',
        diagnostics: [{ code: 'CHECK_RUN_SELECTION_UNBOUND' }],
      })
      controller.emit({ type: 'phase-completed', phase: 'review', status: 'unknown' })
      return
    }
    emitModelSelection(controller, inventory)
    if (diagnostics.length > 0) {
      controller.emit({ type: 'diagnostics-recorded', diagnostics })
    }
    controller.emit({ type: 'phase-completed', phase: 'preflight', status: 'blocked' })
    controller.emit({ type: 'results-recorded', ...inventory.results })
    return
  }

  const inventory = executedCommandInventory(root, {
    ...localExecution,
    result: localExecution.result,
  })
  emitModelSelection(controller, inventory)
  if (diagnostics.length > 0) controller.emit({ type: 'diagnostics-recorded', diagnostics })
  emitApplyPhases(controller, localExecution.result)
  controller.emit({ type: 'results-recorded', ...inventory.results })
}

function emitModelSelection(
  controller: CheckRunController,
  inventory: CommandModelInventory,
): void {
  controller.emit({
    type: 'selection-completed',
    operations: inventory.changes.length,
    targets: inventory.targets.length,
    changes: inventory.changes,
    selectedTargets: inventory.targets,
  })
}

function executedCommandInventory(
  root: string,
  execution: LocalCommandExecution & {
    result: Extract<LegacyCommandApplyResult, { status: 'executed' }>
  },
): CommandModelInventory {
  const { applyResult } = execution.result
  const changesByPhysicalKey = projectedChangesByPhysicalKey(root, execution)
  const operationKeys = new Set(
    applyResult.operations.map((operation) =>
      physicalKey(requireRepositoryPath(root, operation.file), operation.path),
    ),
  )
  if (
    operationKeys.size !== applyResult.operations.length ||
    operationKeys.size !== changesByPhysicalKey.size ||
    [...changesByPhysicalKey.keys()].some((key) => !operationKeys.has(key))
  ) {
    throw new CheckRunInstrumentationError('command operations do not reconcile to projections')
  }
  const changes = applyResult.operations.map((operation) => {
    const file = requireRepositoryPath(root, operation.file)
    const projected = changesByPhysicalKey.get(physicalKey(file, operation.path))
    return {
      id: sanitizeTerminalText(operation.operationId),
      name: sanitizeTerminalText(operation.name),
      owner: file,
      current: sanitizeTerminalText(operation.expectedValue),
      target: sanitizeTerminalText(operation.requestedValue),
      diff: projectedDiff(projected),
    } satisfies CheckRunChange
  })
  const targets = exactTargets(root, execution.result.attempts, changes)
  const attempts = attemptReceipts(execution.result.attempts)
  const operations = applyResult.operations.map((operation) =>
    operationModelResult(
      operation.operationId,
      operation.status,
      operation.reason,
      attempts.get(operation.operationId),
    ),
  )
  return {
    changes,
    targets,
    results: { operations, targets: targetModelResults(targets, operations) },
  }
}

function blockedCommandInventory(
  root: string,
  execution: LocalCommandExecution & {
    result: Extract<LegacyCommandApplyResult, { status: 'blocked' }>
  },
): CommandModelInventory | undefined {
  const projected = projectedPhysicalChanges(root, execution)
  if (!projected) return undefined
  const attemptsByTarget = new Map(
    execution.result.attempts.map((attempt) => [
      safeRepositoryPath(root, attempt.targetPath),
      attempt,
    ]),
  )
  if (
    attemptsByTarget.has(undefined) ||
    attemptsByTarget.size !== execution.result.attempts.length ||
    attemptsByTarget.size !== projected.byTarget.size
  ) {
    return undefined
  }

  const changes: CheckRunChange[] = []
  const targets: CheckRunTarget[] = []
  const operations: CheckRunOperationResult[] = []
  const operationIds = new Set<string>()
  for (const [path, entries] of [...projected.byTarget].sort(([left], [right]) =>
    compareModelText(left, right),
  )) {
    const attempt = attemptsByTarget.get(path)
    if (
      !attempt ||
      attempt.replacementAttempted ||
      entries.length === 0 ||
      attempt.operationIds.length !== entries.length
    ) {
      return undefined
    }
    const targetOperationIds: string[] = []
    const orderedEntries = [...entries].sort((left, right) => compareModelText(left.key, right.key))
    for (const [index, entry] of orderedEntries.entries()) {
      const operationId = attempt.operationIds[index]
      if (
        operationId === undefined ||
        !isSafeModelIdentifier(operationId) ||
        operationIds.has(operationId)
      ) {
        return undefined
      }
      operationIds.add(operationId)
      targetOperationIds.push(operationId)
      changes.push({
        id: operationId,
        name: sanitizeTerminalText(entry.outcome.name),
        owner: path,
        current: sanitizeTerminalText(entry.outcome.expectedValue),
        target: sanitizeTerminalText(entry.outcome.requestedValue),
        diff: projectedDiff(entry.changes),
      })
      operations.push({
        operationId,
        outcome: 'blocked',
        blocked: true,
        notAttempted: true,
        unknown: false,
      })
    }
    targets.push({ path, operationIds: targetOperationIds })
  }
  return {
    changes,
    targets,
    results: { operations, targets: targetModelResults(targets, operations) },
  }
}

function projectedChangesByPhysicalKey(
  root: string,
  execution: LocalCommandExecution,
): Map<string, ResolvedDepChange[]> {
  const projected = projectedPhysicalChanges(root, execution)
  if (!projected) {
    throw new CheckRunInstrumentationError('command projections cannot be reconciled')
  }
  return projected.byKey
}

function projectedPhysicalChanges(
  root: string,
  execution: LocalCommandExecution,
):
  | {
      byKey: Map<string, ResolvedDepChange[]>
      byTarget: Map<
        string,
        Array<{ key: string; outcome: WriteOutcome; changes: ResolvedDepChange[] }>
      >
    }
  | undefined {
  const packages = new Map(execution.result.packages.map((entry) => [entry.packageIndex, entry]))
  const byKey = new Map<string, ResolvedDepChange[]>()
  const outcomesByKey = new Map<string, WriteOutcome[]>()
  for (const selection of execution.selections) {
    const projected = packages.get(selection.packageIndex)
    if (!projected || projected.outcomes.length !== selection.changes.length) return undefined
    for (const [index, change] of selection.changes.entries()) {
      const outcome = projected.outcomes[index]
      if (!(outcome && projectionMatches(change, outcome))) return undefined
      const file = safeRepositoryPath(root, outcome.occurrence.file)
      if (!(file && isSafePhysicalPath(outcome.occurrence.path))) return undefined
      const key = physicalKey(file, outcome.occurrence.path)
      const existing = byKey.get(key)
      if (existing) {
        existing.push(change)
        outcomesByKey.get(key)?.push(outcome)
      } else {
        byKey.set(key, [change])
        outcomesByKey.set(key, [outcome])
      }
    }
  }
  const byTarget = new Map<
    string,
    Array<{ key: string; outcome: WriteOutcome; changes: ResolvedDepChange[] }>
  >()
  for (const [key, changes] of byKey) {
    const outcome = stableProjectedOutcome(outcomesByKey.get(key))
    if (!outcome) return undefined
    const file = safeRepositoryPath(root, outcome.occurrence.file)
    if (!file) return undefined
    const entries = byTarget.get(file)
    const entry = { key, outcome, changes }
    if (entries) entries.push(entry)
    else byTarget.set(file, [entry])
  }
  return { byKey, byTarget }
}

function stableProjectedOutcome(
  outcomes: readonly WriteOutcome[] | undefined,
): WriteOutcome | undefined {
  if (!outcomes || outcomes.length === 0) return undefined
  return [...outcomes].sort((left, right) =>
    compareModelText(
      JSON.stringify([left.expectedValue, left.requestedValue]),
      JSON.stringify([right.expectedValue, right.requestedValue]),
    ),
  )[0]
}

function projectionMatches(change: ResolvedDepChange, outcome: WriteOutcome): boolean {
  const values = resolvePhysicalValues(
    {
      change,
      occurrence: outcome.occurrence,
      exactExpectedValue: change.rawVersion,
    },
    undefined,
  )
  return (
    change.name === outcome.name &&
    values.expectedValue === outcome.expectedValue &&
    values.requestedValue === outcome.requestedValue
  )
}

function projectedDiff(changes: readonly ResolvedDepChange[] | undefined): CheckRunChange['diff'] {
  if (!changes || changes.length === 0) return 'unknown'
  const diffs = new Set(changes.map((change) => change.diff))
  if (diffs.size !== 1) return 'unknown'
  const diff = changes[0]!.diff
  return diff === 'error' ? 'unknown' : diff
}

function exactTargets(
  root: string,
  attempts: LegacyCommandApplyResult['attempts'],
  changes: readonly CheckRunChange[],
): CheckRunTarget[] {
  const selectedIds = new Set(changes.map((change) => change.id))
  const memberships = new Set<string>()
  const targets = attempts.map((attempt) => {
    const path = requireRepositoryPath(root, attempt.targetPath)
    const operationIds = attempt.operationIds.map((id) => sanitizeTerminalText(id))
    for (const operationId of operationIds) {
      if (!selectedIds.has(operationId) || memberships.has(operationId)) {
        throw new CheckRunInstrumentationError('command attempt inventory does not reconcile')
      }
      memberships.add(operationId)
    }
    return { path, operationIds }
  })
  if (memberships.size !== changes.length || (targets.length === 0 && changes.length > 0)) {
    throw new CheckRunInstrumentationError('command target inventory is incomplete')
  }
  return targets
}

function attemptReceipts(attempts: LegacyCommandApplyResult['attempts']): Map<string, boolean> {
  const receipts = new Map<string, boolean>()
  for (const attempt of attempts) {
    for (const operationId of attempt.operationIds) {
      if (receipts.has(operationId)) {
        throw new CheckRunInstrumentationError('operation has duplicate attempt evidence')
      }
      receipts.set(operationId, attempt.replacementAttempted)
    }
  }
  return receipts
}

function operationModelResult(
  operationId: string,
  status: WriteOutcome['status'],
  reason: string,
  replacementAttempted: boolean | undefined,
): CheckRunOperationResult {
  if (replacementAttempted === undefined) {
    throw new CheckRunInstrumentationError('operation attempt evidence is missing')
  }
  const outcome = status === 'conflicted' ? 'blocked' : status
  const result: CheckRunOperationResult = {
    operationId: sanitizeTerminalText(operationId),
    outcome,
    blocked: status === 'conflicted',
    notAttempted: !replacementAttempted,
    unknown: status === 'unknown',
    reason: sanitizeTerminalText(reason),
  }
  if (result.blocked && !result.notAttempted) {
    throw new CheckRunInstrumentationError('conflicted operation was structurally attempted')
  }
  if (result.outcome === 'applied' && result.notAttempted) {
    throw new CheckRunInstrumentationError('applied operation was not structurally attempted')
  }
  return result
}

function targetModelResults(
  targets: readonly CheckRunTarget[],
  operations: readonly CheckRunOperationResult[],
): CheckRunTargetResult[] {
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]))
  return targets.map((target) => {
    const members = target.operationIds.map((operationId) => {
      const operation = byId.get(operationId)
      if (!operation) throw new CheckRunInstrumentationError('target result member is missing')
      return operation
    })
    const outcomes = new Set(members.map((operation) => operation.outcome))
    const outcome: CheckRunTargetOutcome = outcomes.size === 1 ? members[0]!.outcome : 'mixed'
    return {
      path: target.path,
      operationIds: target.operationIds,
      outcome,
      blocked: members.some((operation) => operation.blocked),
      notAttempted: members.some((operation) => operation.notAttempted),
      unknown: members.some((operation) => operation.unknown),
    }
  })
}

function commandDiagnostics(root: string, result: LegacyCommandApplyResult): CheckRunDiagnostic[] {
  return result.diagnostics.map((diagnostic) => {
    const path = safeRepositoryPath(root, diagnostic.target.display)
    return {
      code: sanitizeTerminalText(diagnostic.code),
      ...(path ? { path } : {}),
    }
  })
}

function emitApplyPhases(
  controller: CheckRunController,
  commandResult: Extract<LegacyCommandApplyResult, { status: 'executed' }>,
): void {
  const result = commandResult.applyResult
  const preflight = requireApplyPhase(result, 'preflight')
  const preflightStatus =
    preflight.status === 'failed' &&
    result.operations.some((operation) => operation.status === 'conflicted')
      ? 'blocked'
      : preflight.status
  controller.emit({ type: 'phase-completed', phase: 'preflight', status: preflightStatus })
  if (preflightStatus !== 'passed') {
    emitRetainedCleanupEvidence(controller, commandResult)
    return
  }

  const foldedStageStatus = foldedPhaseStatus(result, ['lock', 'stage'])
  const stageStatus =
    foldedStageStatus === 'failed' &&
    result.operations.every((operation) => operation.status === 'conflicted')
      ? 'blocked'
      : foldedStageStatus
  const inspect = result.phases.find((phase) => phase.name === 'inspect')
  if (stageStatus === 'skipped') {
    controller.emit({
      type: 'stage-completed',
      status: 'skipped',
      observationRequired: inspect !== undefined,
    })
    if (inspect) {
      controller.emit({ type: 'phase-completed', phase: 'observe', status: inspect.status })
    }
    emitRetainedCleanupEvidence(controller, commandResult)
    return
  }
  controller.emit({ type: 'phase-completed', phase: 'stage', status: stageStatus })
  if (stageStatus !== 'passed') {
    emitRetainedCleanupEvidence(controller, commandResult)
    return
  }

  const applyStatus = foldedPhaseStatus(result, ['precommit', 'commit'])
  const recoveryPhase = result.phases.find((phase) => phase.name === 'recovery')
  const recoveryRequired = recoveryPhase !== undefined
  if (applyStatus === 'skipped') {
    controller.emit({ type: 'phase-completed', phase: 'apply', status: 'skipped' })
    if (inspect) {
      controller.emit({ type: 'phase-completed', phase: 'observe', status: inspect.status })
    }
    emitRetainedCleanupEvidence(controller, commandResult)
    return
  }
  controller.emit({
    type: 'apply-completed',
    status: applyStatus,
    recoveryRequired,
    observationRequired: inspect !== undefined,
  })
  if (recoveryRequired) {
    if (result.recovery.status === 'not-needed') {
      throw new CheckRunInstrumentationError('executed recovery is missing exact evidence')
    }
    controller.emit({
      type: 'recovery-recorded',
      executed: true,
      status: result.recovery.status,
      ...(result.recovery.journalId === undefined ? {} : { journalId: result.recovery.journalId }),
      restoredPaths: result.recovery.restoredPaths ?? [],
      unrecoveredPaths: result.recovery.unrecoveredPaths ?? [],
      ...(result.recovery.externalEffects === undefined
        ? {}
        : { externalEffects: result.recovery.externalEffects }),
    })
    controller.emit({
      type: 'phase-completed',
      phase: 'recover',
      status: recoveryPhaseStatus(result.recovery.status),
    })
  }

  if (inspect) {
    controller.emit({ type: 'phase-completed', phase: 'observe', status: inspect.status })
  }
  if (!recoveryRequired) emitRetainedCleanupEvidence(controller, commandResult)
}

function emitRetainedCleanupEvidence(
  controller: CheckRunController,
  commandResult: Extract<LegacyCommandApplyResult, { status: 'executed' }>,
): void {
  const result = commandResult.applyResult
  if (result.recovery.status !== 'unknown') return
  if (
    (result.recovery.restoredPaths?.length ?? 0) > 0 ||
    (result.recovery.unrecoveredPaths?.length ?? 0) > 0
  ) {
    throw new CheckRunInstrumentationError(
      'non-executed cleanup evidence cannot retain recovery paths',
    )
  }
  if (isCleanUnattemptedVcsUnknown(commandResult)) return
  controller.emit({
    type: 'recovery-recorded',
    executed: false,
    status: 'unknown',
    ...(result.recovery.journalId === undefined ? {} : { journalId: result.recovery.journalId }),
    restoredPaths: [],
    unrecoveredPaths: [],
    ...(result.recovery.externalEffects === undefined
      ? {}
      : { externalEffects: result.recovery.externalEffects }),
  })
}

function isCleanUnattemptedVcsUnknown(
  commandResult: Extract<LegacyCommandApplyResult, { status: 'executed' }>,
): boolean {
  const { applyResult, attempts } = commandResult
  const preflight = applyResult.phases.find((phase) => phase.name === 'preflight')
  const cleanup = applyResult.phases.find((phase) => phase.name === 'cleanup')
  const executionStarted = applyResult.phases.some((phase) =>
    ['lock', 'stage', 'precommit', 'commit', 'recovery', 'inspect'].includes(phase.name),
  )
  return (
    preflight?.status === 'unknown' &&
    preflight.reason === 'VCS_UNAVAILABLE' &&
    !executionStarted &&
    (cleanup === undefined || cleanup.status === 'passed') &&
    applyResult.operations.length > 0 &&
    applyResult.operations.every(
      (operation) => operation.status === 'unknown' && operation.reason === 'VCS_UNAVAILABLE',
    ) &&
    attempts.length > 0 &&
    attempts.every((attempt) => !attempt.replacementAttempted) &&
    applyResult.recovery.journalId === undefined &&
    (applyResult.recovery.externalEffects?.length ?? 0) === 0
  )
}

function requireApplyPhase(
  result: Extract<LegacyCommandApplyResult, { status: 'executed' }>['applyResult'],
  name: 'preflight',
): (typeof result.phases)[number] {
  const phase = result.phases.find((entry) => entry.name === name)
  if (!phase) throw new CheckRunInstrumentationError(`command ${name} phase is missing`)
  return phase
}

function foldedPhaseStatus(
  result: Extract<LegacyCommandApplyResult, { status: 'executed' }>['applyResult'],
  names: readonly ('lock' | 'stage' | 'precommit' | 'commit')[],
): (typeof result.phases)[number]['status'] {
  const phases = names
    .map((name) => result.phases.find((phase) => phase.name === name))
    .filter((phase): phase is (typeof result.phases)[number] => phase !== undefined)
  if (phases.length === 0) return 'skipped'
  if (phases.some((phase) => phase.status === 'unknown')) return 'unknown'
  if (phases.some((phase) => phase.status === 'failed')) return 'failed'
  if (phases.some((phase) => phase.status === 'skipped')) return 'skipped'
  return 'passed'
}

function recoveryPhaseStatus(
  status: Extract<
    LegacyCommandApplyResult,
    { status: 'executed' }
  >['applyResult']['recovery']['status'],
): 'passed' | 'failed' | 'unknown' {
  if (status === 'completed') return 'passed'
  if (status === 'partial') return 'failed'
  return 'unknown'
}

function physicalKey(file: string, path: readonly string[]): string {
  return JSON.stringify({ file, path })
}

function requireRepositoryPath(root: string, path: string): string {
  const safe = safeRepositoryPath(root, path)
  if (!safe) throw new CheckRunInstrumentationError('command path is not repository-relative')
  return safe
}

function safeRepositoryPath(root: string, path: string): string | undefined {
  const candidate = isAbsolute(path) ? relative(root, path) : path
  const normalized = candidate.split(sep).join('/')
  if (
    normalized.length === 0 ||
    isAbsolute(normalized) ||
    normalized.includes('\\') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return undefined
  }
  return normalized
}

function isSafePhysicalPath(path: readonly string[]): boolean {
  return path.length > 0 && path.every((segment) => isSafeModelIdentifier(segment))
}

function isSafeModelIdentifier(value: string): boolean {
  return value.length > 0 && !/\p{Cc}|\p{Cf}/u.test(value)
}

function compareModelText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function shouldModelRun(options: depfreshOptions): boolean {
  return !(options.global || options.globalAll)
}

function createReadOnlyLegacySelections(
  preparedPackages: readonly PreparedPackage[],
): LegacyCommandSelection[] {
  return preparedPackages.flatMap((prepared, packageIndex) =>
    prepared.pkg.type !== 'global' && prepared.selected.length > 0
      ? [{ packageIndex, pkg: prepared.pkg, changes: prepared.selected }]
      : [],
  )
}

function emitVisualSelection(
  controller: CheckRunController,
  projection: VisualPlusSelectionProjection,
): void {
  controller.emit({
    type: 'selection-completed',
    operations: projection.changes.length,
    targets: projection.targets.length,
    changes: projection.changes,
    selectedTargets: projection.targets,
  })
}

function visualSectionInput(
  controller: CheckRunController,
  capabilities: VisualPlusCapabilities,
  run: VisualPlusRunMetadata,
  projection: VisualPlusSelectionProjection,
  writeReceipt?: VisualPlusWriteReceiptEvidence,
): VisualPlusSectionInput {
  return {
    snapshot: controller.snapshot(),
    capabilities,
    run,
    changes: projection.metadata,
    ...(writeReceipt === undefined ? {} : { writeReceipt }),
  }
}

function throwRetainedRendererError(error: unknown): void {
  if (error !== undefined) throw error
}

async function runBestEffortVisualCallback(
  renderer: VisualPlusRenderer,
  callback: () => void | Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  await renderer.suspendAsync(() => runContainedBestEffortCallback(callback, onFailure))
}

async function runContainedBestEffortCallback(
  callback: () => void | Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await callback()
  } catch (error) {
    onFailure(error)
  }
}

function finalizeVisualRun(
  renderer: VisualPlusRenderer | undefined,
  controller: CheckRunController | undefined,
  capabilities: VisualPlusCapabilities | undefined,
  run: VisualPlusRunMetadata,
  projection: VisualPlusSelectionProjection | undefined,
  evidence?: LegacySelectionEvidence,
  canonical?: WriteReceipt,
  readRendererError: () => unknown = () => undefined,
): void {
  if (!renderer) return
  throwRetainedRendererError(readRendererError())
  if (!(controller && capabilities && projection)) {
    throw new CheckRunInstrumentationError('Visual+ finalization input is incomplete')
  }
  let writeReceipt: VisualPlusWriteReceiptEvidence | undefined
  if (canonical && evidence) {
    writeReceipt = {
      canonical,
      operationIds: evidence.operations.map((operation) => operation.operationId),
      targets: evidence.targets,
      recovery: controller.snapshot().recovery,
    }
  }
  renderer.finalize(visualSectionInput(controller, capabilities, run, projection, writeReceipt))
  throwRetainedRendererError(readRendererError())
}

function renderNonTtyHint(options: depfreshOptions): void {
  if (process.stdout.isTTY || options.output !== 'table') return
  // biome-ignore lint/suspicious/noConsole: intentional stderr hint for non-TTY environments
  console.error(
    'Tip: Use --output json for structured output. Run --help-json for CLI capabilities.',
  )
}

function emitResolution(
  controller: CheckRunController | undefined,
  facts: Readonly<{ eligible: number; unresolved: number; updates: number }>,
): void {
  if (!controller) return
  controller.emit({ type: 'resolution-completed', ...facts, status: 'passed' })
}

function readResolutionFacts(
  completed: ReadonlyMap<PackageMeta, ResolvedDepChange[]>,
  expectedEligible: number,
): { eligible: number; unresolved: number; updates: number } {
  let unresolved = 0
  let updates = 0
  for (const changes of completed.values()) {
    for (const change of changes) {
      if (change.diff === 'error') unresolved += 1
      else if (change.diff !== 'none') updates += 1
    }
  }
  const eligible = expectedEligible
  if (updates + unresolved > eligible) {
    throw new CheckRunInstrumentationError('resolved facts exceed eligible occurrences')
  }
  return { eligible, unresolved, updates }
}

function emitReadOnlySelection(
  controller: CheckRunController | undefined,
  packages: PackageMeta[],
  root: string,
): void {
  if (!controller) return
  const changes: CheckRunChange[] = []
  const targetsByPath = new Map<string, string[]>()

  for (const [packageIndex, pkg] of packages.entries()) {
    const owner = repositoryRelativePath(root, pkg.filepath)
    for (const [changeIndex, change] of pkg.resolved.entries()) {
      if (change.diff === 'none' || change.diff === 'error') continue
      const id = `change:${packageIndex}:${changeIndex}`
      changes.push({
        id,
        name: sanitizeTerminalText(change.name),
        owner,
        current: sanitizeTerminalText(change.rawVersion ?? change.currentVersion),
        target: sanitizeTerminalText(change.targetVersion),
        diff: change.diff,
      })
      const operationIds = targetsByPath.get(owner)
      if (operationIds) operationIds.push(id)
      else targetsByPath.set(owner, [id])
    }
  }

  const selectedTargets: CheckRunTarget[] = [...targetsByPath].map(([path, operationIds]) => ({
    path,
    operationIds,
  }))
  if (changes.length !== controller.snapshot().counts.updates) {
    throw new CheckRunInstrumentationError('selected inventory differs from resolved updates')
  }
  controller.emit({
    type: 'selection-completed',
    operations: changes.length,
    targets: selectedTargets.length,
    changes,
    selectedTargets,
  })
}

function repositoryRelativePath(root: string, filepath: string): string {
  return relative(root, filepath).split(sep).map(encodeURIComponent).join('/')
}

function finalizeReadOnlyRun(
  controller: CheckRunController | undefined,
  exitCode: 0 | 1 | 2,
): void {
  if (!controller || controller.snapshot().exitCode !== null) return
  if (!controller.snapshot().terminalEvents.some((event) => event.id === 'results-recorded')) {
    const { operations, targets } = readOnlyResults(controller)
    controller.emit({ type: 'results-recorded', operations, targets })
  }
  controller.emit({
    type: 'run-completed',
    eventId: 'run-completed',
    elapsedMs: 0,
    exitCode,
  })
}

function failReadOnlyRun(
  controller: CheckRunController | undefined,
  diagnosticCode: 'CHECK_RUN_FAILED' | 'CHECK_RUN_INVARIANT',
): void {
  if (!controller || controller.snapshot().exitCode !== null) return
  const activePhase = controller
    .snapshot()
    .phases.find((phase) => phase.status === 'active' && phase.name !== 'complete')
  if (activePhase) {
    controller.emit({ type: 'phase-completed', phase: activePhase.name, status: 'failed' })
  }
  controller.emit({
    type: 'diagnostics-recorded',
    diagnostics: [{ code: diagnosticCode }],
  })
  finalizeReadOnlyRun(controller, 2)
}

function tryFailReadOnlyRun(
  controller: CheckRunController | undefined,
  diagnosticCode: 'CHECK_RUN_FAILED' | 'CHECK_RUN_INVARIANT',
): void {
  try {
    failReadOnlyRun(controller, diagnosticCode)
  } catch {
    // Model cleanup must not replace the command error already being handled.
  }
}

class CheckRunInstrumentationError extends Error {
  constructor(message: string) {
    super(`Check run instrumentation invariant: ${message}`)
  }
}

function readOnlyResults(controller: CheckRunController): {
  operations: CheckRunOperationResult[]
  targets: CheckRunTargetResult[]
} {
  const snapshot = controller.snapshot()
  const operations = snapshot.changes.map((change) => ({
    operationId: change.id,
    outcome: 'not-attempted' as const,
    blocked: false,
    notAttempted: true,
    unknown: false,
  }))
  const targets = snapshot.targets.map((target) => ({
    path: target.path,
    operationIds: target.operationIds,
    outcome: 'not-attempted' as const,
    blocked: false,
    notAttempted: true,
    unknown: false,
  }))
  return { operations, targets }
}

function writeDurable<T>(owner: DurableOutputOwner | null, write: () => T): T {
  return owner ? owner.suspend(write) : write()
}

function writeDurableAsync<T>(
  owner: DurableOutputOwner | null,
  write: () => Promise<T>,
): Promise<T> {
  return owner ? owner.suspendAsync(write) : write()
}

function renderWriteReceipt(lines: string[], logger: ReturnType<typeof createLogger>): void {
  if (lines.length > 0) logger.info(lines.join('\n'))
}

function renderGlobalWriteOutcomes(
  outcomes: WriteOutcome[],
  results: GlobalApplyResult[],
  logger: ReturnType<typeof createLogger>,
): void {
  const executorKeys = new Set<string>()
  const renderedKeys = new Set<string>()
  const items: Array<{ manager: string; name: string; status: string; reason: string }> = []
  const append = (item: { manager: string; name: string; status: string; reason: string }) => {
    const key = [item.manager, item.name, item.status, item.reason].join('\u0000')
    if (renderedKeys.has(key)) return
    renderedKeys.add(key)
    items.push(item)
  }

  for (const result of results) {
    for (const item of result.items) {
      executorKeys.add(globalOutcomeKey(item.manager, item.name))
      if (item.status !== 'applied') append(item)
    }
  }

  for (const outcome of outcomes) {
    if (!outcome.occurrence.file.startsWith('global:') || outcome.status === 'applied') continue
    const manager = outcome.occurrence.file.slice('global:'.length)
    if (executorKeys.has(globalOutcomeKey(manager, outcome.name))) continue
    append({ manager, name: outcome.name, status: outcome.status, reason: outcome.reason })
  }

  if (items.length === 0) return
  const lines = [
    'Global write outcomes',
    ...items.map((item) =>
      [item.manager, item.name, item.status, item.reason].map(sanitizeTerminalText).join(' · '),
    ),
  ]
  logger.info(lines.join('\n'))
}

function globalOutcomeKey(manager: string, name: string): string {
  return `${manager}\u0000${name}`
}

interface CheckExitCauses {
  strictResolutionFailed: boolean
  localWriteFailed: boolean
  globalWriteFailed: boolean
  strictPostWriteFailed: boolean
  failOnOutdated: boolean
}

function resolveCheckExitCode(input: CheckExitCauses): 0 | 1 | 2 {
  if (
    input.strictResolutionFailed ||
    input.localWriteFailed ||
    input.globalWriteFailed ||
    input.strictPostWriteFailed
  ) {
    return 2
  }
  return input.failOnOutdated ? 1 : 0
}

function isBlockingWriteStatus(status: string): boolean {
  return (
    status === 'conflicted' || status === 'reverted' || status === 'failed' || status === 'unknown'
  )
}

function renderSelectionReceipt(receipt: SelectionReceipt): void {
  const { summary } = receipt
  const workspaceLabel = summary.matchedWorkspaces === 1 ? 'workspace' : 'workspaces'
  const catalogLabel = summary.matchedCatalogNames === 1 ? 'catalog' : 'catalogs'
  // biome-ignore lint/suspicious/noConsole: intentional durable human receipt
  console.log(
    `Exclusions: ${summary.matchedWorkspaces} ${workspaceLabel} · ${summary.matchedCatalogNames} ${catalogLabel} · ${summary.excludedOccurrences} occurrences`,
  )
  if (summary.eligibleSharedCatalogOwners > 0) {
    // biome-ignore lint/suspicious/noConsole: intentional durable human receipt
    console.log(
      'Shared catalog owners remain eligible; use --exclude-catalog to exclude them explicitly.',
    )
  }
}

function logProfileReport(
  profile: NonNullable<depfreshOptions['profileReport']>,
  logger: ReturnType<typeof createLogger>,
): void {
  logger.info(
    `Profile: discovery=${profile.discoveryMs.toFixed(1)}ms, resolution=${profile.resolutionMs.toFixed(1)}ms, post-write=${profile.postWriteMs.toFixed(1)}ms, total=${profile.totalMs.toFixed(1)}ms`,
  )
  logger.info(
    `Profile: cache hits=${profile.cacheHits}, misses=${profile.cacheMisses}, entries=${profile.cacheEntries}, fetches=${profile.networkFetches}, dedupeHits=${profile.dedupeHits}`,
  )
  logger.info(
    `Profile: packages=${profile.scannedPackages}, deps=${profile.scannedDependencies}, failedResolutions=${profile.failedResolutions}`,
  )
}

function logDiscoveryReport(
  options: depfreshOptions,
  logger: ReturnType<typeof createLogger>,
): void {
  const report = options.discoveryReport
  if (!report) return

  logger.info(
    `Discovery: mode=${report.discoveryMode}, input=${report.inputCwd}, root=${report.effectiveRoot}`,
  )
  logger.info(
    `Discovery: matched ${report.matchedManifests.length}, loaded ${report.loadedPackages.length}, skipped ${report.skippedManifests.length}, catalogs ${report.loadedCatalogs.length}`,
  )

  for (const path of report.loadedPackages) {
    logger.info(`Discovery loaded: ${path}`)
  }

  for (const skipped of report.skippedManifests) {
    logger.info(`Discovery skipped: ${skipped.path} (${skipped.reason})`)
  }

  for (const catalog of report.loadedCatalogs) {
    logger.info(`Discovery catalog: ${catalog}`)
  }
}
