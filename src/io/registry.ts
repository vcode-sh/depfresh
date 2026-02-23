import * as semver from 'semver'
import { RegistryError, ResolveError } from '../errors'
import type { NpmrcConfig, PackageData, ProvenanceLevel, RegistryConfig } from '../types'
import type { Logger } from '../utils/logger'
import { getRegistryForPackage } from '../utils/npmrc'
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

  const versionsObj = (json.versions ?? {}) as Record<string, Record<string, unknown>>
  const versions = Object.keys(versionsObj).filter((v) => semver.valid(v))

  const distTags = (json['dist-tags'] ?? {}) as Record<string, string>
  const time = (json.time ?? {}) as Record<string, string>
  const deprecated: Record<string, string> = {}

  const provenance: Record<string, ProvenanceLevel> = {}
  const engines: Record<string, string> = {}

  for (const [ver, data] of Object.entries(versionsObj)) {
    if (data.deprecated) {
      deprecated[ver] = String(data.deprecated)
    }
    const dist = data.dist as Record<string, unknown> | undefined
    const hasSignatures =
      data.hasSignatures ||
      (Array.isArray(dist?.signatures) && (dist.signatures as unknown[]).length > 0)
    provenance[ver] = hasSignatures ? 'attested' : 'none'
    const enginesObj = data.engines as Record<string, string> | undefined
    if (enginesObj?.node) {
      engines[ver] = enginesObj.node
    }
  }

  return {
    name,
    versions,
    distTags,
    time,
    deprecated: Object.keys(deprecated).length > 0 ? deprecated : undefined,
    provenance: Object.keys(provenance).length > 0 ? provenance : undefined,
    engines: Object.keys(engines).length > 0 ? engines : undefined,
    description: json.description as string | undefined,
    homepage: json.homepage as string | undefined,
    repository:
      typeof json.repository === 'string'
        ? json.repository
        : ((json.repository as Record<string, unknown> | undefined)?.url as string | undefined),
  }
}

async function fetchJsrPackage(name: string, options: FetchOptions): Promise<PackageData> {
  const url = `https://jsr.io/${name}/meta.json`
  const payload = await fetchWithRetry(url, {}, options)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ResolveError(`Unexpected JSR payload shape for ${url}`)
  }
  const json = payload as Record<string, unknown>

  const versionsObj = (json.versions ?? {}) as Record<string, unknown>
  const versions = Object.keys(versionsObj)
  const latest = (json.latest as string) ?? versions[versions.length - 1] ?? ''

  return {
    name: `jsr:${name}`,
    versions,
    distTags: { latest },
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

  // Fetch tags in pages to avoid missing satisfying versions in long-lived repos.
  for (let page = 1; page <= 10; page++) {
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
    // Never retry 4xx client errors — they won't resolve with retries
    if (error instanceof RegistryError && error.status >= 400 && error.status < 500) {
      throw error
    }

    // Resolve failures from config/transport setup are not transient.
    if (error instanceof ResolveError) {
      throw error
    }

    if (attempt < options.retries) {
      const delay = Math.min(1000 * 2 ** attempt, 5000)
      options.logger.debug(`Retry ${attempt + 1}/${options.retries} for ${url} in ${delay}ms`)
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
