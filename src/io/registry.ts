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

  const json = await fetchWithRetry(url, headers, options)

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
  const json = await fetchWithRetry(url, {}, options)

  const versionsObj = (json.versions ?? {}) as Record<string, unknown>
  const versions = Object.keys(versionsObj)
  const latest = (json.latest as string) ?? versions[versions.length - 1] ?? ''

  return {
    name: `jsr:${name}`,
    versions,
    distTags: { latest },
  }
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  options: FetchOptions,
  attempt = 0,
): Promise<Record<string, unknown>> {
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
      throw new RegistryError(
        `HTTP ${response.status}: ${response.statusText} for ${url}`,
        response.status,
        url,
      )
    }

    return (await response.json()) as Record<string, unknown>
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
