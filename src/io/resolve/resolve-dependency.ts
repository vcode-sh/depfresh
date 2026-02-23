import * as semver from 'semver'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, ProvenanceLevel, RawDep, ResolvedDepChange } from '../../types'
import type { createLogger } from '../../utils/logger'
import type { loadNpmrc } from '../../utils/npmrc'
import {
  applyVersionPrefix,
  getDiff,
  getVersionPrefix,
  resolveTargetVersion,
} from '../../utils/versions'
import { fetchPackageData } from '../registry'
import { getPackageMode } from '../resolve-mode'
import { getResolveCachePolicy } from './cache-policy'
import { filterVersions } from './version-filter'

export async function resolveDependency(
  dep: RawDep,
  options: depfreshOptions,
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

  const cachePolicy = getResolveCachePolicy(options)
  let pkgData = cachePolicy.bypassRead ? undefined : cache.get(packageName)

  if (!pkgData) {
    try {
      pkgData = await fetchPackageData(packageName, {
        npmrc,
        timeout: options.timeout,
        retries: options.retries,
        logger,
      })
      if (cachePolicy.shouldWrite) {
        cache.set(packageName, pkgData, options.cacheTTL)
      }
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
    currentVersionTime: cleanCurrent ? pkgData.time?.[cleanCurrent] : undefined,
    provenance: targetProvenance,
    currentProvenance,
    nodeCompat,
    nodeCompatible,
  }
}
