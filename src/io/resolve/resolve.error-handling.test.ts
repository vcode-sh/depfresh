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
  getRegistryForPackage: vi.fn((_name, config) => ({ url: config.defaultRegistry })),
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
    failOnResolutionErrors: false,
    failOnNoPackages: false,
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

const defaultNpmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

describe('currentVersionTime', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('populates currentVersionTime when time data exists for current version', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: {
        '1.0.0': '2024-01-15T10:00:00.000Z',
        '2.0.0': '2024-06-20T12:00:00.000Z',
      },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.currentVersionTime).toBe('2024-01-15T10:00:00.000Z')
    expect(result[0]!.publishedAt).toBe('2024-06-20T12:00:00.000Z')
  })

  it('returns undefined currentVersionTime for wildcard version *', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: {
        '1.0.0': '2024-01-15T10:00:00.000Z',
        '2.0.0': '2024-06-20T12:00:00.000Z',
      },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '*' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.currentVersionTime).toBeUndefined()
  })

  it('coerces range version for currentVersionTime lookup', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.2.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: {
        '1.2.0': '2024-03-01T08:00:00.000Z',
        '2.0.0': '2024-06-20T12:00:00.000Z',
      },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '~1.2.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.currentVersionTime).toBe('2024-03-01T08:00:00.000Z')
  })

  it('populates currentVersionTime for exact version without prefix', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    const pkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: {
        '1.0.0': '2024-02-10T09:00:00.000Z',
        '2.0.0': '2024-06-20T12:00:00.000Z',
      },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(pkgData)

    const dep = makeDep({ currentVersion: '1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.currentVersionTime).toBe('2024-02-10T09:00:00.000Z')
  })

  it('leaves currentVersionTime undefined when time data is missing', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.currentVersionTime).toBeUndefined()
  })
})

describe('unexpected resolution failures', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('converts cache read explosions into explicit error diffs', async () => {
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(cache.get).mockImplementation(() => {
      throw new Error('cache read failed')
    })

    const dep = makeDep({ name: 'broken-pkg', currentVersion: '^1.2.3' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'broken-pkg',
      currentVersion: '^1.2.3',
      targetVersion: '^1.2.3',
      diff: 'error',
    })
  })

  it('preserves sibling successes when one dependency throws unexpectedly', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(cache.get).mockImplementation((key: string) => {
      if (key === 'npm|https://registry.npmjs.org/|broken-pkg') {
        throw new Error('cache read failed')
      }
      return undefined
    })
    vi.mocked(fetchPackageData).mockImplementation(async (name: string) => {
      if (name === 'good-pkg') {
        return {
          name,
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
        }
      }
      throw new Error(`unexpected fetch for ${name}`)
    })

    const pkg = makePkg([
      makeDep({ name: 'broken-pkg', currentVersion: '^1.2.3' }),
      makeDep({ name: 'good-pkg', currentVersion: '^1.0.0', source: 'devDependencies' }),
    ])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      name: 'broken-pkg',
      diff: 'error',
      targetVersion: '^1.2.3',
    })
    expect(result[1]).toMatchObject({
      name: 'good-pkg',
      diff: 'major',
      targetVersion: '^2.0.0',
    })
  })

  it('keeps resolved deps when onDependencyResolved throws', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue({
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })

    const dep = makeDep({ name: 'test-pkg', currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({
      mode: 'latest',
      onDependencyResolved: () => {
        throw new Error('callback failed')
      },
    })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'test-pkg',
      diff: 'major',
      targetVersion: '^2.0.0',
    })
  })

  it('keeps resolved deps when onDependencyProcessed throws', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue({
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })

    const dep = makeDep({ name: 'test-pkg', currentVersion: '^1.0.0' })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc, undefined, () => {
      throw new Error('progress callback failed')
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'test-pkg',
      diff: 'major',
      targetVersion: '^2.0.0',
    })
  })
})
