import * as semver from 'semver'
import type { NpmrcConfig, PackageData, RegistryConfig } from '../types'
import type { Logger } from '../utils/logger'
import { getRegistryForPackage } from '../utils/npmrc'

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
    accept: 'application/vnd.npm.install-v1+json',
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

  for (const [ver, data] of Object.entries(versionsObj)) {
    if (data.deprecated) {
      deprecated[ver] = String(data.deprecated)
    }
  }

  return {
    name,
    versions,
    distTags,
    time,
    deprecated: Object.keys(deprecated).length > 0 ? deprecated : undefined,
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
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`)
    }

    return (await response.json()) as Record<string, unknown>
  } catch (error) {
    if (attempt < options.retries) {
      const delay = Math.min(1000 * 2 ** attempt, 5000)
      options.logger.debug(`Retry ${attempt + 1}/${options.retries} for ${url} in ${delay}ms`)
      await sleep(delay)
      return fetchWithRetry(url, headers, options, attempt + 1)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
