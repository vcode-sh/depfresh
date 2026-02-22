import { describe, expect, it, vi } from 'vitest'
import type { PackageData } from '../types'

const mockData: PackageData = {
  name: 'test-pkg',
  versions: ['1.0.0', '1.1.0', '2.0.0'],
  distTags: { latest: '2.0.0' },
}

describe('sqlite cache', () => {
  it('stores and retrieves data', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    cache.set('test-pkg', mockData, 60_000)
    const result = cache.get('test-pkg')

    expect(result).toEqual(mockData)
    cache.close()
  })

  it('returns undefined for missing key', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    const result = cache.get('nonexistent')
    expect(result).toBeUndefined()
    cache.close()
  })

  it('reports correct stats', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    cache.set('test', mockData, 60_000)
    cache.get('test') // hit
    cache.get('miss') // miss

    const stats = cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    cache.close()
  })

  it('clears all entries', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    cache.set('a', mockData, 60_000)
    cache.set('b', mockData, 60_000)
    cache.clear()

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(false)
    cache.close()
  })
})

describe('cache round-trip with PackageData', () => {
  it('preserves all PackageData fields through set/get', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    const fullData: PackageData = {
      name: '@scope/complex-pkg',
      versions: ['0.1.0', '1.0.0-beta.1', '1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0', next: '1.0.0-beta.1' },
      time: { '1.0.0': '2024-01-01T00:00:00Z', '2.0.0': '2024-06-01T00:00:00Z' },
      deprecated: { '0.1.0': 'Use 1.x or later' },
      description: 'A test package',
      homepage: 'https://example.com',
      repository: 'https://github.com/test/pkg',
    }

    cache.set('@scope/complex-pkg', fullData, 60_000)
    const result = cache.get('@scope/complex-pkg')

    expect(result).toEqual(fullData)
    cache.close()
  })
})

describe('cache TTL expiration', () => {
  it('returns undefined after TTL expires', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    // Set with 1ms TTL
    cache.set('expiring-pkg', mockData, 1)

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10))

    const result = cache.get('expiring-pkg')
    expect(result).toBeUndefined()
    cache.close()
  })
})

describe('cache stats accuracy', () => {
  it('tracks hits and misses accurately', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    cache.set('pkg-a', mockData, 60_000)
    cache.set('pkg-b', mockData, 60_000)

    cache.get('pkg-a') // hit
    cache.get('pkg-b') // hit
    cache.get('pkg-c') // miss
    cache.get('pkg-d') // miss
    cache.get('pkg-e') // miss

    const stats = cache.stats()
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(3)
    expect(stats.size).toBeGreaterThanOrEqual(2)
    cache.close()
  })
})

describe('corrupt JSON data handling', () => {
  it('returns undefined for corrupt cache entries', async () => {
    const Database = (await import('better-sqlite3')).default
    const { mkdirSync } = await import('node:fs')
    const { homedir } = await import('node:os')
    const { join } = await import('pathe')

    const cacheDir = join(homedir(), '.bump')
    mkdirSync(cacheDir, { recursive: true })

    // Directly insert corrupt data into the DB
    const db = new Database(join(cacheDir, 'cache.db'))
    db.exec(`
      CREATE TABLE IF NOT EXISTS registry_cache (
        package TEXT NOT NULL,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (package)
      )
    `)
    db.prepare(
      'INSERT OR REPLACE INTO registry_cache (package, data, fetched_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run('corrupt-pkg', '{invalid json!!!', Date.now(), Date.now() + 60_000)
    db.close()

    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    const result = cache.get('corrupt-pkg')
    expect(result).toBeUndefined()

    const stats = cache.stats()
    expect(stats.misses).toBeGreaterThanOrEqual(1)
    cache.close()
  })
})

describe('scoped package names', () => {
  it('handles @scope/pkg names correctly', async () => {
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    const scopedData: PackageData = {
      name: '@vue/reactivity',
      versions: ['3.0.0', '3.1.0'],
      distTags: { latest: '3.1.0' },
    }

    cache.set('@vue/reactivity', scopedData, 60_000)
    const result = cache.get('@vue/reactivity')

    expect(result).toEqual(scopedData)
    expect(cache.has('@vue/reactivity')).toBe(true)
    cache.close()
  })
})

describe('memory fallback', () => {
  it('works when Database constructor throws', async () => {
    // Force memory fallback by mocking Database to throw
    vi.doMock('better-sqlite3', () => ({
      default: class {
        constructor() {
          throw new Error('SQLite not available')
        }
      },
    }))

    // Must re-import to pick up the mock
    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    // Basic operations should work with memory fallback
    cache.set('fallback-pkg', mockData, 60_000)
    const result = cache.get('fallback-pkg')

    expect(result).toEqual(mockData)
    expect(cache.has('fallback-pkg')).toBe(true)

    const stats = cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.size).toBeGreaterThanOrEqual(1)

    cache.close()
    vi.doUnmock('better-sqlite3')
  })

  it('memory fallback expires entries', async () => {
    vi.doMock('better-sqlite3', () => ({
      default: class {
        constructor() {
          throw new Error('SQLite not available')
        }
      },
    }))

    const { createSqliteCache } = await import('./sqlite')
    const cache = createSqliteCache()

    cache.set('expiring', mockData, 1)
    await new Promise((r) => setTimeout(r, 10))

    const result = cache.get('expiring')
    expect(result).toBeUndefined()

    cache.close()
    vi.doUnmock('better-sqlite3')
  })
})
