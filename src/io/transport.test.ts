import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResolveError } from '../errors'
import type { NpmrcConfig } from '../types'
import type { Logger } from '../utils/logger'
import { getFetchTransportInit, resolveTransportPolicy } from './transport'

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
}

function createNpmrc(overrides: Partial<NpmrcConfig> = {}): NpmrcConfig {
  return {
    registries: new Map(),
    defaultRegistry: 'https://registry.npmjs.org/',
    strictSsl: true,
    ...overrides,
  }
}

describe('transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers https-proxy for https URLs', () => {
    const npmrc = createNpmrc({
      proxy: 'http://proxy.local:8080',
      httpsProxy: 'http://secure-proxy.local:8443',
    })
    const policy = resolveTransportPolicy('https://registry.npmjs.org/lodash', npmrc)
    expect(policy.proxyUrl).toBe('http://secure-proxy.local:8443')
  })

  it('prefers proxy for http URLs', () => {
    const npmrc = createNpmrc({
      proxy: 'http://proxy.local:8080',
      httpsProxy: 'http://secure-proxy.local:8443',
    })
    const policy = resolveTransportPolicy('http://registry.example.com/pkg', npmrc)
    expect(policy.proxyUrl).toBe('http://proxy.local:8080')
  })

  it('does not add dispatcher when no transport overrides are configured', () => {
    const npmrc = createNpmrc()
    const init = getFetchTransportInit('https://registry.npmjs.org/lodash', npmrc, mockLogger)
    expect(init.dispatcher).toBeUndefined()
  })

  it('adds dispatcher when strict SSL is disabled', () => {
    const npmrc = createNpmrc({ strictSsl: false })
    const init = getFetchTransportInit('https://registry.npmjs.org/lodash', npmrc, mockLogger)
    expect(init.dispatcher).toBeDefined()
  })

  it('loads cafile content and reuses cached dispatcher', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depfresh-ca-'))
    const cafile = join(dir, 'ca.pem')
    writeFileSync(cafile, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n')

    const npmrc = createNpmrc({ cafile })
    const policy = resolveTransportPolicy('https://registry.npmjs.org/lodash', npmrc)
    expect(policy.tls.ca).toContain('BEGIN CERTIFICATE')

    const first = getFetchTransportInit('https://registry.npmjs.org/lodash', npmrc, mockLogger)
    const second = getFetchTransportInit('https://registry.npmjs.org/lodash', npmrc, mockLogger)
    expect(first.dispatcher).toBeDefined()
    expect(second.dispatcher).toBe(first.dispatcher)
  })

  it('throws ResolveError when cafile path is invalid', () => {
    const npmrc = createNpmrc({ cafile: '/tmp/does-not-exist-ca.pem' })
    expect(() => resolveTransportPolicy('https://registry.npmjs.org/lodash', npmrc)).toThrowError(
      ResolveError,
    )
  })
})
