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

const REGISTRY_RESPONSE_LIMIT_BYTES = 64 * 1024 * 1024
const GITHUB_MAX_PAGES = 100
const GITHUB_MAX_RECORDS = 10_000
const GITHUB_ELAPSED_LIMIT_MS = 30_000

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

  it('retains only string registry timestamps', async () => {
    globalThis.fetch = mockFetchResponse({
      versions: { '1.0.0': {}, '2.0.0': {} },
      'dist-tags': { latest: '2.0.0' },
      time: {
        '1.0.0': '2025-01-01T00:00:00.000Z',
        '2.0.0': 1,
        modified: null,
      },
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('timestamp-fixture', defaultOptions)

    expect(result.time).toEqual({ '1.0.0': '2025-01-01T00:00:00.000Z' })
  })

  it('routes jsr: packages to jsr.io', async () => {
    const jsrResponse = {
      versions: {
        '2.0.0': { createdAt: '2025-02-01T00:00:00.000Z' },
        invalid: { createdAt: '2025-03-01T00:00:00.000Z' },
        '1.0.0': { createdAt: '2025-01-01T00:00:00.000Z' },
        '3.0.0': { createdAt: '2025-03-01T00:00:00.000Z', yanked: true },
      },
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
    expect(result.versions).toEqual(['2.0.0', '1.0.0', '3.0.0'])
    expect(result.distTags.latest).toBe('2.0.0')
    expect(result.time).toEqual({
      '2.0.0': '2025-02-01T00:00:00.000Z',
      '1.0.0': '2025-01-01T00:00:00.000Z',
      '3.0.0': '2025-03-01T00:00:00.000Z',
    })
    expect(result.deprecated).toEqual({ '3.0.0': 'Version is yanked' })
    expect(result.deprecationPresence).toEqual({
      '1.0.0': 'absent',
      '2.0.0': 'absent',
      '3.0.0': 'present',
    })

    const { selectVersionCandidate } = await import('./resolve')
    expect(
      selectVersionCandidate({
        currentVersion: '1.0.0',
        pkgData: result,
        mode: 'newest',
        includeLocked: true,
        cooldown: 0,
      }),
    ).toMatchObject({
      targetVersion: '2.0.0',
      reason: 'SELECTED',
    })
  })

  it('does not fabricate JSR latest from object insertion order', async () => {
    globalThis.fetch = mockFetchResponse({
      versions: {
        '9.0.0': { createdAt: '2025-02-01T00:00:00.000Z' },
        '1.0.0': { createdAt: '2025-01-01T00:00:00.000Z' },
      },
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('jsr:@std/path', defaultOptions)

    expect(result.distTags).toEqual({})
  })

  it('routes github: packages to GitHub tags API and normalizes semver tags', async () => {
    globalThis.fetch = mockFetchResponse([
      { name: 'v2.0.0' },
      { name: '1.5.0' },
      { name: 'not-a-version' },
    ])

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('github:owner/repo', defaultOptions)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/tags?per_page=100&page=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/vnd.github+json',
          'user-agent': 'depfresh',
        }),
      }),
    )
    expect(result.name).toBe('github:owner/repo')
    expect(result.versions).toEqual(['1.5.0', '2.0.0'])
    expect(result.distTags.latest).toBe('2.0.0')
  })

  it('rejects an unsafe GitHub repository identity before fetch', async () => {
    globalThis.fetch = vi.fn()

    const { fetchPackageData } = await import('./registry')
    await expect(fetchPackageData('github:owner/repo/extra', defaultOptions)).rejects.toThrow(
      'Invalid GitHub repository identity',
    )

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('sends GitHub authorization header when token env var is set', async () => {
    process.env.GITHUB_TOKEN = 'ghs_test_token'
    process.env.GH_TOKEN = undefined
    globalThis.fetch = mockFetchResponse([{ name: 'v1.0.0' }])

    const { fetchPackageData } = await import('./registry')
    await fetchPackageData('github:owner/repo', defaultOptions)

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ghs_test_token')
  })

  it('throws resolve error when github repository has no semver tags', async () => {
    globalThis.fetch = mockFetchResponse([{ name: 'latest' }, { name: 'dev' }])

    const { fetchPackageData } = await import('./registry')
    await expect(fetchPackageData('github:owner/repo', defaultOptions)).rejects.toThrow(
      'No semver tags found for github:owner/repo',
    )
  })

  it('continues paginating GitHub tags until a semver tag is found', async () => {
    const responses = Array.from({ length: 10 }, () =>
      Array.from({ length: 100 }, () => ({ name: 'not-a-version' })),
    )
    responses.push([{ name: 'v3.1.4' }])

    globalThis.fetch = vi.fn().mockImplementation(() => {
      const next = responses.shift()
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(next ?? []),
      })
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('github:owner/repo', defaultOptions)

    expect(globalThis.fetch).toHaveBeenCalledTimes(11)
    expect(result.versions).toEqual(['3.1.4'])
    expect(result.distTags.latest).toBe('3.1.4')
  })

  it('fails GitHub traversal without partial candidates after the maximum page count', async () => {
    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve(
            callCount <= GITHUB_MAX_PAGES
              ? Array.from({ length: 100 }, (_, index) => ({
                  name: index === 0 ? 'v1.0.0' : 'not-a-version',
                }))
              : [{ name: 'v2.0.0' }],
          ),
      })
    })

    const { fetchPackageData } = await import('./registry')

    await expect(fetchPackageData('github:owner/repo', defaultOptions)).rejects.toThrow(
      `exceeded ${GITHUB_MAX_PAGES}-page limit`,
    )
    expect(globalThis.fetch).toHaveBeenCalledTimes(GITHUB_MAX_PAGES)
  })

  it('fails GitHub traversal without partial candidates after the maximum record count', async () => {
    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve(
            callCount === 1
              ? Array.from({ length: GITHUB_MAX_RECORDS + 1 }, (_, index) => ({
                  name: index === 0 ? 'v1.0.0' : 'not-a-version',
                }))
              : [],
          ),
      })
    })

    const { fetchPackageData } = await import('./registry')

    await expect(fetchPackageData('github:owner/repo', defaultOptions)).rejects.toThrow(
      `exceeded ${GITHUB_MAX_RECORDS}-record limit`,
    )
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('fails GitHub traversal when its aggregate monotonic elapsed budget is exhausted', async () => {
    let elapsed = 0
    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++
      elapsed = GITHUB_ELAPSED_LIMIT_MS + 1
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve(
            callCount === 1
              ? Array.from({ length: 100 }, (_, index) => ({
                  name: index === 0 ? 'v1.0.0' : 'not-a-version',
                }))
              : [{ name: 'v2.0.0' }],
          ),
      })
    })

    const { fetchPackageData } = await import('./registry')

    await expect(
      fetchPackageData('github:owner/repo', {
        ...defaultOptions,
        monotonicNow: () => elapsed,
      }),
    ).rejects.toThrow(`exceeded ${GITHUB_ELAPSED_LIMIT_MS}ms elapsed-time limit`)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized declared success body and cancels it before reading', async () => {
    const cancel = vi.fn()
    let emitted = false
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        if (emitted) controller.close()
        else {
          emitted = true
          controller.enqueue(new TextEncoder().encode('{"versions":{"1.0.0":{}}}'))
        }
      },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        headers: { 'content-length': String(REGISTRY_RESPONSE_LIMIT_BYTES + 1) },
      }),
    )

    const { fetchPackageData } = await import('./registry')

    await expect(
      fetchPackageData('oversized-package', { ...defaultOptions, retries: 0 }),
    ).rejects.toThrow(`exceeds ${REGISTRY_RESPONSE_LIMIT_BYTES}-byte limit`)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-byte-count'],
  ])(
    'enforces the streamed success-body limit when content-length is %s',
    async (_description, contentLength) => {
      const cancel = vi.fn()
      const chunk = new Uint8Array(1024 * 1024)
      let emitted = 0
      const body = new ReadableStream<Uint8Array>(
        {
          cancel,
          pull(controller) {
            if (emitted > REGISTRY_RESPONSE_LIMIT_BYTES / chunk.byteLength) controller.close()
            else {
              controller.enqueue(chunk)
              emitted++
            }
          },
        },
        { highWaterMark: 0 },
      )
      const headers = contentLength === undefined ? undefined : { 'content-length': contentLength }
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(body, { headers }))

      const { fetchPackageData } = await import('./registry')

      await expect(
        fetchPackageData('streamed-package', { ...defaultOptions, retries: 0 }),
      ).rejects.toThrow(`exceeds ${REGISTRY_RESPONSE_LIMIT_BYTES}-byte limit`)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    },
  )

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

  it('includes Basic auth header for registries configured with basic auth', async () => {
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
            url: 'https://private.registry.com/npm/',
            token: 'dXNlcjpwYXNz',
            authType: 'basic',
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
    expect(headers.authorization).toBe('Basic dXNlcjpwYXNz')
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

  it('records signature presence from hasSignatures without claiming verification', async () => {
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

    expect(result.signaturePresence).toEqual({
      '1.0.0': 'present',
      '2.0.0': 'absent',
      '3.0.0': 'unknown',
    })
    expect(result.provenance).toBeUndefined()
  })

  it('records signature presence from full metadata without claiming verification', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': { dist: { signatures: [{ keyid: 'SHA256:key', sig: 'abc' }] } },
        '2.0.0': { dist: { signatures: [] } },
        '3.0.0': { dist: {} },
      },
      'dist-tags': { latest: '3.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('full-meta-pkg', defaultOptions)

    expect(result.signaturePresence).toEqual({
      '1.0.0': 'present',
      '2.0.0': 'absent',
      '3.0.0': 'unknown',
    })
    expect(result.provenance).toBeUndefined()
  })

  it('keeps malformed and contradictory signature metadata unknown', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': { hasSignatures: true, dist: { signatures: [] } },
        '2.0.0': { dist: { signatures: 'not-an-array' } },
        '3.0.0': { hasSignatures: 'yes' },
      },
      'dist-tags': { latest: '3.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('ambiguous-signatures', defaultOptions)

    expect(result.signaturePresence).toEqual({
      '1.0.0': 'unknown',
      '2.0.0': 'unknown',
      '3.0.0': 'unknown',
    })
  })

  it('records attestation presence without exposing or verifying its URL', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': { dist: { attestations: { url: 'https://registry.example.test/a.json' } } },
        '2.0.0': { dist: { attestations: {} } },
        '3.0.0': { dist: { attestations: null } },
      },
      'dist-tags': { latest: '3.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('attested-package', defaultOptions)

    expect(result.provenancePresence).toEqual({
      '1.0.0': 'present',
      '2.0.0': 'unknown',
      '3.0.0': 'unknown',
    })
    expect(JSON.stringify(result.provenancePresence)).not.toContain('registry.example')
  })

  it('records only exact sha512 artifact integrity and the credential-free registry identity', async () => {
    const valid = `sha512-${Buffer.alloc(64, 3).toString('base64')}`
    globalThis.fetch = mockFetchResponse({
      versions: {
        '1.0.0': { dist: { integrity: valid } },
        '2.0.0': { dist: { integrity: 'sha512-not-base64' } },
        '3.0.0': { dist: { integrity: `sha512-${Buffer.alloc(63).toString('base64')}` } },
        '4.0.0': { dist: { integrity: `sha256-${Buffer.alloc(32).toString('base64')}` } },
      },
      'dist-tags': { latest: '4.0.0' },
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('artifact-fixture', defaultOptions)

    expect(result.registry).toBe('https://registry.npmjs.org/')
    expect(result.artifactIntegrity).toEqual({ '1.0.0': valid })
  })

  it('keeps hostile peer metadata unknown instead of serializing control text', async () => {
    const hostile = '\u001B[31mpeer\nname'
    globalThis.fetch = mockFetchResponse({
      versions: { '1.0.0': { peerDependencies: { [hostile]: '^1.0.0' } } },
      'dist-tags': { latest: '1.0.0' },
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('hostile-peer-package', defaultOptions)

    expect(result.peerMetadata).toEqual({ '1.0.0': 'unknown' })
    expect(JSON.stringify(result)).not.toContain(hostile)
  })

  it('keeps path-like peer names unknown instead of serializing them as graph subjects', async () => {
    globalThis.fetch = mockFetchResponse({
      versions: { '1.0.0': { peerDependencies: { '../escape': '^1.0.0' } } },
      'dist-tags': { latest: '1.0.0' },
    })

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('path-like-peer-package', defaultOptions)

    expect(result.peerMetadata).toEqual({ '1.0.0': 'unknown' })
    expect(JSON.stringify(result)).not.toContain('../escape')
  })

  it('extracts peer requirements and optionality without coercing malformed fields', async () => {
    const npmResponse = {
      versions: {
        '1.0.0': {
          peerDependencies: { react: '^18.0.0' },
          peerDependenciesMeta: { react: { optional: true } },
        },
        '2.0.0': { peerDependencies: ['invalid'] },
      },
      'dist-tags': { latest: '2.0.0' },
    }
    globalThis.fetch = mockFetchResponse(npmResponse)

    const { fetchPackageData } = await import('./registry')
    const result = await fetchPackageData('peer-package', defaultOptions)

    expect(result.peerDependencies).toEqual({ '1.0.0': { react: '^18.0.0' } })
    expect(result.optionalPeerDependencies).toEqual({ '1.0.0': ['react'] })
    expect(result.peerMetadata).toEqual({ '1.0.0': 'present', '2.0.0': 'unknown' })
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
