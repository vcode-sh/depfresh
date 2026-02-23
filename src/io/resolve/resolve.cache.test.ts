import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, NpmrcConfig, PackageData, PackageMeta, RawDep } from '../../types'

vi.mock('../registry', () => ({
  fetchPackageData: vi.fn(),
}))

vi.mock('../../cache/index', () => ({
  createSqliteCache: vi.fn(),
}))

vi.mock('../../utils/npmrc', () => ({
  loadNpmrc: vi.fn(),
}))

const mockPkgData: PackageData = {
  name: 'test-pkg',
  versions: ['1.0.0', '1.1.0', '1.2.0', '2.0.0'],
  distTags: { latest: '2.0.0' },
}

function makeDep(overrides: Partial<RawDep> = {}): RawDep {
  return {
    name: 'test-pkg',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    ...overrides,
  }
}

function makeOptions(overrides: Partial<depfreshOptions> = {}): depfreshOptions {
  return {
    cwd: '/tmp/test',
    recursive: true,
    mode: 'default',
    write: false,
    interactive: false,
    force: false,
    includeLocked: false,
    includeWorkspace: true,
    concurrency: 4,
    timeout: 5000,
    retries: 2,
    cacheTTL: 60_000,
    output: 'table',
    loglevel: 'silent',
    peer: false,
    global: false,
    globalAll: false,
    ignorePaths: [],
    ignoreOtherWorkspaces: true,
    all: false,
    group: true,
    sort: 'diff-asc',
    timediff: true,
    cooldown: 0,
    nodecompat: true,
    long: false,
    explain: false,
    failOnOutdated: false,
    install: false,
    update: false,
    ...overrides,
  }
}

function makePkg(deps: RawDep[]): PackageMeta {
  return {
    name: 'test-project',
    type: 'package.json',
    filepath: '/tmp/test/package.json',
    deps,
    resolved: [],
    raw: {},
    indent: '  ',
  }
}

function createMockCache(): Cache {
  const store = new Map<string, PackageData>()
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, data: PackageData) => {
      store.set(key, data)
    }),
    has: vi.fn((key: string) => store.has(key)),
    clear: vi.fn(() => store.clear()),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 0, misses: 0, size: store.size })),
  }
}

const npmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

describe('resolvePackage - cache behavior', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns cached data without fetching', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(cache.get).mockReturnValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(cache.get).toHaveBeenCalledWith('test-pkg')
    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.length).toBe(1)
    expect(result[0]!.diff).toBe('major')
  })

  it('fetches from registry on cache miss and caches result', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).toHaveBeenCalledWith('test-pkg', expect.any(Object))
    expect(cache.set).toHaveBeenCalledWith('test-pkg', mockPkgData, options.cacheTTL)
    expect(result.length).toBe(1)
  })

  it('returns error diff on registry fetch failure', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockRejectedValue(new Error('Network error'))

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.diff).toBe('error')
    expect(result[0]!.targetVersion).toBe('^1.0.0')
  })

  it('resolves multiple deps with concurrency', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()

    const pkgDataA: PackageData = {
      name: 'pkg-a',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    }
    const pkgDataB: PackageData = {
      name: 'pkg-b',
      versions: ['1.0.0', '1.5.0'],
      distTags: { latest: '1.5.0' },
    }

    vi.mocked(fetchPackageData).mockResolvedValueOnce(pkgDataA).mockResolvedValueOnce(pkgDataB)

    const depA = makeDep({ name: 'pkg-a', currentVersion: '^1.0.0' })
    const depB = makeDep({ name: 'pkg-b', currentVersion: '^1.0.0' })
    const pkg = makePkg([depA, depB])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).toHaveBeenCalledTimes(2)
    expect(result.length).toBe(2)
  })

  it('calls onDependencyResolved callback per dep', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const onResolved = vi.fn()
    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({
      mode: 'latest',
      onDependencyResolved: onResolved,
    })

    await resolvePackage(pkg, options, cache, npmrc)

    expect(onResolved).toHaveBeenCalledOnce()
    expect(onResolved).toHaveBeenCalledWith(pkg, expect.objectContaining({ name: 'test-pkg' }))
  })

  it('skips deps with update=false', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    const dep = makeDep({ update: false })
    const pkg = makePkg([dep])
    const options = makeOptions()

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.length).toBe(0)
  })

  it('does not close externally provided cache', async () => {
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(cache.get).mockReturnValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    await resolvePackage(pkg, options, cache, npmrc)

    expect(cache.close).not.toHaveBeenCalled()
  })
})
