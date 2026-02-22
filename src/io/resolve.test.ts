import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../cache/index'
import type { BumpOptions, NpmrcConfig, PackageData, PackageMeta, RawDep } from '../types'
import { filterVersions, filterVersionsByMaturityPeriod, getPackageMode } from './resolve'

vi.mock('./registry', () => ({
  fetchPackageData: vi.fn(),
}))

vi.mock('../cache/index', () => ({
  createSqliteCache: vi.fn(),
}))

vi.mock('../utils/npmrc', () => ({
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

function makeOptions(overrides: Partial<BumpOptions> = {}): BumpOptions {
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
    ignorePaths: [],
    all: false,
    group: true,
    sort: 'diff-asc',
    timediff: true,
    cooldown: 0,
    nodecompat: true,
    long: false,
    install: false,
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

describe('resolvePackage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns cached data without fetching', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(cache.get).mockReturnValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(cache.get).toHaveBeenCalledWith('test-pkg')
    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.length).toBe(1)
    expect(result[0]!.diff).toBe('major')
  })

  it('fetches from registry on cache miss and caches result', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).toHaveBeenCalledWith('test-pkg', expect.any(Object))
    expect(cache.set).toHaveBeenCalledWith('test-pkg', mockPkgData, options.cacheTTL)
    expect(result.length).toBe(1)
  })

  it('returns error diff on registry fetch failure', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockRejectedValue(new Error('Network error'))

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.diff).toBe('error')
    expect(result[0]!.targetVersion).toBe('^1.0.0')
  })

  it('resolves multiple deps with concurrency', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

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
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).toHaveBeenCalledTimes(2)
    expect(result.length).toBe(2)
  })

  it('calls onDependencyResolved callback per dep', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const onResolved = vi.fn()
    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({
      mode: 'latest',
      onDependencyResolved: onResolved,
    })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    await resolvePackage(pkg, options, cache, npmrc)

    expect(onResolved).toHaveBeenCalledOnce()
    expect(onResolved).toHaveBeenCalledWith(pkg, expect.objectContaining({ name: 'test-pkg' }))
  })

  it('skips deps with update=false', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    const dep = makeDep({ update: false })
    const pkg = makePkg([dep])
    const options = makeOptions()
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.length).toBe(0)
  })

  it('uses packageMode override over global mode', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({
      mode: 'patch',
      packageMode: { 'test-pkg': 'latest' },
    })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    // With packageMode 'latest', should resolve to 2.0.0 (major bump)
    expect(result.length).toBe(1)
    expect(result[0]!.diff).toBe('major')
  })

  it('does not close externally provided cache', async () => {
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(cache.get).mockReturnValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    await resolvePackage(pkg, options, cache, npmrc)

    expect(cache.close).not.toHaveBeenCalled()
  })
})

