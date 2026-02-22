import { describe, expect, it } from 'vitest'
import type { PackageData } from '../src/types'

// Test the memory fallback cache (doesn't require better-sqlite3)
describe('memory cache', () => {
  const mockData: PackageData = {
    name: 'test-pkg',
    versions: ['1.0.0', '1.1.0', '2.0.0'],
    distTags: { latest: '2.0.0' },
  }

  it('stores and retrieves data', async () => {
    const { createSqliteCache } = await import('../src/cache/sqlite')
    const cache = createSqliteCache()

    cache.set('test-pkg', mockData, 60_000)
    const result = cache.get('test-pkg')

    expect(result).toEqual(mockData)
    cache.close()
  })

  it('returns undefined for missing key', async () => {
    const { createSqliteCache } = await import('../src/cache/sqlite')
    const cache = createSqliteCache()

    const result = cache.get('nonexistent')
    expect(result).toBeUndefined()
    cache.close()
  })

  it('reports correct stats', async () => {
    const { createSqliteCache } = await import('../src/cache/sqlite')
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
    const { createSqliteCache } = await import('../src/cache/sqlite')
    const cache = createSqliteCache()

    cache.set('a', mockData, 60_000)
    cache.set('b', mockData, 60_000)
    cache.clear()

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(false)
    cache.close()
  })
})
