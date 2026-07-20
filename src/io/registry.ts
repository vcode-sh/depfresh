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
import { parseGithubRepositoryIdentity } from './dependencies/protocols'
import { getFetchTransportInit } from './transport'

interface FetchOptions {
  npmrc: NpmrcConfig
  timeout: number
  retries: number
  logger: Logger
  monotonicNow?: () => number
}

const MAX_SUCCESS_BODY_BYTES = 64 * 1024 * 1024
const GITHUB_MAX_PAGES = 100
const GITHUB_MAX_RECORDS = 10_000
const GITHUB_MAX_ELAPSED_MS = 30_000

interface FetchBudget {
  assertActive(): number
  limitError(): ResolveError
}

interface JsonResponseDouble {
  json(): Promise<unknown>
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
  const artifactIntegrity: Record<string, string> = {}

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
    const integrity = readArtifactIntegrity(data)
    if (integrity) artifactIntegrity[ver] = integrity

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
    artifactIntegrity: Object.keys(artifactIntegrity).length > 0 ? artifactIntegrity : undefined,
    registry: canonicalRegistryIdentity(registry.url),
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

function readArtifactIntegrity(data: Record<string, unknown>): string | undefined {
  if (!isRecord(data.dist) || typeof data.dist.integrity !== 'string') return undefined
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(data.dist.integrity)
  if (!match?.[1]) return undefined
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length !== 64 || bytes.toString('base64') !== match[1]) return undefined
  return data.dist.integrity
}

function canonicalRegistryIdentity(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return undefined
    }
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`
    return url.toString()
  } catch {
    return undefined
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
  const identity = parseGithubRepositoryIdentity(repository)
  if (!identity) {
    throw new ResolveError('Invalid GitHub repository identity')
  }
  const encodedRepository = `${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repository)}`
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'depfresh',
  }
  if (token) {
    headers.authorization = `Bearer ${token}`
  }

  const versions = new Set<string>()
  const traversalBudget = createGithubTraversalBudget(repository, options.monotonicNow)
  let recordCount = 0

  // Fetch tags until GitHub returns an empty page.
  for (let page = 1; page <= GITHUB_MAX_PAGES; page++) {
    traversalBudget.assertActive()
    const url = `https://api.github.com/repos/${encodedRepository}/tags?per_page=100&page=${page}`
    const payload = await fetchWithRetry(url, headers, options, 0, traversalBudget)
    if (!Array.isArray(payload)) {
      throw new ResolveError(`Unexpected GitHub tags payload shape for ${url}`)
    }

    if (recordCount + payload.length > GITHUB_MAX_RECORDS) {
      throw new ResolveError(
        `GitHub tag traversal for github:${repository} exceeded ${GITHUB_MAX_RECORDS}-record limit`,
      )
    }
    recordCount += payload.length

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

    if (page === GITHUB_MAX_PAGES) {
      throw new ResolveError(
        `GitHub tag traversal for github:${repository} exceeded ${GITHUB_MAX_PAGES}-page limit`,
      )
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
  budget?: FetchBudget,
): Promise<unknown> {
  const controller = new AbortController()
  const remainingBudgetMs = budget?.assertActive()
  const aggregateOwnsTimeout =
    remainingBudgetMs !== undefined && remainingBudgetMs <= options.timeout
  const timeout = Math.min(options.timeout, remainingBudgetMs ?? options.timeout)
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const transportInit = getFetchTransportInit(url, options.npmrc, options.logger)
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      ...transportInit,
    })

    if (!response.ok) {
      // The error body is untrusted and unnecessary. Cancel it before retry backoff so the
      // transport can release this request without buffering an arbitrarily large payload.
      await response.body?.cancel().catch(() => undefined)
      if (isGithubRateLimit(response, url)) {
        throw createGithubRateLimitError(response, url)
      }
      throw new RegistryError(
        `HTTP ${response.status}: ${response.statusText} for ${url}`,
        response.status,
        url,
      )
    }

    const payload = await readSuccessJson(response, url)
    budget?.assertActive()
    return payload
  } catch (error) {
    // This attempt has settled. Do not let its timeout abort the response or connection while a
    // retry is waiting in backoff; the recursive attempt owns an independent timeout.
    clearTimeout(timer)

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
      if (budget && budget.assertActive() <= delay) throw budget.limitError()
      options.logger.debug(
        `Retry ${attempt + 1}/${options.retries} for ${redactSensitiveText(url)} in ${delay}ms`,
      )
      await sleep(delay)
      return fetchWithRetry(url, headers, options, attempt + 1, budget)
    }

    if (error instanceof RegistryError) {
      throw error
    }

    if (isAbortError(error)) {
      if (aggregateOwnsTimeout && budget) throw budget.limitError()
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

async function readSuccessJson(
  response: Response | JsonResponseDouble,
  url: string,
): Promise<unknown> {
  // Fetch always returns a native Response in production. Existing focused tests use minimal
  // response doubles, so keep their json() seam without allowing native bodies to bypass the cap.
  if (!(response instanceof Response)) {
    try {
      return await response.json()
    } catch (error) {
      throw invalidJsonResponse(url, error)
    }
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && /^\d+$/u.test(contentLength)) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_SUCCESS_BODY_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw responseBodyLimitError(url)
    }
  }

  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_SUCCESS_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw responseBodyLimitError(url)
      }
      chunks.push(value)
    }
  }

  const body = Buffer.concat(chunks, byteLength).toString('utf8')
  try {
    return JSON.parse(body) as unknown
  } catch (error) {
    throw invalidJsonResponse(url, error)
  }
}

function responseBodyLimitError(url: string): ResolveError {
  return new ResolveError(
    `Registry response body for ${url} exceeds ${MAX_SUCCESS_BODY_BYTES}-byte limit`,
  )
}

function invalidJsonResponse(url: string, cause: unknown): ResolveError {
  return new ResolveError(`Invalid JSON response from ${url}`, { cause })
}

function createGithubTraversalBudget(repository: string, injectedNow?: () => number): FetchBudget {
  const now = injectedNow ?? (() => performance.now())
  const startedAt = readMonotonicClock(now)
  let lastObservedAt = startedAt
  const limitError = (): ResolveError =>
    new ResolveError(
      `GitHub tag traversal for github:${repository} exceeded ${GITHUB_MAX_ELAPSED_MS}ms elapsed-time limit`,
    )

  return {
    assertActive: () => {
      const observedAt = readMonotonicClock(now)
      if (observedAt < lastObservedAt) {
        throw new ResolveError('GitHub tag traversal monotonic clock moved backwards')
      }
      lastObservedAt = observedAt
      const remaining = GITHUB_MAX_ELAPSED_MS - (observedAt - startedAt)
      if (remaining <= 0) throw limitError()
      return remaining
    },
    limitError,
  }
}

function readMonotonicClock(now: () => number): number {
  const value = now()
  if (!Number.isFinite(value)) {
    throw new ResolveError('GitHub tag traversal monotonic clock must return a finite number')
  }
  return value
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
