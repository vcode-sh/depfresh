import { isAbsolute } from 'node:path'
import type { RangeMode } from '../../types'
import type { CheckRunInsightEvidence } from './relationship-evidence'
import {
  copyAndValidateRelationshipSelection,
  RelationshipEvidenceError,
} from './relationship-evidence'

export type {
  CheckRunCatalogEvidence,
  CheckRunInsightEvidence,
  CheckRunOwnerReference,
} from './relationship-evidence'

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
type CheckRunFinalStatus = Extract<
  CheckRunTerminalPhaseStatus,
  'passed' | 'blocked' | 'failed' | 'unknown'
>
type CheckRunRecoveryStatus = 'not-needed' | 'completed' | 'partial' | 'unknown'

export interface CheckRunPhase {
  readonly name: CheckRunPhaseName
  readonly status: CheckRunPhaseStatus
}

export interface CheckRunCounts {
  readonly packages: number
  readonly declared: number
  readonly eligible: number
  readonly unresolved: number
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
  readonly insight?: CheckRunInsightEvidence
}

export interface CheckRunTarget {
  readonly path: string
  readonly operationIds: readonly string[]
}

export interface CheckRunDiagnostic {
  readonly code: string
  readonly path?: string
  readonly detail?: string
}

export interface CheckRunResultTotals {
  readonly applied: number
  readonly skipped: number
  readonly mixed: number
  readonly blocked: number
  readonly notAttempted: number
  readonly failed: number
  readonly reverted: number
  readonly unknown: number
}

export type CheckRunOperationOutcome =
  | 'applied'
  | 'skipped'
  | 'blocked'
  | 'not-attempted'
  | 'failed'
  | 'reverted'
  | 'unknown'

export type CheckRunTargetOutcome = CheckRunOperationOutcome | 'mixed'

export interface CheckRunOperationResult {
  readonly operationId: string
  // The base outcome is exclusive; safety receipts are independent and may overlap.
  readonly outcome: CheckRunOperationOutcome
  readonly blocked: boolean
  readonly notAttempted: boolean
  readonly unknown: boolean
  readonly reason?: string
}

export interface CheckRunTargetResult {
  readonly path: string
  readonly operationIds: readonly string[]
  // Physical-file outcome and aggregate safety receipts remain separate dimensions.
  readonly outcome: CheckRunTargetOutcome
  readonly blocked: boolean
  readonly notAttempted: boolean
  readonly unknown: boolean
}

export interface CheckRunResults {
  readonly operations: readonly CheckRunOperationResult[]
  readonly targets: readonly CheckRunTargetResult[]
  readonly totals: CheckRunResultTotals
  readonly targetTotals: CheckRunResultTotals
}

export interface CheckRunRecovery {
  readonly executed: boolean
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
  readonly results: CheckRunResults
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
      readonly unresolved: number
      readonly updates: number
      readonly status?: CheckRunTerminalPhaseStatus
    }
  | {
      readonly type: 'selection-completed'
      readonly operations: number
      readonly targets: number
      readonly changes: readonly CheckRunChange[]
      readonly selectedTargets: readonly CheckRunTarget[]
    }
  | {
      readonly type: 'phase-completed'
      readonly eventId?: string
      readonly phase: CheckRunPhaseName
      readonly status: CheckRunTerminalPhaseStatus
    }
  | {
      readonly type: 'stage-completed'
      readonly status: Extract<CheckRunTerminalPhaseStatus, 'skipped'>
      readonly observationRequired: boolean
    }
  | {
      readonly type: 'apply-completed'
      readonly status: CheckRunTerminalPhaseStatus
      readonly recoveryRequired: boolean
      readonly observationRequired: boolean
    }
  | {
      readonly type: 'diagnostics-recorded'
      readonly diagnostics: readonly CheckRunDiagnostic[]
    }
  | {
      readonly type: 'results-recorded'
      readonly operations: readonly CheckRunOperationResult[]
      readonly targets: readonly CheckRunTargetResult[]
    }
  | {
      readonly type: 'recovery-recorded'
      readonly executed: boolean
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
      readonly status?: CheckRunFinalStatus
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

const PHASE_NAME_SET = new Set<CheckRunPhaseName>(PHASE_NAMES)

const TERMINAL_PHASE_STATUSES = new Set<CheckRunTerminalPhaseStatus>([
  'passed',
  'skipped',
  'blocked',
  'failed',
  'unknown',
])

const OPERATION_OUTCOMES = new Set<CheckRunOperationOutcome>([
  'applied',
  'skipped',
  'blocked',
  'not-attempted',
  'failed',
  'reverted',
  'unknown',
])

const TARGET_OUTCOMES = new Set<CheckRunTargetOutcome>([...OPERATION_OUTCOMES, 'mixed'])

const RECOVERY_STATUSES = new Set<CheckRunRecoveryStatus>([
  'not-needed',
  'completed',
  'partial',
  'unknown',
])

const CHANGE_DIFFS = new Set<CheckRunChange['diff']>(['major', 'minor', 'patch', 'none', 'unknown'])

const BAD_STATUS_RANK: Readonly<Record<CheckRunFinalStatus, number>> = {
  passed: 0,
  blocked: 1,
  failed: 2,
  unknown: 3,
}

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
    results: emptyRunResults(),
    recovery: {
      executed: false,
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
  if (terminalDuplicate(state, event)) return state
  assertOpen(state)

  if (event.type === 'packages-discovered') return discoverPackages(state, event)
  if (event.type === 'repository-inspection-started') {
    assertPhase(state.phases, 'inspect', 'active')
    return nextSnapshot(state)
  }
  if (event.type === 'repository-inspection-completed') {
    assertTerminalStatus(event.status)
    const phases = completeAndAdvance(state.phases, 'inspect', event.status, state.write)
    return acceptedTerminal(state, event, { phases })
  }
  if (event.type === 'resolution-completed') return completeResolution(state, event)
  if (event.type === 'selection-completed') return completeSelection(state, event)
  if (event.type === 'stage-completed') return completeExactStage(state, event)
  if (event.type === 'apply-completed') return completeExactApply(state, event)
  if (event.type === 'phase-completed') return completePhase(state, event)
  if (event.type === 'diagnostics-recorded') {
    return nextSnapshot(state, {
      diagnostics: [...state.diagnostics, ...copyDiagnostics(event.diagnostics)],
    })
  }
  if (event.type === 'results-recorded') return recordResults(state, event)
  if (event.type === 'recovery-recorded') return recordRecovery(state, event)
  return completeRun(state, event)
}

function discoverPackages(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'packages-discovered' }>,
): CheckRunSnapshot {
  assertCount('packages', event.packages)
  assertCount('declared', event.declared)
  assertNotReduced('packages', state.counts.packages, event.packages)
  assertNotReduced('declared', state.counts.declared, event.declared)
  const phases = completeAndAdvance(state.phases, 'discover', 'passed', state.write)
  return acceptedTerminal(state, event, {
    phases,
    counts: { ...state.counts, packages: event.packages, declared: event.declared },
  })
}

