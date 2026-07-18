import { isAbsolute } from 'node:path'
import type { RangeMode } from '../../types'

export type CheckRunPhaseName =
  | 'discover'
  | 'inspect'
  | 'resolve'
  | 'review'
  | 'preflight'
  | 'stage'
  | 'apply'
  | 'observe'
  | 'recover'
  | 'complete'

export type CheckRunPhaseStatus =
  | 'pending'
  | 'active'
  | 'passed'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'unknown'

type CheckRunTerminalPhaseStatus = Exclude<CheckRunPhaseStatus, 'pending' | 'active'>
type CheckRunRecoveryStatus = 'not-needed' | 'completed' | 'partial' | 'unknown'

export interface CheckRunPhase {
  readonly name: CheckRunPhaseName
  readonly status: CheckRunPhaseStatus
}

export interface CheckRunCounts {
  readonly packages: number
  readonly declared: number
  readonly eligible: number
  readonly updates: number
  readonly operations: number
  readonly targets: number
}

export interface CheckRunChange {
  readonly id: string
  readonly name: string
  readonly owner: string
  readonly current: string
  readonly target: string
  readonly diff: 'major' | 'minor' | 'patch' | 'none' | 'unknown'
  readonly ageMs?: number
}

export interface CheckRunTarget {
  readonly path: string
  readonly operationIds: readonly string[]
}

export interface CheckRunDiagnostic {
  readonly code: string
  readonly path: string
  readonly detail?: string
}

export interface CheckRunResultTotals {
  readonly applied: number
  readonly blocked: number
  readonly notAttempted: number
  readonly failed: number
  readonly reverted: number
  readonly unknown: number
}

export interface CheckRunRecovery {
  readonly status: CheckRunRecoveryStatus
  readonly journalId?: string
  readonly restoredPaths: readonly string[]
  readonly unrecoveredPaths: readonly string[]
  readonly externalEffects?: readonly string[]
}

interface CheckRunTerminalEvent {
  readonly id: string
  readonly signature: string
}

export interface CheckRunSnapshot {
  readonly sequence: number
  readonly mode: RangeMode
  readonly write: boolean
  readonly phases: readonly CheckRunPhase[]
  readonly counts: CheckRunCounts
  readonly changes: readonly CheckRunChange[]
  readonly targets: readonly CheckRunTarget[]
  readonly diagnostics: readonly CheckRunDiagnostic[]
  readonly results: CheckRunResultTotals
  readonly recovery: CheckRunRecovery
  readonly elapsedMs: number | null
  readonly exitCode: 0 | 1 | 2 | null
  readonly terminalEvents: readonly CheckRunTerminalEvent[]
}

export type CheckRunEvent =
  | {
      readonly type: 'packages-discovered'
      readonly packages: number
      readonly declared: number
    }
  | {
      readonly type: 'repository-inspection-started'
    }
  | {
      readonly type: 'repository-inspection-completed'
      readonly status: CheckRunTerminalPhaseStatus
    }
  | {
      readonly type: 'resolution-completed'
      readonly eligible: number
      readonly updates: number
    }
  | {
      readonly type: 'selection-completed'
      readonly operations: number
      readonly targets: number
      readonly changes?: readonly CheckRunChange[]
      readonly selectedTargets?: readonly CheckRunTarget[]
    }
  | {
      readonly type: 'phase-completed'
      readonly eventId?: string
      readonly phase: CheckRunPhaseName
      readonly status: CheckRunTerminalPhaseStatus
    }
  | {
      readonly type: 'diagnostics-recorded'
      readonly diagnostics: readonly CheckRunDiagnostic[]
    }
  | {
      readonly type: 'results-recorded'
      readonly totals: CheckRunResultTotals
    }
  | {
      readonly type: 'recovery-recorded'
      readonly status: CheckRunRecoveryStatus
      readonly journalId?: string
      readonly restoredPaths: readonly string[]
      readonly unrecoveredPaths: readonly string[]
      readonly externalEffects?: readonly string[]
    }
  | {
      readonly type: 'run-completed'
      readonly eventId: string
      readonly elapsedMs: number
      readonly exitCode: 0 | 1 | 2
    }

