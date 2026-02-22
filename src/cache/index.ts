import type { PackageData } from '../types'

export interface Cache {
  get(key: string): PackageData | undefined
  set(key: string, data: PackageData, ttl: number): void
  has(key: string): boolean
  clear(): void
  close(): void
  stats(): { hits: number; misses: number; size: number }
}

export { createSqliteCache } from './sqlite'
