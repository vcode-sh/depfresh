import type { depfreshOptions } from '../../types'

export interface ResolveCachePolicy {
  bypassRead: boolean
  shouldWrite: boolean
}

export function getResolveCachePolicy(options: depfreshOptions): ResolveCachePolicy {
  const cacheEnabled = options.cacheTTL > 0
  return {
    bypassRead: !cacheEnabled || Boolean(options.refreshCache),
    shouldWrite: cacheEnabled,
  }
}
