import { isAbsolute, relative, sep } from 'node:path'
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
import type { LegacyCommandApplyResult, LegacyCommandSelection } from '../apply/legacy-plan'
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
import { renderResolutionErrors, renderTable } from './render'
import type { CheckRunController } from './run-controller'
import type {
  CheckRunChange,
  CheckRunDiagnostic,
  CheckRunOperationResult,
  CheckRunTarget,
  CheckRunTargetOutcome,
  CheckRunTargetResult,
} from './run-model'
import { applyLegacyCommandWrite, applyPackageWrite, type PackageWriteResult } from './write-flow'
import {
  buildWriteReceipt,
  type CommandWriteReceiptEvidence,
  formatWriteReceipt,
} from './write-receipt'

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
              if (runController && !activeProgress) {
                logger.info(
                  `Found ${discoveredPackages.length} packages with ${discoveredPackages.reduce((sum, pkg) => sum + pkg.deps.length, 0)} dependencies`,
                )
              }
            },
            ...(activeProgress
              ? { writeDurable: <T>(write: () => T): T => activeProgress.suspend(write) }
              : {}),
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
    let commandReceiptEvidence: CommandWriteReceiptEvidence | undefined
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
      const preparedPackages = await prepareAllPackages(
        packages,
        completedResolutions,
        runtimeOptions,
        authority,
        packageHooks,
        progress,
      )
      const applyExecution = await applyPreparedPackages(
        preparedPackages,
        runtimeOptions,
        authority,
        executionRoot,
        packageHooks,
      )
      let modelEmission: PackageCompletion = { ok: true }
      if (runtimeOptions.write) {
        try {
          emitLocalWriteResult(runController, executionRoot, applyExecution)
        } catch (error) {
          modelEmission = { ok: false, error }
        }
      }
      const completion = await completeAllPackagesRetainingError(
        preparedPackages,
        applyExecution.packageResults,
        packageHooks,
      )
      if (!modelEmission.ok) throw modelEmission.error
      if (!completion.ok) throw completion.error
      await writeDurableAsync(progress, () => addons.afterPackagesEnd(packages))
      commandReceiptEvidence =
        runtimeOptions.output === 'table'
          ? createCommandReceiptEvidence(executionRoot, applyExecution.localExecution)
          : undefined
      if (!runtimeOptions.write) emitReadOnlySelection(runController, packages, executionRoot)
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
              ...(commandReceiptEvidence ? { commandEvidence: commandReceiptEvidence } : {}),
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

async function prepareAllPackages(
  packages: readonly PackageMeta[],
  completedResolutions: ReadonlyMap<PackageMeta, ResolvedDepChange[]>,
  options: depfreshOptions,
  authority: InvocationAuthority,
  hooksFor: (pkg: PackageMeta) => ProcessPackageHooks,
  progress: CheckProgress | null,
): Promise<PreparedPackage[]> {
  const preparedPackages: PreparedPackage[] = []
  try {
    for (const pkg of packages) {
      const prepared = await writeDurableAsync(progress, () =>
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
      const commandResult = await applyLegacyCommandWrite(executionRoot, localSelections, authority)
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
  emitApplyPhases(controller, localExecution.result.applyResult)
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
      entries.length !== 1 ||
      attempt.operationIds.length !== 1
    ) {
      return undefined
    }
    const operationId = attempt.operationIds[0]!
    if (!isSafeModelIdentifier(operationId) || operationIds.has(operationId)) return undefined
    operationIds.add(operationId)
    const entry = entries[0]!
    changes.push({
      id: operationId,
      name: sanitizeTerminalText(entry.outcome.name),
      owner: path,
      current: sanitizeTerminalText(entry.outcome.expectedValue),
      target: sanitizeTerminalText(entry.outcome.requestedValue),
      diff: projectedDiff(entry.changes),
    })
    targets.push({ path, operationIds: [operationId] })
    operations.push({
      operationId,
      outcome: 'blocked',
      blocked: true,
      notAttempted: true,
      unknown: false,
    })
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
      byTarget: Map<string, Array<{ outcome: WriteOutcome; changes: ResolvedDepChange[] }>>
    }
  | undefined {
  const packages = new Map(execution.result.packages.map((entry) => [entry.packageIndex, entry]))
  const byKey = new Map<string, ResolvedDepChange[]>()
  const outcomeByKey = new Map<string, WriteOutcome>()
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
      if (existing) existing.push(change)
      else {
        byKey.set(key, [change])
        outcomeByKey.set(key, outcome)
      }
    }
  }
  const byTarget = new Map<string, Array<{ outcome: WriteOutcome; changes: ResolvedDepChange[] }>>()
  for (const [key, changes] of byKey) {
    const outcome = outcomeByKey.get(key)
    if (!outcome) return undefined
    const file = safeRepositoryPath(root, outcome.occurrence.file)
    if (!file) return undefined
    const entries = byTarget.get(file)
    const entry = { outcome, changes }
    if (entries) entries.push(entry)
    else byTarget.set(file, [entry])
  }
  return { byKey, byTarget }
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
  result: Extract<LegacyCommandApplyResult, { status: 'executed' }>['applyResult'],
): void {
  const preflight = requireApplyPhase(result, 'preflight')
  const preflightStatus =
    preflight.status === 'failed' &&
    result.operations.some((operation) => operation.status === 'conflicted')
      ? 'blocked'
      : preflight.status
  controller.emit({ type: 'phase-completed', phase: 'preflight', status: preflightStatus })
  if (preflightStatus !== 'passed') {
    emitRetainedCleanupEvidence(controller, result)
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
    emitRetainedCleanupEvidence(controller, result)
    return
  }
  controller.emit({ type: 'phase-completed', phase: 'stage', status: stageStatus })
  if (stageStatus !== 'passed') {
    emitRetainedCleanupEvidence(controller, result)
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
    emitRetainedCleanupEvidence(controller, result)
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
  if (!recoveryRequired) emitRetainedCleanupEvidence(controller, result)
}

function emitRetainedCleanupEvidence(
  controller: CheckRunController,
  result: Extract<LegacyCommandApplyResult, { status: 'executed' }>['applyResult'],
): void {
  if (result.recovery.status !== 'unknown') return
  if (
    (result.recovery.restoredPaths?.length ?? 0) > 0 ||
    (result.recovery.unrecoveredPaths?.length ?? 0) > 0
  ) {
    throw new CheckRunInstrumentationError(
      'non-executed cleanup evidence cannot retain recovery paths',
    )
  }
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