function completeResolution(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'resolution-completed' }>,
): CheckRunSnapshot {
  const inspected = activateResolution(state.phases)
  assertCount('eligible', event.eligible)
  assertCount('unresolved', event.unresolved)
  assertCount('updates', event.updates)
  assertNotReduced('eligible', state.counts.eligible, event.eligible)
  assertNotReduced('unresolved', state.counts.unresolved, event.unresolved)
  assertNotReduced('updates', state.counts.updates, event.updates)
  if (event.eligible > state.counts.declared) {
    throw new CheckRunInvariantError('eligible count cannot exceed declared occurrences')
  }
  if (event.updates + event.unresolved > event.eligible) {
    throw new CheckRunInvariantError(
      'updates and unresolved counts cannot exceed eligible occurrences',
    )
  }
  const status = event.status ?? 'passed'
  assertTerminalStatus(status)
  const phases = completeAndAdvance(inspected, 'resolve', status, state.write)
  return acceptedTerminal(state, event, {
    phases,
    counts: {
      ...state.counts,
      eligible: event.eligible,
      unresolved: event.unresolved,
      updates: event.updates,
    },
  })
}

function activateResolution(phases: readonly CheckRunPhase[]): readonly CheckRunPhase[] {
  const inspection = phaseStatus(phases, 'inspect')
  if (inspection === 'active') {
    return setPhaseStatus(setPhaseStatus(phases, 'inspect', 'skipped'), 'resolve', 'active')
  }
  assertPhase(phases, 'resolve', 'active')
  return phases
}

function completeSelection(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'selection-completed' }>,
): CheckRunSnapshot {
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
  const inventory = copyAndValidateInventory(event)
  assertPhase(state.phases, 'review', 'active')
  const phases = advanceFromReview(setPhaseStatus(state.phases, 'review', 'passed'), state.write)
  return acceptedTerminal(state, event, {
    phases,
    counts: { ...state.counts, operations: event.operations, targets: event.targets },
    changes: inventory.changes,
    targets: inventory.targets,
  })
}

function completePhase(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'phase-completed' }>,
): CheckRunSnapshot {
  assertPhaseName(event.phase)
  assertTerminalStatus(event.status)
  if (event.phase === 'complete') {
    throw new CheckRunInvariantError('complete phase requires run-completed')
  }
  if (
    event.status === 'passed' &&
    (event.phase === 'discover' || event.phase === 'resolve' || event.phase === 'review')
  ) {
    throw new CheckRunInvariantError(`${event.phase} success requires ${factEvent(event.phase)}`)
  }
  if (event.phase === 'resolve' && phaseStatus(state.phases, 'inspect') === 'active') {
    const phases = setPhaseStatus(
      setPhaseStatus(state.phases, 'inspect', 'skipped'),
      'resolve',
      'active',
    )
    return acceptedTerminal(state, event, {
      phases: completeAndAdvance(phases, 'resolve', event.status, state.write),
    })
  }
  if (event.phase === 'stage' && event.status === 'skipped' && state.counts.operations > 0) {
    assertPhase(state.phases, 'stage', 'active')
    throw new CheckRunInvariantError('selected no-mutation stage requires fact-bearing observation')
  }
  const phases = completeAndAdvance(state.phases, event.phase, event.status, state.write)
  return acceptedTerminal(state, event, { phases })
}

function completeExactApply(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'apply-completed' }>,
): CheckRunSnapshot {
  assertTerminalStatus(event.status)
  assertBoolean('recovery-required receipt', event.recoveryRequired)
  assertBoolean('observation-required receipt', event.observationRequired)
  if (event.status === 'blocked' || event.status === 'skipped') {
    throw new CheckRunInvariantError('exact apply status must be passed, failed, or unknown')
  }
  if (event.recoveryRequired && !event.observationRequired) {
    throw new CheckRunInvariantError('recovery requires final observation')
  }
  if (event.status === 'passed' && !event.observationRequired) {
    throw new CheckRunInvariantError('passed apply requires final observation')
  }
  assertPhase(state.phases, 'apply', 'active')
  let phases = setPhaseStatus(state.phases, 'apply', event.status)
  if (event.recoveryRequired) {
    phases = setPhaseStatus(phases, 'recover', 'active')
  } else if (event.observationRequired) {
    phases = setPhaseStatus(setPhaseStatus(phases, 'recover', 'skipped'), 'observe', 'active')
  } else {
    phases = finishWithoutMutation(phases, ['recover', 'observe'])
  }
  return acceptedTerminal(state, event, { phases })
}

