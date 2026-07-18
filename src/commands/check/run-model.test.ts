import { describe, expect, it } from 'vitest'
import {
  type CheckRunEvent,
  type CheckRunSnapshot,
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

function selectedState(write = true): CheckRunSnapshot {
  let state = createCheckRunState({ mode: 'major', write })
  state = reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 1 })
  state = reduceCheckRun(state, { type: 'resolution-completed', eligible: 1, updates: 1 })
  return reduceCheckRun(state, {
    type: 'selection-completed',
    operations: 1,
    targets: 1,
    changes: [change],
    selectedTargets: [target],
  })
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
  totals = {
    applied: 1,
    blocked: 0,
    notAttempted: 0,
    failed: 0,
    reverted: 0,
    unknown: 0,
  },
): CheckRunSnapshot {
  return reduceCheckRun(state, { type: 'results-recorded', totals })
}

describe('check run model', () => {
  it('reconciles lifecycle counts through selection', () => {
    let state = createCheckRunState({ mode: 'major', write: true })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 66, declared: 616 })
    state = reduceCheckRun(state, { type: 'resolution-completed', eligible: 612, updates: 76 })
    state = reduceCheckRun(state, { type: 'selection-completed', operations: 76, targets: 14 })

    expect(state.counts).toEqual({
      packages: 66,
      declared: 616,
      eligible: 612,
      updates: 76,
      operations: 76,
      targets: 14,
    })
    expect(state.phases.map((phase) => [phase.name, phase.status])).toEqual([
      ['discover', 'passed'],
      ['inspect', 'skipped'],
      ['resolve', 'passed'],
      ['review', 'passed'],
      ['preflight', 'active'],
      ['stage', 'pending'],
      ['apply', 'pending'],
      ['observe', 'pending'],
      ['recover', 'pending'],
      ['complete', 'pending'],
    ])
  })

  it('represents overlapping safety dimensions without treating them as exclusive', () => {
    let state = createCheckRunState({ mode: 'major', write: true })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 66, declared: 616 })
    state = reduceCheckRun(state, { type: 'resolution-completed', eligible: 612, updates: 76 })
    state = reduceCheckRun(state, { type: 'selection-completed', operations: 76, targets: 14 })
    state = completePhase(state, 'preflight', 'blocked')
    state = results(state, {
      applied: 0,
      blocked: 76,
      notAttempted: 76,
      failed: 0,
      reverted: 0,
      unknown: 76,
    })
    state = reduceCheckRun(state, {
      type: 'run-completed',
      eventId: 'complete:safety-block',
      elapsedMs: 42,
      exitCode: 2,
    })

    expect(state.results).toEqual({
      applied: 0,
      blocked: 76,
      notAttempted: 76,
      failed: 0,
      reverted: 0,
      unknown: 76,
    })
    expect(state.phases.find((phase) => phase.name === 'stage')?.status).toBe('skipped')
    expect(state.phases.find((phase) => phase.name === 'apply')?.status).toBe('skipped')
    expect(state.phases.find((phase) => phase.name === 'complete')?.status).toBe('unknown')
  })

  it('branches before and after mutation truthfully', () => {
    const preflight = completePhase(selectedState(), 'preflight', 'failed')
    expect(preflight.phases.find((phase) => phase.name === 'stage')?.status).toBe('skipped')
    expect(preflight.phases.find((phase) => phase.name === 'apply')?.status).toBe('skipped')
    expect(preflight.phases.find((phase) => phase.name === 'recover')?.status).toBe('skipped')
    expect(preflight.phases.find((phase) => phase.name === 'complete')?.status).toBe('active')

    let stage = completePhase(selectedState(), 'preflight')
    stage = completePhase(stage, 'stage', 'blocked')
    expect(stage.phases.find((phase) => phase.name === 'apply')?.status).toBe('skipped')
    expect(stage.phases.find((phase) => phase.name === 'recover')?.status).toBe('skipped')
    expect(stage.phases.find((phase) => phase.name === 'complete')?.status).toBe('active')

    let success = completePhase(selectedState(), 'preflight')
    success = completePhase(success, 'stage')
    success = completePhase(success, 'apply')
    expect(success.phases.find((phase) => phase.name === 'recover')?.status).toBe('skipped')
    expect(success.phases.find((phase) => phase.name === 'observe')?.status).toBe('active')

    let failure = completePhase(selectedState(), 'preflight')
    failure = completePhase(failure, 'stage')
    failure = completePhase(failure, 'apply', 'unknown')
    expect(failure.phases.find((phase) => phase.name === 'recover')?.status).toBe('active')
    failure = reduceCheckRun(failure, {
      type: 'recovery-recorded',
      status: 'partial',
      journalId: 'run-123',
      restoredPaths: [],
      unrecoveredPaths: ['package.json'],
    })
    failure = completePhase(failure, 'recover', 'unknown')
    expect(failure.phases.find((phase) => phase.name === 'observe')?.status).toBe('active')
  })

  it('preserves phase failure and nonzero exit in the final status', () => {
    let state = completePhase(selectedState(), 'preflight', 'failed')
    state = results(state, {
      applied: 0,
      blocked: 0,
      notAttempted: 1,
      failed: 0,
      reverted: 0,
      unknown: 0,
    })
    state = reduceCheckRun(state, {
      type: 'run-completed',
      eventId: 'complete:failed-preflight',
      elapsedMs: 5,
      exitCode: 2,
    })

    expect(state.phases.find((phase) => phase.name === 'preflight')?.status).toBe('failed')
    expect(state.phases.find((phase) => phase.name === 'complete')?.status).toBe('failed')
    expect(state.exitCode).toBe(2)
  })

  it('rejects events after finalization while retaining exact duplicate idempotency', () => {
    let state = selectedState(false)
    state = results(state, {
      applied: 0,
      blocked: 0,
      notAttempted: 1,
      failed: 0,
      reverted: 0,
      unknown: 0,
    })
    const completion = {
      type: 'run-completed' as const,
      eventId: 'complete:read-only',
      elapsedMs: 1,
      exitCode: 0 as const,
    }
    state = reduceCheckRun(state, completion)

    expect(reduceCheckRun(state, completion)).toBe(state)
    expect(() =>
      reduceCheckRun(state, {
        type: 'diagnostics-recorded',
        diagnostics: [{ code: 'LATE_EVENT' }],
      }),
    ).toThrow('run is finalized')
    expect(() => reduceCheckRun(state, { ...completion, elapsedMs: 2 })).toThrow(
      'terminal event complete:read-only payload differs',
    )
  })

  it('enforces phase legality for results, recovery, and diagnostics', () => {
    const state = selectedState()

    expect(() => results(state)).toThrow('results can only be recorded during complete')
    expect(() =>
      reduceCheckRun(state, {
        type: 'recovery-recorded',
        status: 'completed',
        restoredPaths: ['package.json'],
        unrecoveredPaths: [],
      }),
    ).toThrow('recovery can only be recorded during recover')

    const safe = reduceCheckRun(state, {
      type: 'diagnostics-recorded',
      diagnostics: [{ code: 'CHECK_RUN_OBSERVER_FAILED', detail: 'observer failed' }],
    })
    expect(safe.diagnostics).toEqual([
      { code: 'CHECK_RUN_OBSERVER_FAILED', detail: 'observer failed' },
    ])
    expect(() =>
      reduceCheckRun(state, {
        type: 'diagnostics-recorded',
        diagnostics: [{ code: 'HOSTILE', detail: '\u001b[2Jforged\nline' }],
      }),
    ).toThrow('terminal control characters')
  })

  it('makes every named completion event exactly idempotent', () => {
    let state = createCheckRunState({ mode: 'major', write: true })
    const discovered = { type: 'packages-discovered' as const, packages: 1, declared: 1 }
    state = reduceCheckRun(state, discovered)
    expect(reduceCheckRun(state, discovered)).toBe(state)
    expect(() => reduceCheckRun(state, { ...discovered, declared: 2 })).toThrow(
      'terminal event packages-discovered payload differs',
    )

    const inspected = {
      type: 'repository-inspection-completed' as const,
      status: 'passed' as const,
    }
    state = reduceCheckRun(state, inspected)
    expect(reduceCheckRun(state, inspected)).toBe(state)
    const resolved = { type: 'resolution-completed' as const, eligible: 1, updates: 1 }
    state = reduceCheckRun(state, resolved)
    expect(reduceCheckRun(state, resolved)).toBe(state)
    const selected = { type: 'selection-completed' as const, operations: 1, targets: 1 }
    state = reduceCheckRun(state, selected)
    expect(reduceCheckRun(state, selected)).toBe(state)
  })

  it('keeps blocked final status distinct from failed while enforcing exit contracts', () => {
    let blocked = completePhase(selectedState(), 'preflight', 'blocked')
    blocked = results(blocked, {
      applied: 0,
      blocked: 1,
      notAttempted: 1,
      failed: 0,
      reverted: 0,
      unknown: 0,
    })
    blocked = reduceCheckRun(blocked, {
      type: 'run-completed',
      eventId: 'complete:blocked',
      elapsedMs: 1,
      exitCode: 2,
    })
    expect(blocked.phases.find((phase) => phase.name === 'complete')?.status).toBe('blocked')

    let invalidStrict = selectedState(false)
    invalidStrict = results(invalidStrict)
    expect(() =>
      reduceCheckRun(invalidStrict, {
        type: 'run-completed',
        eventId: 'complete:invalid-strict',
        elapsedMs: 1,
        exitCode: 1,
        status: 'failed',
      }),
    ).toThrow('exit code 1 cannot finalize a failed result')
  })

  it('reconciles supplied inventories, identifiers, paths, and membership', () => {
    let state = createCheckRunState({ mode: 'major', write: true })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 2 })
    state = reduceCheckRun(state, { type: 'resolution-completed', eligible: 2, updates: 2 })
    const second = { ...change, id: 'package.json:devDependencies:vitest' }

    expect(() =>
      reduceCheckRun(state, {
        type: 'selection-completed',
        operations: 2,
        targets: 1,
        changes: [change, { ...second, id: change.id }],
        selectedTargets: [{ path: 'package.json', operationIds: [change.id, second.id] }],
      }),
    ).toThrow('change identifiers must be unique')
    expect(() =>
      reduceCheckRun(state, {
        type: 'selection-completed',
        operations: 2,
        targets: 1,
        changes: [change, second],
        selectedTargets: [{ path: 'package.json', operationIds: [change.id] }],
      }),
    ).toThrow('every selected operation must belong to exactly one target')
    expect(() =>
      reduceCheckRun(state, {
        type: 'selection-completed',
        operations: 2,
        targets: 1,
        changes: [change, second],
        selectedTargets: [{ path: '../package.json', operationIds: [change.id, second.id] }],
      }),
    ).toThrow('path must be repository-relative')
  })

  it('represents resolution failures and strict or post-write failures truthfully', () => {
    let resolution = createCheckRunState({ mode: 'major', write: false })
    resolution = reduceCheckRun(resolution, {
      type: 'packages-discovered',
      packages: 1,
      declared: 2,
    })
    resolution = reduceCheckRun(resolution, {
      type: 'resolution-completed',
      eligible: 1,
      updates: 1,
      status: 'failed',
    })
    expect(resolution.phases.find((phase) => phase.name === 'resolve')?.status).toBe('failed')
    expect(resolution.phases.find((phase) => phase.name === 'review')?.status).toBe('active')

    let strict = selectedState(false)
    strict = results(strict, {
      applied: 0,
      blocked: 0,
      notAttempted: 1,
      failed: 0,
      reverted: 0,
      unknown: 0,
    })
    strict = reduceCheckRun(strict, {
      type: 'run-completed',
      eventId: 'complete:strict',
      elapsedMs: 2,
      exitCode: 1,
    })
    expect(strict.phases.find((phase) => phase.name === 'complete')?.status).toBe('passed')

    let postWrite = completePhase(selectedState(), 'preflight')
    postWrite = completePhase(postWrite, 'stage')
    postWrite = completePhase(postWrite, 'apply')
    postWrite = completePhase(postWrite, 'observe')
    postWrite = results(postWrite)
    postWrite = reduceCheckRun(postWrite, {
      type: 'run-completed',
      eventId: 'complete:post-write-failure',
      elapsedMs: 3,
      exitCode: 2,
      status: 'failed',
    })
    expect(postWrite.phases.find((phase) => phase.name === 'complete')?.status).toBe('failed')
  })

  it('returns frozen snapshots without retaining caller arrays', () => {
    const changes = [{ ...change }]
    const selectedTargets = [{ path: target.path, operationIds: [...target.operationIds] }]
    let state = createCheckRunState({ mode: 'major', write: true })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 1 })
    state = reduceCheckRun(state, { type: 'resolution-completed', eligible: 1, updates: 1 })
    const next = reduceCheckRun(state, {
      type: 'selection-completed',
      operations: 1,
      targets: 1,
      changes,
      selectedTargets,
    })
    changes[0]!.name = 'mutated-by-caller'
    selectedTargets[0]!.operationIds.push('mutated-by-caller')

    expect(next).not.toBe(state)
    expect(Object.isFrozen(next)).toBe(true)
    expect(Object.isFrozen(next.changes[0]!)).toBe(true)
    expect(Object.isFrozen(next.targets[0]!.operationIds)).toBe(true)
    expect(next.changes[0]!.name).toBe('vitest')
    expect(next.targets[0]!.operationIds).toEqual([change.id])
  })

  it('rejects backward transitions and count regressions', () => {
    const state = selectedState()
    expect(() => completePhase(state, 'resolve')).toThrow('cannot complete resolve from passed')
    expect(() => completePhase(state, 'stage')).toThrow('cannot complete stage from pending')
    expect(() =>
      reduceCheckRun(state, { type: 'packages-discovered', packages: 0, declared: 1 }),
    ).toThrow('terminal event packages-discovered payload differs')
  })
})
