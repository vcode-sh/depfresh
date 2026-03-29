import { performance } from 'node:perf_hooks'
import c from 'ansis'
import { createAddonLifecycle } from '../../addons'
import { createSqliteCache } from '../../cache/index'
import { loadPackages } from '../../io/packages'
import { resolveDiscoveryContext } from '../../io/packages/root-detection'
import { createResolveContext, resolvePackage } from '../../io/resolve'
import type { depfreshOptions, PackageMeta, ResolvedDepChange } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadNpmrc } from '../../utils/npmrc'
import { validateOptions } from '../../validate-options'
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
import { createCheckProgress } from './progress'
import { renderResolutionErrors, renderTable } from './render'

export async function check(options: depfreshOptions): Promise<number> {
  const totalStart = performance.now()
  const logLevel = options.output === 'json' ? 'silent' : options.loglevel
  const addonOptions: depfreshOptions = {
    ...options,
    loglevel: logLevel,
  }
  const logger = createLogger(logLevel)
  const addons = createAddonLifecycle(addonOptions)
  const runtimeOptions: depfreshOptions = {
    ...addonOptions,
    onDependencyResolved: (pkg, dep) => addons.onDependencyResolved(pkg, dep),
  }

  try {
    validateOptions(runtimeOptions)
    await addons.setup()

    const discoveryStart = performance.now()
    const packages = await loadPackages(runtimeOptions)
    const discoveryMs = performance.now() - discoveryStart
    if (runtimeOptions.explainDiscovery && runtimeOptions.output === 'table') {
      logDiscoveryReport(runtimeOptions, logger)
    }
    const executionState: JsonExecutionState = {
      scannedPackages: packages.length,
      packagesWithUpdates: 0,
      plannedUpdates: 0,
      appliedUpdates: 0,
      revertedUpdates: 0,
      failedResolutions: 0,
      noPackagesFound: packages.length === 0,
      didWrite: false,
    }

    if (packages.length === 0) {
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
        outputJsonEnvelope([], runtimeOptions, executionState)
      }
      return options.failOnNoPackages ? 2 : 0
    }

    await addons.afterPackagesLoaded(packages)

    let hasUpdates = false
    let didWrite = false
    const jsonPackages: JsonPackage[] = []
    const jsonErrors: JsonError[] = []
    const progress = createCheckProgress(options, packages)
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
      onDependencyProcessed: () => progress?.onDependencyProcessed(),
      onHasUpdates: (updates: ResolvedDepChange[]) => {
        hasUpdates = true
        executionState.packagesWithUpdates += 1
        if (options.output === 'json') {
          jsonPackages.push(buildJsonPackage(pkg.name, updates))
        } else {
          renderTable(pkg.name, updates, options)
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
          renderResolutionErrors(pkg.name, errors)
        }
      },
      onAllModeNoUpdates: () => {
        if (!options.all) return
        if (options.output === 'json') {
          jsonPackages.push(buildJsonPackage(pkg.name, []))
        } else {
          renderUpToDate(pkg.name)
        }
      },
      onPlannedUpdates: (count: number) => {
        executionState.plannedUpdates += count
      },
      onWriteResult: (result: { applied: number; reverted: number }) => {
        executionState.appliedUpdates += result.applied
        executionState.revertedUpdates += result.reverted
      },
      onDidWrite: () => {
        didWrite = true
        executionState.didWrite = true
      },
      logger,
    })

    const resolutionStart = performance.now()
    try {
      if (progress === null && packages.length > 1) {
        const pendingResolutions = new Map<PackageMeta, Promise<ResolvedDepChange[]>>()

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
              undefined,
              resolveContext,
            ),
          )
        }

        for (const pkg of packages) {
          await processPackage(
            pkg,
            runtimeOptions,
            packageHooks(pkg),
            pendingResolutions.get(pkg),
            true,
          )
        }
      } else {
        for (const pkg of packages) {
          progress?.onPackageStart(pkg)
          await processPackage(pkg, runtimeOptions, packageHooks(pkg))
          progress?.onPackageEnd()
        }
      }
      await addons.afterPackagesEnd(packages)
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

    let postWriteFailed = false
    const postWriteStart = performance.now()

    if (options.execute && options.write && didWrite) {
      const executeSucceeded = await runExecute(options.execute, executionRoot, logger)
      postWriteFailed = postWriteFailed || !executeSucceeded
    }

    if (options.write && didWrite) {
      if (options.update) {
        const updateSucceeded = await runUpdate(executionRoot, packages, logger)
        postWriteFailed = postWriteFailed || !updateSucceeded
      } else if (options.install) {
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
      outputJsonEnvelope(jsonPackages, runtimeOptions, executionState, jsonErrors)
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
    if (options.output === 'json') {
      outputJsonError(error, { cwd: options.cwd, mode: options.mode })
    } else {
      logger.error('Check failed:', error instanceof Error ? error.message : String(error))
    }
    return 2
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