function completeExactStage(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'stage-completed' }>,
): CheckRunSnapshot {
  assertBoolean('observation-required receipt', event.observationRequired)
  if (event.status !== 'skipped') {
    throw new CheckRunInvariantError('exact no-mutation stage status must be skipped')
  }
  assertPhase(state.phases, 'stage', 'active')
  if (state.counts.operations > 0 && !event.observationRequired) {
    throw new CheckRunInvariantError('selected no-mutation stage requires final observation')
  }
  let phases = setPhaseStatus(state.phases, 'stage', 'skipped')
  phases = setPhaseStatus(setPhaseStatus(phases, 'apply', 'skipped'), 'recover', 'skipped')
  phases = event.observationRequired
    ? setPhaseStatus(phases, 'observe', 'active')
    : finishWithoutMutation(phases, ['observe'])
  return acceptedTerminal(state, event, { phases })
}

function factEvent(phase: 'discover' | 'resolve' | 'review'): string {
  if (phase === 'discover') return 'packages-discovered'
  if (phase === 'resolve') return 'resolution-completed'
  return 'selection-completed'
}

function recordResults(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'results-recorded' }>,
): CheckRunSnapshot {
  if (phaseStatus(state.phases, 'complete') !== 'active') {
    throw new CheckRunInvariantError('results can only be recorded during complete')
  }
  const results = copyAndValidateResults(state, event)
  return acceptedTerminal(state, event, { results })
}

function recordRecovery(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'recovery-recorded' }>,
): CheckRunSnapshot {
  assertBoolean('executed recovery receipt', event.executed)
  const recover = phaseStatus(state.phases, 'recover')
  if (event.executed && recover !== 'active') {
    throw new CheckRunInvariantError('executed recovery requires an active recovery phase')
  }
  if (!event.executed && recover !== 'skipped') {
    throw new CheckRunInvariantError('retained cleanup evidence requires skipped recovery')
  }
  return acceptedTerminal(state, event, { recovery: copyRecovery(event) })
}

function completeRun(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'run-completed' }>,
): CheckRunSnapshot {
  assertDuration(event.elapsedMs)
  assertEventId(event.eventId)
  if (event.status !== undefined) assertFinalStatus(event.status)
  assertPhase(state.phases, 'complete', 'active')
  if (!hasTerminalEvent(state, 'results-recorded')) {
    throw new CheckRunInvariantError('results must be recorded before completion')
  }
  if (event.exitCode === 1 && state.write) {
    throw new CheckRunInvariantError('exit code 1 is only valid for a read-only strict result')
  }
  const status = finalStatus(state, event)
  if (event.exitCode === 0 && status !== 'passed') {
    throw new CheckRunInvariantError(`exit code 0 cannot finalize a ${status} result`)
  }
  if (event.exitCode === 1 && status !== 'passed') {
    throw new CheckRunInvariantError(`exit code 1 cannot finalize a ${status} result`)
  }
  const phases = setPhaseStatus(state.phases, 'complete', status)
  return acceptedTerminal(state, event, {
    phases,
    elapsedMs: event.elapsedMs,
    exitCode: event.exitCode,
  })
}

function completeAndAdvance(
  phases: readonly CheckRunPhase[],
  phase: Exclude<CheckRunPhaseName, 'complete'>,
  status: CheckRunTerminalPhaseStatus,
  write: boolean,
): readonly CheckRunPhase[] {
  assertPhase(phases, phase, 'active')
  const completed = setPhaseStatus(phases, phase, status)

  if (phase === 'discover') {
    return status === 'passed'
      ? setPhaseStatus(completed, 'inspect', 'active')
      : finishWithoutMutation(completed, ['inspect', 'resolve', 'review', ...writePhases()])
  }
  if (phase === 'inspect') {
    return status === 'passed'
      ? setPhaseStatus(completed, 'resolve', 'active')
      : finishWithoutMutation(completed, ['resolve', 'review', ...writePhases()])
  }
  if (phase === 'resolve') {
    return status === 'passed'
      ? setPhaseStatus(completed, 'review', 'active')
      : finishWithoutMutation(completed, ['review', ...writePhases()])
  }
  if (phase === 'review') {
    return status === 'passed'
      ? advanceFromReview(completed, write)
      : finishWithoutMutation(completed, writePhases())
  }
  if (phase === 'preflight') {
    return status === 'passed'
      ? setPhaseStatus(completed, 'stage', 'active')
      : finishWithoutMutation(completed, ['stage', 'apply', 'observe', 'recover'])
  }
  if (phase === 'stage') {
    return status === 'passed'
      ? setPhaseStatus(completed, 'apply', 'active')
      : finishWithoutMutation(completed, ['apply', 'observe', 'recover'])
  }
  if (phase === 'apply') {
    if (status === 'passed' || status === 'skipped') {
      return setPhaseStatus(setPhaseStatus(completed, 'recover', 'skipped'), 'observe', 'active')
    }
    return setPhaseStatus(completed, 'recover', 'active')
  }
  if (phase === 'recover') return setPhaseStatus(completed, 'observe', 'active')
  return setPhaseStatus(completed, 'complete', 'active')
}

function advanceFromReview(
  phases: readonly CheckRunPhase[],
  write: boolean,
): readonly CheckRunPhase[] {
  if (write) return setPhaseStatus(phases, 'preflight', 'active')
  return finishWithoutMutation(phases, writePhases())
}

function writePhases(): readonly ['preflight', 'stage', 'apply', 'observe', 'recover'] {
  return ['preflight', 'stage', 'apply', 'observe', 'recover']
}

