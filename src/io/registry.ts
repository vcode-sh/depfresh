import * as semver from 'semver'
import { isContractSafeText } from '../contracts/sanitize'
import { RegistryError, ResolveError } from '../errors'
import type {
  NpmrcConfig,
  PackageData,
  PassivePresence,
  RegistryConfig,
  SignaturePresence,
} from '../types'
import type { Logger } from '../utils/logger'
import { getRegistryForPackage } from '../utils/npmrc'
import { isValidPackageName } from '../utils/package-name'
import { redactSensitiveText } from '../utils/redact'
import { getFetchTransportInit } from './transport'

interface FetchOptions {
  npmrc: NpmrcConfig
  timeout: number
  retries: number
  logger: Logger
}

export async function fetchPackageData(name: string, options: FetchOptions): Promise<PackageData> {
  const registry = getRegistryForPackage(name, options.npmrc)

  // GitHub protocol
  if (name.startsWith('github:')) {
    return fetchGithubPackage(name.slice('github:'.length), options)
  }

  // JSR protocol
  if (name.startsWith('jsr:')) {
    return fetchJsrPackage(name.slice(4), options)
  }

  return fetchNpmPackage(name, registry, options)
}

async function fetchNpmPackage(
  name: string,
  registry: RegistryConfig,
  options: FetchOptions,
): Promise<PackageData> {
  const encodedName = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)
  const url = `${registry.url}${encodedName}`

  const headers: Record<string, string> = {
    accept: 'application/json',
  }

  if (registry.token) {
    headers.authorization =
      registry.authType === 'basic' ? `Basic ${registry.token}` : `Bearer ${registry.token}`
  }

  const payload = await fetchWithRetry(url, headers, options)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ResolveError(`Unexpected npm registry payload shape for ${url}`)
  }
  const json = payload as Record<string, unknown>

  const versionsObj = isRecord(json.versions) ? json.versions : {}
  const versions = Object.entries(versionsObj)
    .filter(([candidate, metadata]) => semver.valid(candidate) && isRecord(metadata))
    .map(([candidate]) => candidate)

  const distTags = readDistTags(json['dist-tags'])
  const time = readStringRecord(json.time)
  const deprecated: Record<string, string> = {}

  const signaturePresence: Record<string, SignaturePresence> = {}
  const provenancePresence: Record<string, PassivePresence> = {}
  const deprecationPresence: Record<string, PassivePresence> = {}
  const engineMetadata: Record<string, PassivePresence> = {}
  const peerDependencies: Record<string, Record<string, string>> = {}
  const optionalPeerDependencies: Record<string, string[]> = {}
  const peerMetadata: Record<string, PassivePresence> = {}
  const engines: Record<string, string> = {}

  for (const ver of versions) {
    const data = versionsObj[ver]
    if (!isRecord(data)) continue
    const deprecatedValue = data.deprecated
    if (deprecatedValue === undefined) deprecationPresence[ver] = 'absent'
    else if (typeof deprecatedValue === 'string' && deprecatedValue.length > 0) {
      deprecated[ver] = deprecatedValue
      deprecationPresence[ver] = 'present'
    } else deprecationPresence[ver] = 'unknown'

    signaturePresence[ver] = readSignaturePresence(data)
    provenancePresence[ver] = readProvenancePresence(data)

    const enginesValue = data.engines
    if (enginesValue === undefined) engineMetadata[ver] = 'absent'
    else if (isRecord(enginesValue)) {
      const node = enginesValue.node
      if (node === undefined) engineMetadata[ver] = 'absent'
      else if (typeof node === 'string' && isContractSafeText(node) && semver.validRange(node)) {
        engines[ver] = node
        engineMetadata[ver] = 'present'
      } else engineMetadata[ver] = 'unknown'
    } else engineMetadata[ver] = 'unknown'

    const peerValue = data.peerDependencies
    if (peerValue === undefined) peerMetadata[ver] = 'absent'
    else {
      const peers = readStringRecordStrict(peerValue)
      if (!peers) peerMetadata[ver] = 'unknown'
      else {
        peerDependencies[ver] = peers
        peerMetadata[ver] = Object.keys(peers).length > 0 ? 'present' : 'absent'
        const optional = readOptionalPeers(data.peerDependenciesMeta, new Set(Object.keys(peers)))
        if (optional) optionalPeerDependencies[ver] = optional
        else if (data.peerDependenciesMeta !== undefined) peerMetadata[ver] = 'unknown'
      }
    }
  }

  return {
    name,
    versions,
    distTags,
    time,
    deprecated: Object.keys(deprecated).length > 0 ? deprecated : undefined,
    signaturePresence: Object.keys(signaturePresence).length > 0 ? signaturePresence : undefined,
    provenancePresence: Object.keys(provenancePresence).length > 0 ? provenancePresence : undefined,
    deprecationPresence,
    engineMetadata,
    peerDependencies: Object.keys(peerDependencies).length > 0 ? peerDependencies : undefined,
    optionalPeerDependencies:
      Object.keys(optionalPeerDependencies).length > 0 ? optionalPeerDependencies : undefined,
    peerMetadata,
    engines: Object.keys(engines).length > 0 ? engines : undefined,
    description: typeof json.description === 'string' ? json.description : undefined,
    homepage: typeof json.homepage === 'string' ? json.homepage : undefined,
    repository:
      typeof json.repository === 'string'
        ? json.repository
        : isRecord(json.repository) && typeof json.repository.url === 'string'
          ? json.repository.url
          : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key)
}

