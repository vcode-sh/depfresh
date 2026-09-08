import { afterEach, expect, it, vi } from 'vitest'
import type { depfreshOptions } from '../types'
import { createLogger } from '../utils/logger'
import { fetchPackageData, fetchPackageVersionData } from './registry'

const options = {
  npmrc: { registries: new Map(), defaultRegistry: 'https://registry.npmjs.org/', strictSsl: true },
  timeout: 1000,
  retries: 0,
  logger: createLogger('silent'),
}

afterEach(() => vi.unstubAllGlobals())

it('discovers a large package through compact metadata and enriches only the requested version', async () => {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push(url)
      if (url.endsWith('/2.0.0'))
        return Response.json({
          name: 'large-package',
          version: '2.0.0',
          engines: { node: '>=24' },
          peerDependencies: { react: '^19.0.0' },
          repository: { url: 'https://github.com/example/repo' },
        })
      if (
        (init.headers as Record<string, string>).accept !== 'application/vnd.npm.install-v1+json'
      ) {
        return new Response('{}', { headers: { 'content-length': String(65 * 1024 * 1024) } })
      }
      return Response.json({
        'dist-tags': { latest: '2.0.0' },
        versions: { '1.0.0': {}, '1.5.0': { deprecated: 'Unsupported' }, '2.0.0': {} },
      })
    }),
  )
  const data = await fetchPackageData('large-package', { ...options, compact: true })
  expect(data.versions).toEqual(['1.0.0', '1.5.0', '2.0.0'])
  expect(data.deprecated).toEqual({ '1.5.0': 'Unsupported' })
  expect(data.engineMetadata).toBeUndefined()
  const selected = await fetchPackageVersionData('large-package', '2.0.0', options)
  expect(selected.engines).toEqual({ '2.0.0': '>=24' })
  expect(selected.peerDependencies).toEqual({ '2.0.0': { react: '^19.0.0' } })
  expect(selected.repository).toBe('https://github.com/example/repo')
  expect(requests).toEqual([
    'https://registry.npmjs.org/large-package',
    'https://registry.npmjs.org/large-package/2.0.0',
  ])
})

it('resolves repeated occurrences with only discovery and the current/target manifests', async () => {
  const { createMemoryCache } = await import('../cache')
  const { DEFAULT_OPTIONS } = await import('../types')
  const { createResolveContext } = await import('./resolve/context')
  const { resolveDependency } = await import('./resolve/resolve-dependency')
  const runOptions = {
    ...DEFAULT_OPTIONS,
    cwd: process.cwd(),
    timediff: false,
    mode: 'latest',
    cacheTTL: 0,
  } as depfreshOptions
  const context = createResolveContext(runOptions, { compactMetadata: true })
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const version = url.split('/').at(-1)
      return Response.json(
        version === 'large-package'
          ? {
              'dist-tags': { latest: '3.0.0' },
              versions: { '1.0.0': {}, '2.0.0': {}, '3.0.0': {} },
            }
          : { name: 'large-package', version, engines: { node: '>=24' } },
      )
    }),
  )
  for (let occurrence = 0; occurrence < 3; occurrence++) {
    const result = await resolveDependency(
      {
        name: 'large-package',
        currentVersion: '^1.0.0',
        source: 'dependencies',
        update: true,
        parents: [],
      },
      runOptions,
      createMemoryCache(),
      options.npmrc,
      options.logger,
      undefined,
      context,
    )
    expect(result?.targetVersion).toBe('^3.0.0')
    expect(result?.nodeCompat).toBe('>=24')
  }
  expect(urls).toEqual([
    'https://registry.npmjs.org/large-package',
    'https://registry.npmjs.org/large-package/1.0.0',
    'https://registry.npmjs.org/large-package/3.0.0',
  ])
  expect(context.metrics.fetchesStarted).toBe(urls.length)
  expect(context.metrics.dedupeHits).toBe(6)
})

