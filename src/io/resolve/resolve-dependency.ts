import { createHash } from 'node:crypto'
import * as semver from 'semver'
import type { Cache } from '../../cache/index'
import type {
  depfreshOptions,
  PackageData,
  PolicyCandidateReason,
  RawDep,
  ResolvedDepChange,
  SignaturePresence,
} from '../../types'
import type { createLogger } from '../../utils/logger'
import type { loadNpmrc } from '../../utils/npmrc'
import { getRegistryForPackage } from '../../utils/npmrc'
import { getSafeErrorDetails } from '../../utils/redact'
import {
  applyVersionPrefix,
  getDiff,
  getSpecShape,
  getVersionPrefix,
  normalizeVersion,
  rebuildXRange,
} from '../../utils/versions'
import { fetchPackageData, fetchPackageVersionData } from '../registry'
import { getPackageMode } from '../resolve-mode'
import { getResolveCachePolicy } from './cache-policy'
import { type ResolveContext, recordResolutionMetadata, recordResolutionTrace } from './context'
import { resolutionErrorDetails } from './resolution-error'
import { selectVersionCandidate, type VersionCandidateSelection } from './version-filter'

const authenticatedNpmrcIds = new WeakMap<ReturnType<typeof loadNpmrc>, number>()
let nextAuthenticatedNpmrcId = 1

