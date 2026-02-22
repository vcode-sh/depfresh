import c from 'ansis'
import { createSqliteCache } from '../../cache/index'
import { loadPackages } from '../../io/packages'
import type { ResolvedDepChange, UpgrOptions } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadNpmrc } from '../../utils/npmrc'
import { buildJsonPackage, type JsonPackage, outputJsonEnvelope } from './json-output'
import { runInstall, runUpdate } from './package-manager'
import { renderUpToDate, runExecute } from './post-write-actions'
import { processPackage } from './process-package'
import { createCheckProgress } from './progress'
import { renderTable } from './render'

export async function check(options: UpgrOptions): Promise<number> {
  const logLevel = options.output === 'json' ? 'silent' : options.loglevel
  const logger = createLogger(logLevel)

  try {
    const packages = await loadPackages(options)

    if (packages.length === 0) {
      logger.warn('No packages found')
      if (options.output === 'json') {
        outputJsonEnvelope([], options)
      }
      return 0
    }

    await options.afterPackagesLoaded?.(packages)

    let hasUpdates = false
    let didWrite = false
    const jsonPackages: JsonPackage[] = []
    const progress = createCheckProgress(options, packages)

    const cache = createSqliteCache()
    const npmrc = loadNpmrc(options.cwd)
    const workspacePackageNames = new Set(packages.map((p) => p.name).filter(Boolean))

    try {
      for (const pkg of packages) {
        progress?.onPackageStart(pkg)
        await processPackage(pkg, options, {
          cache,
          npmrc,
          workspacePackageNames,
          onDependencyProcessed: () => progress?.onDependencyProcessed(),
          onHasUpdates: (updates: ResolvedDepChange[]) => {
            hasUpdates = true
            if (options.output === 'json') {
              jsonPackages.push(buildJsonPackage(pkg.name, updates))
            } else {
              renderTable(pkg.name, updates, options)
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
          onDidWrite: () => {
            didWrite = true
          },
          logger,
        })
        progress?.onPackageEnd()
      }
      await options.afterPackagesEnd?.(packages)
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
      outputJsonEnvelope(jsonPackages, options)
    }

    if (!hasUpdates) {
      logger.success('All dependencies are up to date')
    }

    if (hasUpdates && options.output === 'table') {
      if (options.mode === 'default') {
        logger.info(c.gray('Tip: Run `upgr major` to check for major updates'))
      }
      if (!options.write) {
        logger.info(c.gray('Tip: Add `-w` to write changes to package files'))
      }
    }

    return hasUpdates && !options.write && options.failOnOutdated ? 1 : 0
  } catch (error) {
    logger.error('Check failed:', error instanceof Error ? error.message : String(error))
    return 2
  }
}