function finishWithoutMutation(
  phases: readonly CheckRunPhase[],
  skipped: readonly CheckRunPhaseName[],
): readonly CheckRunPhase[] {
  let next = phases
  for (const phase of skipped) {
    if (phaseStatus(next, phase) === 'pending') next = setPhaseStatus(next, phase, 'skipped')
  }
  return setPhaseStatus(next, 'complete', 'active')
}

function copyAndValidateInventory(event: Extract<CheckRunEvent, { type: 'selection-completed' }>): {
  readonly changes: readonly CheckRunChange[]
  readonly targets: readonly CheckRunTarget[]
} {
  if (!(Array.isArray(event.changes) && Array.isArray(event.selectedTargets))) {
    throw new CheckRunInvariantError('complete selection inventories are required')
  }
  if (event.changes.length !== event.operations) {
    throw new CheckRunInvariantError('change inventory must reconcile to selected operations')
  }
  if (event.selectedTargets.length !== event.targets) {
    throw new CheckRunInvariantError('target inventory must reconcile to selected targets')
  }
  const changes = copyChanges(event.changes)
  const targets = copyTargets(event.selectedTargets)
  assertUnique(
    changes.map((change) => change.id),
    'change identifiers',
  )
  assertUnique(
    targets.map((target) => target.path),
    'target paths',
  )

  const changesById = new Map(changes.map((change) => [change.id, change]))
  const memberships = new Map<string, number>()
  for (const target of targets) {
    assertUnique(target.operationIds, `operation identifiers for ${target.path}`)
    for (const operationId of target.operationIds) {
      const selected = changesById.get(operationId)
      if (!selected) {
        throw new CheckRunInvariantError(`target references unknown operation ${operationId}`)
      }
      if (selected.owner !== target.path) {
        throw new CheckRunInvariantError(
          `operation ${operationId} does not belong to ${target.path}`,
        )
      }
      memberships.set(operationId, (memberships.get(operationId) ?? 0) + 1)
    }
  }
  if (changes.some((selected) => memberships.get(selected.id) !== 1)) {
    throw new CheckRunInvariantError('every selected operation must belong to exactly one target')
  }
  return { changes, targets }
}

function copyChanges(changes: readonly CheckRunChange[]): readonly CheckRunChange[] {
  const copied = changes.map((change) => {
    assertSafeIdentifier('change identifier', change.id)
    assertSafeText('dependency name', change.name)
    assertRelativePath(change.owner)
    assertSafeText('current dependency value', change.current)
    assertSafeText('target dependency value', change.target)
    if (!CHANGE_DIFFS.has(change.diff)) {
      throw new CheckRunInvariantError('invalid dependency difference')
    }
    if (change.ageMs !== undefined) assertCount('change age milliseconds', change.ageMs)
    return { ...change }
  })
  try {
    const insights = copyAndValidateRelationshipSelection(copied, 'optional')
    return copied.map((change, index) => {
      const insight = insights[index]
      return insight === undefined ? { ...change } : { ...change, insight }
    })
  } catch (error) {
    if (error instanceof RelationshipEvidenceError) {
      throw new CheckRunInvariantError(error.message)
    }
    throw error
  }
}

function copyTargets(targets: readonly CheckRunTarget[]): readonly CheckRunTarget[] {
  return targets.map((target) => {
    assertRelativePath(target.path)
    const operationIds = target.operationIds.map((operationId) => {
      assertSafeIdentifier('operation identifier', operationId)
      return operationId
    })
    return { path: target.path, operationIds }
  })
}

function copyAndValidateResults(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'results-recorded' }>,
): CheckRunResults {
  const operations = event.operations.map((result) => copyOperationResult(result, state.write))
  assertUnique(
    operations.map((result) => result.operationId),
    'operation result identifiers',
  )
  if (event.operations.length !== state.counts.operations) {
    throw new CheckRunInvariantError('operation results must reconcile to selected operations')
  }
  if (event.targets.length !== state.counts.targets) {
    throw new CheckRunInvariantError(
      'physical target results must reconcile to selected physical targets',
    )
  }

  const selectedOperations = new Set(state.changes.map((selected) => selected.id))
  for (const result of operations) {
    if (!selectedOperations.has(result.operationId)) {
      throw new CheckRunInvariantError('operation result is not selected')
    }
  }
  const selectedTargets = new Map(state.targets.map((selected) => [selected.path, selected]))
  const targets = event.targets.map((result) => copyTargetResult(result))
  assertUnique(
    targets.map((result) => result.path),
    'physical target result paths',
  )
  const operationsById = new Map(operations.map((result) => [result.operationId, result]))
  for (const result of targets) {
    const selected = selectedTargets.get(result.path)
    if (!selected) throw new CheckRunInvariantError('physical target result is not selected')
    if (!sameStrings(result.operationIds, selected.operationIds)) {
      throw new CheckRunInvariantError('physical target operation membership differs')
    }
    assertTargetOutcomeCoherence(result, operationsById)
  }

  const totals = deriveOperationTotals(operations)
  const targetTotals = deriveTargetTotals(targets)
  assertResultPhaseCoherence(state, operations, totals, targets)
  return {
    operations,
    targets,
    totals,
    targetTotals,
  }
}

