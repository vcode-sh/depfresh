import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { NpmrcConfig, PackageData, PackageMeta, RawDep, UpgrOptions } from '../../types'
import { filterVersions } from './index'

vi.mock('../registry', () => ({
  fetchPackageData: vi.fn(),
}))

vi.mock('../../cache/index', () => ({
  createSqliteCache: vi.fn(),
}))

vi.mock('../../utils/npmrc', () => ({
  loadNpmrc: vi.fn(),
}))

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

function makeOptions(overrides: Partial<UpgrOptions> = {}): UpgrOptions {
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

describe('filterVersions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('removes deprecated versions when current is not deprecated', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

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
    const options = makeOptions({ mode: 'major' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.targetVersion).toBe('^1.1.0')
  })

  it('keeps same-channel prerelease versions when current is prerelease', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0-rc.1', '1.0.0-rc.2', '2.0.0-rc.1', '2.0.0-beta.1'],
      distTags: { latest: '1.0.0-rc.2' },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '1.0.0-rc.1' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'newest' })
    const npmrc: NpmrcConfig = {
      registries: new Map(),
      defaultRegistry: 'https://registry.npmjs.org/',
      strictSsl: true,
    }

    const result = await resolvePackage(pkg, options, cache, npmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.targetVersion).toBe('2.0.0-rc.1')
    expect(result[0]!.diff).toBe('major')
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
