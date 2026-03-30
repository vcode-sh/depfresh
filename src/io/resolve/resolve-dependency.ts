import * as semver from 'semver'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, ProvenanceLevel, RawDep, ResolvedDepChange } from '../../types'
import type { createLogger } from '../../utils/logger'
import type { loadNpmrc } from '../../utils/npmrc'
import { getRegistryForPackage } from '../../utils/npmrc'
import {
  applyVersionPrefix,
  getDiff,
  getVersionPrefix,
  resolveTargetVersion,
} from '../../utils/versions'
import { fetchPackageData } from '../registry'
import { getPackageMode } from '../resolve-mode'
import { getResolveCachePolicy } from './cache-policy'
import type { ResolveContext } from './context'
import { filterVersions } from './version-filter'

export async function resolveDependency(
  dep: RawDep,
  options: depfreshOptions,
  cache: Cache,
  npmrc: ReturnType<typeof loadNpmrc>,
  logger: ReturnType<typeof createLogger>,
  privatePackages?: Set<string>,
  resolveContext?: ResolveContext,
): Promise<ResolvedDepChange | null> {
  const packageName = dep.aliasName ?? dep.name
  const normalizedCurrentVersion = normalizeWorkspaceCurrentVersion(
    dep.currentVersion,
    dep.protocol,
  )
  const resolveKey = buildResolveKey(packageName, npmrc)

  if (dep.protocol === 'workspace' && !normalizedCurrentVersion) {
    logger.debug(`Skipping workspace dependency without explicit version: ${packageName}`)
    return null
  }
  const currentVersion = normalizedCurrentVersion ?? dep.currentVersion

  // Skip private workspace packages — no point hitting the registry for local deps
  if (privatePackages?.has(packageName) && dep.protocol !== 'workspace') {
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
  let pkgData = cachePolicy.bypassRead ? undefined : cache.get(resolveKey)

  if (!pkgData) {
    try {
      const inFlight = resolveContext?.inFlight.get(resolveKey)

      if (inFlight) {
        if (resolveContext) {
          resolveContext.metrics.dedupeHits += 1
        }
        pkgData = await inFlight
      } else {
        if (resolveContext) {
          resolveContext.metrics.fetchesStarted += 1
        }
        const fetchPromise = fetchPackageData(packageName, {
          npmrc,
          timeout: options.timeout,
          retries: options.retries,
          logger,
        }).finally(() => {
          resolveContext?.inFlight.delete(resolveKey)
        })

        resolveContext?.inFlight.set(resolveKey, fetchPromise)
        pkgData = await fetchPromise
      }

      if (cachePolicy.shouldWrite) {
        try {
          cache.set(resolveKey, pkgData, options.cacheTTL)
        } catch (error) {
          logger.debug(
            `Failed to write cache entry for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
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

  // Skip dist-tag versions (e.g., "latest", "next") — they resolve dynamically at install time
  if (currentVersion in pkgData.distTags) {
    logger.debug(`Skipping ${dep.name}: version "${currentVersion}" is a dist-tag`)
    return null
  }

  // Filter out deprecated, immature, and wrong-channel prerelease versions
  const versions = filterVersions(pkgData, dep, options)

  // Resolve the target version based on mode
  const targetVersion = resolveTargetVersion(currentVersion, versions, pkgData.distTags, mode)

  if (!targetVersion) {
    return null
  }

  const prefix = getVersionPrefix(currentVersion)
  const prefixedTarget = applyVersionPrefix(targetVersion, prefix)
  const diff = getDiff(currentVersion, targetVersion)

  // Skip if no change
  if (diff === 'none' && !options.force) {
    return null
  }

  const cleanCurrent = semver.coerce(currentVersion)?.version ?? undefined
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
    currentVersion,
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

function normalizeWorkspaceCurrentVersion(
  currentVersion: string,
  protocol: string | undefined,
): string | null {
  if (protocol !== 'workspace') {
    return currentVersion
  }

  if (
    currentVersion === '' ||
    currentVersion === '*' ||
    currentVersion === '^' ||
    currentVersion === '~'
  ) {
    return null
  }

  return currentVersion
}

function buildResolveKey(packageName: string, npmrc: ReturnType<typeof loadNpmrc>): string {
  if (packageName.startsWith('github:')) {
    return `github|${packageName}`
  }

  if (packageName.startsWith('jsr:')) {
    return `jsr|${packageName}`
  }

  const registry = getRegistryForPackage(packageName, npmrc)
  return `npm|${registry.url}|${packageName}`
}
