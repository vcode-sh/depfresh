import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, NpmrcConfig, PackageData, PackageMeta, RawDep } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { resolvePackage } from './index'

vi.mock('../registry', () => ({
  fetchPackageData: vi.fn(),
}))

function makeCache(data?: PackageData): Cache {
  return {
    get: vi.fn(() => data),
    set: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 0, misses: 0, size: data ? 1 : 0 })),
  }
}

function makeOptions(overrides: Partial<depfreshOptions> = {}): depfreshOptions {
  return {
    ...(DEFAULT_OPTIONS as depfreshOptions),
    cwd: '/tmp/test',
    mode: 'latest',
    loglevel: 'silent',
    ...overrides,
  }
}

function makePkg(dep: RawDep): PackageMeta {
  return {
    name: 'test-project',
    type: 'package.json',
    filepath: '/tmp/test/package.json',
    deps: [dep],
    resolved: [],
    raw: {},
    indent: '  ',
  }
}

const npmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

const dep: RawDep = {
  name: 'test-pkg',
  currentVersion: '^1.0.0',
  source: 'dependencies',
  update: true,
  parents: [],
}

describe('resolvePackage cache refresh integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('uses cached package data when refreshCache is disabled', async () => {
    const { fetchPackageData } = await import('../registry')
    const cachedData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    }
    const cache = makeCache(cachedData)

    const result = await resolvePackage(makePkg(dep), makeOptions(), cache, npmrc)

    expect(cache.get).toHaveBeenCalledWith('test-pkg')
    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0]?.targetVersion).toBe('^2.0.0')
  })

  it('bypasses cache reads and fetches fresh data when refreshCache=true', async () => {
    const { fetchPackageData } = await import('../registry')
    const cachedData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    }
    const fetchedData: PackageData = {
      name: 'test-pkg',
      versions: ['1.0.0', '3.0.0'],
      distTags: { latest: '3.0.0' },
    }
    vi.mocked(fetchPackageData).mockResolvedValue(fetchedData)
    const cache = makeCache(cachedData)

    const result = await resolvePackage(
      makePkg(dep),
      makeOptions({ refreshCache: true }),
      cache,
      npmrc,
    )

    expect(cache.get).not.toHaveBeenCalled()
    expect(fetchPackageData).toHaveBeenCalledWith('test-pkg', expect.any(Object))
    expect(cache.set).toHaveBeenCalledWith('test-pkg', fetchedData, expect.any(Number))
    expect(result).toHaveLength(1)
    expect(result[0]?.targetVersion).toBe('^3.0.0')
  })
})
