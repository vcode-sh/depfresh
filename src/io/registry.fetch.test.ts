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
          accept: 'application/json',
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

  it('sends correct Accept header for full metadata', async () => {
    const npmResponse = {
      versions: { '1.0.0': {} },
      'dist-tags': { latest: '1.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    await fetchPackageData('test-pkg', defaultOptions)

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>
    expect(headers.accept).toBe('application/json')
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

  it('extracts provenance from hasSignatures field', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': { hasSignatures: true },
        '2.0.0': { hasSignatures: false },
        '3.0.0': {},
      },
      'dist-tags': { latest: '3.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('signed-pkg', defaultOptions)

    expect(result.provenance).toEqual({
      '1.0.0': 'attested',
      '2.0.0': 'none',
      '3.0.0': 'none',
    })
  })

  it('extracts provenance from dist.signatures in full metadata', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': { dist: { signatures: [{ sig: 'abc' }] } },
        '2.0.0': { dist: { signatures: [] } },
        '3.0.0': { dist: {} },
      },
      'dist-tags': { latest: '3.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('full-meta-pkg', defaultOptions)

    expect(result.provenance).toEqual({
      '1.0.0': 'attested',
      '2.0.0': 'none',
      '3.0.0': 'none',
    })
  })

  it('extracts engines.node per version', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': { engines: { node: '>=14' } },
        '2.0.0': { engines: { node: '>=18' } },
        '3.0.0': {},
      },
      'dist-tags': { latest: '3.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('engines-pkg', defaultOptions)

    expect(result.engines).toEqual({
      '1.0.0': '>=14',
      '2.0.0': '>=18',
    })
  })

  it('returns undefined engines when no versions have engines', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': {},
        '2.0.0': {},
      },
      'dist-tags': { latest: '2.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('no-engines-pkg', defaultOptions)

    expect(result.engines).toBeUndefined()
  })
})
