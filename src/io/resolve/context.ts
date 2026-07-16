import pLimit, { type LimitFunction } from 'p-limit'
import type { depfreshOptions, PackageData } from '../../types'

export type ResolutionTraceStatus = 'selected' | 'unchanged' | 'skipped' | 'blocked' | 'unknown'

export interface ResolutionTrace {
  occurrenceId: string
  status: ResolutionTraceStatus
  reason: string
  eligibleVersions: string[]
  targetVersion?: string
}

export interface ResolveContext {
  limit: LimitFunction
  inFlight: Map<string, Promise<PackageData>>
  traces: Map<string, ResolutionTrace>
  now?: number
  metrics: {
    fetchesStarted: number
    dedupeHits: number
  }
}

export function createResolveContext(
  options: depfreshOptions,
  deterministic?: { now?: number },
): ResolveContext {
  return {
    limit: pLimit(options.concurrency),
    inFlight: new Map(),
    traces: new Map(),
    ...(deterministic?.now === undefined ? {} : { now: deterministic.now }),
    metrics: {
      fetchesStarted: 0,
      dedupeHits: 0,
    },
  }
}

export function recordResolutionTrace(
  context: ResolveContext | undefined,
  occurrenceId: string | undefined,
  trace: Omit<ResolutionTrace, 'occurrenceId'>,
): void {
  if (!(context && occurrenceId)) return
  context.traces.set(occurrenceId, { occurrenceId, ...trace })
}
