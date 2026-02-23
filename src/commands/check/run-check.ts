import c from 'ansis'
import { createAddonLifecycle } from '../../addons'
import { createSqliteCache } from '../../cache/index'
import { loadPackages } from '../../io/packages'
import type { depfreshOptions, ResolvedDepChange } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadNpmrc } from '../../utils/npmrc'
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
import { processPackage } from './process-package'
import { createCheckProgress } from './progress'
import { renderTable } from './render'

export async function check(options: depfreshOptions): Promise<number> {
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
    await addons.setup()

    const packages = await loadPackages(runtimeOptions)
    const executionState: JsonExecutionState = {
      scannedPackages: packages.length,
      packagesWithUpdates: 0,
      plannedUpdates: 0,
      appliedUpdates: 0,
      revertedUpdates: 0,
      noPackagesFound: packages.length === 0,
      didWrite: false,
    }

    if (packages.length === 0) {
      logger.warn('No packages found')
      if (options.output === 'json') {
        outputJsonEnvelope([], options, executionState)
      }
      return 0
    }

    await addons.afterPackagesLoaded(packages)

    let hasUpdates = false
    let didWrite = false
    const jsonPackages: JsonPackage[] = []
    const jsonErrors: JsonError[] = []
    const progress = createCheckProgress(options, packages)

    const cache = createSqliteCache()
    const npmrc = loadNpmrc(options.cwd)
    const workspacePackageNames = new Set(packages.map((p) => p.name).filter(Boolean))

    try {
      for (const pkg of packages) {
        progress?.onPackageStart(pkg)
        await processPackage(pkg, runtimeOptions, {
          cache,
          npmrc,
          workspacePackageNames,
          beforePackageStart: (currentPkg) => addons.beforePackageStart(currentPkg),
          beforePackageWrite: (currentPkg, changes) =>
            addons.beforePackageWrite(currentPkg, changes),
          afterPackageWrite: (currentPkg, changes) => addons.afterPackageWrite(currentPkg, changes),
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
            if (options.output === 'json') {
              for (const dep of errors) {
                jsonErrors.push({
                  name: dep.name,
                  source: dep.source,
                  currentVersion: dep.currentVersion,
                  message: 'Failed to resolve from registry',
                })
              }
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
          onWriteResult: (result) => {
            executionState.appliedUpdates += result.applied
            executionState.revertedUpdates += result.reverted
          },
          onDidWrite: () => {
            didWrite = true
            executionState.didWrite = true
          },
          logger,
        })
        progress?.onPackageEnd()
      }
      await addons.afterPackagesEnd(packages)
    } finally {
      progress?.done()
      const stats = cache.stats()
      cache.close()
      logger.debug(`Cache stats: ${stats.hits} hits, ${stats.misses} misses, ${stats.size} entries`)
    }

    if (options.execute && options.write && didWrite) {
      await runExecute(options.execute, options.cwd, logger)
    }

    if (options.write && didWrite) {
      if (options.update) {
        await runUpdate(options.cwd, packages, logger)
      } else if (options.install) {
        await runInstall(options.cwd, packages, logger)
      }
    }

    if (options.output === 'json') {
      outputJsonEnvelope(jsonPackages, options, executionState, jsonErrors)
    }

    if (!hasUpdates) {
      logger.success('All dependencies are up to date')
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
