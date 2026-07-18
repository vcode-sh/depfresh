import { describe, expect, it } from 'vitest'
import { createCheckRunController } from './run-controller'
import type { CheckRunEvent, CheckRunSnapshot } from './run-model'

function createClock(initial = 0): {
  readonly now: () => number
  set(value: number): void
} {
  let value = initial
  return {
    now: () => value,
    set: (next) => {
      value = next
    },
  }
}

function advanceToCompletion(
  emit: (event: CheckRunEvent) => void,
  completion: Extract<CheckRunEvent, { type: 'run-completed' }> = {
    type: 'run-completed',
    eventId: 'run-completed',
    elapsedMs: 999,
    exitCode: 0,
  },
): void {
  emit({ type: 'packages-discovered', packages: 0, declared: 0 })
  emit({ type: 'resolution-completed', eligible: 0, unresolved: 0, updates: 0 })
  emit({
    type: 'selection-completed',
    operations: 0,
    targets: 0,
    changes: [],
    selectedTargets: [],
  })
  emit({ type: 'results-recorded', operations: [], targets: [] })
  emit(completion)
}

describe('createCheckRunController', () => {
  it('delivers the current snapshot synchronously when subscribing', () => {
    const clock = createClock()
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    const snapshots: CheckRunSnapshot[] = []

    controller.subscribe((snapshot) => snapshots.push(snapshot))

    expect(snapshots).toEqual([controller.snapshot()])
    expect(snapshots[0]?.sequence).toBe(0)
  })

  it('delivers one stable accepted snapshot to observers in subscription order', () => {
    const clock = createClock()
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    const calls: Array<{ name: string; snapshot: CheckRunSnapshot }> = []
    controller.subscribe((snapshot) => calls.push({ name: 'first', snapshot }))
    controller.subscribe((snapshot) => calls.push({ name: 'second', snapshot }))
    calls.length = 0

    controller.emit({ type: 'packages-discovered', packages: 2, declared: 4 })

    expect(calls.map(({ name }) => name)).toEqual(['first', 'second'])
    expect(calls[0]?.snapshot).toBe(calls[1]?.snapshot)
    expect(calls[0]?.snapshot).toBe(controller.snapshot())
    expect(controller.snapshot().sequence).toBe(1)
  })

  it('makes unsubscribe idempotent and preserves remaining observer order', () => {
    const clock = createClock()
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    const calls: string[] = []
    const unsubscribe = controller.subscribe(() => calls.push('first'))
    controller.subscribe(() => calls.push('second'))
    calls.length = 0

    unsubscribe()
    unsubscribe()
    controller.emit({ type: 'packages-discovered', packages: 0, declared: 0 })

    expect(calls).toEqual(['second'])
  })

  it('tracks repeated subscriptions of the same observer independently', () => {
    const clock = createClock()
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    let deliveries = 0
    const observer = (): void => {
      deliveries += 1
    }
    const unsubscribeFirst = controller.subscribe(observer)
    const unsubscribeSecond = controller.subscribe(observer)
    deliveries = 0

    unsubscribeFirst()
    controller.emit({ type: 'packages-discovered', packages: 0, declared: 0 })

    expect(deliveries).toBe(1)
    unsubscribeSecond()
  })

  it('isolates observer failures and retains only a sanitized controller diagnostic', () => {
    const clock = createClock()
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    const delivered: CheckRunSnapshot[] = []
    controller.subscribe(() => {
      throw new Error('secret observer detail')
    })
    controller.subscribe((snapshot) => delivered.push(snapshot))
    delivered.length = 0

    controller.emit({ type: 'packages-discovered', packages: 0, declared: 0 })

    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.sequence).toBe(1)
    expect(controller.snapshot().diagnostics).toContainEqual({
      code: 'CHECK_RUN_OBSERVER_FAILED',
      detail: 'A check run observer threw',
    })
    expect(JSON.stringify(controller.snapshot())).not.toContain('secret observer detail')
    expect(Object.isFrozen(controller.snapshot())).toBe(true)
    expect(Object.isFrozen(controller.snapshot().diagnostics)).toBe(true)
  })

  it('retains observer failure diagnostics without reopening a finalized reducer snapshot', () => {
    const clock = createClock(10)
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    const delivered: CheckRunSnapshot[] = []
    controller.subscribe((snapshot) => {
      if (snapshot.exitCode !== null) throw new Error('final delivery failed')
    })
    controller.subscribe((snapshot) => delivered.push(snapshot))
    delivered.length = 0
    clock.set(42.5)

    advanceToCompletion(controller.emit)

    const deliveredFinal = delivered.at(-1)
    const retainedFinal = controller.snapshot()
    expect(deliveredFinal?.exitCode).toBe(0)
    expect(deliveredFinal?.diagnostics).toEqual([])
    expect(retainedFinal.exitCode).toBe(0)
    expect(retainedFinal.sequence).toBe(deliveredFinal?.sequence)
    expect(retainedFinal.diagnostics).toContainEqual({
      code: 'CHECK_RUN_OBSERVER_FAILED',
      detail: 'A check run observer threw',
    })
    expect(retainedFinal).not.toBe(deliveredFinal)
  })

  it('uses the exact injected monotonic elapsed time for finalization', () => {
    const clock = createClock(12.25)
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    clock.set(40)

    advanceToCompletion(controller.emit)

    expect(controller.snapshot().elapsedMs).toBe(27.75)
  })

  it('accepts an exact duplicate completion without delivering a second final snapshot', () => {
    const clock = createClock(5)
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    let finalDeliveries = 0
    controller.subscribe((snapshot) => {
      if (snapshot.exitCode !== null) finalDeliveries += 1
    })
    const completion = {
      type: 'run-completed',
      eventId: 'run-completed',
      elapsedMs: 123,
      exitCode: 0,
    } as const
    clock.set(8)
    advanceToCompletion(controller.emit, completion)
    const finalSnapshot = controller.snapshot()
    clock.set(100)

    controller.emit(completion)

    expect(controller.snapshot()).toBe(finalSnapshot)
    expect(finalDeliveries).toBe(1)
  })

  it('rejects a completion whose raw elapsed payload differs after clock normalization', () => {
    const clock = createClock(5)
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    let finalDeliveries = 0
    controller.subscribe((snapshot) => {
      if (snapshot.exitCode !== null) finalDeliveries += 1
    })
    const completion = {
      type: 'run-completed',
      eventId: 'run-completed',
      elapsedMs: 111,
      exitCode: 0,
    } as const
    clock.set(8)
    advanceToCompletion(controller.emit, completion)
    const finalSnapshot = controller.snapshot()

    expect(finalSnapshot.elapsedMs).toBe(3)
    expect(() => controller.emit({ ...completion, elapsedMs: 999 })).toThrow(
      'terminal event payload differs',
    )
    expect(controller.snapshot()).toBe(finalSnapshot)
    expect(finalDeliveries).toBe(1)
  })

  it('rejects a conflicting second completion and keeps the finalized snapshot stable', () => {
    const clock = createClock()
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    advanceToCompletion(controller.emit)
    const finalSnapshot = controller.snapshot()

    expect(() =>
      controller.emit({
        type: 'run-completed',
        eventId: 'run-completed',
        elapsedMs: 999,
        exitCode: 1,
      }),
    ).toThrow('terminal event payload differs')
    expect(controller.snapshot()).toBe(finalSnapshot)
  })

  it('rejects a non-monotonic clock before reducing or notifying observers', () => {
    const clock = createClock(10)
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    let deliveries = 0
    controller.subscribe(() => {
      deliveries += 1
    })
    const initial = controller.snapshot()
    clock.set(9)

    expect(() =>
      controller.emit({ type: 'packages-discovered', packages: 0, declared: 0 }),
    ).toThrow('clock moved backwards')
    expect(controller.snapshot()).toBe(initial)
    expect(deliveries).toBe(1)
  })

  it('retains the last observed clock reading when an event violates reducer invariants', () => {
    const clock = createClock(10)
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    clock.set(20)
    expect(() =>
      controller.emit({ type: 'phase-completed', phase: 'inspect', status: 'passed' }),
    ).toThrow('cannot complete inspect from pending')
    clock.set(15)

    expect(() =>
      controller.emit({ type: 'packages-discovered', packages: 0, declared: 0 }),
    ).toThrow('clock moved backwards')
    expect(controller.snapshot().sequence).toBe(0)
  })

  it('rejects a non-finite initial clock reading before creating state', () => {
    expect(() =>
      createCheckRunController({ mode: 'major', write: false, now: () => Number.NaN }),
    ).toThrow('clock must return a finite number')
  })

  it('does not swallow reducer invariant errors or publish rejected snapshots', () => {
    const clock = createClock()
    const controller = createCheckRunController({ mode: 'major', write: false, now: clock.now })
    const snapshots: CheckRunSnapshot[] = []
    controller.subscribe((snapshot) => snapshots.push(snapshot))
    const initial = controller.snapshot()

    expect(() =>
      controller.emit({ type: 'phase-completed', phase: 'inspect', status: 'passed' }),
    ).toThrow('cannot complete inspect from pending')
    expect(controller.snapshot()).toBe(initial)
    expect(snapshots).toEqual([initial])
  })
})