function readSignaturePresence(data: Record<string, unknown>): SignaturePresence {
  const hasFlag = hasOwn(data, 'hasSignatures')
  const flag = data.hasSignatures
  const dist = isRecord(data.dist) ? data.dist : undefined
  const hasArray = Boolean(dist && hasOwn(dist, 'signatures'))
  const signatures = dist?.signatures
  if ((hasFlag && typeof flag !== 'boolean') || (hasArray && !Array.isArray(signatures))) {
    return 'unknown'
  }
  const fromFlag = hasFlag ? (flag === true ? 'present' : 'absent') : undefined
  const signatureArray = Array.isArray(signatures) ? signatures : undefined
  const fromArray = hasArray
    ? signatureArray?.length === 0
      ? 'absent'
      : signatureArray?.every(
            (entry) =>
              isRecord(entry) &&
              isPassiveMetadataString(entry.keyid, 2048) &&
              isPassiveMetadataString(entry.sig, 65_536),
          )
        ? 'present'
        : 'unknown'
    : undefined
  if (fromFlag && fromArray && fromFlag !== fromArray) return 'unknown'
  return fromFlag ?? fromArray ?? 'unknown'
}

function readProvenancePresence(data: Record<string, unknown>): PassivePresence {
  if (!isRecord(data.dist)) return 'unknown'
  if (!hasOwn(data.dist, 'attestations')) return 'unknown'
  const attestations = data.dist.attestations
  if (!isRecord(attestations)) return 'unknown'
  if (Object.keys(attestations).length === 0) return 'unknown'
  if (typeof attestations.url !== 'string' || attestations.url.length > 4096) return 'unknown'
  try {
    const url = new URL(attestations.url)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? 'present'
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

function isPassiveMetadataString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
  )
}

function readDistTags(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        isContractSafeText(entry[0]) &&
        typeof entry[1] === 'string' &&
        isContractSafeText(entry[1]) &&
        Boolean(semver.valid(entry[1])),
    ),
  )
}

function readStringRecordStrict(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (
    entries.some(
      ([name, item]) =>
        !(isContractSafeText(name) && isValidPackageName(name)) ||
        typeof item !== 'string' ||
        !isContractSafeText(item) ||
        !semver.validRange(item),
    )
  ) {
    return undefined
  }
  return Object.fromEntries(entries as Array<[string, string]>)
}

function readOptionalPeers(value: unknown, peers: Set<string>): string[] | undefined {
  if (value === undefined) return []
  if (!isRecord(value)) return undefined
  const optional: string[] = []
  for (const [name, metadata] of Object.entries(value)) {
    if (!(peers.has(name) && isRecord(metadata)) || typeof metadata.optional !== 'boolean') {
      return undefined
    }
    if (metadata.optional) optional.push(name)
  }
  return optional.sort()
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

async function fetchJsrPackage(name: string, options: FetchOptions): Promise<PackageData> {
  const url = `https://jsr.io/${name}/meta.json`
  const payload = await fetchWithRetry(url, {}, options)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ResolveError(`Unexpected JSR payload shape for ${url}`)
  }
  const json = payload as Record<string, unknown>

  const versionsObj = (json.versions ?? {}) as Record<string, unknown>
  const versions = Object.keys(versionsObj).filter((version) => semver.valid(version))
  const versionSet = new Set(versions)
  const latest = typeof json.latest === 'string' ? semver.valid(json.latest) : null
  const time: Record<string, string> = {}
  const deprecated: Record<string, string> = {}
  const deprecationPresence: Record<string, PassivePresence> = {}

  for (const version of versions) {
    const metadata = versionsObj[version]
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue
    const record = metadata as Record<string, unknown>
    if (typeof record.createdAt === 'string') {
      time[version] = record.createdAt
    }
    if (record.yanked === true) {
      deprecated[version] = 'Version is yanked'
      deprecationPresence[version] = 'present'
    } else if (record.yanked === false || record.yanked === undefined) {
      deprecationPresence[version] = 'absent'
    } else {
      deprecationPresence[version] = 'unknown'
    }
  }

  return {
    name: `jsr:${name}`,
    versions,
    distTags: latest && versionSet.has(latest) ? { latest } : {},
    time: Object.keys(time).length > 0 ? time : undefined,
    deprecated: Object.keys(deprecated).length > 0 ? deprecated : undefined,
    deprecationPresence,
  }
}

