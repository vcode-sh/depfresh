import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'
import { join } from 'pathe'
import { CacheError } from '../errors'
import type { PackageData } from '../types'
import type { Cache } from './index'

// TODO: Auto-detect Bun runtime and use bun:sqlite for 3-6x faster cache operations

const CACHE_DIR = join(homedir(), '.depfresh')
const CACHE_DB = join(CACHE_DIR, 'cache.db')

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS registry_cache (
    package TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (package)
  )
`

const INDEX = `CREATE INDEX IF NOT EXISTS idx_expires ON registry_cache(expires_at)`

export function createSqliteCache(): Cache {
  mkdirSync(CACHE_DIR, { recursive: true })

  let db: InstanceType<typeof Database>
  try {
    db = new Database(CACHE_DB)
  } catch {
    return createMemoryFallback()
  }

  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(SCHEMA)
    db.exec(INDEX)
  } catch {
    db.close()
    return createMemoryFallback()
  }

  const getStmt = db.prepare('SELECT data FROM registry_cache WHERE package = ? AND expires_at > ?')
  const setStmt = db.prepare(
    'INSERT OR REPLACE INTO registry_cache (package, data, fetched_at, expires_at) VALUES (?, ?, ?, ?)',
  )
  const hasStmt = db.prepare('SELECT 1 FROM registry_cache WHERE package = ? AND expires_at > ?')
  const clearStmt = db.prepare('DELETE FROM registry_cache')
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM registry_cache WHERE expires_at > ?')
  const pruneStmt = db.prepare('DELETE FROM registry_cache WHERE expires_at <= ?')
  const deleteStmt = db.prepare('DELETE FROM registry_cache WHERE package = ?')

  let hits = 0
  let misses = 0

  // Prune expired entries on startup
  pruneStmt.run(Date.now())

  return {
    get(key: string): PackageData | undefined {
      let row: { data: string } | undefined
      try {
        row = getStmt.get(key, Date.now()) as { data: string } | undefined
      } catch (error) {
        throw new CacheError(`Failed to read cache entry for ${key}`, { cause: error })
      }
      if (row) {
        try {
          const parsed = JSON.parse(row.data)
          hits++
          return parsed
        } catch {
          deleteStmt.run(key)
          misses++
          return undefined
        }
      }
      misses++
      return undefined
    },

    set(key: string, data: PackageData, ttl: number): void {
      const now = Date.now()
      try {
        setStmt.run(key, JSON.stringify(data), now, now + ttl)
      } catch (error) {
        throw new CacheError(`Failed to write cache entry for ${key}`, { cause: error })
      }
    },

    has(key: string): boolean {
      try {
        return !!hasStmt.get(key, Date.now())
      } catch (error) {
        throw new CacheError(`Failed to check cache entry for ${key}`, { cause: error })
      }
    },

    clear(): void {
      try {
        clearStmt.run()
      } catch (error) {
        throw new CacheError('Failed to clear cache', { cause: error })
      }
    },

    close(): void {
      try {
        db.close()
      } catch (error) {
        throw new CacheError('Failed to close cache database', { cause: error })
      }
    },

    stats() {
      let row: { count: number }
      try {
        row = countStmt.get(Date.now()) as { count: number }
      } catch (error) {
        throw new CacheError('Failed to read cache stats', { cause: error })
      }
      return { hits, misses, size: row.count }
    },
  }
}

function createMemoryFallback(): Cache {
  const store = new Map<string, { data: PackageData; expiresAt: number }>()
  let hits = 0
  let misses = 0

  return {
    get(key) {
      const entry = store.get(key)
      if (entry && entry.expiresAt > Date.now()) {
        hits++
        return entry.data
      }
      if (entry) store.delete(key)
      misses++
      return undefined
    },
    set(key, data, ttl) {
      store.set(key, { data, expiresAt: Date.now() + ttl })
    },
    has(key) {
      const entry = store.get(key)
      return !!entry && entry.expiresAt > Date.now()
    },
    clear() {
      store.clear()
    },
    close() {
      store.clear()
    },
    stats() {
      return { hits, misses, size: store.size }
    },
  }
}
