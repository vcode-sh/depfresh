import pLimit, { type LimitFunction } from 'p-limit'
import type { depfreshOptions, PackageData } from '../../types'

export interface ResolveContext {
  limit: LimitFunction
  inFlight: Map<string, Promise<PackageData>>
  metrics: {
    fetchesStarted: number
    dedupeHits: number
  }
}

export function createResolveContext(options: depfreshOptions): ResolveContext {
  return {
    limit: pLimit(options.concurrency),
    inFlight: new Map(),
    metrics: {
      fetchesStarted: 0,
      dedupeHits: 0,
    },
  }
}
