import { mkdirSync } from 'node:fs'
import { join } from 'pathe'
import { homedir } from 'node:os'
import type Database from 'better-sqlite3'
import type { PackageData } from '../types'
import type { Cache } from './index'

const CACHE_DIR = join(homedir(), '.bump')
const CACHE_DB = join(CACHE_DIR, 'cache.db')

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS registry_cache (
    package TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (package)
  );
  CREATE INDEX IF NOT EXISTS idx_expires ON registry_cache(expires_at);
`

export function createSqliteCache(): Cache {
  mkdirSync(CACHE_DIR, { recursive: true })

  // Dynamic import to handle environments without native modules
  // biome-ignore lint/suspicious/noExplicitAny: better-sqlite3 dynamic load
  let BetterSqlite3: any
  try {
    BetterSqlite3 = require('better-sqlite3')
  } catch {
    // Fallback to in-memory if better-sqlite3 not available
    return createMemoryFallback()
  }

  const db: Database.Database = new BetterSqlite3(CACHE_DB)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA)

  // Prepared statements
  const getStmt = db.prepare('SELECT data FROM registry_cache WHERE package = ? AND expires_at > ?')
  const setStmt = db.prepare(
    'INSERT OR REPLACE INTO registry_cache (package, data, fetched_at, expires_at) VALUES (?, ?, ?, ?)',
  )
  const hasStmt = db.prepare(
    'SELECT 1 FROM registry_cache WHERE package = ? AND expires_at > ?',
  )
  const clearStmt = db.prepare('DELETE FROM registry_cache')
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM registry_cache WHERE expires_at > ?')
  const pruneStmt = db.prepare('DELETE FROM registry_cache WHERE expires_at <= ?')

  let hits = 0
  let misses = 0

  // Prune expired entries on startup
  pruneStmt.run(Date.now())

  return {
    get(key: string): PackageData | undefined {
      const row = getStmt.get(key, Date.now()) as { data: string } | undefined
      if (row) {
        hits++
        return JSON.parse(row.data)
      }
      misses++
      return undefined
    },

    set(key: string, data: PackageData, ttl: number): void {
      const now = Date.now()
      setStmt.run(key, JSON.stringify(data), now, now + ttl)
    },

    has(key: string): boolean {
      return !!hasStmt.get(key, Date.now())
    },

    clear(): void {
      clearStmt.run()
    },

    close(): void {
      db.close()
    },

    stats() {
      const row = countStmt.get(Date.now()) as { count: number }
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
