import type { RangeMode } from '../../types'
import {
  type CheckRunDiagnostic,
  type CheckRunEvent,
  type CheckRunSnapshot,
  createCheckRunState,
  reduceCheckRun,
} from './run-model'

export interface CreateCheckRunControllerOptions {
  readonly mode: RangeMode
  readonly write: boolean
  readonly now: () => number
}

export interface CheckRunController {
  /** Emits one reducer event; final elapsed time is always derived from the injected clock. */
  emit(event: CheckRunEvent): void
  snapshot(): CheckRunSnapshot
  /** Subscribes in insertion order and synchronously delivers the current snapshot once. */
  subscribe(observer: (snapshot: CheckRunSnapshot) => void): () => void
}

const OBSERVER_FAILURE_DIAGNOSTIC: CheckRunDiagnostic = Object.freeze({
  code: 'CHECK_RUN_OBSERVER_FAILED',
  detail: 'A check run observer threw',
})

class CheckRunControllerError extends Error {
  constructor(message: string) {
    super(`Check run controller: ${message}`)
  }
}

export function createCheckRunController(
  options: CreateCheckRunControllerOptions,
): CheckRunController {
  const startedAt = readInitialClock(options.now)
  let lastObservedAt = startedAt
  let reducerSnapshot = createCheckRunState({ mode: options.mode, write: options.write })
  let observerDiagnostics: readonly CheckRunDiagnostic[] = []
  let visibleSnapshot = reducerSnapshot
  let rawCompletion: Readonly<{ eventId: string; signature: string }> | null = null
  const observers = new Map<symbol, (snapshot: CheckRunSnapshot) => void>()

  const retainObserverFailure = (): void => {
    observerDiagnostics = Object.freeze([...observerDiagnostics, OBSERVER_FAILURE_DIAGNOSTIC])
    visibleSnapshot = projectSnapshot(reducerSnapshot, observerDiagnostics)
  }

  const deliver = (
    observer: (snapshot: CheckRunSnapshot) => void,
    snapshot: CheckRunSnapshot,
  ): void => {
    try {
      observer(snapshot)
    } catch {
      retainObserverFailure()
    }
  }

  const emit = (event: CheckRunEvent): void => {
    if (reducerSnapshot.exitCode !== null) {
      if (event.type === 'run-completed' && rawCompletion?.eventId === event.eventId) {
        if (rawCompletion.signature !== JSON.stringify(event)) {
          throw new CheckRunControllerError('terminal event payload differs')
        }
      }
      const duplicate = reduceCheckRun(reducerSnapshot, normalizeFinalEvent(event, reducerSnapshot))
      if (duplicate !== reducerSnapshot) {
        throw new CheckRunControllerError('a finalized run produced another snapshot')
      }
      return
    }

    const timestamp = readClock(options.now, lastObservedAt)
    lastObservedAt = timestamp
    const normalized =
      event.type === 'run-completed'
        ? { ...event, elapsedMs: elapsedSince(startedAt, timestamp) }
        : event
    const nextReducerSnapshot = reduceCheckRun(reducerSnapshot, normalized)
    if (nextReducerSnapshot === reducerSnapshot) return

    reducerSnapshot = nextReducerSnapshot
    if (event.type === 'run-completed') {
      rawCompletion = Object.freeze({ eventId: event.eventId, signature: JSON.stringify(event) })
    }
    visibleSnapshot = projectSnapshot(reducerSnapshot, observerDiagnostics)
    const emittedSnapshot = visibleSnapshot
    for (const observer of [...observers.values()]) deliver(observer, emittedSnapshot)
  }

  const subscribe = (observer: (snapshot: CheckRunSnapshot) => void): (() => void) => {
    const observerId = Symbol('check-run-observer')
    observers.set(observerId, observer)
    deliver(observer, visibleSnapshot)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      observers.delete(observerId)
    }
  }

  return {
    emit,
    snapshot: () => visibleSnapshot,
    subscribe,
  }
}

function normalizeFinalEvent(event: CheckRunEvent, snapshot: CheckRunSnapshot): CheckRunEvent {
  if (event.type !== 'run-completed' || snapshot.elapsedMs === null) return event
  return { ...event, elapsedMs: snapshot.elapsedMs }
}

function projectSnapshot(
  snapshot: CheckRunSnapshot,
  observerDiagnostics: readonly CheckRunDiagnostic[],
): CheckRunSnapshot {
  if (observerDiagnostics.length === 0) return snapshot
  const diagnostics = Object.freeze([...snapshot.diagnostics, ...observerDiagnostics])
  return Object.freeze({ ...snapshot, diagnostics })
}

function readInitialClock(now: () => number): number {
  const value = now()
  if (!Number.isFinite(value)) {
    throw new CheckRunControllerError('clock must return a finite number')
  }
  return value
}

function readClock(now: () => number, previous: number): number {
  const value = readInitialClock(now)
  if (value < previous) throw new CheckRunControllerError('clock moved backwards')
  return value
}

function elapsedSince(startedAt: number, completedAt: number): number {
  const elapsed = completedAt - startedAt
  if (!Number.isFinite(elapsed)) {
    throw new CheckRunControllerError('elapsed time must be finite')
  }
  return elapsed
}