function copyOperationResult(
  result: CheckRunOperationResult,
  write: boolean,
): CheckRunOperationResult {
  assertSafeIdentifier('operation result identifier', result.operationId)
  assertOutcome(result.outcome)
  assertBoolean('blocked receipt', result.blocked)
  assertBoolean('not-attempted receipt', result.notAttempted)
  assertBoolean('unknown receipt', result.unknown)
  if (result.outcome === 'applied') {
    if (result.unknown) {
      throw new CheckRunInvariantError('applied operation cannot also be unknown')
    }
    if (result.blocked || result.notAttempted) {
      throw new CheckRunInvariantError('applied operation cannot retain a safety receipt')
    }
    if (!write) throw new CheckRunInvariantError('read-only runs cannot report applied results')
  }
  if (result.outcome === 'reverted') {
    if (result.blocked || result.notAttempted || result.unknown) {
      throw new CheckRunInvariantError('known final operation cannot retain a safety receipt')
    }
  }
  if (result.outcome === 'failed' && (result.blocked || result.unknown)) {
    throw new CheckRunInvariantError('failed operation cannot retain blocked or unknown truth')
  }
  if (result.outcome === 'blocked' && !result.blocked) {
    throw new CheckRunInvariantError('blocked operation requires a blocked receipt')
  }
  if (result.outcome === 'not-attempted' && !result.notAttempted) {
    throw new CheckRunInvariantError('not-attempted operation requires its receipt')
  }
  if (result.outcome === 'unknown' && !result.unknown) {
    throw new CheckRunInvariantError('unknown operation requires an unknown receipt')
  }
  if (result.blocked && !result.notAttempted) {
    throw new CheckRunInvariantError('blocked receipt requires not-attempted truth')
  }
  return { ...result }
}

function copyTargetResult(result: CheckRunTargetResult): CheckRunTargetResult {
  assertRelativePath(result.path)
  assertTargetOutcome(result.outcome)
  assertBoolean('physical target blocked receipt', result.blocked)
  assertBoolean('physical target not-attempted receipt', result.notAttempted)
  assertBoolean('physical target unknown receipt', result.unknown)
  if (result.outcome === 'applied' && (result.blocked || result.notAttempted || result.unknown)) {
    throw new CheckRunInvariantError('applied physical target cannot retain a safety receipt')
  }
  if (result.outcome === 'blocked' && !result.blocked) {
    throw new CheckRunInvariantError('blocked physical target requires a blocked receipt')
  }
  if (result.outcome === 'not-attempted' && !result.notAttempted) {
    throw new CheckRunInvariantError('not-attempted physical target requires its receipt')
  }
  if (result.outcome === 'unknown' && !result.unknown) {
    throw new CheckRunInvariantError('unknown physical target requires an unknown receipt')
  }
  if (result.blocked && !result.notAttempted) {
    throw new CheckRunInvariantError('physical target blocked receipt requires not-attempted truth')
  }
  const operationIds = result.operationIds.map((operationId) => {
    assertSafeIdentifier('physical target operation identifier', operationId)
    return operationId
  })
  assertUnique(operationIds, 'physical target operation identifiers')
  return { ...result, operationIds }
}

function assertTargetOutcomeCoherence(
  targetResult: CheckRunTargetResult,
  operationsById: ReadonlyMap<string, CheckRunOperationResult>,
): void {
  const operations = targetResult.operationIds.map((operationId) => {
    const operation = operationsById.get(operationId)
    if (!operation) throw new CheckRunInvariantError('physical target references a missing result')
    return operation
  })
  if (
    targetResult.blocked !== operations.some((operation) => operation.blocked) ||
    targetResult.notAttempted !== operations.some((operation) => operation.notAttempted) ||
    targetResult.unknown !== operations.some((operation) => operation.unknown)
  ) {
    throw new CheckRunInvariantError('physical target receipt dimensions differ from operations')
  }
  if (operations.length === 0) {
    throw new CheckRunInvariantError('physical target requires at least one operation result')
  }
  const outcomes = new Set(operations.map((operation) => operation.outcome))
  if (outcomes.size === 1) {
    if (targetResult.outcome !== operations[0]!.outcome) {
      throw new CheckRunInvariantError(
        'uniform physical target must use its exact operation outcome',
      )
    }
  } else if (targetResult.outcome !== 'mixed') {
    throw new CheckRunInvariantError('heterogeneous physical target requires mixed outcome')
  }
}