export async function resolveDependency(
  dep: RawDep,
  options: depfreshOptions,
  cache: Cache,
  npmrc: ReturnType<typeof loadNpmrc>,
  logger: ReturnType<typeof createLogger>,
  privatePackages?: Set<string>,
  resolveContext?: ResolveContext,
  onCandidateSelection?: (selection: VersionCandidateSelection) => void,
): Promise<ResolvedDepChange | null> {
  const packageName = dep.aliasName ?? dep.name
  const normalizedCurrentVersion = normalizeWorkspaceCurrentVersion(
    dep.currentVersion,
    dep.protocol,
  )
  const cacheIdentity = buildResolveCacheIdentity(packageName, npmrc)

  if (dep.protocol === 'workspace' && !normalizedCurrentVersion) {
    logger.debug(`Skipping workspace dependency without explicit version: ${packageName}`)
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'skipped',
      reason: 'WORKSPACE_VERSION_DYNAMIC',
      eligibleVersions: [],
    })
    return null
  }
  const currentVersion = normalizedCurrentVersion ?? dep.currentVersion

  // Skip private workspace packages — no point hitting the registry for local deps
  if (privatePackages?.has(packageName) && dep.protocol !== 'workspace') {
    logger.debug(`Skipping private workspace package: ${packageName}`)
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'skipped',
      reason: 'PRIVATE_WORKSPACE_PACKAGE',
      eligibleVersions: [],
    })
    return null
  }

  // Resolve the mode — check packageMode globs before falling back to global mode
  const mode =
    dep.policyDecision?.status === 'selected' || dep.policyDecision?.status === 'unchanged'
      ? dep.policyDecision.mode
      : getPackageMode(packageName, options.packageMode, options.mode)

  // Skip if mode is 'ignore'
  if (mode === 'ignore') {
    logger.debug(`Ignoring ${packageName} (mode: ignore)`)
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'skipped',
      reason: 'MODE_IGNORED',
      eligibleVersions: [],
    })
    return null
  }

  const compact = Boolean(
    resolveContext?.compactMetadata &&
      options.cooldown <= 0 &&
      mode !== 'newest' &&
      !options.sort.startsWith('time-') &&
      !options.signalRules?.length &&
      !options.cohorts?.length &&
      !packageName.startsWith('github:') &&
      !packageName.startsWith('jsr:'),
  )
  const fullCacheIdentity = { ...cacheIdentity }
  if (compact) {
    if (cacheIdentity.persistentKey) cacheIdentity.persistentKey += '|compact'
    if (cacheIdentity.inFlightKey) cacheIdentity.inFlightKey += '|compact'
  }
  const cachePolicy = getResolveCachePolicy(options)
  let pkgData =
    cachePolicy.bypassRead || !cacheIdentity.persistentKey
      ? undefined
      : ((compact && options.timediff && fullCacheIdentity.persistentKey
          ? cache.get(fullCacheIdentity.persistentKey)
          : undefined) ?? cache.get(cacheIdentity.persistentKey))
  const persistentCacheHit = pkgData !== undefined

  if (!pkgData) {
    try {
      const inFlight = cacheIdentity.inFlightKey
        ? resolveContext?.inFlight.get(cacheIdentity.inFlightKey)
        : undefined

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
          ...(compact
            ? {
                compact: true,
                onCompactVersions: (project: (version: string) => PackageData | undefined) => {
                  if (cacheIdentity.inFlightKey)
                    resolveContext?.compactVersions.set(cacheIdentity.inFlightKey, project)
                },
              }
            : {}),
        })

        if (cacheIdentity.inFlightKey) {
          resolveContext?.inFlight.set(cacheIdentity.inFlightKey, fetchPromise)
        }
        pkgData = await fetchPromise
      }

      if (cachePolicy.shouldWrite && cacheIdentity.persistentKey) {
        try {
          if (
            !pkgData.compact ||
            cachePolicy.bypassRead ||
            !cache.get(cacheIdentity.persistentKey)
          ) {
            cache.set(cacheIdentity.persistentKey, pkgData, options.cacheTTL)
          }
        } catch (error) {
          logger.debug(
            `Failed to write cache entry for ${packageName}: ${getSafeErrorDetails(error).message}`,
          )
        }
      }
    } catch (error) {
      logger.debug(`Failed to fetch ${packageName}: ${getSafeErrorDetails(error).message}`)
      recordResolutionTrace(resolveContext, dep.occurrenceId, {
        status: 'unknown',
        reason: 'REGISTRY_UNAVAILABLE',
        eligibleVersions: [],
      })
      return {
        ...dep,
        targetVersion: dep.currentVersion,
        diff: 'error',
        resolutionError: resolutionErrorDetails(error),
        pkgData: { name: packageName, versions: [], distTags: {} },
      }
    }
  }

  recordResolutionMetadata(resolveContext, dep.occurrenceId, {
    packageName,
    currentVersion,
    data: pkgData,
  })

  // Skip dist-tag versions (e.g., "latest", "next") — they resolve dynamically at install time
  if (
    pkgData.distTags &&
    typeof pkgData.distTags === 'object' &&
    currentVersion in pkgData.distTags
  ) {
    logger.debug(`Skipping ${dep.name}: version "${currentVersion}" is a dist-tag`)
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'skipped',
      reason: 'DYNAMIC_DIST_TAG',
      eligibleVersions: [],
    })
    return null
  }

  const specShape = getSpecShape(currentVersion)
  if (specShape === 'complex' && semver.validRange(currentVersion)) {
    logger.debug(
      `Skipping ${dep.name}: version "${currentVersion}" is a complex range depfresh cannot rewrite faithfully`,
    )
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'skipped',
      reason: 'COMPLEX_RANGE_UNSUPPORTED',
      eligibleVersions: [],
    })
    return null
  }

  const selection = selectVersionCandidate({
    currentVersion,
    pkgData,
    mode,
    includeLocked: options.includeLocked,
    cooldown: options.cooldown,
    ...(resolveContext?.now === undefined ? {} : { now: resolveContext.now }),
  })
  onCandidateSelection?.(selection)
  logger.debug(`Candidate selection for ${packageName}: ${selection.reason}`)
  const targetVersion = selection.targetVersion

  if (!targetVersion) {
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: candidateTraceStatus(selection.reason),
      reason: selection.reason,
      eligibleVersions: selection.eligibleVersions,
    })
    return null
  }

  if (specShape === 'x-range' && semver.satisfies(targetVersion, currentVersion)) {
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'unchanged',
      reason: 'RANGE_ALREADY_SATISFIES_TARGET',
      eligibleVersions: selection.eligibleVersions,
      targetVersion,
    })
    return null
  }

  const prefixedTarget =
    specShape === 'x-range'
      ? (rebuildXRange(currentVersion, targetVersion) ?? targetVersion)
      : applyVersionPrefix(targetVersion, getVersionPrefix(currentVersion))
  const diff = getDiff(currentVersion, targetVersion)

  if (prefixedTarget === currentVersion) {
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'unchanged',
      reason: 'CURRENT_VALUE_SELECTED',
      eligibleVersions: selection.eligibleVersions,
      targetVersion,
    })
    return null
  }

  // Skip if no change
  if (diff === 'none' && !options.force) {
    recordResolutionTrace(resolveContext, dep.occurrenceId, {
      status: 'unchanged',
      reason: 'NO_SEMANTIC_CHANGE',
      eligibleVersions: selection.eligibleVersions,
      targetVersion,
    })
    return null
  }

  const cleanCurrent = normalizeVersion(currentVersion) ?? undefined
  let metadataWarning: ResolvedDepChange['metadataWarning']
  if (pkgData.compact) {
    for (const version of new Set([cleanCurrent, targetVersion])) {
      if (!(version && pkgData.versions.includes(version))) continue
      if (pkgData.enrichedVersions?.includes(version)) continue
      const projected = cacheIdentity.inFlightKey
        ? resolveContext?.compactVersions.get(cacheIdentity.inFlightKey)?.(version)
        : undefined
      if (projected) {
        pkgData = mergeVersionMetadata(pkgData, projected)
        continue
      }
      try {
        const key = cacheIdentity.inFlightKey
          ? `${cacheIdentity.inFlightKey}|version:${version}`
          : undefined
        let request = key ? resolveContext?.inFlight.get(key) : undefined
        if (request) {
          if (resolveContext) resolveContext.metrics.dedupeHits += 1
        } else {
          if (resolveContext) resolveContext.metrics.fetchesStarted += 1
          request = fetchPackageVersionData(packageName, version, {
            npmrc,
            timeout: Math.min(options.timeout, 2000),
            retries: 0,
            logger,
          })
          if (key) resolveContext?.inFlight.set(key, request)
        }
        pkgData = mergeVersionMetadata(pkgData, await request)
      } catch (error) {
        metadataWarning = resolutionErrorDetails(error)
      }
    }
    if (!persistentCacheHit && cachePolicy.shouldWrite && cacheIdentity.persistentKey) {
      try {
        const cached = cachePolicy.bypassRead ? undefined : cache.get(cacheIdentity.persistentKey)
        if (cached?.compact) pkgData = mergeVersionMetadata(cached, pkgData)
        cache.set(cacheIdentity.persistentKey, pkgData, options.cacheTTL)
      } catch (error) {
        logger.debug(
          `Failed to cache metadata for ${packageName}: ${getSafeErrorDetails(error).message}`,
        )
      }
    }
  }
  const needsReleaseDates = (data: PackageData) =>
    !Number.isFinite(Date.parse(data.time?.[targetVersion] ?? '')) ||
    Boolean(
      cleanCurrent &&
        data.versions.includes(cleanCurrent) &&
        !Number.isFinite(Date.parse(data.time?.[cleanCurrent] ?? '')),
    )
  if (compact && options.timediff && needsReleaseDates(pkgData)) {
    if (pkgData.compact) {
      try {
        const key = fullCacheIdentity.inFlightKey
        const advisoryKey = key ? `${key}|dates` : undefined
        let request = key ? resolveContext?.inFlight.get(key) : undefined
        request ??= advisoryKey ? resolveContext?.inFlight.get(advisoryKey) : undefined
        const freshRequest = !request
        if (request) {
          if (resolveContext) resolveContext.metrics.dedupeHits += 1
        } else {
          if (resolveContext) resolveContext.metrics.fetchesStarted += 1
          request = fetchPackageData(packageName, {
            npmrc,
            timeout: Math.min(options.timeout, 2000),
            retries: 0,
            logger,
          })
          if (advisoryKey) resolveContext?.inFlight.set(advisoryKey, request)
        }
        const dated = await request
        pkgData = { ...pkgData, time: dated.time }
        if (freshRequest && cachePolicy.shouldWrite && fullCacheIdentity.persistentKey) {
          try {
            cache.set(fullCacheIdentity.persistentKey, dated, options.cacheTTL)
          } catch (error) {
            logger.debug(
              `Failed to cache metadata for ${packageName}: ${getSafeErrorDetails(error).message}`,
            )
          }
        }
      } catch (error) {
        metadataWarning = resolutionErrorDetails(error)
      }
    }
    if (needsReleaseDates(pkgData) && !metadataWarning) {
      metadataWarning = {
        code: 'ERR_RESOLVE',
        message: 'Publication dates unavailable for selected versions',
      }
    }
  }
  recordResolutionMetadata(resolveContext, dep.occurrenceId, {
    packageName,
    currentVersion,
    data: pkgData,
  })
  const currentSignaturePresence = cleanCurrent
    ? getSignaturePresence(pkgData, cleanCurrent)
    : undefined
  const signaturePresence = getSignaturePresence(pkgData, targetVersion)
  const nodeCompat: string | undefined = pkgData.engines?.[targetVersion]

  recordResolutionTrace(resolveContext, dep.occurrenceId, {
    status: 'selected',
    reason: selection.reason,
    eligibleVersions: selection.eligibleVersions,
    targetVersion,
  })
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
    signaturePresence,
    currentSignaturePresence,
    nodeCompat,
    ...(metadataWarning ? { metadataWarning } : {}),
  }
}

