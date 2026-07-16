import type { PackageData } from '../types'
import type { Cache } from './index'

export function createMemoryCache(now: () => number = Date.now): Cache {
  const store = new Map<string, { data: PackageData; expiresAt: number }>()
  let hits = 0
  let misses = 0

  return {
    get(key) {
      const entry = store.get(key)
      if (entry && entry.expiresAt > now()) {
        hits++
        return entry.data
      }
      if (entry) store.delete(key)
      misses++
      return undefined
    },
    set(key, data, ttl) {
      store.set(key, { data, expiresAt: now() + ttl })
    },
    has(key) {
      const entry = store.get(key)
      if (entry && entry.expiresAt > now()) return true
      if (entry) store.delete(key)
      return false
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