it.each([{ cooldown: 2 }, { mode: 'newest' as const }, { sort: 'time-desc' as const }])(
  'keeps publication-time requests bounded when required by %j',
  async (required) => {
    const { createMemoryCache } = await import('../cache')
    const { DEFAULT_OPTIONS } = await import('../types')
    const { createResolveContext } = await import('./resolve/context')
    const { resolveDependency } = await import('./resolve/resolve-dependency')
    const runOptions = {
      ...DEFAULT_OPTIONS,
      cwd: process.cwd(),
      timediff: false,
      cacheTTL: 0,
      ...required,
    } as depfreshOptions
    const context = createResolveContext(runOptions, { compactMetadata: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect((init.headers as Record<string, string>).accept).toBe('application/json')
        return new Response('{}', { headers: { 'content-length': String(65 * 1024 * 1024) } })
      }),
    )
    const result = await resolveDependency(
      {
        name: 'large-package',
        currentVersion: '^1.0.0',
        source: 'dependencies',
        update: true,
        parents: [],
      },
      runOptions,
      createMemoryCache(),
      options.npmrc,
      options.logger,
      undefined,
      context,
    )
    expect(result?.diff).toBe('error')
    expect(result?.resolutionError?.message).toContain('exceeds 67108864-byte limit')
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  },
)

it.each([404, 503])(
  'preserves selected updates on HTTP %s advisory failures without retrying',
  async (status) => {
    const { createMemoryCache } = await import('../cache')
    const { DEFAULT_OPTIONS } = await import('../types')
    const { createResolveContext } = await import('./resolve/context')
    const { resolveDependency } = await import('./resolve/resolve-dependency')
    const runOptions = {
      ...DEFAULT_OPTIONS,
      cwd: process.cwd(),
      timediff: false,
      mode: 'latest',
      cacheTTL: 0,
    } as depfreshOptions
    const context = createResolveContext(runOptions, { compactMetadata: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/large-package')
          ? Response.json({
              'dist-tags': { latest: '2.0.0' },
              versions: { '1.0.0': {}, '2.0.0': {} },
            })
          : new Response('', { status }),
      ),
    )
    for (let occurrence = 0; occurrence < 2; occurrence++) {
      const result = await resolveDependency(
        {
          name: 'large-package',
          currentVersion: '^1.0.0',
          source: 'dependencies',
          update: true,
          parents: [],
        },
        runOptions,
        createMemoryCache(),
        options.npmrc,
        options.logger,
        undefined,
        context,
      )
      expect(result).toMatchObject({ targetVersion: '^2.0.0', diff: 'major' })
      expect(result?.metadataWarning?.message).toContain(`HTTP ${status}`)
      expect(result?.resolutionError).toBeUndefined()
      expect(result?.nodeCompat).toBeUndefined()
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  },
)

it('reuses selected compact details without extending discovery expiry on warm reads or enrichment', async () => {
  const { createMemoryCache } = await import('../cache')
  const { DEFAULT_OPTIONS } = await import('../types')
  const { createResolveContext } = await import('./resolve/context')
  const { resolveDependency } = await import('./resolve/resolve-dependency')
  const runOptions = {
    ...DEFAULT_OPTIONS,
    cwd: process.cwd(),
    timediff: false,
    mode: 'latest',
    cacheTTL: 60_000,
  } as depfreshOptions
  let now = 0
  const cache = createMemoryCache(() => now)
  const urls: string[] = []
  const record = (version: string) => ({
    name: 'large-package',
    version,
    dist: {},
    engines: { node: '>=24' },
    peerDependencies: { react: '^19.0.0' },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const version = url.split('/').at(-1)!
      return Response.json(
        version === 'large-package'
          ? {
              'dist-tags': { latest: '3.0.0' },
              versions: {
                '1.0.0': record('1.0.0'),
                '2.0.0': record('2.0.0'),
                '3.0.0': record('3.0.0'),
              },
            }
          : record(version),
      )
    }),
  )
  for (const [at, currentVersion, expectedRequests] of [
    [0, '^1.0.0', 1],
    [30_000, '^1.0.0', 1],
    [45_000, '^2.0.0', 2],
    [60_001, '^1.0.0', 3],
  ] as const) {
    now = at
    const context = createResolveContext(runOptions, { compactMetadata: true })
    const before = urls.length
    const result = await resolveDependency(
      { name: 'large-package', currentVersion, source: 'dependencies', update: true, parents: [] },
      runOptions,
      cache,
      options.npmrc,
      options.logger,
      undefined,
      context,
    )
    expect(result?.targetVersion).toBe('^3.0.0')
    expect(result?.nodeCompat).toBe('>=24')
    expect(urls).toHaveLength(expectedRequests)
    expect(context.metrics.fetchesStarted).toBe(urls.length - before)
    if (before === 0) expect(Object.keys(result?.pkgData.engines ?? {})).toEqual(['1.0.0', '3.0.0'])
    expect(result?.pkgData).not.toHaveProperty('rawVersions')
  }
  expect(urls).toEqual([
    'https://registry.npmjs.org/large-package',
    'https://registry.npmjs.org/large-package/2.0.0',
    'https://registry.npmjs.org/large-package',
  ])
})