function assertResultPhaseCoherence(
  state: CheckRunSnapshot,
  operations: readonly CheckRunOperationResult[],
  totals: CheckRunResultTotals,
  targets: readonly CheckRunTargetResult[],
): void {
  const selected = state.counts.operations
  const preflight = phaseStatus(state.phases, 'preflight')
  const stage = phaseStatus(state.phases, 'stage')
  const apply = phaseStatus(state.phases, 'apply')
  const observe = phaseStatus(state.phases, 'observe')
  const recover = phaseStatus(state.phases, 'recover')
  const blockedPhase = [preflight, stage, apply].includes('blocked')
  const unknownPhase = [preflight, stage, apply, observe, recover].includes('unknown')
  const failedPhase = [preflight, stage, apply, observe, recover].includes('failed')
  const recoveryRecorded = hasTerminalEvent(state, 'recovery-recorded')
  const retainedCleanupUnknown =
    recoveryRecorded &&
    !state.recovery.executed &&
    state.recovery.status === 'unknown' &&
    recover === 'skipped'
  const noObservationApplyFailure =
    (apply === 'failed' || apply === 'unknown') &&
    preflight === 'passed' &&
    stage === 'passed' &&
    observe === 'skipped' &&
    recover === 'skipped'
  const noObservationEarlyFailure =
    apply === 'skipped' &&
    preflight === 'passed' &&
    (stage === 'blocked' || stage === 'failed' || stage === 'unknown') &&
    observe === 'skipped' &&
    recover === 'skipped'
  const zeroMutationFailure = noObservationApplyFailure || noObservationEarlyFailure
  const zeroMutationLabel = noObservationApplyFailure
    ? 'no-observation apply'
    : 'zero-mutation lifecycle'

  if (zeroMutationFailure) {
    if (totals.applied > 0 || totals.reverted > 0) {
      throw new CheckRunInvariantError(`${zeroMutationLabel} cannot report mutation outcomes`)
    }
    if (totals.notAttempted !== selected) {
      throw new CheckRunInvariantError(
        `${zeroMutationLabel} requires structurally not-attempted results`,
      )
    }
    if (
      operations.some(
        (operation) =>
          operation.outcome !== 'blocked' &&
          operation.outcome !== 'failed' &&
          operation.outcome !== 'unknown',
      )
    ) {
      throw new CheckRunInvariantError(
        `${zeroMutationLabel} requires blocked, failed, or unknown results`,
      )
    }
  }

  if (totals.reverted > 0) {
    if (apply === 'skipped' || recover === 'skipped' || !recoveryRecorded) {
      throw new CheckRunInvariantError('reverted results require a real recovery branch')
    }
  }

  if (apply === 'passed' && observe === 'passed') {
    if (recover === 'skipped') {
      const cleanupUnknown =
        recoveryRecorded && !state.recovery.executed && state.recovery.status === 'unknown'
      const expectedResults = cleanupUnknown
        ? totals.unknown === selected && totals.applied === 0
        : totals.applied + totals.skipped === selected && totals.unknown === 0
      if (
        !expectedResults ||
        totals.blocked > 0 ||
        totals.notAttempted > 0 ||
        totals.failed > 0 ||
        totals.reverted > 0
      ) {
        throw new CheckRunInvariantError('passed apply and observe require applied results')
      }
      if (!cleanupUnknown && state.recovery.status !== 'not-needed') {
        throw new CheckRunInvariantError('applied results cannot include a recovery branch')
      }
      return
    }
  }

  if (apply === 'skipped' && !zeroMutationFailure) {
    if (totals.applied > 0 || totals.reverted > 0 || totals.failed > 0) {
      throw new CheckRunInvariantError('skipped apply cannot report mutation outcomes')
    }
    if (totals.notAttempted !== selected) {
      throw new CheckRunInvariantError('skipped apply requires not-attempted results')
    }
    if (
      preflight === 'blocked' &&
      (totals.blocked !== selected || totals.notAttempted !== selected)
    ) {
      throw new CheckRunInvariantError(
        'blocked preflight requires blocked and not-attempted results',
      )
    }
    const noMutationCause = [preflight, stage].find(
      (status) => status !== 'passed' && status !== 'skipped',
    )
    if (noMutationCause === 'blocked' && totals.blocked !== selected) {
      throw new CheckRunInvariantError('blocked no-mutation phase requires blocked results')
    }
    if (noMutationCause === 'unknown' && totals.unknown !== selected) {
      throw new CheckRunInvariantError('unknown no-mutation phase requires unknown results')
    }
  }

  if (totals.applied > 0 && (recover === 'skipped' || !recoveryRecorded)) {
    throw new CheckRunInvariantError('applied results require passed apply and observe')
  }

  const completedRecoveredConflict =
    state.recovery.status === 'completed' &&
    totals.reverted > 0 &&
    operations.some((operation) => operation.outcome === 'blocked') &&
    operations
      .filter((operation) => operation.outcome === 'blocked')
      .every(
        (operation) =>
          operation.notAttempted &&
          operation.blocked &&
          operation.reason !== undefined &&
          ['SOURCE_CHANGED', 'STAGED_SOURCE_CHANGED', 'BACKUP_SOURCE_CHANGED'].includes(
            operation.reason,
          ),
      ) &&
    targets
      .filter((target) => target.outcome === 'blocked')
      .every((target) => target.notAttempted && target.blocked)

  if (totals.blocked > 0 && !blockedPhase && !zeroMutationFailure && !completedRecoveredConflict) {
    throw new CheckRunInvariantError('blocked results require a blocked mutation phase')
  }
  if (totals.failed > 0 && !failedPhase && state.recovery.status !== 'partial') {
    throw new CheckRunInvariantError('failed results require a failed lifecycle branch')
  }
  if (
    totals.unknown > 0 &&
    !unknownPhase &&
    totals.blocked === 0 &&
    state.recovery.status !== 'partial' &&
    state.recovery.status !== 'unknown'
  ) {
    throw new CheckRunInvariantError('unknown results require an unknown lifecycle branch')
  }

  if (recover === 'skipped') {
    if (
      state.recovery.executed ||
      (!retainedCleanupUnknown && state.recovery.status !== 'not-needed')
    ) {
      throw new CheckRunInvariantError('skipped recovery cannot retain recovery evidence')
    }
  } else if (!(recoveryRecorded && state.recovery.executed)) {
    throw new CheckRunInvariantError('recovery phase requires recorded recovery evidence')
  }

  if (state.recovery.status === 'completed' && recover !== 'passed') {
    throw new CheckRunInvariantError('completed recovery requires a passed recovery phase')
  }
  if (state.recovery.status === 'partial' && recover !== 'failed') {
    throw new CheckRunInvariantError('partial recovery requires a failed recovery phase')
  }
  if (
    state.recovery.status === 'partial' &&
    !operations.some(
      (operation) =>
        operation.outcome === 'reverted' ||
        operation.outcome === 'failed' ||
        operation.outcome === 'unknown',
    )
  ) {
    throw new CheckRunInvariantError(
      'partial recovery requires a reverted, failed, or unknown result',
    )
  }
  if (state.recovery.status === 'unknown' && recover !== 'unknown' && !retainedCleanupUnknown) {
    throw new CheckRunInvariantError('unknown recovery requires an unknown recovery phase')
  }
  if (state.recovery.status === 'completed') {
    if (totals.applied > 0 || targets.some((target) => target.outcome === 'applied')) {
      throw new CheckRunInvariantError('completed recovery cannot retain applied results')
    }
    if (
      (totals.blocked > 0 && !completedRecoveredConflict) ||
      totals.skipped > 0 ||
      totals.unknown > 0 ||
      operations.some(
        (operation) =>
          operation.notAttempted &&
          operation.outcome !== 'failed' &&
          !(completedRecoveredConflict && operation.outcome === 'blocked'),
      ) ||
      targets.some(
        (target) =>
          (target.outcome === 'blocked' && !completedRecoveredConflict) ||
          target.outcome === 'not-attempted' ||
          target.outcome === 'unknown' ||
          (target.notAttempted &&
            target.outcome !== 'failed' &&
            !(completedRecoveredConflict && target.outcome === 'blocked')),
      )
    ) {
      throw new CheckRunInvariantError('completed recovery cannot retain forbidden results')
    }
  }
  if (observe === 'unknown' && totals.unknown === 0) {
    throw new CheckRunInvariantError('unknown observation requires unknown results')
  }
  if (observe === 'failed' && totals.failed + totals.unknown === 0) {
    throw new CheckRunInvariantError('failed observation requires failed or unknown results')
  }
}

