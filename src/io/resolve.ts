import pLimit from 'p-limit'
import * as semver from 'semver'
import type { Cache } from '../cache/index'
import { createSqliteCache } from '../cache/index'
import type {
  BumpOptions,
  NpmrcConfig,
  PackageData,
  PackageMeta,
  ProvenanceLevel,
  RangeMode,
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
  privatePackages?: Set<string>,
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
          limit(() => resolveDependency(dep, options, cache, npmrc, logger, privatePackages)),
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

async function resolveDependency(
  dep: RawDep,
  options: BumpOptions,
  cache: Cache,
  npmrc: ReturnType<typeof loadNpmrc>,
  logger: ReturnType<typeof createLogger>,
  privatePackages?: Set<string>,
): Promise<ResolvedDepChange | null> {
  const packageName = dep.aliasName ?? dep.name

  // Skip private workspace packages — no point hitting the registry for local deps
  if (privatePackages?.has(packageName)) {
    logger.debug(`Skipping private workspace package: ${packageName}`)
    return null
  }

  // Resolve the mode — check packageMode globs before falling back to global mode
  const mode = getPackageMode(packageName, options.packageMode, options.mode)

  // Skip if mode is 'ignore'
  if (mode === 'ignore') {
    logger.debug(`Ignoring ${packageName} (mode: ignore)`)
    return null
  }

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

  // Filter out deprecated, immature, and wrong-channel prerelease versions
  const versions = filterVersions(pkgData, dep, options)

  // Resolve the target version based on mode
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

  const cleanCurrent = semver.coerce(dep.currentVersion)?.version ?? undefined
  const currentProvenance: ProvenanceLevel | undefined = cleanCurrent
    ? pkgData.provenance?.[cleanCurrent]
    : undefined
  const targetProvenance: ProvenanceLevel | undefined = pkgData.provenance?.[targetVersion]
  const nodeCompat: string | undefined = pkgData.engines?.[targetVersion]
  const nodeCompatible: boolean | undefined = nodeCompat
    ? semver.satisfies(process.version, nodeCompat)
    : undefined

  return {
    ...dep,
    targetVersion: prefixedTarget,
    diff,
    pkgData,
    deprecated: pkgData.deprecated?.[targetVersion],
    latestVersion: pkgData.distTags.latest,
    publishedAt: pkgData.time?.[targetVersion],
    provenance: targetProvenance,
    currentProvenance,
    nodeCompat,
    nodeCompatible,
  }
}

export function getPackageMode(
  packageName: string,
  packageMode: Record<string, RangeMode> | undefined,
  defaultMode: RangeMode,
): RangeMode {
  if (!packageMode) return defaultMode

  // Exact match first
  if (packageMode[packageName]) {
    return packageMode[packageName]
  }

  // Glob/pattern matching
  for (const [pattern, mode] of Object.entries(packageMode)) {
    // Skip exact keys already checked
    if (pattern === packageName) continue

    try {
      const regex = patternToMatchRegex(pattern)
      if (regex.test(packageName)) {
        return mode
      }
    } catch {
      // Skip invalid patterns
    }
  }

  return defaultMode
}

function patternToMatchRegex(pattern: string): RegExp {
  // Glob pattern: contains * but not regex metacharacters
  if (pattern.includes('*') && !/[\^$[\]()\\|+?]/.test(pattern)) {
    const escaped = pattern.replace(/[.@/]/g, '\\$&').replace(/\*/g, '[^/]*')
    return new RegExp(`^${escaped}$`)
  }
  return new RegExp(pattern)
}

export function filterVersions(pkgData: PackageData, dep: RawDep, options?: BumpOptions): string[] {
  const currentPrerelease = semver.prerelease(dep.currentVersion)
  const currentChannel = currentPrerelease?.[0]

  let filtered = pkgData.versions.filter((v) => {
    // Skip deprecated unless current version is also deprecated
    if (pkgData.deprecated?.[v] && !pkgData.deprecated?.[dep.currentVersion]) {
      return false
    }

    const vPrerelease = semver.prerelease(v)

    // If current is not prerelease, skip all prereleases
    if (vPrerelease?.length && !currentPrerelease?.length) {
      return false
    }

    // If current IS prerelease and candidate is also prerelease,
    // only allow same channel (e.g., rc → rc, beta → beta)
    if (vPrerelease?.length && currentPrerelease?.length) {
      const vChannel = vPrerelease[0]
      if (typeof currentChannel === 'string' && typeof vChannel === 'string') {
        if (vChannel !== currentChannel) {
          return false
        }
      }
    }

    return true
  })

  // Apply cooldown / maturity period filter
  if (options?.cooldown && options.cooldown > 0) {
    filtered = filterVersionsByMaturityPeriod(filtered, pkgData.time, options.cooldown)
  }

  return filtered
}

export function filterVersionsByMaturityPeriod(
  versions: string[],
  time: Record<string, string> | undefined,
  days: number,
): string[] {
  if (!time || days <= 0) return versions

  const cutoff = Date.now() - days * 86_400_000

  const filtered = versions.filter((v) => {
    const published = time[v]
    // If no time data for this version, keep it (don't filter what we can't verify)
    if (!published) return true
    return new Date(published).getTime() <= cutoff
  })

  // If all versions were filtered out, return the original list as fallback
  return filtered.length > 0 ? filtered : versions
}
