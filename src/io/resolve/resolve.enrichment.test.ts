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

const defaultNpmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

describe('provenance tracking', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('populates provenance fields from package data', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

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

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.provenance).toBe('none')
    expect(result[0]!.currentProvenance).toBe('attested')
  })

  it('leaves provenance undefined when package data has no provenance', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

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
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

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

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.nodeCompat).toBe('>=18')
    expect(result[0]!.nodeCompatible).toBe(true)
  })

  it('marks incompatible node versions', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

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

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.nodeCompat).toBe('<16')
    expect(result[0]!.nodeCompatible).toBe(false)
  })

  it('leaves nodeCompat undefined when no engines data', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue(mockPkgData)

    const dep = makeDep()
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result.length).toBe(1)
    expect(result[0]!.nodeCompat).toBeUndefined()
    expect(result[0]!.nodeCompatible).toBeUndefined()
  })
})