const PHASE_NAMES = [
  'discover',
  'inspect',
  'resolve',
  'review',
  'preflight',
  'stage',
  'apply',
  'observe',
  'recover',
  'complete',
] as const satisfies readonly CheckRunPhaseName[]

const TERMINAL_PHASE_STATUSES = new Set<CheckRunTerminalPhaseStatus>([
  'passed',
  'skipped',
  'blocked',
  'failed',
  'unknown',
])

class CheckRunInvariantError extends Error {
  constructor(message: string) {
    super(`Check run invariant: ${message}`)
  }
}

export function createCheckRunState(options: {
  readonly mode: RangeMode
  readonly write: boolean
}): CheckRunSnapshot {
  return freezeSnapshot({
    sequence: 0,
    mode: options.mode,
    write: options.write,
    phases: PHASE_NAMES.map((name) => ({
      name,
      status: name === 'discover' ? 'active' : 'pending',
    })),
    counts: emptyCounts(),
    changes: [],
    targets: [],
    diagnostics: [],
    results: emptyResults(),
    recovery: {
      status: 'not-needed',
      restoredPaths: [],
      unrecoveredPaths: [],
      externalEffects: [],
    },
    elapsedMs: null,
    exitCode: null,
    terminalEvents: [],
  })
}

export function reduceCheckRun(state: CheckRunSnapshot, event: CheckRunEvent): CheckRunSnapshot {
  const duplicate = terminalDuplicate(state, event)
  if (duplicate) return state

  if (event.type === 'packages-discovered') {
    assertCount('packages', event.packages)
    assertCount('declared', event.declared)
    assertNotReduced('packages', state.counts.packages, event.packages)
    assertNotReduced('declared', state.counts.declared, event.declared)
    const phases = completeAndAdvance(state.phases, 'discover', 'passed', state.write)
    return nextSnapshot(state, {
      phases,
      counts: { ...state.counts, packages: event.packages, declared: event.declared },
    })
  }

  if (event.type === 'repository-inspection-started') {
    assertPhase(state.phases, 'inspect', 'active')
    return nextSnapshot(state)
  }

  if (event.type === 'repository-inspection-completed') {
    assertTerminalStatus(event.status)
    const phases = completeAndAdvance(state.phases, 'inspect', event.status, state.write)
    return nextSnapshot(state, { phases })
  }

  if (event.type === 'resolution-completed') {
    assertCount('eligible', event.eligible)
    assertCount('updates', event.updates)
    assertNotReduced('eligible', state.counts.eligible, event.eligible)
    assertNotReduced('updates', state.counts.updates, event.updates)
    if (event.eligible > state.counts.declared) {
      throw new CheckRunInvariantError('eligible count cannot exceed declared count')
    }
    if (event.updates > event.eligible) {
      throw new CheckRunInvariantError('updates count cannot exceed eligible count')
    }
    const inspected =
      phaseStatus(state.phases, 'inspect') === 'active'
        ? setPhaseStatus(state.phases, 'inspect', 'skipped')
        : state.phases
    const resolving =
      phaseStatus(inspected, 'resolve') === 'pending'
        ? setPhaseStatus(inspected, 'resolve', 'active')
        : inspected
    const phases = completeAndAdvance(resolving, 'resolve', 'passed', state.write)
    return nextSnapshot(state, {
      phases,
      counts: { ...state.counts, eligible: event.eligible, updates: event.updates },
    })
  }

  if (event.type === 'selection-completed') {
    assertCount('operations', event.operations)
    assertCount('targets', event.targets)
    assertNotReduced('operations', state.counts.operations, event.operations)
    assertNotReduced('targets', state.counts.targets, event.targets)
    if (event.operations > state.counts.updates) {
      throw new CheckRunInvariantError('operations count cannot exceed updates count')
    }
    if (event.targets > event.operations) {
      throw new CheckRunInvariantError('targets count cannot exceed operations count')
    }
    const phases = completeSelection(state.phases, state.write)
    return nextSnapshot(state, {
      phases,
      counts: { ...state.counts, operations: event.operations, targets: event.targets },
      changes: event.changes ? copyChanges(event.changes) : state.changes,
      targets: event.selectedTargets ? copyTargets(event.selectedTargets) : state.targets,
    })
  }

  if (event.type === 'phase-completed') {
    assertTerminalStatus(event.status)
    const phases = completeAndAdvance(state.phases, event.phase, event.status, state.write)
    return nextSnapshot(state, { phases }, terminalEvent(state, event))
  }

  if (event.type === 'diagnostics-recorded') {
    return nextSnapshot(state, {
      diagnostics: [...state.diagnostics, ...copyDiagnostics(event.diagnostics)],
    })
  }

  if (event.type === 'results-recorded') {
    assertResults(event.totals, state.counts.operations)
    return nextSnapshot(state, { results: { ...event.totals } })
  }

  if (event.type === 'recovery-recorded') {
    return nextSnapshot(state, { recovery: copyRecovery(event) })
  }

  assertCount('elapsed milliseconds', event.elapsedMs)
  assertEventId(event.eventId)
  assertPhase(state.phases, 'complete', 'active')
  const status = finalStatus(state.results)
  const phases = setPhaseStatus(state.phases, 'complete', status)
  return nextSnapshot(
    state,
    { phases, elapsedMs: event.elapsedMs, exitCode: event.exitCode },
    terminalEvent(state, event),
  )
}

