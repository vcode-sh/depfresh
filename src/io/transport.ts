import { readFileSync } from 'node:fs'
import { Agent, ProxyAgent } from 'undici'
import { ResolveError } from '../errors'
import type { NpmrcConfig } from '../types'
import type { Logger } from '../utils/logger'

type Dispatcher = NonNullable<RequestInit['dispatcher']>

interface TlsPolicy {
  rejectUnauthorized: boolean
  ca?: string
}

export interface TransportPolicy {
  proxyUrl?: string
  tls: TlsPolicy
}

export interface FetchTransportInit {
  dispatcher?: Dispatcher
}

const dispatcherCache = new Map<string, Dispatcher>()
const caCache = new Map<string, string>()

export function resolveTransportPolicy(url: string, npmrc: NpmrcConfig): TransportPolicy {
  return {
    proxyUrl: resolveProxyUrl(url, npmrc),
    tls: {
      rejectUnauthorized: npmrc.strictSsl,
      ca: npmrc.cafile ? loadCaBundle(npmrc.cafile) : undefined,
    },
  }
}

export function getFetchTransportInit(
  url: string,
  npmrc: NpmrcConfig,
  logger: Logger,
): FetchTransportInit {
  const policy = resolveTransportPolicy(url, npmrc)
  if (!needsCustomTransport(policy)) return {}

  const cacheKey = toCacheKey(policy)
  const cached = dispatcherCache.get(cacheKey)
  if (cached) return { dispatcher: cached }

  const dispatcher = createDispatcher(policy)
  dispatcherCache.set(cacheKey, dispatcher)
  logger.debug(`Configured registry transport (${describePolicy(policy)})`)
  return { dispatcher }
}

function resolveProxyUrl(url: string, npmrc: NpmrcConfig): string | undefined {
  const protocol = getProtocol(url)
  if (protocol === 'http:') {
    return npmrc.proxy ?? npmrc.httpsProxy
  }
  if (protocol === 'https:') {
    return npmrc.httpsProxy ?? npmrc.proxy
  }
  return npmrc.httpsProxy ?? npmrc.proxy
}

function getProtocol(url: string): string {
  try {
    return new URL(url).protocol
  } catch {
    return ''
  }
}

function needsCustomTransport(policy: TransportPolicy): boolean {
  return Boolean(policy.proxyUrl || !policy.tls.rejectUnauthorized || policy.tls.ca)
}

function toCacheKey(policy: TransportPolicy): string {
  return JSON.stringify({
    proxyUrl: policy.proxyUrl ?? '',
    rejectUnauthorized: policy.tls.rejectUnauthorized,
    ca: policy.tls.ca ?? '',
  })
}

function describePolicy(policy: TransportPolicy): string {
  const parts = [`strict-ssl=${policy.tls.rejectUnauthorized}`]
  if (policy.proxyUrl) {
    parts.push(`proxy=${maskCredentials(policy.proxyUrl)}`)
  }
  if (policy.tls.ca) {
    parts.push('cafile=yes')
  }
  return parts.join(', ')
}

function maskCredentials(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      parsed.username = '***'
      parsed.password = '***'
    }
    return parsed.toString()
  } catch {
    return '<invalid-proxy-url>'
  }
}

function createDispatcher(policy: TransportPolicy): Dispatcher {
  if (policy.proxyUrl) {
    return new ProxyAgent({
      uri: policy.proxyUrl,
      requestTls: policy.tls,
      proxyTls: policy.tls,
    }) as unknown as Dispatcher
  }
  return new Agent({ connect: policy.tls }) as unknown as Dispatcher
}

function loadCaBundle(cafilePath: string): string {
  const cached = caCache.get(cafilePath)
  if (cached !== undefined) {
    return cached
  }

  try {
    const content = readFileSync(cafilePath, 'utf-8')
    caCache.set(cafilePath, content)
    return content
  } catch (error) {
    throw new ResolveError(`Unable to read npmrc cafile at ${cafilePath}`, { cause: error })
  }
}
