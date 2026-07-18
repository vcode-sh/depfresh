import { describe, expect, it } from 'vitest'
import {
  type CheckRunChange,
  type CheckRunEvent,
  type CheckRunOperationResult,
  type CheckRunSnapshot,
  type CheckRunTarget,
  type CheckRunTargetResult,
  createCheckRunState,
  reduceCheckRun,
} from './run-model'

const change = {
  id: 'package.json:dependencies:vitest',
  name: 'vitest',
  owner: 'package.json',
  current: '^3.0.0',
  target: '^4.0.0',
  diff: 'major' as const,
}
const target = { path: 'package.json', operationIds: [change.id] }

const appliedOperation = {
  operationId: change.id,
  outcome: 'applied' as const,
  blocked: false,
  notAttempted: false,
  unknown: false,
}
const appliedTarget = {
  path: target.path,
  operationIds: target.operationIds,
  outcome: 'applied' as const,
  blocked: false,
  notAttempted: false,
  unknown: false,
}

function physicalTarget(
  outcome: CheckRunTargetResult['outcome'],
  overrides: Partial<CheckRunTargetResult> = {},
): CheckRunTargetResult {
  return {
    path: target.path,
    operationIds: target.operationIds,
    outcome,
    blocked: outcome === 'blocked',
    notAttempted: outcome === 'blocked' || outcome === 'not-attempted',
    unknown: outcome === 'unknown',
    ...overrides,
  }
}

function inventory(
  operations: number,
  targetCount: number,
): { changes: CheckRunChange[]; selectedTargets: CheckRunTarget[] } {
  const changes = Array.from({ length: operations }, (_, index) => ({
    ...change,
    id: `package-${index % targetCount}.json:dependencies:dependency-${index}`,
    name: `dependency-${index}`,
    owner: `package-${index % targetCount}.json`,
  }))
  const selectedTargets = Array.from({ length: targetCount }, (_, index) => ({
    path: `package-${index}.json`,
    operationIds: changes
      .filter((item) => item.owner === `package-${index}.json`)
      .map((item) => item.id),
  }))
  return { changes, selectedTargets }
}

function selectedState(write = true): CheckRunSnapshot {
  let state = createCheckRunState({ mode: 'major', write })
  state = reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 1 })
  state = reduceCheckRun(state, {
    type: 'resolution-completed',
    eligible: 1,
    unresolved: 0,
    updates: 1,
  })
  return reduceCheckRun(state, {
    type: 'selection-completed',
    operations: 1,
    targets: 1,
    changes: [change],
    selectedTargets: [target],
  })
}

function selectedInventoryState(operationCount: number, targetCount: number): CheckRunSnapshot {
  const selected = inventory(operationCount, targetCount)
  let state = createCheckRunState({ mode: 'major', write: true })
  state = reduceCheckRun(state, {
    type: 'packages-discovered',
    packages: targetCount,
    declared: operationCount,
  })
  state = reduceCheckRun(state, {
    type: 'resolution-completed',
    eligible: operationCount,
    unresolved: 0,
    updates: operationCount,
  })
  return reduceCheckRun(state, {
    type: 'selection-completed',
    operations: operationCount,
    targets: targetCount,
    ...selected,
  })
}

function operationResult(
  operationId: string,
  outcome: CheckRunOperationResult['outcome'],
): CheckRunOperationResult {
  return {
    operationId,
    outcome,
    blocked: outcome === 'blocked',
    notAttempted: outcome === 'blocked' || outcome === 'not-attempted',
    unknown: outcome === 'unknown',
  }
}

function targetResult(
  selected: CheckRunTarget,
  outcome: CheckRunTargetResult['outcome'],
): CheckRunTargetResult {
  return {
    path: selected.path,
    operationIds: selected.operationIds,
    outcome,
    blocked: outcome === 'blocked',
    notAttempted: outcome === 'blocked' || outcome === 'not-attempted',
    unknown: outcome === 'unknown',
  }
}

function completePhase(
  state: CheckRunSnapshot,
  phase: Extract<CheckRunEvent, { type: 'phase-completed' }>['phase'],
  status: Extract<CheckRunEvent, { type: 'phase-completed' }>['status'] = 'passed',
): CheckRunSnapshot {
  return reduceCheckRun(state, {
    type: 'phase-completed',
    eventId: `${phase}:${status}`,
    phase,
    status,
  })
}

