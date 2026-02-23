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

function mockFetchResponse(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  })
}

function createNpmrc(overrides: Partial<NpmrcConfig> = {}): NpmrcConfig {
  return {
    registries: new Map(),
    defaultRegistry: 'https://registry.npmjs.org/',
    strictSsl: true,
    ...overrides,
  }
}

describe('fetchPackageData transport wiring', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('passes custom dispatcher to fetch when strict SSL is disabled', async () => {
    globalThis.fetch = mockFetchResponse({
      versions: { '1.0.0': {} },
      'dist-tags': { latest: '1.0.0' },
    })

    const { fetchPackageData } = await import('./registry')
    await fetchPackageData('lodash', {
      npmrc: createNpmrc({ strictSsl: false }),
      timeout: 5000,
      retries: 1,
      logger: mockLogger,
    })

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
    const init = fetchCall[1] as { dispatcher?: unknown }
    expect(init.dispatcher).toBeDefined()
  })
})
