import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AddonError,
  CacheError,
  ConfigError,
  depfreshError,
  RegistryError,
  ResolveError,
  WriteError,
} from './errors'
import type { NpmrcConfig } from './types'
import { getSafeErrorDetails, redactSensitiveValue } from './utils/redact'

const npmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

describe('error hierarchy', () => {
  it('all typed errors extend depfreshError with stable codes', () => {
    const errors = [
      new CacheError('cache'),
      new ConfigError('config'),
      new AddonError('addon', 'test-addon', 'setup'),
      new RegistryError('registry', 404, 'https://registry.npmjs.org/pkg'),
      new ResolveError('resolve'),
      new WriteError('write'),
    ]

    for (const err of errors) {
      expect(err).toBeInstanceOf(depfreshError)
      expect(err.code).toMatch(/^ERR_/)
    }
  })

  it('redacts nested causes, sensitive keys, URL credentials, and environment values', () => {
    const cause = new Error(
      'Bearer nested-secret from https://user:password@example.test/pkg?token=query-secret',
    )
    Object.assign(cause, {
      authorization: 'Basic header-secret',
      context: {
        NPM_TOKEN: 'env-secret',
        apiKey: 'api-key-secret',
        accessToken: 'access-token-secret',
        clientSecret: 'client-secret',
        safeHost: 'registry.example.test',
      },
    })
    const error = new ConfigError('Configuration failed', { cause })

    const details = getSafeErrorDetails(error)
    const serialized = JSON.stringify(details)
    expect(details.cause).toMatchObject({
      name: 'Error',
      message: expect.stringContaining('example.test'),
    })
    expect(serialized).toContain('registry.example.test')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toMatch(
      /nested-secret|user:password|query-secret|header-secret|env-secret|api-key-secret|access-token-secret|client-secret/u,
    )
  })

  it('redacts common key assignment spellings in text', () => {
    const error = new ConfigError(
      'API_KEY=api-secret accessToken=access-secret CLIENT_SECRET=client-secret',
    )

    expect(error.message).not.toMatch(/api-secret|access-secret|client-secret/u)
    expect(error.message.match(/\[REDACTED\]/gu)).toHaveLength(3)
  })

  it('redacts circular nested values without mutating the source', () => {
    const source: Record<string, unknown> = { token: 'top-secret' }
    source.self = source

    expect(redactSensitiveValue(source)).toEqual({ token: '[REDACTED]', self: '[CIRCULAR]' })
    expect(source.token).toBe('top-secret')
    expect(source.self).toBe(source)
  })

  it('RegistryError includes status and url', () => {
    const err = new RegistryError('missing', 404, 'https://registry.npmjs.org/missing')
    expect(err.status).toBe(404)
    expect(err.url).toContain('missing')
  })

  it('redacts registry URL userinfo, sensitive query values, and authorization text', () => {
    const error = new RegistryError(
      'Authorization: Bearer top-secret at https://user:password@registry.example/pkg?token=top-secret',
      401,
      'https://user:password@registry.example/pkg?token=top-secret',
    )

    expect(error.message).toContain('registry.example')
    expect(error.url).toContain('registry.example')
    expect(`${error.message} ${error.url}`).toContain('[REDACTED]')
    expect(`${error.message} ${error.url}`).not.toMatch(/top-secret|user:password/u)
  })
})

describe('typed registry failures', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('throws RegistryError for 4xx responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({}),
    })

    const { fetchPackageData } = await import('./io/registry')

    await expect(
      fetchPackageData('missing-pkg', {
        npmrc,
        timeout: 100,
        retries: 0,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(RegistryError)
  })

  it('throws ResolveError for network failures', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('network down'))

    const { fetchPackageData } = await import('./io/registry')

    await expect(
      fetchPackageData('any-pkg', {
        npmrc,
        timeout: 100,
        retries: 0,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(ResolveError)
  })
})
