import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CacheError,
  ConfigError,
  RegistryError,
  ResolveError,
  UpgrError,
  WriteError,
} from './errors'
import type { NpmrcConfig } from './types'

const npmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

describe('error hierarchy', () => {
  it('all typed errors extend UpgrError with stable codes', () => {
    const errors = [
      new CacheError('cache'),
      new ConfigError('config'),
      new RegistryError('registry', 404, 'https://registry.npmjs.org/pkg'),
      new ResolveError('resolve'),
      new WriteError('write'),
    ]

    for (const err of errors) {
      expect(err).toBeInstanceOf(UpgrError)
      expect(err.code).toMatch(/^ERR_/)
    }
  })

  it('RegistryError includes status and url', () => {
    const err = new RegistryError('missing', 404, 'https://registry.npmjs.org/missing')
    expect(err.status).toBe(404)
    expect(err.url).toContain('missing')
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
