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

describe('fetchWithRetry', () => {
  const originalFetch = globalThis.fetch
  const originalGithubToken = process.env.GITHUB_TOKEN
  const originalGhToken = process.env.GH_TOKEN

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalGithubToken === undefined) {
      process.env.GITHUB_TOKEN = undefined
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken
    }
    if (originalGhToken === undefined) {
      process.env.GH_TOKEN = undefined
    } else {
      process.env.GH_TOKEN = originalGhToken
    }
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

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('does NOT retry when GitHub API rate limit is exceeded', async () => {
    process.env.GITHUB_TOKEN = 'ghs_test_token'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: {
        get: (name: string) => {
          if (name === 'x-ratelimit-remaining') return '0'
          if (name === 'x-ratelimit-reset') return '1700000000'
          return null
        },
      },
      json: () => Promise.resolve({ message: 'API rate limit exceeded' }),
    })

    const { fetchPackageData } = await import('./registry')

    await expect(fetchPackageData('github:owner/repo', defaultOptions)).rejects.toThrow(
      'GitHub API rate limit exceeded',
    )

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
