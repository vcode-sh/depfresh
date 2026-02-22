import pLimit from 'p-limit'
import * as semver from 'semver'
import type { Cache } from '../cache/index'
import { createSqliteCache } from '../cache/index'
import type {
  BumpOptions,
  NpmrcConfig,
  PackageData,
  PackageMeta,
  RawDep,
  ResolvedDepChange,
} from '../types'
import { createLogger } from '../utils/logger'
import { loadNpmrc } from '../utils/npmrc'
import {
  applyVersionPrefix,
  getDiff,
  getVersionPrefix,
  resolveTargetVersion,
} from '../utils/versions'
import { fetchPackageData } from './registry'

export async function resolvePackage(
  pkg: PackageMeta,
  options: BumpOptions,
  externalCache?: Cache,
  externalNpmrc?: NpmrcConfig,
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
        .map((dep) => limit(() => resolveDependency(dep, options, cache, npmrc, logger))),
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

async function resolveDependency(
  dep: RawDep,
  options: BumpOptions,
  cache: Cache,
  npmrc: ReturnType<typeof loadNpmrc>,
  logger: ReturnType<typeof createLogger>,
): Promise<ResolvedDepChange | null> {
  const packageName = dep.aliasName ?? dep.name

  // Check cache
  let pkgData = cache.get(packageName)

  if (!pkgData) {
    try {
      pkgData = await fetchPackageData(packageName, {
        npmrc,
        timeout: options.timeout,
        retries: options.retries,
        logger,
      })
      cache.set(packageName, pkgData, options.cacheTTL)
    } catch (error) {
      logger.debug(`Failed to fetch ${packageName}: ${error}`)
      return {
        ...dep,
        targetVersion: dep.currentVersion,
        diff: 'error',
        pkgData: { name: packageName, versions: [], distTags: {} },
      }
    }
  }

  // Filter out deprecated versions unless current is deprecated
  const versions = filterVersions(pkgData, dep)

  // Resolve the target version based on mode
  const mode = options.packageMode?.[packageName] ?? options.mode
  const targetVersion = resolveTargetVersion(dep.currentVersion, versions, pkgData.distTags, mode)

  if (!targetVersion) {
    return null
  }

  const prefix = getVersionPrefix(dep.currentVersion)
  const prefixedTarget = applyVersionPrefix(targetVersion, prefix)
  const diff = getDiff(dep.currentVersion, targetVersion)

  // Skip if no change
  if (diff === 'none' && !options.force) {
    return null
  }

  return {
    ...dep,
    targetVersion: prefixedTarget,
    diff,
    pkgData,
    deprecated: pkgData.deprecated?.[targetVersion],
    latestVersion: pkgData.distTags.latest,
    publishedAt: pkgData.time?.[targetVersion],
  }
}

function filterVersions(pkgData: PackageData, dep: RawDep): string[] {
  return pkgData.versions.filter((v) => {
    // Skip deprecated unless current version is also deprecated
    if (pkgData.deprecated?.[v] && !pkgData.deprecated?.[dep.currentVersion]) {
      return false
    }
    // Skip prerelease unless current is prerelease
    if (semver.prerelease(v)?.length && !semver.prerelease(dep.currentVersion)?.length) {
      return false
    }
    return true
  })
}