describe('filterVersions', () => {
  // filterVersions is not exported, so we test it indirectly through resolvePackage

  it('removes deprecated versions when current is not deprecated', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '1.1.0', '2.0.0'],
      distTags: { latest: '1.1.0' },
      deprecated: { '2.0.0': 'Use 3.x instead' },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    // Use 'major' mode which picks from the filtered versions array
    const options = makeOptions({ mode: 'major' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    // 2.0.0 is deprecated and filtered out, best remaining is 1.1.0
    expect(result.length).toBe(1)
    expect(result[0]!.targetVersion).toBe('^1.1.0')
  })

  it('keeps same-channel prerelease versions when current is prerelease', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0-rc.1', '1.0.0-rc.2', '2.0.0-rc.1', '2.0.0-beta.1'],
      distTags: { latest: '1.0.0-rc.2' },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    // Current is rc prerelease — only rc prereleases should be kept
    const dep = makeDep({ currentVersion: '1.0.0-rc.1' })
    const pkg = makePkg([dep])
    // Use 'newest' mode to pick the max from filtered versions
    const options = makeOptions({ mode: 'newest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    // 2.0.0-beta.1 is filtered out (different channel: beta != rc)
    // Remaining: 1.0.0-rc.1, 1.0.0-rc.2, 2.0.0-rc.1
    // Newest picks: 2.0.0-rc.1
    expect(result.length).toBe(1)
    expect(result[0]!.targetVersion).toBe('2.0.0-rc.1')
    expect(result[0]!.diff).toBe('major')
  })
})

describe('filterVersionsByMaturityPeriod', () => {
  it('returns all versions when days is 0', () => {
    const versions = ['1.0.0', '2.0.0']
    const time = { '1.0.0': '2020-01-01T00:00:00Z', '2.0.0': '2020-01-02T00:00:00Z' }
    expect(filterVersionsByMaturityPeriod(versions, time, 0)).toEqual(versions)
  })

  it('filters versions published less than N days ago', () => {
    const now = Date.now()
    const threeDaysAgo = new Date(now - 3 * 86_400_000).toISOString()
    const tenDaysAgo = new Date(now - 10 * 86_400_000).toISOString()

    const versions = ['1.0.0', '2.0.0']
    const time = { '1.0.0': tenDaysAgo, '2.0.0': threeDaysAgo }

    const result = filterVersionsByMaturityPeriod(versions, time, 7)
    expect(result).toEqual(['1.0.0'])
  })

  it('keeps versions with no time data', () => {
    const now = Date.now()
    const threeDaysAgo = new Date(now - 3 * 86_400_000).toISOString()

    const versions = ['1.0.0', '2.0.0']
    const time = { '2.0.0': threeDaysAgo }

    // 1.0.0 has no time data, should be kept. 2.0.0 is too new.
    const result = filterVersionsByMaturityPeriod(versions, time, 7)
    expect(result).toEqual(['1.0.0'])
  })

  it('returns original list when no time data exists', () => {
    const versions = ['1.0.0', '2.0.0']
    expect(filterVersionsByMaturityPeriod(versions, undefined, 7)).toEqual(versions)
  })

  it('falls back to original list when all versions are filtered', () => {
    const now = Date.now()
    const oneDayAgo = new Date(now - 1 * 86_400_000).toISOString()

    const versions = ['1.0.0', '2.0.0']
    const time = { '1.0.0': oneDayAgo, '2.0.0': oneDayAgo }

    // Both too new with 7-day cooldown — should fall back to original list
    const result = filterVersionsByMaturityPeriod(versions, time, 7)
    expect(result).toEqual(versions)
  })
})

describe('filterVersions (exported)', () => {
  it('filters prerelease versions when current is not prerelease', () => {
    const pkgData: PackageData = {
      name: 'test',
      versions: ['1.0.0', '1.1.0', '2.0.0-beta.1'],
      distTags: { latest: '1.1.0' },
    }
    const dep = makeDep({ currentVersion: '^1.0.0' })

    const result = filterVersions(pkgData, dep)
    expect(result).toEqual(['1.0.0', '1.1.0'])
  })

  it('allows same-channel prereleases when current is prerelease', () => {
    const pkgData: PackageData = {
      name: 'test',
      versions: ['1.0.0-rc.1', '1.0.0-rc.2', '1.0.0-beta.1', '1.0.0'],
      distTags: { latest: '1.0.0' },
    }
    const dep = makeDep({ currentVersion: '1.0.0-rc.1' })

    const result = filterVersions(pkgData, dep)
    // rc.1, rc.2 (same channel) + 1.0.0 (stable) — but NOT beta.1
    expect(result).toEqual(['1.0.0-rc.1', '1.0.0-rc.2', '1.0.0'])
  })

  it('blocks cross-channel prereleases', () => {
    const pkgData: PackageData = {
      name: 'test',
      versions: ['2.0.0-alpha.1', '2.0.0-beta.1', '2.0.0-rc.1'],
      distTags: { latest: '2.0.0-rc.1' },
    }
    const dep = makeDep({ currentVersion: '2.0.0-beta.1' })

    const result = filterVersions(pkgData, dep)
    // Only beta allowed (same channel)
    expect(result).toEqual(['2.0.0-beta.1'])
  })

  it('applies cooldown filter when options provided', () => {
    const now = Date.now()
    const twoDaysAgo = new Date(now - 2 * 86_400_000).toISOString()
    const tenDaysAgo = new Date(now - 10 * 86_400_000).toISOString()

    const pkgData: PackageData = {
      name: 'test',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: { '1.0.0': tenDaysAgo, '2.0.0': twoDaysAgo },
    }
    const dep = makeDep({ currentVersion: '^1.0.0' })
    const options = makeOptions({ cooldown: 7 })

    const result = filterVersions(pkgData, dep, options)
    expect(result).toEqual(['1.0.0'])
  })

  it('skips cooldown when cooldown is 0', () => {
    const now = Date.now()
    const oneDayAgo = new Date(now - 1 * 86_400_000).toISOString()

    const pkgData: PackageData = {
      name: 'test',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: { '1.0.0': '2020-01-01T00:00:00Z', '2.0.0': oneDayAgo },
    }
    const dep = makeDep({ currentVersion: '^1.0.0' })
    const options = makeOptions({ cooldown: 0 })

    const result = filterVersions(pkgData, dep, options)
    expect(result).toEqual(['1.0.0', '2.0.0'])
  })
})

describe('getPackageMode', () => {
  it('returns default mode when no packageMode defined', () => {
    expect(getPackageMode('react', undefined, 'minor')).toBe('minor')
  })

  it('returns exact match from packageMode', () => {
    const packageMode = { react: 'latest' as const, lodash: 'patch' as const }
    expect(getPackageMode('react', packageMode, 'minor')).toBe('latest')
  })

  it('matches glob patterns in packageMode', () => {
    const packageMode = { '@types/*': 'ignore' as const }
    expect(getPackageMode('@types/node', packageMode, 'minor')).toBe('ignore')
    expect(getPackageMode('@types/react', packageMode, 'minor')).toBe('ignore')
  })

  it('does not match non-matching glob patterns', () => {
    const packageMode = { '@types/*': 'ignore' as const }
    expect(getPackageMode('react', packageMode, 'minor')).toBe('minor')
    expect(getPackageMode('@scope/pkg', packageMode, 'minor')).toBe('minor')
  })

  it('prefers exact match over glob', () => {
    const packageMode = {
      '@types/*': 'ignore' as const,
      '@types/node': 'latest' as const,
    }
    expect(getPackageMode('@types/node', packageMode, 'minor')).toBe('latest')
  })

  it('matches eslint-* style globs', () => {
    const packageMode = { 'eslint-*': 'patch' as const }
    expect(getPackageMode('eslint-plugin-foo', packageMode, 'minor')).toBe('patch')
    expect(getPackageMode('eslint-config-bar', packageMode, 'minor')).toBe('patch')
    expect(getPackageMode('prettier', packageMode, 'minor')).toBe('minor')
  })

  it('falls back to default for unmatched packages', () => {
    const packageMode = { react: 'latest' as const }
    expect(getPackageMode('vue', packageMode, 'default')).toBe('default')
  })
})

describe('private package filtering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('skips workspace package names', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()

    const dep = makeDep({ name: '@my-org/shared-utils' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const privatePackages = new Set(['@my-org/shared-utils', '@my-org/another-pkg'])
    const result = await resolvePackage(pkg, options, cache, npmrc, privatePackages)

    // Should not hit the registry at all
    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.length).toBe(0)
  })

  it('does not skip non-workspace packages', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep({ name: 'test-pkg' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const privatePackages = new Set(['@my-org/internal-pkg'])
    const result = await resolvePackage(pkg, options, cache, npmrc, privatePackages)

    expect(fetchPackageData).toHaveBeenCalledWith('test-pkg', expect.any(Object))
    expect(result.length).toBe(1)
  })
})