function deriveOperationTotals(
  operations: readonly CheckRunOperationResult[],
): CheckRunResultTotals {
  const totals = emptyResults()
  for (const operation of operations) {
    if (operation.outcome === 'applied') totals.applied += 1
    if (operation.outcome === 'skipped') totals.skipped += 1
    if (operation.outcome === 'failed') totals.failed += 1
    if (operation.outcome === 'reverted') totals.reverted += 1
    if (operation.blocked) totals.blocked += 1
    if (operation.notAttempted) totals.notAttempted += 1
    if (operation.unknown) totals.unknown += 1
  }
  return totals
}

function deriveTargetTotals(targets: readonly CheckRunTargetResult[]): CheckRunResultTotals {
  const totals = emptyResults()
  for (const targetResult of targets) {
    if (targetResult.outcome === 'applied') totals.applied += 1
    if (targetResult.outcome === 'skipped') totals.skipped += 1
    if (targetResult.outcome === 'mixed') totals.mixed += 1
    if (targetResult.outcome === 'failed') totals.failed += 1
    if (targetResult.outcome === 'reverted') totals.reverted += 1
    if (targetResult.blocked) totals.blocked += 1
    if (targetResult.notAttempted) totals.notAttempted += 1
    if (targetResult.unknown) totals.unknown += 1
  }
  return totals
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function copyDiagnostics(
  diagnostics: readonly CheckRunDiagnostic[],
): readonly CheckRunDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    assertSafeText('diagnostic code', diagnostic.code)
    if (!/^[A-Z][A-Z0-9_]*$/.test(diagnostic.code)) {
      throw new CheckRunInvariantError('invalid diagnostic code')
    }
    if (diagnostic.path !== undefined) assertRelativePath(diagnostic.path)
    if (diagnostic.detail !== undefined) assertSafeText('diagnostic detail', diagnostic.detail)
    return { ...diagnostic }
  })
}

function copyRecovery(
  event: Extract<CheckRunEvent, { type: 'recovery-recorded' }>,
): CheckRunRecovery {
  assertBoolean('executed recovery receipt', event.executed)
  assertRecoveryStatus(event.status)
  if (event.status === 'not-needed') {
    throw new CheckRunInvariantError('active recovery cannot be recorded as not-needed')
  }
  if (event.journalId !== undefined) assertSafeIdentifier('journal identifier', event.journalId)
  const restoredPaths = copyPaths(event.restoredPaths)
  const unrecoveredPaths = copyPaths(event.unrecoveredPaths)
  assertUnique(restoredPaths, 'restored paths')
  assertUnique(unrecoveredPaths, 'unrecovered paths')
  if (restoredPaths.some((path) => unrecoveredPaths.includes(path))) {
    throw new CheckRunInvariantError('recovery paths cannot be both restored and unrecovered')
  }
  const externalEffects = event.externalEffects?.map((effect) => {
    assertSafeText('external effect', effect)
    return effect
  })
  if (!event.executed) {
    if (event.status !== 'unknown') {
      throw new CheckRunInvariantError('retained cleanup evidence must be unknown')
    }
    if (restoredPaths.length > 0 || unrecoveredPaths.length > 0) {
      throw new CheckRunInvariantError('retained cleanup evidence cannot claim recovery paths')
    }
  }
  return {
    executed: event.executed,
    status: event.status,
    ...(event.journalId === undefined ? {} : { journalId: event.journalId }),
    restoredPaths,
    unrecoveredPaths,
    ...(externalEffects === undefined ? {} : { externalEffects }),
  }
}

function emptyCounts(): CheckRunCounts {
  return {
    packages: 0,
    declared: 0,
    eligible: 0,
    unresolved: 0,
    updates: 0,
    operations: 0,
    targets: 0,
  }
}

type MutableResultTotals = {
  -readonly [Key in keyof CheckRunResultTotals]: CheckRunResultTotals[Key]
}

function emptyResults(): MutableResultTotals {
  return {
    applied: 0,
    skipped: 0,
    mixed: 0,
    blocked: 0,
    notAttempted: 0,
    failed: 0,
    reverted: 0,
    unknown: 0,
  }
}

function emptyRunResults(): CheckRunResults {
  return {
    operations: [],
    targets: [],
    totals: emptyResults(),
    targetTotals: emptyResults(),
  }
}

