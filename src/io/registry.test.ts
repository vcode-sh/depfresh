import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NpmrcConfig } from '../types'
import type { Logger } from '../utils/logger'

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
}

const defaultNpmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

const defaultOptions = {
  npmrc: defaultNpmrc,
  timeout: 5000,
  retries: 2,
  logger: mockLogger,
}

function mockFetchResponse(body: unknown, status = 200, statusText = 'OK') {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
  })
}

describe('fetchPackageData', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('routes npm packages to the npm registry', async () => {
    const npmResponse = {
      versions: { '1.0.0': {}, '2.0.0': {} },
      'dist-tags': { latest: '2.0.0' },
      time: { '1.0.0': '2024-01-01', '2.0.0': '2024-06-01' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('lodash', defaultOptions)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/lodash',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/vnd.npm.install-v1+json',
        }),
      }),
    )
    expect(result.name).toBe('lodash')
    expect(result.versions).toEqual(['1.0.0', '2.0.0'])
    expect(result.distTags.latest).toBe('2.0.0')
  })

  it('routes jsr: packages to jsr.io', async () => {
    const jsrResponse = {
      versions: { '1.0.0': {}, '2.0.0': {} },
      latest: '2.0.0',
    }
    globalThis.fetch = mockFetchResponse(jsrResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('jsr:@std/path', defaultOptions)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://jsr.io/@std/path/meta.json',
      expect.any(Object),
    )
    expect(result.name).toBe('jsr:@std/path')
    expect(result.distTags.latest).toBe('2.0.0')
  })

  it('encodes scoped package names correctly', async () => {
    const npmResponse = {
      versions: { '3.0.0': {} },
      'dist-tags': { latest: '3.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    await fetchPackageData('@vue/reactivity', defaultOptions)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@vue%2Freactivity',
      expect.any(Object),
    )
  })

  it('sends correct Accept header for abbreviated metadata', async () => {
    const npmResponse = {
      versions: { '1.0.0': {} },
      'dist-tags': { latest: '1.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    await fetchPackageData('test-pkg', defaultOptions)

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>
    expect(headers.accept).toBe('application/vnd.npm.install-v1+json')
  })

  it('includes auth header for registries with tokens', async () => {
    const npmResponse = {
      versions: { '1.0.0': {} },
      'dist-tags': { latest: '1.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const scopedNpmrc: NpmrcConfig = {
      registries: new Map([
        [
          '@private',
          {
            url: 'https://private.registry.com/',
            token: 'secret-token',
            authType: 'bearer',
            scope: '@private',
          },
        ],
      ]),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const { fetchPackageData } = await import('./registry')
    await fetchPackageData('@private/pkg', {
      ...defaultOptions,
      npmrc: scopedNpmrc,
    })

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer secret-token')
  })

  it('detects deprecated versions', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': { deprecated: 'Use 2.x' },
        '2.0.0': {},
      },
      'dist-tags': { latest: '2.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('old-pkg', defaultOptions)

    expect(result.deprecated).toEqual({ '1.0.0': 'Use 2.x' })
  })
})

describe('fetchWithRetry', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('succeeds on first attempt', async () => {
    const npmResponse = {
      versions: { '1.0.0': {} },
      'dist-tags': { latest: '1.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('test-pkg', defaultOptions)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(result.name).toBe('test-pkg')
  })

  it('retries on 500 server error', async () => {
    const successResponse = {
      versions: { '1.0.0': {} },
      'dist-tags': { latest: '1.0.0' },
    }

    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({}),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(successResponse),
      })
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('test-pkg', {
      ...defaultOptions,
      retries: 2,
    })

    // First call fails with 500, second retries successfully
    // But RegistryError with status 500 is >= 400 and < 500? No, 500 >= 500
    // Actually wait: 500 is NOT in the 4xx range, so it should retry
    expect(callCount).toBe(2)
    expect(result.name).toBe('test-pkg')
  }, 10_000)

  it('does NOT retry on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({}),
    })

    const { fetchPackageData } = await import('./registry')

    await expect(
      fetchPackageData('nonexistent-pkg', {
        ...defaultOptions,
        retries: 2,
      }),
    ).rejects.toThrow('HTTP 404')

    // Should NOT retry on 404 — only 1 call
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 403', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: () => Promise.resolve({}),
    })

    const { fetchPackageData } = await import('./registry')

    await expect(
      fetchPackageData('private-pkg', {
        ...defaultOptions,
        retries: 2,
      }),
    ).rejects.toThrow('HTTP 403')

    // Should NOT retry on 403 — only 1 call
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on network errors', async () => {
    const successResponse = {
      versions: { '1.0.0': {} },
      'dist-tags': { latest: '1.0.0' },
    }

    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.reject(new TypeError('fetch failed'))
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(successResponse),
      })
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('test-pkg', {
      ...defaultOptions,
      retries: 2,
    })

    expect(callCount).toBe(2)
    expect(result.name).toBe('test-pkg')
  }, 10_000)

  it('throws after all retries exhausted', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

    const { fetchPackageData } = await import('./registry')

    await expect(
      fetchPackageData('test-pkg', {
        ...defaultOptions,
        retries: 1,
      }),
    ).rejects.toThrow('fetch failed')

    // Initial + 1 retry = 2 calls
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  }, 10_000)
})
