import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, NpmrcConfig, PackageData, PackageMeta, RawDep } from '../../types'
import { filterVersionsByMaturityPeriod } from './index'

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

    const result = filterVersionsByMaturityPeriod(versions, time, 7)
    expect(result).toEqual(versions)
  })
})

describe('cooldown integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('filters recent versions when cooldown is set', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

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

    expect(result.length).toBe(1)
    expect(result[0]!.targetVersion).toBe('^1.1.0')
  })
})