it.each(['oversize', 'timeout'])(
  'keeps updates when optional release dates fail with %s',
  async (failure) => {
    const { createMemoryCache } = await import('../cache')
    const { DEFAULT_OPTIONS } = await import('../types')
    const { createResolveContext } = await import('./resolve/context')
    const { resolveDependency } = await import('./resolve/resolve-dependency')
    const runOptions = {
      ...DEFAULT_OPTIONS,
      cwd: process.cwd(),
      timediff: true,
      mode: 'latest',
      cacheTTL: 0,
      timeout: 30,
    } as depfreshOptions
    const context = createResolveContext(runOptions, { compactMetadata: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (
          (init.headers as Record<string, string>).accept === 'application/vnd.npm.install-v1+json'
        ) {
          return Response.json({
            'dist-tags': { latest: '2.0.0' },
            versions: Object.fromEntries(
              ['1.0.0', '2.0.0'].map((version) => [
                version,
                { name: 'large-package', version, dist: {} },
              ]),
            ),
          })
        }
        if (failure === 'oversize')
          return new Response('{}', { headers: { 'content-length': String(65 * 1024 * 1024) } })
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          ),
        )
      }),
    )
    for (let occurrence = 0; occurrence < 2; occurrence++) {
      const result = await resolveDependency(
        {
          name: 'large-package',
          currentVersion: '^1.0.0',
          source: 'dependencies',
          update: true,
          parents: [],
        },
        runOptions,
        createMemoryCache(),
        options.npmrc,
        options.logger,
        undefined,
        context,
      )
      expect(result).toMatchObject({ targetVersion: '^2.0.0', diff: 'major' })
      expect(result?.resolutionError).toBeUndefined()
      expect(result?.publishedAt).toBeUndefined()
      expect(result?.metadataWarning?.message).toMatch(/exceeds|timeout/u)
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(context.metrics.fetchesStarted).toBe(2)
  },
)

it('reuses fresh full metadata for optional dates without additional requests or extending its expiry', async () => {
  const { createMemoryCache } = await import('../cache')
  const { DEFAULT_OPTIONS } = await import('../types')
  const { createResolveContext } = await import('./resolve/context')
  const { resolveDependency } = await import('./resolve/resolve-dependency')
  const runOptions = {
    ...DEFAULT_OPTIONS,
    cwd: process.cwd(),
    timediff: true,
    mode: 'latest',
    cacheTTL: 1000,
  } as depfreshOptions
  let now = 0
  const cache = createMemoryCache(() => now)
  const fullKey = 'npm|https://registry.npmjs.org/|large-package'
  cache.set(
    fullKey,
    {
      name: 'large-package',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: { '1.0.0': '2025-01-01', '2.0.0': '2025-02-01' },
    },
    1000,
  )
  now = 900
  vi.stubGlobal('fetch', vi.fn())
  const result = await resolveDependency(
    {
      name: 'large-package',
      currentVersion: '^1.0.0',
      source: 'dependencies',
      update: true,
      parents: [],
    },
    runOptions,
    cache,
    options.npmrc,
    options.logger,
    undefined,
    createResolveContext(runOptions, { compactMetadata: true }),
  )
  expect(result).toMatchObject({
    targetVersion: '^2.0.0',
    publishedAt: '2025-02-01',
    currentVersionTime: '2025-01-01',
  })
  expect(result?.metadataWarning).toBeUndefined()
  expect(globalThis.fetch).not.toHaveBeenCalled()
  now = 1001
  expect(cache.get(fullKey)).toBeUndefined()
})
