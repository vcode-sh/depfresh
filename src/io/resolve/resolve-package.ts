import pLimit from 'p-limit'
import type { Cache } from '../../cache/index'
import { createSqliteCache } from '../../cache/index'
import type {
  depfreshOptions,
  NpmrcConfig,
  PackageMeta,
  RawDep,
  ResolvedDepChange,
} from '../../types'
import { createLogger } from '../../utils/logger'
import { loadNpmrc } from '../../utils/npmrc'
import { resolveDiscoveryContext } from '../packages/root-detection'
import type { ResolveContext } from './context'
import { resolveDependency } from './resolve-dependency'

function createResolutionError(dep: RawDep): ResolvedDepChange {
  return {
    ...dep,
    targetVersion: dep.currentVersion,
    diff: 'error',
    pkgData: {
      name: dep.aliasName ?? dep.name,
      versions: [],
      distTags: {},
    },
  }
}

async function runBestEffortCallback(
  logger: ReturnType<typeof createLogger>,
  label: string,
  callback: (() => void | Promise<void>) | undefined,
): Promise<void> {
  if (!callback) return

  try {
    await callback()
  } catch (error) {
    logger.debug(
      `Ignored ${label} callback failure: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function resolvePackage(
  pkg: PackageMeta,
  options: depfreshOptions,
  externalCache?: Cache,
  externalNpmrc?: NpmrcConfig,
  privatePackages?: Set<string>,
  onDependencyProcessed?: (pkg: PackageMeta, dep: RawDep) => void | Promise<void>,
  resolveContext?: ResolveContext,
): Promise<ResolvedDepChange[]> {
  const logger = createLogger(options.loglevel)
  const effectiveRoot = options.effectiveRoot ?? resolveDiscoveryContext(options.cwd).effectiveRoot
  const npmrc = externalNpmrc ?? loadNpmrc(effectiveRoot)
  const cache = externalCache ?? createSqliteCache()
  const ownCache = !externalCache
  const limit = resolveContext?.limit ?? pLimit(options.concurrency)

  try {
    const results = await Promise.allSettled(
      pkg.deps
        .filter((dep) => dep.update)
        .map((dep) =>
          limit(async () => {
            try {
              return await resolveDependency(
                dep,
                options,
                cache,
                npmrc,
                logger,
                privatePackages,
                resolveContext,
              )
            } catch (error) {
              logger.debug(
                `Resolution failed for ${dep.aliasName ?? dep.name}: ${error instanceof Error ? error.message : String(error)}`,
              )
              return createResolutionError(dep)
            } finally {
              await runBestEffortCallback(
                logger,
                'onDependencyProcessed',
                onDependencyProcessed ? () => onDependencyProcessed(pkg, dep) : undefined,
              )
            }
          }),
        ),
    )

    const resolved: ResolvedDepChange[] = []
    const onDependencyResolved = options.onDependencyResolved

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) {
        if (result.status === 'rejected') {
          logger.debug(`Resolution failed: ${result.reason}`)
        }
        continue
      }

      const resolvedDep = result.value
      resolved.push(resolvedDep)
      await runBestEffortCallback(
        logger,
        'onDependencyResolved',
        onDependencyResolved ? () => onDependencyResolved(pkg, resolvedDep) : undefined,
      )
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
