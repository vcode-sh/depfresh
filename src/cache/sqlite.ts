import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'pathe'
import type { PackageData } from '../types'
import type { Cache } from './index'
import { createMemoryCache } from './memory'

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
const LEGACY_KEY_PRUNE = `DELETE FROM registry_cache WHERE package NOT LIKE '%|%'`

export function createSqliteCache(): Cache {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
  } catch {
    return createMemoryCache()
  }

  let db: DatabaseSync
  try {
    db = new DatabaseSync(CACHE_DB)
  } catch {
    return createMemoryCache()
  }

  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(SCHEMA)
    db.exec(INDEX)
  } catch {
    try {
      db.close()
    } catch {}
    return createMemoryCache()
  }

  try {
    return createOperationalCache(db)
  } catch {
    try {
      db.close()
    } catch {}
    return createMemoryCache()
  }
}

function createOperationalCache(db: DatabaseSync): Cache {
  const getStmt = db.prepare('SELECT data FROM registry_cache WHERE package = ? AND expires_at > ?')
  const setStmt = db.prepare(
    'INSERT OR REPLACE INTO registry_cache (package, data, fetched_at, expires_at) VALUES (?, ?, ?, ?)',
  )
  const hasStmt = db.prepare('SELECT 1 FROM registry_cache WHERE package = ? AND expires_at > ?')
  const clearStmt = db.prepare('DELETE FROM registry_cache')
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM registry_cache WHERE expires_at > ?')
  const pruneStmt = db.prepare('DELETE FROM registry_cache WHERE expires_at <= ?')
  const pruneLegacyStmt = db.prepare(LEGACY_KEY_PRUNE)
  const deleteStmt = db.prepare('DELETE FROM registry_cache WHERE package = ?')
  const memory = createMemoryCache()

  let hits = 0
  let misses = 0
  let usingMemory = false
  let closeAttempted = false

  const failOver = (): void => {
    if (usingMemory) return
    usingMemory = true
    if (closeAttempted) return
    closeAttempted = true
    try {
      db.close()
    } catch {}
  }

  const cumulativeStats = () => {
    const current = memory.stats()
    return {
      hits: hits + current.hits,
      misses: misses + current.misses,
      size: current.size,
    }
  }

  // Prune expired entries on startup
  pruneStmt.run(Date.now())
  // Invalidate legacy cache rows keyed only by package name.
  pruneLegacyStmt.run()

  return {
    get(key: string): PackageData | undefined {
      if (usingMemory) return memory.get(key)

      let row: { data: string } | undefined
      try {
        row = getStmt.get(key, Date.now()) as { data: string } | undefined
      } catch {
        failOver()
        return memory.get(key)
      }
      if (row) {
        try {
          const parsed = JSON.parse(row.data)
          hits++
          return parsed
        } catch {
          try {
            deleteStmt.run(key)
            misses++
            return undefined
          } catch {
            failOver()
            return memory.get(key)
          }
        }
      }
      misses++
      return undefined
    },

    set(key: string, data: PackageData, ttl: number): void {
      if (usingMemory) {
        memory.set(key, data, ttl)
        return
      }

      const now = Date.now()
      try {
        setStmt.run(key, JSON.stringify(data), now, now + ttl)
      } catch {
        failOver()
        memory.set(key, data, ttl)
      }
    },

    has(key: string): boolean {
      if (usingMemory) return memory.has(key)

      try {
        return !!hasStmt.get(key, Date.now())
      } catch {
        failOver()
        return memory.has(key)
      }
    },

    clear(): void {
      if (usingMemory) {
        memory.clear()
        return
      }

      try {
        clearStmt.run()
      } catch {
        failOver()
        memory.clear()
      }
    },

    close(): void {
      if (usingMemory) {
        memory.close()
        return
      }

      closeAttempted = true
      try {
        db.close()
      } catch {
        failOver()
        memory.close()
      }
    },

    stats() {
      if (usingMemory) return cumulativeStats()

      let row: { count: number | bigint }
      try {
        row = countStmt.get(Date.now()) as { count: number | bigint }
      } catch {
        failOver()
        return cumulativeStats()
      }
      return { hits, misses, size: Number(row.count) }
    },
  }
}