async function fetchGithubPackage(repository: string, options: FetchOptions): Promise<PackageData> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'depfresh',
  }
  if (token) {
    headers.authorization = `Bearer ${token}`
  }

  const versions = new Set<string>()

  // Fetch tags until GitHub returns an empty page.
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`
    const payload = await fetchWithRetry(url, headers, options)
    if (!Array.isArray(payload)) {
      throw new ResolveError(`Unexpected GitHub tags payload shape for ${url}`)
    }

    if (payload.length === 0) {
      break
    }

    for (const item of payload) {
      if (!item || typeof item !== 'object') continue
      const tagName = (item as { name?: unknown }).name
      if (typeof tagName !== 'string') continue
      const normalized = normalizeGithubTag(tagName)
      if (normalized) {
        versions.add(normalized)
      }
    }

    if (payload.length < 100) {
      break
    }
  }

  const sorted = Array.from(versions).sort(semver.compare)
  const latest = sorted[sorted.length - 1]
  if (!latest) {
    throw new ResolveError(`No semver tags found for github:${repository}`)
  }

  const repositoryUrl = `https://github.com/${repository}`
  return {
    name: `github:${repository}`,
    versions: sorted,
    distTags: { latest },
    repository: repositoryUrl,
    homepage: repositoryUrl,
  }
}

function normalizeGithubTag(tag: string): string | null {
  const trimmed = tag.trim()
  if (!trimmed) return null

  const withoutTagPrefix = trimmed.startsWith('refs/tags/')
    ? trimmed.slice('refs/tags/'.length)
    : trimmed
  const withoutVPrefix = withoutTagPrefix.startsWith('v')
    ? withoutTagPrefix.slice(1)
    : withoutTagPrefix

  return semver.valid(withoutVPrefix)
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  options: FetchOptions,
  attempt = 0,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout)

  try {
    const transportInit = getFetchTransportInit(url, options.npmrc, options.logger)
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      ...transportInit,
    })

    if (!response.ok) {
      if (isGithubRateLimit(response, url)) {
        throw createGithubRateLimitError(response, url)
      }
      throw new RegistryError(
        `HTTP ${response.status}: ${response.statusText} for ${url}`,
        response.status,
        url,
      )
    }

    return await response.json()
  } catch (error) {
    // Never retry 4xx client errors — they won't resolve with retries.
    // 429 is treated as retryable because rate limits are transient.
    if (
      error instanceof RegistryError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    ) {
      throw error
    }

    // Resolve failures from config/transport setup are not transient.
    if (error instanceof ResolveError) {
      throw error
    }

    if (attempt < options.retries) {
      const delay = Math.min(1000 * 2 ** attempt, 5000)
      options.logger.debug(
        `Retry ${attempt + 1}/${options.retries} for ${redactSensitiveText(url)} in ${delay}ms`,
      )
      await sleep(delay)
      return fetchWithRetry(url, headers, options, attempt + 1)
    }

    if (error instanceof RegistryError) {
      throw error
    }

    if (isAbortError(error)) {
      throw new ResolveError(`Request timeout after ${options.timeout}ms for ${url}`, {
        cause: error,
      })
    }

    const causeMessage = error instanceof Error ? `: ${error.message}` : ''
    throw new ResolveError(`Network failure while fetching ${url}${causeMessage}`, { cause: error })
  } finally {
    clearTimeout(timer)
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const named = error as { name?: string }
  return named.name === 'AbortError'
}

function isGithubRateLimit(response: Response, url: string): boolean {
  if (!url.includes('api.github.com')) return false
  if (response.status !== 403 && response.status !== 429) return false
  return response.headers.get('x-ratelimit-remaining') === '0'
}

function createGithubRateLimitError(response: Response, url: string): ResolveError {
  const resetRaw = response.headers.get('x-ratelimit-reset')
  let resetHint = ''
  if (resetRaw) {
    const resetSeconds = Number.parseInt(resetRaw, 10)
    if (Number.isFinite(resetSeconds)) {
      resetHint = ` Resets at ${new Date(resetSeconds * 1000).toISOString()}.`
    }
  }

  return new ResolveError(
    `GitHub API rate limit exceeded for ${url}.${resetHint} Set GITHUB_TOKEN or GH_TOKEN.`,
    {
      cause: {
        status: response.status,
        statusText: response.statusText,
      },
    },
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
