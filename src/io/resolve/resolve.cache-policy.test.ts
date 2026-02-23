import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, NpmrcConfig, PackageData, RawDep } from '../../types'
import { createLogger } from '../../utils/logger'
import { resolveDependency } from './resolve-dependency'

vi.mock('../registry', () => ({
  fetchPackageData: vi.fn(),
}))

function makeCache(hit?: PackageData): Cache {
  return {
    get: vi.fn(() => hit),
    set: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 0, misses: 0, size: hit ? 1 : 0 })),
  }
}

function makeOptions(overrides: Partial<depfreshOptions> = {}): depfreshOptions {
  return {
    cwd: '/tmp/project',
    recursive: true,
    mode: 'default',
    write: false,
    interactive: false,
    force: false,
    includeLocked: false,
    includeWorkspace: true,
    concurrency: 8,
    timeout: 5000,
    retries: 2,
    cacheTTL: 60_000,
    refreshCache: false,
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

const npmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

const dep: RawDep = {
  name: 'test-dep',
  currentVersion: '^1.0.0',
  source: 'dependencies',
  update: true,
  parents: [],
}

const cachedData: PackageData = {
  name: 'test-dep',
  versions: ['1.0.0', '2.0.0'],
  distTags: { latest: '2.0.0' },
}

const fetchedData: PackageData = {
  name: 'test-dep',
  versions: ['1.0.0', '3.0.0'],
  distTags: { latest: '3.0.0' },
}

describe('resolveDependency cache policy', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('uses cache reads by default', async () => {
    const { fetchPackageData } = await import('../registry')
    const cache = makeCache(cachedData)

    const result = await resolveDependency(
      dep,
      makeOptions({ mode: 'latest' }),
      cache,
      npmrc,
      createLogger('silent'),
    )

    expect(cache.get).toHaveBeenCalledWith('test-dep')
    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result?.targetVersion).toBe('^2.0.0')
  })

  it('bypasses cache read and repopulates when refreshCache=true', async () => {
    const { fetchPackageData } = await import('../registry')
    vi.mocked(fetchPackageData).mockResolvedValue(fetchedData)
    const cache = makeCache(cachedData)

    const result = await resolveDependency(
      dep,
      makeOptions({ refreshCache: true, mode: 'latest' }),
      cache,
      npmrc,
      createLogger('silent'),
    )

    expect(cache.get).not.toHaveBeenCalled()
    expect(fetchPackageData).toHaveBeenCalledWith('test-dep', expect.any(Object))
    expect(cache.set).toHaveBeenCalledWith('test-dep', fetchedData, 60_000)
    expect(result?.targetVersion).toBe('^3.0.0')
  })

  it('disables cache read and write when cacheTTL=0', async () => {
    const { fetchPackageData } = await import('../registry')
    vi.mocked(fetchPackageData).mockResolvedValue(fetchedData)
    const cache = makeCache(cachedData)

    await resolveDependency(
      dep,
      makeOptions({ cacheTTL: 0, mode: 'latest' }),
      cache,
      npmrc,
      createLogger('silent'),
    )

    expect(cache.get).not.toHaveBeenCalled()
    expect(fetchPackageData).toHaveBeenCalledWith('test-dep', expect.any(Object))
    expect(cache.set).not.toHaveBeenCalled()
  })
})
