import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, NpmrcConfig, PackageData, PackageMeta, RawDep } from '../../types'
import { getPackageMode } from './index'

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

describe('ignore mode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('skips dependency when mode is ignore', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

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
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

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

  it('uses packageMode override over global mode', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const mockPkgData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '1.1.0', '1.2.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    }

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

    expect(result.length).toBe(1)
    expect(result[0]!.diff).toBe('major')
  })
})
