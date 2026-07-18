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
  readonly blocked: number
  readonly notAttempted: number
  readonly failed: number
  readonly reverted: number
  readonly unknown: number
}

export type CheckRunOperationOutcome =
  | 'applied'
  | 'blocked'
  | 'not-attempted'
  | 'failed'
  | 'reverted'
  | 'unknown'

export interface CheckRunOperationResult {
  readonly operationId: string
  // The base outcome is exclusive; safety receipts are independent and may overlap.
  readonly outcome: CheckRunOperationOutcome
  readonly blocked: boolean
  readonly notAttempted: boolean
  readonly unknown: boolean
}

export interface CheckRunTargetResult {
  readonly path: string
  readonly operationIds: readonly string[]
  // Physical-file outcome and aggregate safety receipts remain separate dimensions.
  readonly outcome: CheckRunOperationOutcome
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
  'blocked',
  'not-attempted',
  'failed',
  'reverted',
  'unknown',
])

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
  const phases = completeAndAdvance(state.phases, event.phase, event.status, state.write)
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
  if (phaseStatus(state.phases, 'recover') !== 'active') {
    throw new CheckRunInvariantError('recovery can only be recorded during recover')
  }
  return acceptedTerminal(state, event, { recovery: copyRecovery(state, event) })
}

function completeRun(
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'run-completed' }>,
): CheckRunSnapshot {
  assertCount('elapsed milliseconds', event.elapsedMs)
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
  return changes.map((change) => {
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
  assertResultPhaseCoherence(state, totals, targets)
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
  if (result.outcome === 'reverted' || result.outcome === 'failed') {
    if (result.blocked || result.notAttempted || result.unknown) {
      throw new CheckRunInvariantError('known final operation cannot retain a safety receipt')
    }
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
  assertOutcome(result.outcome)
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
  if (targetResult.outcome === 'applied' || targetResult.outcome === 'reverted') {
    if (operations.some((operation) => operation.outcome !== targetResult.outcome)) {
      throw new CheckRunInvariantError('successful physical target outcome differs from operations')
    }
  }
  if (targetResult.outcome === 'failed') {
    if (operations.some((operation) => operation.outcome !== 'failed')) {
      throw new CheckRunInvariantError('failed physical target differs from operations')
    }
  }
  if (targetResult.outcome === 'blocked') {
    if (operations.some((operation) => !operation.blocked)) {
      throw new CheckRunInvariantError('blocked physical target differs from operations')
    }
  }
  if (targetResult.outcome === 'unknown') {
    if (operations.some((operation) => !operation.unknown)) {
      throw new CheckRunInvariantError('unknown physical target differs from operations')
    }
  }
  if (targetResult.outcome === 'not-attempted' && operations.some((item) => !item.notAttempted)) {
    throw new CheckRunInvariantError('not-attempted physical target differs from operations')
  }
}

function assertResultPhaseCoherence(
  state: CheckRunSnapshot,
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

  if (totals.reverted > 0) {
    const recoveryRecorded = hasTerminalEvent(state, 'recovery-recorded')
    if (
      apply === 'passed' ||
      apply === 'skipped' ||
      state.recovery.status !== 'completed' ||
      recover !== 'passed' ||
      observe !== 'passed' ||
      !recoveryRecorded
    ) {
      throw new CheckRunInvariantError('reverted results require completed recovery')
    }
    const restored = new Set(state.recovery.restoredPaths)
    if (targets.some((target) => target.outcome === 'reverted' && !restored.has(target.path))) {
      throw new CheckRunInvariantError('reverted target requires restored-path evidence')
    }
  }

  if (apply === 'passed' && observe === 'passed') {
    if (
      totals.applied !== selected ||
      totals.blocked > 0 ||
      totals.notAttempted > 0 ||
      totals.failed > 0 ||
      totals.reverted > 0 ||
      totals.unknown > 0
    ) {
      throw new CheckRunInvariantError('passed apply and observe require applied results')
    }
    if (recover !== 'skipped' || state.recovery.status !== 'not-needed') {
      throw new CheckRunInvariantError('applied results cannot include a recovery branch')
    }
    return
  }

  if (apply === 'skipped') {
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

  if (totals.applied > 0) {
    throw new CheckRunInvariantError('applied results require passed apply and observe')
  }

  if (totals.blocked > 0 && !blockedPhase) {
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

  const recoveryRecorded = hasTerminalEvent(state, 'recovery-recorded')
  if (recover === 'skipped') {
    if (state.recovery.status !== 'not-needed' || recoveryRecorded) {
      throw new CheckRunInvariantError('skipped recovery cannot retain recovery evidence')
    }
  } else if (!recoveryRecorded) {
    throw new CheckRunInvariantError('recovery phase requires recorded recovery evidence')
  }

  if (state.recovery.status === 'completed' && recover !== 'passed') {
    throw new CheckRunInvariantError('completed recovery requires a passed recovery phase')
  }
  if (state.recovery.status === 'partial' && recover !== 'failed' && recover !== 'unknown') {
    throw new CheckRunInvariantError('partial recovery requires failed or unknown phase truth')
  }
  if (state.recovery.status === 'unknown' && recover !== 'unknown') {
    throw new CheckRunInvariantError('unknown recovery requires an unknown recovery phase')
  }
  if (state.recovery.status === 'partial' && totals.failed + totals.unknown === 0) {
    throw new CheckRunInvariantError('partial recovery requires failed or unknown results')
  }
  if (state.recovery.status === 'unknown' && totals.unknown === 0) {
    throw new CheckRunInvariantError('unknown recovery requires unknown results')
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
  state: CheckRunSnapshot,
  event: Extract<CheckRunEvent, { type: 'recovery-recorded' }>,
): CheckRunRecovery {
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
  if (event.status === 'completed' && unrecoveredPaths.length > 0) {
    throw new CheckRunInvariantError('completed recovery cannot retain unrecovered paths')
  }
  if (state.targets.length > 0) {
    const selectedPaths = new Set(state.targets.map((target) => target.path))
    for (const path of [...restoredPaths, ...unrecoveredPaths]) {
      if (!selectedPaths.has(path)) {
        throw new CheckRunInvariantError(`recovery path is not a selected target: ${path}`)
      }
    }
  }
  const externalEffects = event.externalEffects?.map((effect) => {
    assertSafeText('external effect', effect)
    return effect
  })
  return {
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
  return { applied: 0, blocked: 0, notAttempted: 0, failed: 0, reverted: 0, unknown: 0 }
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
  if (state.write && state.results.totals.notAttempted > 0) {
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