function finalStatus(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'run-completed' }>,
): CheckRunFinalStatus {
  let status: CheckRunFinalStatus = event.status ?? 'passed'
  for (const phase of state.phases) {
    if (phase.status === 'blocked' || phase.status === 'failed' || phase.status === 'unknown') {
      status = worseStatus(status, phase.status)
    }
    if (
      phase.status === 'skipped' &&
      (phase.name === 'discover' || phase.name === 'resolve' || phase.name === 'review')
    ) {
      status = worseStatus(status, 'unknown')
    }
  }
  if (state.results.totals.blocked > 0) status = worseStatus(status, 'blocked')
  if (state.results.totals.failed > 0) status = worseStatus(status, 'failed')
  if (state.results.totals.unknown > 0) status = worseStatus(status, 'unknown')
  if (
    state.write &&
    state.results.operations.some(
      (operation) => operation.notAttempted && operation.outcome !== 'skipped',
    )
  ) {
    status = worseStatus(status, 'blocked')
  }
  if (state.results.totals.reverted > 0) status = worseStatus(status, 'failed')
  if (state.recovery.status === 'partial') status = worseStatus(status, 'failed')
  if (state.recovery.status === 'unknown') status = worseStatus(status, 'unknown')
  if (event.exitCode === 2 && status === 'passed') status = 'failed'
  return status
}

function worseStatus(left: CheckRunFinalStatus, right: CheckRunFinalStatus): CheckRunFinalStatus {
  return BAD_STATUS_RANK[left] >= BAD_STATUS_RANK[right] ? left : right
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
    throw new CheckRunInvariantError('invalid terminal phase status')
  }
}

function assertPhaseName(phase: CheckRunPhaseName): void {
  if (!PHASE_NAME_SET.has(phase)) throw new CheckRunInvariantError('invalid phase name')
}

function assertFinalStatus(status: CheckRunFinalStatus): void {
  if (status !== 'passed' && status !== 'blocked' && status !== 'failed' && status !== 'unknown') {
    throw new CheckRunInvariantError('invalid final status')
  }
}

function assertRecoveryStatus(status: CheckRunRecoveryStatus): void {
  if (!RECOVERY_STATUSES.has(status)) {
    throw new CheckRunInvariantError('invalid recovery status')
  }
}

function assertOutcome(outcome: CheckRunOperationOutcome): void {
  if (!OPERATION_OUTCOMES.has(outcome)) {
    throw new CheckRunInvariantError('invalid operation outcome')
  }
}

function assertTargetOutcome(outcome: CheckRunTargetOutcome): void {
  if (!TARGET_OUTCOMES.has(outcome)) {
    throw new CheckRunInvariantError('invalid physical target outcome')
  }
}

function assertBoolean(name: string, value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new CheckRunInvariantError(`${name} must be boolean`)
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CheckRunInvariantError(`${name} count must be a non-negative safe integer`)
  }
}

function assertDuration(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new CheckRunInvariantError('elapsed milliseconds must be a non-negative finite number')
  }
}

function assertNotReduced(name: string, previous: number, next: number): void {
  if (next < previous) throw new CheckRunInvariantError(`${name} count cannot decrease`)
}

function assertOpen(state: CheckRunSnapshot): void {
  if (
    state.exitCode !== null ||
    (phaseStatus(state.phases, 'complete') !== 'pending' &&
      phaseStatus(state.phases, 'complete') !== 'active')
  ) {
    throw new CheckRunInvariantError('run is finalized')
  }
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new CheckRunInvariantError(`${name} must be unique`)
  }
}

function assertSafeIdentifier(name: string, value: string): void {
  if (value.length === 0) throw new CheckRunInvariantError(`${name} cannot be empty`)
  assertSafeText(name, value)
}

function assertSafeText(name: string, value: string): void {
  if (/\p{Cc}|\p{Cf}/u.test(value)) {
    throw new CheckRunInvariantError(`${name} contains terminal control characters`)
  }
}

function copyPaths(paths: readonly string[]): readonly string[] {
  return paths.map((path) => {
    assertRelativePath(path)
    return path
  })
}

function assertRelativePath(path: string): void {
  assertSafeText('path', path)
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
  throw new CheckRunInvariantError('terminal event payload differs')
}

function terminalEventId(event: CheckRunEvent): string | undefined {
  if (event.type === 'packages-discovered') return 'packages-discovered'
  if (event.type === 'repository-inspection-completed') return 'repository-inspection-completed'
  if (event.type === 'resolution-completed') return 'resolution-completed'
  if (event.type === 'selection-completed') return 'selection-completed'
  if (event.type === 'stage-completed') return 'stage-completed'
  if (event.type === 'apply-completed') return 'apply-completed'
  if (event.type === 'phase-completed') return event.eventId ?? `phase-completed:${event.phase}`
  if (event.type === 'results-recorded') return 'results-recorded'
  if (event.type === 'recovery-recorded') return 'recovery-recorded'
  if (event.type === 'run-completed') return event.eventId
  return undefined
}

function assertEventId(eventId: string): void {
  assertSafeIdentifier('terminal event identifier', eventId)
}

function hasTerminalEvent(state: CheckRunSnapshot, id: string): boolean {
  return state.terminalEvents.some((entry) => entry.id === id)
}

function acceptedTerminal(
  state: CheckRunSnapshot,
  event: Exclude<CheckRunEvent, { type: 'repository-inspection-started' | 'diagnostics-recorded' }>,
  updates: Partial<Omit<CheckRunSnapshot, 'sequence' | 'terminalEvents'>>,
): CheckRunSnapshot {
  const id = terminalEventId(event)
  if (!id) throw new CheckRunInvariantError('terminal event requires an identifier')
  assertEventId(id)
  return nextSnapshot(state, updates, [
    ...state.terminalEvents,
    { id, signature: JSON.stringify(event) },
  ])
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