describe('ignore mode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('skips dependency when mode is ignore', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()

    const dep = makeDep({ name: 'test-pkg' })
    const pkg = makePkg([dep])
    const options = makeOptions({
      mode: 'minor',
      packageMode: { 'test-pkg': 'ignore' },
    })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.length).toBe(0)
  })

  it('skips dependency when glob pattern matches ignore mode', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()

    const dep = makeDep({ name: '@types/node' })
    const pkg = makePkg([dep])
    const options = makeOptions({
      mode: 'latest',
      packageMode: { '@types/*': 'ignore' },
    })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.length).toBe(0)
  })
})

describe('cooldown integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('filters recent versions when cooldown is set', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const now = Date.now()
    const twoDaysAgo = new Date(now - 2 * 86_400_000).toISOString()
    const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString()

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '1.1.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: {
        '1.0.0': thirtyDaysAgo,
        '1.1.0': thirtyDaysAgo,
        '2.0.0': twoDaysAgo,
      },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'major', cooldown: 7 })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    // 2.0.0 should be filtered (only 2 days old, cooldown is 7)
    // Best remaining is 1.1.0
    expect(result.length).toBe(1)
    expect(result[0]!.targetVersion).toBe('^1.1.0')
  })
})

describe('provenance tracking', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('populates provenance fields from package data', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      provenance: { '1.0.0': 'attested', '2.0.0': 'none' },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.provenance).toBe('none')
    expect(result[0]!.currentProvenance).toBe('attested')
  })

  it('leaves provenance undefined when package data has no provenance', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.provenance).toBeUndefined()
    expect(result[0]!.currentProvenance).toBeUndefined()
  })
})

describe('node engine compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('populates nodeCompat and nodeCompatible from engines data', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      engines: { '1.0.0': '>=14', '2.0.0': '>=18' },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.nodeCompat).toBe('>=18')
    // Node >= 24 so >=18 should be compatible
    expect(result[0]!.nodeCompatible).toBe(true)
  })

  it('marks incompatible node versions', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      engines: { '2.0.0': '<16' },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.nodeCompat).toBe('<16')
    expect(result[0]!.nodeCompatible).toBe(false)
  })

  it('leaves nodeCompat undefined when no engines data', async () => {
    const { fetchPackageData } = await import('./registry')
    const { resolvePackage } = await import('./resolve')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.nodeCompat).toBeUndefined()
    expect(result[0]!.nodeCompatible).toBeUndefined()
  })
})
