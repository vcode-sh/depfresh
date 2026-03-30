import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, NpmrcConfig, PackageData, RawDep } from '../../types'

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

function makePkg(deps: RawDep[]) {
  return {
    name: 'test-project',
    type: 'package.json' as const,
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

describe('dist-tag version handling', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('skips deps where currentVersion is the "latest" dist-tag', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue({
      name: '@fumadocs/base-ui',
      versions: ['16.7.5', '16.7.6', '16.7.7'],
      distTags: { latest: '16.7.7' },
    })

    const dep = makeDep({
      name: 'fumadocs-ui',
      aliasName: '@fumadocs/base-ui',
      protocol: 'npm',
      currentVersion: 'latest',
    })
    const pkg = makePkg([dep])
    const options = makeOptions()

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(0)
  })

  it('skips deps where currentVersion is the "next" dist-tag', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue({
      name: 'react',
      versions: ['18.3.1', '19.0.0', '19.1.0-canary.1'],
      distTags: { latest: '19.0.0', next: '19.1.0-canary.1' },
    })

    const dep = makeDep({
      name: 'react',
      currentVersion: 'next',
    })
    const pkg = makePkg([dep])
    const options = makeOptions()

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(0)
  })

  it('skips npm alias deps with dist-tag version', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue({
      name: '@fumadocs/base-ui',
      versions: ['16.7.5', '16.7.6', '16.7.7'],
      distTags: { latest: '16.7.7', canary: '16.8.0-canary.1' },
    })

    const dep = makeDep({
      name: 'fumadocs-ui',
      aliasName: '@fumadocs/base-ui',
      protocol: 'npm',
      currentVersion: 'canary',
    })
    const pkg = makePkg([dep])
    const options = makeOptions()

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(0)
  })

  it('does NOT skip deps with semver versions that happen to match a dist-tag value', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue({
      name: 'test-pkg',
      versions: ['1.0.0', '1.1.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })

    const dep = makeDep({
      name: 'test-pkg',
      currentVersion: '^1.0.0',
    })
    const pkg = makePkg([dep])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'test-pkg',
      targetVersion: '^2.0.0',
      diff: 'major',
    })
  })

  it('still resolves normal deps alongside dist-tag deps', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockImplementation(async (name: string) => {
      if (name === '@fumadocs/base-ui') {
        return {
          name: '@fumadocs/base-ui',
          versions: ['16.7.7'],
          distTags: { latest: '16.7.7' },
        }
      }
      return {
        name: 'other-pkg',
        versions: ['1.0.0', '2.0.0'],
        distTags: { latest: '2.0.0' },
      }
    })

    const pkg = makePkg([
      makeDep({
        name: 'fumadocs-ui',
        aliasName: '@fumadocs/base-ui',
        protocol: 'npm',
        currentVersion: 'latest',
      }),
      makeDep({
        name: 'other-pkg',
        currentVersion: '^1.0.0',
        source: 'devDependencies',
      }),
    ])
    const options = makeOptions({ mode: 'latest' })

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'other-pkg',
      targetVersion: '^2.0.0',
      diff: 'major',
    })
  })

  it('does not skip when currentVersion looks like a tag but is not in distTags', async () => {
    const { fetchPackageData } = await import('../registry')
    const { resolvePackage } = await import('./index')

    const cache = createMockCache()
    vi.mocked(fetchPackageData).mockResolvedValue({
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })

    // "beta" is not in distTags, so it should not be skipped
    // (it will fail resolution as an invalid semver, resulting in error diff)
    const dep = makeDep({
      name: 'test-pkg',
      currentVersion: 'beta',
    })
    const pkg = makePkg([dep])
    const options = makeOptions()

    const result = await resolvePackage(pkg, options, cache, defaultNpmrc)

    // "beta" as currentVersion: resolveTargetVersion returns distTags.latest fallback
    // getDiff("beta", "2.0.0") returns "error" since semver.coerce("beta") is null
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      diff: 'error',
    })
  })
})
