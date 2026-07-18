import { relative, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import c from 'ansis'
import { createAddonLifecycle } from '../../addons'
import { createSqliteCache } from '../../cache/index'
import type { InvocationScopeExclusions } from '../../cli/scope-exclusions'
import { hasInvocationScopeExclusions } from '../../cli/scope-exclusions'
import { createInvocationAuthority, snapshotInvocationAuthority } from '../../invocation-authority'
import { loadPackages } from '../../io/packages'
import type { PackageLoadObserver } from '../../io/packages/discovery'
import { resolveDiscoveryContext } from '../../io/packages/root-detection'
import { createResolveContext, resolvePackage } from '../../io/resolve'
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
  buildJsonPackage,
  type JsonError,
  type JsonExecutionState,
  type JsonPackage,
  outputJsonEnvelope,
  outputJsonError,
} from './json-output'
import { runInstall, runUpdate } from './package-manager'
import { renderUpToDate, runExecute } from './post-write-actions'
import { type ProcessPackageHooks, processPackage } from './process-package'
import { type CheckProgress, createCheckProgress } from './progress'
import { renderResolutionErrors, renderTable } from './render'
import type { CheckRunController } from './run-controller'
import type {
  CheckRunChange,
  CheckRunOperationResult,
  CheckRunTarget,
  CheckRunTargetResult,
} from './run-model'
import { buildWriteReceipt, formatWriteReceipt } from './write-receipt'

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
): Promise<number> {
  return runCheck(options, requestedAuthority, true, invocationSelection)
}