function candidateTraceStatus(
  reason: PolicyCandidateReason,
): 'unchanged' | 'skipped' | 'blocked' | 'unknown' {
  switch (reason) {
    case 'CURRENT_VERSION_SELECTED':
    case 'MODE_NO_MATCH':
      return 'unchanged'
    case 'CURRENT_VERSION_INVALID':
      return 'skipped'
    case 'PRERELEASE_CHANNEL_BLOCKED':
    case 'DEPRECATED_CANDIDATE_BLOCKED':
    case 'MATURITY_CANDIDATE_BLOCKED':
    case 'DOWNGRADE_BLOCKED':
      return 'blocked'
    case 'NO_VALID_VERSIONS':
    case 'DIST_TAG_MISSING':
    case 'DIST_TAG_NOT_ELIGIBLE':
    case 'MISSING_PUBLISH_TIME':
      return 'unknown'
    case 'SELECTED':
      return 'unknown'
  }
}

function getSignaturePresence(
  pkgData: PackageData,
  version: string,
): SignaturePresence | undefined {
  const presence = pkgData.signaturePresence?.[version]
  if (presence) return presence

  return undefined
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

function buildResolveCacheIdentity(
  packageName: string,
  npmrc: ReturnType<typeof loadNpmrc>,
): { persistentKey?: string; inFlightKey?: string } {
  if (packageName.startsWith('github:')) {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (token)
      return { inFlightKey: `github-authenticated|${opaqueIdentity(token)}|${packageName}` }
    const key = `github|${packageName}`
    return { persistentKey: key, inFlightKey: key }
  }

  if (packageName.startsWith('jsr:')) {
    const key = `jsr|${packageName}`
    return { persistentKey: key, inFlightKey: key }
  }

  const registry = getRegistryForPackage(packageName, npmrc)
  const anonymousRegistry = canonicalAnonymousRegistryIdentity(registry)
  if (anonymousRegistry) {
    const key = `npm|${anonymousRegistry}|${packageName}`
    return { persistentKey: key, inFlightKey: key }
  }

  let npmrcId = authenticatedNpmrcIds.get(npmrc)
  if (npmrcId === undefined) {
    npmrcId = nextAuthenticatedNpmrcId++
    authenticatedNpmrcIds.set(npmrc, npmrcId)
  }
  return {
    inFlightKey: `npm-authenticated|${npmrcId}|${opaqueIdentity(JSON.stringify(registry))}|${packageName}`,
  }
}

function canonicalAnonymousRegistryIdentity(
  registry: ReturnType<typeof getRegistryForPackage>,
): string | undefined {
  if (registry.token) return undefined

  try {
    const url = new URL(registry.url)
    if (url.username || url.password || url.search || url.hash) return undefined
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`
    return url.toString()
  } catch {
    return undefined
  }
}

function opaqueIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function mergeVersionMetadata(data: PackageData, version: PackageData): PackageData {
  return {
    ...data,
    enrichedVersions: [
      ...new Set([
        ...(data.enrichedVersions ?? []),
        ...(version.enrichedVersions ?? (version.compact ? [] : version.versions)),
      ]),
    ],
    description: version.description ?? data.description,
    homepage: version.homepage ?? data.homepage,
    repository: version.repository ?? data.repository,
    deprecated: { ...data.deprecated, ...version.deprecated },
    signaturePresence: { ...data.signaturePresence, ...version.signaturePresence },
    provenancePresence: { ...data.provenancePresence, ...version.provenancePresence },
    artifactIntegrity: { ...data.artifactIntegrity, ...version.artifactIntegrity },
    deprecationPresence: { ...data.deprecationPresence, ...version.deprecationPresence },
    engineMetadata: { ...data.engineMetadata, ...version.engineMetadata },
    peerDependencies: { ...data.peerDependencies, ...version.peerDependencies },
    optionalPeerDependencies: {
      ...data.optionalPeerDependencies,
      ...version.optionalPeerDependencies,
    },
    peerMetadata: { ...data.peerMetadata, ...version.peerMetadata },
    engines: { ...data.engines, ...version.engines },
  }
}
