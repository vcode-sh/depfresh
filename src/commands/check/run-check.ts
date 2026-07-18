import { performance } from 'node:perf_hooks'
import c from 'ansis'
import { createAddonLifecycle } from '../../addons'
import { createSqliteCache } from '../../cache/index'
import type { InvocationScopeExclusions } from '../../cli/scope-exclusions'
import { hasInvocationScopeExclusions } from '../../cli/scope-exclusions'
import { createInvocationAuthority, snapshotInvocationAuthority } from '../../invocation-authority'
import { loadPackages } from '../../io/packages'
import { resolveDiscoveryContext } from '../../io/packages/root-detection'
import { createResolveContext, resolvePackage } from '../../io/resolve'
import { readInvocationSelectionReceipt, type SelectionReceipt } from '../../selection'
import type {
  depfreshOptions,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
} from '../../types'
import { summarizeWriteOutcomes } from '../../types'
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

async function runCheck(
  options: depfreshOptions,
  requestedAuthority: InvocationAuthority,
  renderProgress: boolean,
  invocationSelection?: InvocationScopeExclusions,
): Promise<number> {
  const authority = snapshotInvocationAuthority(requestedAuthority)
  const totalStart = performance.now()
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
    const progressObserver = activeProgress
      ? {
          onPackagesDiscovered: (discoveredPackages: PackageMeta[]) => {
            activeProgress.onPackagesDiscovered(discoveredPackages)
            if (!(runtimeOptions.global || runtimeOptions.globalAll)) {
              activeProgress.onRepositoryInspectionStart()
            }
          },
          writeDurable: <T>(write: () => T) => activeProgress.suspend(write),
        }
      : undefined
    const packages = activeProgress
      ? hasSelection
        ? await loadPackages(runtimeOptions, progressObserver, invocationSelection)
        : await loadPackages(runtimeOptions, progressObserver)
      : hasSelection
        ? await loadPackages(runtimeOptions, undefined, invocationSelection)
        : await loadPackages(runtimeOptions)
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
      return options.failOnNoPackages ? 2 : 0
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
      const declaredDependencies = packages.reduce((sum, pkg) => sum + pkg.deps.length, 0)
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
    const writeFailed =
      executionState.conflictedUpdates > 0 ||
      executionState.failedWrites > 0 ||
      executionState.unknownWrites > 0

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

    if (options.output === 'json') {
      outputJsonEnvelope(jsonPackages, runtimeOptions, executionState, jsonErrors, selectionReceipt)
    } else if (executionState.plannedUpdates > 0) {
      renderWriteReceipt(
        formatWriteReceipt(
          buildWriteReceipt({
            outcomes: executionState.writeOutcomes,
            diagnostics: writeDiagnostics,
            cwd: executionRoot,
          }),
        ),
        logger,
      )
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
      return 2
    }

    if (writeFailed) return 2

    if (
      runtimeOptions.profile &&
      runtimeOptions.output === 'table' &&
      runtimeOptions.profileReport
    ) {
      logProfileReport(runtimeOptions.profileReport, logger)
    }

    if (postWriteFailed && options.strictPostWrite) {
      return 2
    }

    return hasUpdates && !options.write && options.failOnOutdated ? 1 : 0
  } catch (error) {
    progress?.done()
    if (options.output === 'json') {
      outputJsonError(error, { cwd: options.cwd, mode: options.mode })
    } else {
      logger.error('Check failed:', getSafeErrorDetails(error).message)
    }
    return 2
  }
}

function writeDurable<T>(progress: CheckProgress | null, write: () => T): T {
  return progress ? progress.suspend(write) : write()
}

function writeDurableAsync<T>(progress: CheckProgress | null, write: () => Promise<T>): Promise<T> {
  return progress ? progress.suspendAsync(write) : write()
}

function renderWriteReceipt(lines: string[], logger: ReturnType<typeof createLogger>): void {
  const headline = lines[0]
  const exit = lines.at(-1)
  if (headline) logger.info(headline)
  for (let index = 1; index < lines.length - 1; index += 2) {
    const group = lines[index]
    const reason = lines[index + 1]
    if (group) logger.warn(reason ? `${group}\n${reason}` : group)
  }
  if (exit && exit !== headline) logger.info(exit)
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