export async function runCheck(
  options: depfreshOptions,
  requestedAuthority: InvocationAuthority,
  renderProgress: boolean,
  invocationSelection?: InvocationScopeExclusions,
  injectedRunController?: CheckRunController,
): Promise<number> {
  const authority = snapshotInvocationAuthority(requestedAuthority)
  const totalStart = performance.now()
  const runController = shouldModelRun(options) ? injectedRunController : undefined
  const logLevel = options.output === 'json' ? 'silent' : options.loglevel
  const addonOptions: depfreshOptions = {
    ...options,
    loglevel: logLevel,
  }
  const logger = createLogger(logLevel)
  const addons = createAddonLifecycle(addonOptions)
  let progress: CheckProgress | null = null
  const runtimeOptions: depfreshOptions = {
    ...addonOptions,
    onDependencyResolved: (pkg, dep) => addons.onDependencyResolved(pkg, dep),
  }

  try {
    validateOptions(runtimeOptions, authority)

    const hasPerDependencyLifecycle = Boolean(
      options.onDependencyResolved || options.addons?.some((addon) => addon.onDependencyResolved),
    )
    const hasAfterPackageEndLifecycle = Boolean(
      options.afterPackageEnd || options.addons?.some((addon) => addon.afterPackageEnd),
    )
    progress = renderProgress && !hasPerDependencyLifecycle ? createCheckProgress(options) : null
    const discoveryStart = performance.now()
    const activeProgress = progress
    let selectionReceipt: SelectionReceipt | undefined
    const hasSelection = Boolean(
      invocationSelection && hasInvocationScopeExclusions(invocationSelection),
    )
    const packageObserver: PackageLoadObserver | undefined =
      activeProgress || runController
        ? {
            onPackagesDiscovered: (discoveredPackages: PackageMeta[]) => {
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
            },
            ...(activeProgress
              ? { writeDurable: <T>(write: () => T): T => activeProgress.suspend(write) }
              : { preserveDefaultLog: true }),
          }
        : undefined
    const packages = packageObserver
      ? hasSelection
        ? await loadPackages(runtimeOptions, packageObserver, invocationSelection)
        : await loadPackages(runtimeOptions, packageObserver)
      : hasSelection
        ? await loadPackages(runtimeOptions, undefined, invocationSelection)
        : await loadPackages(runtimeOptions)
    const declaredDependencies = packages.reduce((sum, pkg) => sum + pkg.deps.length, 0)
    runController?.emit({ type: 'repository-inspection-completed', status: 'passed' })
    selectionReceipt = readInvocationSelectionReceipt(runtimeOptions)
    const discoveryMs = performance.now() - discoveryStart
    progress?.onPackagesReady(packages)
    if (selectionReceipt && hasSelection && runtimeOptions.output === 'table') {
      writeDurable(progress, () => renderSelectionReceipt(selectionReceipt!))
    }
    if (runtimeOptions.explainDiscovery && runtimeOptions.output === 'table') {
      writeDurable(progress, () => logDiscoveryReport(runtimeOptions, logger))
    }
    await writeDurableAsync(progress, () => addons.setup())
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
      logger.warn('No packages found')
      if (options.output === 'json') {
        outputJsonEnvelope([], runtimeOptions, executionState, [], selectionReceipt)
      }
      const noPackagesExitCode = options.failOnNoPackages ? 2 : 0
      finalizeReadOnlyRun(runController, noPackagesExitCode)
      return noPackagesExitCode
    }

    await writeDurableAsync(progress, () => addons.afterPackagesLoaded(packages))

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
        } else {
          writeDurable(progress, () => renderTable(pkg.name, updates, options))
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
          writeDurable(progress, () => renderResolutionErrors(pkg.name, errors))
        }
      },
      onAllModeNoUpdates: () => {
        if (!options.all) return
        if (options.output === 'json') {
          jsonPackages.push(buildJsonPackage(pkg.name, []))
        } else {
          writeDurable(progress, () => renderUpToDate(pkg.name))
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
    try {
      const pendingResolutions = new Map<PackageMeta, Promise<ResolvedDepChange[]>>()

      await writeDurableAsync(progress, async () => {
        for (const pkg of packages) {
          await addons.beforePackageStart(pkg)
          pendingResolutions.set(
            pkg,
            resolvePackage(
              pkg,
              runtimeOptions,
              cache,
              npmrc,
              workspacePackageNames,
              progress ? () => progress?.onDependencyProcessed() : undefined,
              resolveContext,
            ),
          )
        }
      })

      const completedResolutions = new Map<PackageMeta, ResolvedDepChange[]>()
      await Promise.all(
        packages.map(async (pkg) => {
          const pending = pendingResolutions.get(pkg)
          if (pending) completedResolutions.set(pkg, await pending)
        }),
      )
      if (runController) {
        const resolutionFacts = readResolutionFacts(completedResolutions, totalDependencies)
        emitResolution(runController, resolutionFacts)
      }
      progress?.onRenderingStart()
      for (const pkg of packages) {
        const processCurrentPackage = () =>
          processPackage(
            pkg,
            runtimeOptions,
            authority,
            packageHooks(pkg),
            Promise.resolve(completedResolutions.get(pkg) ?? []),
            true,
          )
        if (runtimeOptions.write || runtimeOptions.interactive || hasAfterPackageEndLifecycle) {
          await writeDurableAsync(progress, processCurrentPackage)
        } else {
          await processCurrentPackage()
        }
        progress?.onPackageRendered()
      }
      await writeDurableAsync(progress, () => addons.afterPackagesEnd(packages))
      emitReadOnlySelection(runController, packages, executionRoot)
    } finally {
      progress?.done()
      const stats = cache.stats()
      cache.close()
      logger.debug(`Cache stats: ${stats.hits} hits, ${stats.misses} misses, ${stats.size} entries`)
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
      const executeSucceeded = await runExecute(options.execute, executionRoot, logger)
      postWriteFailed = postWriteFailed || !executeSucceeded
    }

    if (authority.write && didWrite && !writeFailed) {
      if (authority.update && options.update) {
        const updateSucceeded = await runUpdate(executionRoot, packages, logger)
        postWriteFailed = postWriteFailed || !updateSucceeded
      } else if (authority.install && options.install) {
        const installSucceeded = await runInstall(executionRoot, packages, logger)
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

    if (options.output === 'json') {
      outputJsonEnvelope(jsonPackages, runtimeOptions, executionState, jsonErrors, selectionReceipt)
    } else {
      renderGlobalWriteOutcomes(executionState.writeOutcomes, executionState.globalResults, logger)
      const localWriteOutcomes = executionState.writeOutcomes.filter(
        (outcome) => !outcome.occurrence.file.startsWith('global:'),
      )
      if (localWriteOutcomes.length > 0) {
        renderWriteReceipt(
          formatWriteReceipt(
            buildWriteReceipt({
              outcomes: localWriteOutcomes,
              diagnostics: writeDiagnostics,
              cwd: executionRoot,
            }),
            {
              code: finalExitCode,
              strictResolutionFailed: exitCauses.strictResolutionFailed,
              globalWriteFailed: exitCauses.globalWriteFailed,
              strictPostWriteFailed: exitCauses.strictPostWriteFailed,
            },
          ),
          logger,
        )
      }
    }

    if (!hasUpdates && executionState.failedResolutions === 0) {
      logger.success('All dependencies are up to date')
    } else if (executionState.failedResolutions > 0 && options.output === 'table') {
      logger.warn(`${executionState.failedResolutions} dependencies failed to resolve`)
    }

    if (hasUpdates && options.output === 'table') {
      if (options.mode === 'default') {
        logger.info(c.gray('Tip: Run `depfresh major` to check for major updates'))
      }
      if (!options.write) {
        logger.info(c.gray('Tip: Add `-w` to write changes to package files'))
      }
    }

    if (!process.stdout.isTTY && options.output === 'table') {
      // biome-ignore lint/suspicious/noConsole: intentional stderr hint for non-TTY environments
      console.error(
        'Tip: Use --output json for structured output. Run --help-json for CLI capabilities.',
      )
    }

    if (executionState.failedResolutions > 0 && options.failOnResolutionErrors) {
      finalizeReadOnlyRun(runController, finalExitCode)
      return finalExitCode
    }

    if (writeFailed) {
      finalizeReadOnlyRun(runController, finalExitCode)
      return finalExitCode
    }

    if (
      runtimeOptions.profile &&
      runtimeOptions.output === 'table' &&
      runtimeOptions.profileReport
    ) {
      logProfileReport(runtimeOptions.profileReport, logger)
    }

    if (postWriteFailed && options.strictPostWrite) {
      finalizeReadOnlyRun(runController, finalExitCode)
      return finalExitCode
    }

    finalizeReadOnlyRun(runController, finalExitCode)
    return finalExitCode
  } catch (error) {
    progress?.done()
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
  }
}

function shouldModelRun(options: depfreshOptions): boolean {
  return !(options.write || options.global || options.globalAll)
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
  const { operations, targets } = readOnlyResults(controller)
  controller.emit({ type: 'results-recorded', operations, targets })
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

function writeDurable<T>(progress: CheckProgress | null, write: () => T): T {
  return progress ? progress.suspend(write) : write()
}

function writeDurableAsync<T>(progress: CheckProgress | null, write: () => Promise<T>): Promise<T> {
  return progress ? progress.suspendAsync(write) : write()
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
