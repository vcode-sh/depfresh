import { describe, expect, it } from 'vitest'
import { type CheckRunSnapshot, createCheckRunState, reduceCheckRun } from './run-model'

function selectedState(): CheckRunSnapshot {
  let state = createCheckRunState({ mode: 'major', write: true })
  state = reduceCheckRun(state, { type: 'packages-discovered', packages: 66, declared: 616 })
  state = reduceCheckRun(state, { type: 'resolution-completed', eligible: 612, updates: 76 })
  return reduceCheckRun(state, {
    type: 'selection-completed',
    operations: 76,
    targets: 14,
    changes: [
      {
        id: 'package.json:dependencies:vitest',
        name: 'vitest',
        owner: 'package.json',
        current: '^3.0.0',
        target: '^4.0.0',
        diff: 'major',
      },
    ],
    selectedTargets: [{ path: 'package.json', operationIds: ['package.json:dependencies:vitest'] }],
  })
}

describe('check run model', () => {
  it('reconciles lifecycle counts through selection', () => {
    const state = selectedState()

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

  it('rejects a backward phase transition', () => {
    const state = selectedState()

    expect(() =>
      reduceCheckRun(state, { type: 'phase-completed', phase: 'resolve', status: 'passed' }),
    ).toThrow('cannot complete resolve from passed')
    expect(() =>
      reduceCheckRun(state, { type: 'phase-completed', phase: 'stage', status: 'passed' }),
    ).toThrow('cannot complete stage from pending')
  })

  it('returns frozen snapshots without retaining caller arrays', () => {
    const changes = [
      {
        id: 'package.json:dependencies:vitest',
        name: 'vitest',
        owner: 'package.json',
        current: '^3.0.0',
        target: '^4.0.0',
        diff: 'major' as const,
      },
    ]
    const selectedTargets = [
      { path: 'package.json', operationIds: ['package.json:dependencies:vitest'] },
    ]
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
    expect(Object.isFrozen(next.changes)).toBe(true)
    expect(Object.isFrozen(next.changes[0]!)).toBe(true)
    expect(Object.isFrozen(next.targets[0]!.operationIds)).toBe(true)
    expect(next.changes[0]!.name).toBe('vitest')
    expect(next.targets[0]!.operationIds).toEqual(['package.json:dependencies:vitest'])
  })

  it('rejects count regressions and impossible reconciliation', () => {
    let state = createCheckRunState({ mode: 'major', write: false })
    state = reduceCheckRun(state, { type: 'packages-discovered', packages: 2, declared: 3 })

    expect(() =>
      reduceCheckRun(state, { type: 'resolution-completed', eligible: 4, updates: 1 }),
    ).toThrow('eligible count cannot exceed declared count')
    expect(() =>
      reduceCheckRun(state, { type: 'packages-discovered', packages: 1, declared: 3 }),
    ).toThrow('packages count cannot decrease')
  })

  it('accepts a byte-equivalent terminal event exactly once', () => {
    let state = selectedState()
    const completed = {
      type: 'phase-completed' as const,
      eventId: 'preflight:passed',
      phase: 'preflight' as const,
      status: 'passed' as const,
    }
    state = reduceCheckRun(state, completed)
    const duplicate = reduceCheckRun(state, completed)

    expect(duplicate).toBe(state)
    expect(() => reduceCheckRun(state, { ...completed, status: 'blocked' as const })).toThrow(
      'terminal event preflight:passed payload differs',
    )
  })

  it('keeps unknown separate from failed and follows recovery before observation', () => {
    let state = selectedState()
    state = reduceCheckRun(state, {
      type: 'phase-completed',
      eventId: 'preflight:passed',
      phase: 'preflight',
      status: 'passed',
    })
    state = reduceCheckRun(state, {
      type: 'phase-completed',
      eventId: 'stage:passed',
      phase: 'stage',
      status: 'passed',
    })
    state = reduceCheckRun(state, {
      type: 'phase-completed',
      eventId: 'apply:unknown',
      phase: 'apply',
      status: 'unknown',
    })
    state = reduceCheckRun(state, {
      type: 'recovery-recorded',
      status: 'unknown',
      journalId: 'run-123',
      restoredPaths: [],
      unrecoveredPaths: ['package.json'],
    })
    state = reduceCheckRun(state, {
      type: 'phase-completed',
      eventId: 'recover:unknown',
      phase: 'recover',
      status: 'unknown',
    })
    state = reduceCheckRun(state, {
      type: 'phase-completed',
      eventId: 'observe:unknown',
      phase: 'observe',
      status: 'unknown',
    })
    state = reduceCheckRun(state, {
      type: 'results-recorded',
      totals: { applied: 0, blocked: 0, notAttempted: 0, failed: 0, reverted: 0, unknown: 76 },
    })
    state = reduceCheckRun(state, {
      type: 'run-completed',
      eventId: 'complete:unknown',
      elapsedMs: 42,
      exitCode: 2,
    })

    expect(state.phases.find((phase) => phase.name === 'apply')?.status).toBe('unknown')
    expect(state.phases.find((phase) => phase.name === 'recover')?.status).toBe('unknown')
    expect(state.results).toEqual({
      applied: 0,
      blocked: 0,
      notAttempted: 0,
      failed: 0,
      reverted: 0,
      unknown: 76,
    })
    expect(state.recovery).toEqual({
      status: 'unknown',
      journalId: 'run-123',
      restoredPaths: [],
      unrecoveredPaths: ['package.json'],
    })
    expect(state.elapsedMs).toBe(42)
    expect(state.exitCode).toBe(2)
  })
})