function emptyCounts(): CheckRunCounts {
  return { packages: 0, declared: 0, eligible: 0, updates: 0, operations: 0, targets: 0 }
}

function emptyResults(): CheckRunResultTotals {
  return { applied: 0, blocked: 0, notAttempted: 0, failed: 0, reverted: 0, unknown: 0 }
}

function completeSelection(
  phases: readonly CheckRunPhase[],
  write: boolean,
): readonly CheckRunPhase[] {
  assertPhase(phases, 'review', 'active')
  const reviewed = setPhaseStatus(phases, 'review', 'passed')
  if (write) return setPhaseStatus(reviewed, 'preflight', 'active')
  let next = reviewed
  for (const phase of ['preflight', 'stage', 'apply', 'observe', 'recover'] as const) {
    next = setPhaseStatus(next, phase, 'skipped')
  }
  return setPhaseStatus(next, 'complete', 'active')
}

function completeAndAdvance(
  phases: readonly CheckRunPhase[],
  phase: CheckRunPhaseName,
  status: CheckRunTerminalPhaseStatus,
  write: boolean,
): readonly CheckRunPhase[] {
  assertPhase(phases, phase, 'active')
  const completed = setPhaseStatus(phases, phase, status)
  const next = nextPhase(phase, status, write)
  return next ? setPhaseStatus(completed, next, 'active') : completed
}

function nextPhase(
  phase: CheckRunPhaseName,
  status: CheckRunTerminalPhaseStatus,
  write: boolean,
): CheckRunPhaseName | undefined {
  if (phase === 'discover') return 'inspect'
  if (phase === 'inspect') return 'resolve'
  if (phase === 'resolve') return 'review'
  if (phase === 'review') return write ? 'preflight' : undefined
  if (phase === 'preflight') return 'stage'
  if (phase === 'stage') return 'apply'
  if (phase === 'apply') return status === 'passed' ? 'observe' : 'recover'
  if (phase === 'recover') return 'observe'
  if (phase === 'observe') return 'complete'
  return undefined
}

function phaseStatus(
  phases: readonly CheckRunPhase[],
  name: CheckRunPhaseName,
): CheckRunPhaseStatus {
  return phases.find((phase) => phase.name === name)?.status ?? missingPhase(name)
}

function missingPhase(name: CheckRunPhaseName): never {
  throw new CheckRunInvariantError(`missing ${name} phase`)
}

function assertPhase(
  phases: readonly CheckRunPhase[],
  name: CheckRunPhaseName,
  expected: CheckRunPhaseStatus,
): void {
  const actual = phaseStatus(phases, name)
  if (actual !== expected) {
    throw new CheckRunInvariantError(`cannot complete ${name} from ${actual}`)
  }
}

function setPhaseStatus(
  phases: readonly CheckRunPhase[],
  name: CheckRunPhaseName,
  status: CheckRunPhaseStatus,
): readonly CheckRunPhase[] {
  return phases.map((phase) => (phase.name === name ? { ...phase, status } : { ...phase }))
}

function assertTerminalStatus(status: CheckRunPhaseStatus): void {
  if (!TERMINAL_PHASE_STATUSES.has(status as CheckRunTerminalPhaseStatus)) {
    throw new CheckRunInvariantError(`invalid terminal phase status ${status}`)
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CheckRunInvariantError(`${name} count must be a non-negative safe integer`)
  }
}

