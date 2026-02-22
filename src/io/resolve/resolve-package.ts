import pLimit from 'p-limit'
import type { Cache } from '../../cache/index'
import { createSqliteCache } from '../../cache/index'
import type { NpmrcConfig, PackageMeta, RawDep, ResolvedDepChange, UpgrOptions } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadNpmrc } from '../../utils/npmrc'
import { resolveDependency } from './resolve-dependency'

export async function resolvePackage(
  pkg: PackageMeta,
  options: UpgrOptions,
  externalCache?: Cache,
  externalNpmrc?: NpmrcConfig,
  privatePackages?: Set<string>,
  onDependencyProcessed?: (pkg: PackageMeta, dep: RawDep) => void | Promise<void>,
): Promise<ResolvedDepChange[]> {
  const logger = createLogger(options.loglevel)
  const npmrc = externalNpmrc ?? loadNpmrc(options.cwd)
  const cache = externalCache ?? createSqliteCache()
  const ownCache = !externalCache
  const limit = pLimit(options.concurrency)

  try {
    const results = await Promise.allSettled(
      pkg.deps
        .filter((dep) => dep.update)
        .map((dep) =>
          limit(async () => {
            try {
              return await resolveDependency(dep, options, cache, npmrc, logger, privatePackages)
            } finally {
              await onDependencyProcessed?.(pkg, dep)
            }
          }),
        ),
    )

    const resolved: ResolvedDepChange[] = []

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        resolved.push(result.value)
        options.onDependencyResolved?.(pkg, result.value)
      } else if (result.status === 'rejected') {
        logger.debug(`Resolution failed: ${result.reason}`)
      }
    }

    return resolved
  } finally {
    if (ownCache) {
      const stats = cache.stats()
      cache.close()
      logger.debug(`Cache stats: ${stats.hits} hits, ${stats.misses} misses, ${stats.size} entries`)
    }
  }
}