function results(
  state: CheckRunSnapshot,
  operations: readonly CheckRunOperationResult[] = [appliedOperation],
  targets: readonly CheckRunTargetResult[] = [appliedTarget],
): CheckRunSnapshot {
  return reduceCheckRun(state, { type: 'results-recorded', operations, targets })
}

function finishApply(state = selectedState()): CheckRunSnapshot {
  let next = completePhase(state, 'preflight')
  next = completePhase(next, 'stage')
  next = completePhase(next, 'apply')
  return completePhase(next, 'observe')
}

type RecoveryRecordedEvent = Extract<CheckRunEvent, { type: 'recovery-recorded' }>
type PhaseCompletedEvent = Extract<CheckRunEvent, { type: 'phase-completed' }>

interface RecoveryCompatibilityCase {
  readonly name: string
  readonly applyStatus: PhaseCompletedEvent['status']
  readonly recoveryStatus: PhaseCompletedEvent['status']
  readonly observeStatus: PhaseCompletedEvent['status']
  readonly recovery: Omit<RecoveryRecordedEvent, 'type'>
  readonly outcomes: readonly CheckRunOperationResult['outcome'][]
  readonly expectedError?: string
}

const recoveryCompatibilityCases: readonly RecoveryCompatibilityCase[] = [
  {
    name: 'completed recovery accepts reverted and semantic failed outcomes with restored lockfile',
    applyStatus: 'failed',
    recoveryStatus: 'passed',
    observeStatus: 'passed',
    recovery: {
      status: 'completed',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['reverted', 'failed'],
  },
  {
    name: 'completed recovery rejects a surviving applied outcome',
    applyStatus: 'failed',
    recoveryStatus: 'passed',
    observeStatus: 'passed',
    recovery: {
      status: 'completed',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['reverted', 'applied'],
    expectedError: 'completed recovery cannot retain applied results',
  },
  {
    name: 'completed recovery rejects the internal skipped analogue',
    applyStatus: 'failed',
    recoveryStatus: 'passed',
    observeStatus: 'passed',
    recovery: {
      status: 'completed',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['not-attempted'],
    expectedError: 'completed recovery cannot retain forbidden results',
  },
  {
    name: 'completed recovery rejects the internal conflicted analogue',
    applyStatus: 'blocked',
    recoveryStatus: 'passed',
    observeStatus: 'passed',
    recovery: {
      status: 'completed',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['blocked'],
    expectedError: 'completed recovery cannot retain forbidden results',
  },
  {
    name: 'completed recovery rejects unknown outcomes',
    applyStatus: 'unknown',
    recoveryStatus: 'passed',
    observeStatus: 'passed',
    recovery: {
      status: 'completed',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['unknown'],
    expectedError: 'completed recovery cannot retain forbidden results',
  },
  {
    name: 'partial recovery accepts semantic failure without an unrecovered manifest path',
    applyStatus: 'failed',
    recoveryStatus: 'failed',
    observeStatus: 'failed',
    recovery: {
      status: 'partial',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['reverted', 'failed'],
  },
  {
    name: 'partial recovery accepts reverted-only outcomes',
    applyStatus: 'failed',
    recoveryStatus: 'failed',
    observeStatus: 'passed',
    recovery: {
      status: 'partial',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['reverted'],
  },
  {
    name: 'partial recovery rejects an unknown recovery phase',
    applyStatus: 'failed',
    recoveryStatus: 'unknown',
    observeStatus: 'passed',
    recovery: {
      status: 'partial',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    },
    outcomes: ['reverted'],
    expectedError: 'partial recovery requires a failed recovery phase',
  },
  {
    name: 'unknown recovery accepts restored lockfile and external-effect-only uncertainty',
    applyStatus: 'failed',
    recoveryStatus: 'unknown',
    observeStatus: 'passed',
    recovery: {
      status: 'unknown',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
      externalEffects: ['package-manager-cache'],
    },
    outcomes: ['reverted'],
  },
  {
    name: 'unknown recovery accepts an unrecovered transaction lockfile outside selected targets',
    applyStatus: 'unknown',
    recoveryStatus: 'unknown',
    observeStatus: 'unknown',
    recovery: {
      status: 'unknown',
      restoredPaths: [],
      unrecoveredPaths: ['package-lock.json'],
    },
    outcomes: ['unknown'],
  },
]

function applyRecoveryCompatibilityCase(fixture: RecoveryCompatibilityCase): CheckRunSnapshot {
  let state = completePhase(
    selectedInventoryState(fixture.outcomes.length, fixture.outcomes.length),
    'preflight',
  )
  state = completePhase(state, 'stage')
  state = completePhase(state, 'apply', fixture.applyStatus)
  state = reduceCheckRun(state, { type: 'recovery-recorded', ...fixture.recovery })
  state = completePhase(state, 'recover', fixture.recoveryStatus)
  state = completePhase(state, 'observe', fixture.observeStatus)
  return results(
    state,
    state.targets.map((selected, index) =>
      operationResult(selected.operationIds[0]!, fixture.outcomes[index]!),
    ),
    state.targets.map((selected, index) => targetResult(selected, fixture.outcomes[index]!)),
  )
}

describe('check run model', () => {
  it('reconciles complete lifecycle inventories and resolution counts', () => {
    const selected = inventory(76, 14)
    let state = createCheckRunState({ mode: 'major', write: true })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 66, declared: 616 })
    state = reduceCheckRun(state, {
      type: 'resolution-completed',
      eligible: 612,
      unresolved: 0,
      updates: 76,
    })
    state = reduceCheckRun(state, {
      type: 'selection-completed',
      operations: 76,
      targets: 14,
      ...selected,
    })

    expect(state.counts).toEqual({
      packages: 66,
      declared: 616,
      eligible: 612,
      unresolved: 0,
      updates: 76,
      operations: 76,
      targets: 14,
    })
    expect(state.changes).toHaveLength(76)
    expect(state.targets).toHaveLength(14)
  })

  it('requires complete operation and physical-target inventories at selection', () => {
    let state = createCheckRunState({ mode: 'major', write: true })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 1 })
    state = reduceCheckRun(state, {
      type: 'resolution-completed',
      eligible: 1,
      unresolved: 0,
      updates: 1,
    })

    expect(() =>
      reduceCheckRun(state, {
        type: 'selection-completed',
        operations: 1,
        targets: 1,
      } as CheckRunEvent),
    ).toThrow('complete selection inventories are required')
    expect(() =>
      reduceCheckRun(state, {
        type: 'selection-completed',
        operations: 1,
        targets: 1,
        changes: [change],
        selectedTargets: [],
      }),
    ).toThrow('target inventory must reconcile')
  })

  it('reconciles resolution errors without collapsing unresolved into eligible', () => {
    let state = createCheckRunState({ mode: 'major', write: false })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 3 })
    state = reduceCheckRun(state, {
      type: 'resolution-completed',
      eligible: 3,
      unresolved: 2,
      updates: 1,
      status: 'failed',
    })

    expect(state.counts).toMatchObject({ declared: 3, eligible: 3, unresolved: 2 })
    expect(state.phases.find((phase) => phase.name === 'resolve')?.status).toBe('failed')
    expect(() =>
      reduceCheckRun(createCheckRunState({ mode: 'major', write: false }), {
        type: 'resolution-completed',
        eligible: 1,
        unresolved: 0,
        updates: 0,
      }),
    ).toThrow('cannot complete resolve')

    let mismatched = createCheckRunState({ mode: 'major', write: false })
    mismatched = reduceCheckRun(mismatched, {
      type: 'packages-discovered',
      packages: 1,
      declared: 3,
    })
    expect(() =>
      reduceCheckRun(mismatched, {
        type: 'resolution-completed',
        eligible: 3,
        unresolved: 2,
        updates: 2,
      }),
    ).toThrow('updates and unresolved counts cannot exceed eligible')
  })

  it('derives honest operation totals from one coherent outcome per selected operation', () => {
    let state = completePhase(selectedState(), 'preflight', 'blocked')
    state = results(
      state,
      [
        {
          operationId: change.id,
          outcome: 'blocked',
          blocked: true,
          notAttempted: true,
          unknown: true,
        },
      ],
      [
        {
          path: target.path,
          operationIds: target.operationIds,
          outcome: 'blocked',
          blocked: true,
          notAttempted: true,
          unknown: true,
        },
      ],
    )

    expect(state.results.totals).toEqual({
      applied: 0,
      blocked: 1,
      notAttempted: 1,
      failed: 0,
      reverted: 0,
      unknown: 1,
    })
    expect(state.results.operations).toHaveLength(1)
    expect(state.results.targets).toHaveLength(1)
    expect(state.results.targetTotals).toEqual({
      applied: 0,
      blocked: 1,
      notAttempted: 1,
      failed: 0,
      reverted: 0,
      unknown: 1,
    })
  })

  it('rejects physical-target receipt dimensions that do not reconcile to owned operations', () => {
    const state = completePhase(selectedState(), 'preflight', 'blocked')
    expect(() =>
      results(
        state,
        [
          {
            operationId: change.id,
            outcome: 'blocked',
            blocked: true,
            notAttempted: true,
            unknown: true,
          },
        ],
        [
          {
            path: target.path,
            operationIds: target.operationIds,
            outcome: 'blocked',
            blocked: true,
            notAttempted: true,
            unknown: false,
          },
        ],
      ),
    ).toThrow('physical target receipt dimensions differ from operations')
  })

  it('rejects passed mutation phases with non-applied result truth', () => {
    const state = finishApply()
    expect(() =>
      results(
        state,
        [
          {
            operationId: change.id,
            outcome: 'unknown',
            blocked: false,
            notAttempted: false,
            unknown: true,
          },
        ],
        [
          {
            path: target.path,
            operationIds: target.operationIds,
            outcome: 'unknown',
            blocked: false,
            notAttempted: false,
            unknown: true,
          },
        ],
      ),
    ).toThrow('passed apply and observe require applied results')
  })

  it('requires blocked preflight truth to reconcile to every selected operation and target', () => {
    const state = completePhase(selectedState(), 'preflight', 'blocked')
    expect(() =>
      results(
        state,
        [
          {
            operationId: change.id,
            outcome: 'not-attempted',
            blocked: false,
            notAttempted: true,
            unknown: false,
          },
        ],
        [
          {
            path: target.path,
            operationIds: target.operationIds,
            outcome: 'not-attempted',
            blocked: false,
            notAttempted: true,
            unknown: false,
          },
        ],
      ),
    ).toThrow('blocked preflight requires blocked and not-attempted results')
  })

  it('requires reverted results to follow completed recovery and observation', () => {
    const state = finishApply()
    const operation = {
      operationId: change.id,
      outcome: 'reverted' as const,
      blocked: false,
      notAttempted: false,
      unknown: false,
    }
    const physicalTarget = {
      path: target.path,
      operationIds: target.operationIds,
      outcome: 'reverted' as const,
      blocked: false,
      notAttempted: false,
      unknown: false,
    }
    expect(() => results(state, [operation], [physicalTarget])).toThrow(
      'reverted results require a real recovery branch',
    )
  })

  it('accepts reverted results only on a real completed recovery branch', () => {
    let state = completePhase(selectedState(), 'preflight')
    state = completePhase(state, 'stage')
    state = completePhase(state, 'apply', 'failed')
    state = reduceCheckRun(state, {
      type: 'recovery-recorded',
      status: 'completed',
      journalId: 'run-reverted',
      restoredPaths: [target.path],
      unrecoveredPaths: [],
    })
    state = completePhase(state, 'recover')
    state = completePhase(state, 'observe')
    state = results(
      state,
      [
        {
          operationId: change.id,
          outcome: 'reverted',
          blocked: false,
          notAttempted: false,
          unknown: false,
        },
      ],
      [physicalTarget('reverted')],
    )

    expect(state.results.totals.reverted).toBe(1)
    expect(state.recovery.status).toBe('completed')
  })

  it('accepts a known failed result on a matching failed recovery branch', () => {
    let state = completePhase(selectedState(), 'preflight')
    state = completePhase(state, 'stage')
    state = completePhase(state, 'apply', 'failed')
    state = reduceCheckRun(state, {
      type: 'recovery-recorded',
      status: 'partial',
      journalId: 'run-failed',
      restoredPaths: [],
      unrecoveredPaths: [target.path],
    })
    state = completePhase(state, 'recover', 'failed')
    state = completePhase(state, 'observe', 'failed')
    state = results(
      state,
      [
        {
          operationId: change.id,
          outcome: 'failed',
          blocked: false,
          notAttempted: false,
          unknown: false,
        },
      ],
      [physicalTarget('failed')],
    )

    expect(state.results.totals.failed).toBe(1)
    expect(state.recovery.status).toBe('partial')
  })

  it.each(recoveryCompatibilityCases)('$name', (fixture) => {
    if (fixture.expectedError) {
      expect(() => applyRecoveryCompatibilityCase(fixture)).toThrow(fixture.expectedError)
      return
    }

    const state = applyRecoveryCompatibilityCase(fixture)
    expect(state.recovery).toMatchObject(fixture.recovery)
    expect(state.results.operations.map((result) => result.outcome)).toEqual(fixture.outcomes)
    expect(state.results.targets.map((result) => result.outcome)).toEqual(fixture.outcomes)
  })

  it('accepts partial recovery with applied and reverted operations aggregated as reverted', () => {
    let state = completePhase(selectedInventoryState(2, 1), 'preflight')
    state = completePhase(state, 'stage')
    state = completePhase(state, 'apply', 'failed')
    state = reduceCheckRun(state, {
      type: 'recovery-recorded',
      status: 'partial',
      restoredPaths: ['package-lock.json'],
      unrecoveredPaths: [],
    })
    state = completePhase(state, 'recover', 'failed')
    state = completePhase(state, 'observe', 'passed')
    const selected = state.targets[0]!
    state = results(
      state,
      [
        operationResult(selected.operationIds[0]!, 'applied'),
        operationResult(selected.operationIds[1]!, 'reverted'),
      ],
      [targetResult(selected, 'reverted')],
    )

    expect(state.results.totals).toMatchObject({ applied: 1, reverted: 1 })
    expect(state.results.targetTotals).toMatchObject({ applied: 0, reverted: 1 })
  })

  it.each([
    { restoredPaths: ['/package-lock.json'], unrecoveredPaths: [] },
    { restoredPaths: [], unrecoveredPaths: ['../package-lock.json'] },
  ])(
    'rejects non-relative recovery transaction paths: $restoredPaths $unrecoveredPaths',
    (paths) => {
      let state = completePhase(selectedState(), 'preflight')
      state = completePhase(state, 'stage')
      state = completePhase(state, 'apply', 'failed')

      expect(() =>
        reduceCheckRun(state, {
          type: 'recovery-recorded',
          status: 'unknown',
          ...paths,
        }),
      ).toThrow('path must be repository-relative')
    },
  )

  it('rejects unknown results without an unknown or blocked lifecycle cause', () => {
    let state = completePhase(selectedState(), 'preflight')
    state = completePhase(state, 'stage')
    state = completePhase(state, 'apply', 'failed')
    state = reduceCheckRun(state, {
      type: 'recovery-recorded',
      status: 'completed',
      restoredPaths: [],
      unrecoveredPaths: [],
    })
    state = completePhase(state, 'recover')
    state = completePhase(state, 'observe')

    expect(() =>
      results(
        state,
        [
          {
            operationId: change.id,
            outcome: 'unknown',
            blocked: false,
            notAttempted: false,
            unknown: true,
          },
        ],
        [physicalTarget('unknown')],
      ),
    ).toThrow('unknown results require an unknown lifecycle branch')
  })

  it('requires unknown no-mutation phases to retain unknown result receipts', () => {
    const state = completePhase(selectedState(), 'preflight', 'unknown')
    expect(() =>
      results(
        state,
        [
          {
            operationId: change.id,
            outcome: 'not-attempted',
            blocked: false,
            notAttempted: true,
            unknown: false,
          },
        ],
        [physicalTarget('not-attempted')],
      ),
    ).toThrow('unknown no-mutation phase requires unknown results')
  })

  it('requires every entered recovery branch to record matching evidence', () => {
    let state = completePhase(selectedState(), 'preflight')
    state = completePhase(state, 'stage')
    state = completePhase(state, 'apply', 'failed')
    state = completePhase(state, 'recover')
    state = completePhase(state, 'observe')

    expect(() =>
      results(
        state,
        [
          {
            operationId: change.id,
            outcome: 'not-attempted',
            blocked: false,
            notAttempted: true,
            unknown: false,
          },
        ],
        [physicalTarget('not-attempted')],
      ),
    ).toThrow('recovery phase requires recorded recovery evidence')
  })

  it('rejects missing, duplicate, foreign, and all-zero write operation outcomes', () => {
    const state = completePhase(selectedState(), 'preflight', 'blocked')
    expect(() => results(state, [], [])).toThrow('operation results must reconcile')
    expect(() =>
      results(state, [appliedOperation, appliedOperation], [physicalTarget('applied')]),
    ).toThrow('operation result identifiers must be unique')
    expect(() =>
      results(
        state,
        [{ ...appliedOperation, operationId: 'foreign' }],
        [physicalTarget('applied')],
      ),
    ).toThrow('operation result is not selected')
  })

  it('forbids read-only applied outcomes and applied plus unknown claims', () => {
    let readOnly = selectedState(false)
    expect(() => results(readOnly)).toThrow('read-only runs cannot report applied results')

    const write = finishApply()
    expect(() => results(write, [{ ...appliedOperation, unknown: true }], [appliedTarget])).toThrow(
      'applied operation cannot also be unknown',
    )

    readOnly = results(
      readOnly,
      [
        {
          operationId: change.id,
          outcome: 'not-attempted',
          blocked: false,
          notAttempted: true,
          unknown: false,
        },
      ],
      [physicalTarget('not-attempted')],
    )
    expect(readOnly.results.totals.notAttempted).toBe(1)
  })

  it('rejects applied results when mutation never reached apply', () => {
    const blocked = completePhase(selectedState(), 'preflight', 'blocked')
    expect(() => results(blocked)).toThrow('skipped apply cannot report mutation outcomes')
  })

  it('accepts overlapping safety receipts only when their facts are coherent', () => {
    const blocked = completePhase(selectedState(), 'preflight', 'blocked')
    expect(() =>
      results(
        blocked,
        [
          {
            operationId: change.id,
            outcome: 'blocked',
            blocked: true,
            notAttempted: false,
            unknown: true,
          },
        ],
        [physicalTarget('unknown', { blocked: true, notAttempted: false })],
      ),
    ).toThrow('blocked receipt requires not-attempted')
  })

  it('records one physical-file result per selected target and reconciles memberships', () => {
    const write = finishApply()
    expect(() => results(write, [appliedOperation], [])).toThrow(
      'physical target results must reconcile',
    )
    expect(() =>
      results(write, [appliedOperation], [physicalTarget('applied', { path: 'other.json' })]),
    ).toThrow('physical target result is not selected')
    expect(() =>
      results(
        write,
        [appliedOperation],
        [physicalTarget('applied', { operationIds: ['foreign'] })],
      ),
    ).toThrow('physical target operation membership differs')
  })

  it('requires physical target truth to agree with every owned operation', () => {
    const state = finishApply()
    expect(() =>
      results(
        state,
        [
          {
            operationId: change.id,
            outcome: 'unknown',
            blocked: false,
            notAttempted: false,
            unknown: true,
          },
        ],
        [physicalTarget('failed', { unknown: true })],
      ),
    ).toThrow('failed physical target differs from operations')
  })

  it('prevents generic successful events from bypassing fact-bearing phases', () => {
    const initial = createCheckRunState({ mode: 'major', write: true })
    expect(() => completePhase(initial, 'discover')).toThrow(
      'discover success requires packages-discovered',
    )

    let resolving = reduceCheckRun(initial, {
      type: 'packages-discovered',
      packages: 1,
      declared: 1,
    })
    expect(() => completePhase(resolving, 'resolve')).toThrow(
      'resolve success requires resolution-completed',
    )

    resolving = reduceCheckRun(resolving, {
      type: 'resolution-completed',
      eligible: 1,
      unresolved: 0,
      updates: 1,
    })
    expect(() => completePhase(resolving, 'review')).toThrow(
      'review success requires selection-completed',
    )
  })

  it('allows generic non-success closure before fact-bearing events', () => {
    const discoverFailed = completePhase(
      createCheckRunState({ mode: 'major', write: true }),
      'discover',
      'failed',
    )
    expect(discoverFailed.phases.find((phase) => phase.name === 'complete')?.status).toBe('active')

    let resolveUnknown = createCheckRunState({ mode: 'major', write: true })
    resolveUnknown = reduceCheckRun(resolveUnknown, {
      type: 'packages-discovered',
      packages: 1,
      declared: 1,
    })
    resolveUnknown = completePhase(resolveUnknown, 'resolve', 'unknown')
    expect(resolveUnknown.phases.find((phase) => phase.name === 'complete')?.status).toBe('active')

    let skipped = completePhase(
      createCheckRunState({ mode: 'major', write: false }),
      'discover',
      'skipped',
    )
    skipped = results(skipped, [], [])
    skipped = reduceCheckRun(skipped, {
      type: 'run-completed',
      eventId: 'complete:skipped-discovery',
      elapsedMs: 1,
      exitCode: 2,
    })
    expect(skipped.phases.find((phase) => phase.name === 'complete')?.status).toBe('unknown')
  })

  it('branches through recovery and preserves physical recovery truth', () => {
    let state = completePhase(selectedState(), 'preflight')
    state = completePhase(state, 'stage')
    state = completePhase(state, 'apply', 'unknown')
    state = reduceCheckRun(state, {
      type: 'recovery-recorded',
      status: 'unknown',
      journalId: 'run-123',
      restoredPaths: [],
      unrecoveredPaths: ['package.json'],
    })
    state = completePhase(state, 'recover', 'unknown')
    state = completePhase(state, 'observe', 'unknown')
    state = results(
      state,
      [
        {
          operationId: change.id,
          outcome: 'unknown',
          blocked: false,
          notAttempted: false,
          unknown: true,
        },
      ],
      [physicalTarget('unknown')],
    )
    state = reduceCheckRun(state, {
      type: 'run-completed',
      eventId: 'complete:unknown',
      elapsedMs: 4,
      exitCode: 2,
    })

    expect(state.recovery.unrecoveredPaths).toEqual(['package.json'])
    expect(state.phases.find((phase) => phase.name === 'complete')?.status).toBe('unknown')
  })

  it('retains exact terminal idempotency and seals final snapshots', () => {
    let state = selectedState(false)
    state = results(
      state,
      [
        {
          operationId: change.id,
          outcome: 'not-attempted',
          blocked: false,
          notAttempted: true,
          unknown: false,
        },
      ],
      [physicalTarget('not-attempted')],
    )
    const completion = {
      type: 'run-completed' as const,
      eventId: 'complete:read-only',
      elapsedMs: 1,
      exitCode: 0 as const,
    }
    state = reduceCheckRun(state, completion)

    expect(reduceCheckRun(state, completion)).toBe(state)
    expect(() => reduceCheckRun(state, { ...completion, elapsedMs: 2 })).toThrow(
      'terminal event payload differs',
    )
    expect(() =>
      reduceCheckRun(state, {
        type: 'diagnostics-recorded',
        diagnostics: [{ code: 'LATE_EVENT' }],
      }),
    ).toThrow('run is finalized')
  })

  it('keeps fact-bearing terminal events idempotent and rejects backward transitions', () => {
    let state = createCheckRunState({ mode: 'major', write: true })
    const discovered = { type: 'packages-discovered' as const, packages: 1, declared: 1 }
    state = reduceCheckRun(state, discovered)
    expect(reduceCheckRun(state, discovered)).toBe(state)
    expect(() => reduceCheckRun(state, { ...discovered, declared: 0 })).toThrow(
      'terminal event payload differs',
    )
    expect(() => completePhase(state, 'stage', 'failed')).toThrow(
      'cannot complete stage from pending',
    )

    const resolved = {
      type: 'resolution-completed' as const,
      eligible: 1,
      unresolved: 0,
      updates: 1,
    }
    state = reduceCheckRun(state, resolved)
    expect(reduceCheckRun(state, resolved)).toBe(state)
  })

  it('freezes nested result and inventory arrays without retaining caller values', () => {
    const changes = [{ ...change }]
    const selectedTargets = [{ path: target.path, operationIds: [...target.operationIds] }]
    let selected = createCheckRunState({ mode: 'major', write: true })
    selected = reduceCheckRun(selected, {
      type: 'packages-discovered',
      packages: 1,
      declared: 1,
    })
    selected = reduceCheckRun(selected, {
      type: 'resolution-completed',
      eligible: 1,
      unresolved: 0,
      updates: 1,
    })
    selected = reduceCheckRun(selected, {
      type: 'selection-completed',
      operations: 1,
      targets: 1,
      changes,
      selectedTargets,
    })
    changes[0]!.name = 'mutated-selection'
    selectedTargets[0]!.operationIds.push('mutated-selection')

    const operations = [{ ...appliedOperation }]
    const targetResults = [{ ...appliedTarget, operationIds: [...appliedTarget.operationIds] }]
    let applied = completePhase(selected, 'preflight')
    applied = completePhase(applied, 'stage')
    applied = completePhase(applied, 'apply')
    applied = completePhase(applied, 'observe')
    const state = results(applied, operations, targetResults)
    operations[0]!.operationId = 'mutated'
    targetResults[0]!.operationIds.push('mutated')

    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.results.operations)).toBe(true)
    expect(Object.isFrozen(state.results.operations[0])).toBe(true)
    expect(Object.isFrozen(state.results.targets[0]?.operationIds)).toBe(true)
    expect(state.changes[0]?.name).toBe('vitest')
    expect(state.targets[0]?.operationIds).toEqual([change.id])
    expect(state.results.operations[0]?.operationId).toBe(change.id)
    expect(state.results.targets[0]?.operationIds).toEqual([change.id])
  })

  it('never reflects hostile raw event text in invariant messages', () => {
    const hostile = '\u001b[2Jforged\nline'
    let state = createCheckRunState({ mode: 'major', write: true })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 1 })
    state = reduceCheckRun(state, {
      type: 'resolution-completed',
      eligible: 1,
      unresolved: 0,
      updates: 1,
    })

    for (const invoke of [
      () =>
        reduceCheckRun(state, {
          type: 'selection-completed',
          operations: 1,
          targets: 1,
          changes: [{ ...change, id: hostile }],
          selectedTargets: [{ path: target.path, operationIds: [hostile] }],
        }),
      () =>
        reduceCheckRun(state, {
          type: 'selection-completed',
          operations: 1,
          targets: 1,
          changes: [{ ...change, owner: hostile }],
          selectedTargets: [{ path: hostile, operationIds: [change.id] }],
        }),
      () =>
        reduceCheckRun(state, {
          type: 'diagnostics-recorded',
          diagnostics: [{ code: hostile }],
        }),
      () =>
        reduceCheckRun(state, {
          type: 'phase-completed',
          eventId: 'safe-event-id',
          phase: hostile as Extract<CheckRunEvent, { type: 'phase-completed' }>['phase'],
          status: 'failed',
        }),
    ]) {
      try {
        invoke()
        throw new Error('expected invariant error')
      } catch (error) {
        expect(String(error)).not.toContain(hostile)
        expect(String(error)).not.toContain('\u001b')
        expect(String(error)).not.toContain('\n')
      }
    }

    let recovering = completePhase(selectedState(), 'preflight')
    recovering = completePhase(recovering, 'stage')
    recovering = completePhase(recovering, 'apply', 'unknown')
    expect(() =>
      reduceCheckRun(recovering, {
        type: 'recovery-recorded',
        status: hostile as Extract<CheckRunEvent, { type: 'recovery-recorded' }>['status'],
        restoredPaths: [],
        unrecoveredPaths: [],
      }),
    ).toThrow('invalid recovery status')
  })

  it('documents observer failure after finalization as controller-local', () => {
    let state = selectedState(false)
    state = results(
      state,
      [
        {
          operationId: change.id,
          outcome: 'not-attempted',
          blocked: false,
          notAttempted: true,
          unknown: false,
        },
      ],
      [physicalTarget('not-attempted')],
    )
    state = reduceCheckRun(state, {
      type: 'run-completed',
      eventId: 'complete:observer-contract',
      elapsedMs: 1,
      exitCode: 0,
    })

    expect(() =>
      reduceCheckRun(state, {
        type: 'diagnostics-recorded',
        diagnostics: [{ code: 'CHECK_RUN_OBSERVER_FAILED' }],
      }),
    ).toThrow('run is finalized')
  })
})