function assertNotReduced(name: string, previous: number, next: number): void {
  if (next < previous) throw new CheckRunInvariantError(`${name} count cannot decrease`)
}

function assertResults(totals: CheckRunResultTotals, operations: number): void {
  for (const [name, value] of Object.entries(totals)) assertCount(name, value)
  const terminal =
    totals.applied + totals.blocked + totals.notAttempted + totals.failed + totals.unknown
  if (terminal !== operations) {
    throw new CheckRunInvariantError('result totals must reconcile to selected operations')
  }
  if (totals.reverted > operations) {
    throw new CheckRunInvariantError('reverted total cannot exceed selected operations')
  }
}

function finalStatus(results: CheckRunResultTotals): CheckRunTerminalPhaseStatus {
  if (results.unknown > 0) return 'unknown'
  if (results.failed > 0) return 'failed'
  if (results.blocked > 0) return 'blocked'
  return 'passed'
}

function copyChanges(changes: readonly CheckRunChange[]): readonly CheckRunChange[] {
  return changes.map((change) => {
    assertRelativePath(change.owner)
    return { ...change }
  })
}

function copyTargets(targets: readonly CheckRunTarget[]): readonly CheckRunTarget[] {
  return targets.map((target) => {
    assertRelativePath(target.path)
    return { path: target.path, operationIds: [...target.operationIds] }
  })
}

function copyDiagnostics(
  diagnostics: readonly CheckRunDiagnostic[],
): readonly CheckRunDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    assertRelativePath(diagnostic.path)
    return { ...diagnostic }
  })
}

function copyRecovery(
  event: Extract<CheckRunEvent, { type: 'recovery-recorded' }>,
): CheckRunRecovery {
  if (event.journalId !== undefined && event.journalId.length === 0) {
    throw new CheckRunInvariantError('journal identifier cannot be empty')
  }
  const restoredPaths = copyPaths(event.restoredPaths)
  const unrecoveredPaths = copyPaths(event.unrecoveredPaths)
  const externalEffects = event.externalEffects ? [...event.externalEffects] : undefined
  return {
    status: event.status,
    ...(event.journalId === undefined ? {} : { journalId: event.journalId }),
    restoredPaths,
    unrecoveredPaths,
    ...(externalEffects === undefined ? {} : { externalEffects }),
  }
}

function copyPaths(paths: readonly string[]): readonly string[] {
  return paths.map((path) => {
    assertRelativePath(path)
    return path
  })
}

function assertRelativePath(path: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new CheckRunInvariantError(`path must be repository-relative: ${path}`)
  }
}

function terminalDuplicate(state: CheckRunSnapshot, event: CheckRunEvent): boolean {
  const eventId = terminalEventId(event)
  if (!eventId) return false
  assertEventId(eventId)
  const previous = state.terminalEvents.find((entry) => entry.id === eventId)
  if (!previous) return false
  if (previous.signature === JSON.stringify(event)) return true
  throw new CheckRunInvariantError(`terminal event ${eventId} payload differs`)
}

function terminalEventId(event: CheckRunEvent): string | undefined {
  if (event.type === 'phase-completed') return event.eventId
  if (event.type === 'run-completed') return event.eventId
  return undefined
}

function assertEventId(eventId: string): void {
  if (eventId.length === 0)
    throw new CheckRunInvariantError('terminal event identifier cannot be empty')
}

function terminalEvent(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'phase-completed' | 'run-completed' }>,
): readonly CheckRunTerminalEvent[] {
  const eventId = terminalEventId(event)
  if (!eventId) return state.terminalEvents
  return [...state.terminalEvents, { id: eventId, signature: JSON.stringify(event) }]
}

function nextSnapshot(
  state: CheckRunSnapshot,
  updates: Partial<Omit<CheckRunSnapshot, 'sequence' | 'terminalEvents'>> = {},
  terminalEvents = state.terminalEvents,
): CheckRunSnapshot {
  return freezeSnapshot({ ...state, ...updates, sequence: state.sequence + 1, terminalEvents })
}

function freezeSnapshot(snapshot: CheckRunSnapshot): CheckRunSnapshot {
  return deepFreeze(snapshot)
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
