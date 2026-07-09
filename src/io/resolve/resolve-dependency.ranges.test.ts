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
    failOnResolutionErrors: false,
    failOnNoPackages: false,
    install: false,
    update: false,
    ...overrides,
  }
}

function makeDep(overrides: Partial<RawDep> = {}): RawDep {
  return {
    name: 'test-dep',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    ...overrides,
  }
}

const npmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

const logger = createLogger('silent')

describe('resolveDependency range shape preservation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('skips complex comparator ranges instead of pinning them', async () => {
    const cache = makeCache({
      name: 'test-dep',
      versions: ['1.0.0', '2.4.1'],
      distTags: { latest: '2.4.1' },
    })

    const result = await resolveDependency(
      makeDep({ currentVersion: '>=1.0.0 <2.0.0' }),
      makeOptions({ mode: 'latest' }),
      cache,
      npmrc,
      logger,
    )

    expect(result).toBe(null)
  })

  it('updates x-ranges while preserving their shape', async () => {
    const cache = makeCache({
      name: 'test-dep',
      versions: ['1.0.0', '2.4.1'],
      distTags: { latest: '2.4.1' },
    })

    const result = await resolveDependency(
      makeDep({ currentVersion: '1.x' }),
      makeOptions({ mode: 'latest' }),
      cache,
      npmrc,
      logger,
    )

    expect(result?.targetVersion).toBe('2.x')
    expect(result?.diff).toBe('major')
  })

  it('skips x-ranges when the target still satisfies the current range', async () => {
    const cache = makeCache({
      name: 'test-dep',
      versions: ['1.0.0', '1.9.0'],
      distTags: { latest: '1.9.0' },
    })

    const result = await resolveDependency(
      makeDep({ currentVersion: '1.x' }),
      makeOptions({ mode: 'latest' }),
      cache,
      npmrc,
      logger,
    )

    expect(result).toBe(null)
  })

  it('skips bare wildcards without producing an error diff', async () => {
    const cache = makeCache({
      name: 'test-dep',
      versions: ['1.0.0', '2.4.1'],
      distTags: { latest: '2.4.1' },
    })

    const result = await resolveDependency(
      makeDep({ currentVersion: '*' }),
      makeOptions({ mode: 'latest' }),
      cache,
      npmrc,
      logger,
    )

    expect(result).toBe(null)
  })

  it('keeps invalid complex-shaped specs on the error diff path', async () => {
    const cache = makeCache({
      name: 'test-dep',
      versions: ['1.0.0', '2.4.1'],
      distTags: { latest: '2.4.1' },
    })

    const result = await resolveDependency(
      makeDep({ currentVersion: 'beta' }),
      makeOptions({ mode: 'latest' }),
      cache,
      npmrc,
      logger,
    )

    expect(result?.diff).toBe('error')
    expect(result?.targetVersion).toBe('2.4.1')
  })

  it('still preserves simple prefixes and bare exact versions', async () => {
    const prefixedCache = makeCache({
      name: 'test-dep',
      versions: ['1.2.3', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })
    const exactCache = makeCache({
      name: 'test-dep',
      versions: ['1.2.3', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })

    const prefixed = await resolveDependency(
      makeDep({ currentVersion: '^1.2.3' }),
      makeOptions({ mode: 'latest' }),
      prefixedCache,
      npmrc,
      logger,
    )
    const exact = await resolveDependency(
      makeDep({ currentVersion: '1.2.3' }),
      makeOptions({ mode: 'latest' }),
      exactCache,
      npmrc,
      logger,
    )

    expect(prefixed?.targetVersion).toBe('^2.0.0')
    expect(exact?.targetVersion).toBe('2.0.0')
  })
})
