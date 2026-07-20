import { describe, expect, it } from 'vitest'
import { createRepositoryId } from '../../../repository/identity'
import { stripAnsi, visualLength } from '../../../utils/format'
import type { CheckRunController } from '../run-controller'
import type { CheckRunPhaseName, CheckRunPhaseStatus, CheckRunSnapshot } from '../run-model'
import type { VisualPlusCapabilities } from './capabilities'
import type { VisualPlusRunMetadata, VisualPlusSectionInput } from './input'
import { createVisualPlusRenderer, type VisualPlusScheduler } from './renderer'
import { createVisualPlusFixtureInput, createVisualPlusFixtureSnapshot } from './test-fixture'

const phaseNames = [
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

const run: VisualPlusRunMetadata = {
  detailLevel: 'full',
  display: { group: false, sort: 'diff-asc', timediff: false, nodecompat: false },
  repository: { name: 'fixture', relativePath: 'packages/fixture' },
  workspaceScope: 'workspace',
  packageManager: {
    status: 'observed',
    name: 'pnpm',
    version: '10.0.0',
    sources: ['package.json'],
  },
}

const startupRun: VisualPlusRunMetadata = {
  detailLevel: 'full',
  display: { group: false, sort: 'diff-asc', timediff: false, nodecompat: false },
  workspaceScope: 'unknown',
  packageManager: { status: 'unknown', sources: [] },
}

const compactRun: VisualPlusRunMetadata = {
  ...run,
  detailLevel: 'compact',
}

const capable: VisualPlusCapabilities = {
  interactive: true,
  color: false,
  unicode: false,
  motion: true,
  cursorControl: true,
  width: 80,
  layout: 'wide',
}

function statuses(
  values: Partial<Record<CheckRunPhaseName, CheckRunPhaseStatus>>,
): CheckRunSnapshot['phases'] {
  return phaseNames.map((name) => ({ name, status: values[name] ?? 'pending' }))
}

function emptyTotals() {
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

function snapshot(overrides: Partial<CheckRunSnapshot> = {}): CheckRunSnapshot {
  return {
    sequence: 0,
    mode: 'major',
    write: true,
    phases: statuses({ discover: 'active' }),
    counts: {
      packages: 0,
      declared: 0,
      eligible: 0,
      unresolved: 0,
      updates: 0,
      operations: 0,
      targets: 0,
    },
    changes: [],
    targets: [],
    diagnostics: [],
    results: { operations: [], targets: [], totals: emptyTotals(), targetTotals: emptyTotals() },
    recovery: { executed: false, status: 'not-needed', restoredPaths: [], unrecoveredPaths: [] },
    elapsedMs: null,
    exitCode: null,
    terminalEvents: [],
    ...overrides,
  }
}

function selectedSnapshot(overrides: Partial<CheckRunSnapshot> = {}): CheckRunSnapshot {
  return snapshot({
    sequence: 4,
    phases: statuses({
      discover: 'passed',
      inspect: 'passed',
      resolve: 'passed',
      review: 'passed',
      preflight: 'active',
    }),
    counts: {
      packages: 1,
      declared: 1,
      eligible: 1,
      unresolved: 0,
      updates: 1,
      operations: 1,
      targets: 1,
    },
    changes: [
      {
        id: 'op-1',
        name: 'alpha',
        owner: 'package.json',
        current: '^1.0.0',
        target: '^2.0.0',
        diff: 'major',
        insight: {
          dependencyId: createRepositoryId('dependency', 'alpha'),
          rawName: 'alpha',
          sourceFileId: createRepositoryId('source', 'package.json'),
          sourcePath: 'package.json',
          occurrencePath: ['dependencies', 'alpha'],
          owner: {
            id: createRepositoryId('package', 'package.json'),
            role: 'manifest',
            label: 'root',
            path: 'package.json',
            order: 0,
            physicalTarget: 'package.json',
          },
          catalog: { role: 'direct' },
          ageMs: null,
          compatibility: { status: 'unknown' },
        },
      },
    ],
    targets: [{ path: 'package.json', operationIds: ['op-1'] }],
    ...overrides,
  })
}

function finalSnapshot(): CheckRunSnapshot {
  const operations = [
    {
      operationId: 'op-1',
      outcome: 'applied' as const,
      blocked: false,
      notAttempted: false,
      unknown: false,
    },
  ]
  const targets = [
    {
      path: 'package.json',
      operationIds: ['op-1'],
      outcome: 'applied' as const,
      blocked: false,
      notAttempted: false,
      unknown: false,
    },
  ]
  return selectedSnapshot({
    sequence: 10,
    phases: statuses({
      discover: 'passed',
      inspect: 'passed',
      resolve: 'passed',
      review: 'passed',
      preflight: 'passed',
      stage: 'passed',
      apply: 'passed',
      observe: 'passed',
      recover: 'skipped',
      complete: 'passed',
    }),
    results: {
      operations,
      targets,
      totals: { ...emptyTotals(), applied: 1 },
      targetTotals: { ...emptyTotals(), applied: 1 },
    },
    elapsedMs: 120,
    exitCode: 0,
  })
}

function input(value: CheckRunSnapshot, caps = capable): VisualPlusSectionInput {
  return {
    snapshot: value,
    capabilities: caps,
    run,
    changes: value.changes.map((change, displayOrder) => ({
      operationId: change.id,
      source: change.insight!.occurrencePath[0] as 'dependencies',
      displayOrder,
      ownerGroup: {
        id: change.insight!.owner.id,
        label: change.insight!.owner.label,
        order: change.insight!.owner.order,
        physicalTarget: change.insight!.owner.physicalTarget,
      },
      ageMs: change.insight!.ageMs,
      compatibility: change.insight!.compatibility,
      ...(change.insight!.catalog.role === 'direct'
        ? {}
        : {
            catalog: {
              name: change.insight!.catalog.name,
              sourcePath: change.insight!.catalog.sourcePath,
            },
          }),
    })),
    ...(value.exitCode === null || !value.write
      ? {}
      : {
          writeReceipt: {
            canonical: {
              verdict: 'complete' as const,
              operations: {
                planned: 1,
                applied: 1,
                skipped: 0,
                conflicted: 0,
                reverted: 0,
                failed: 0,
                unknown: 0,
              },
              files: {
                planned: 1,
                applied: 1,
                skipped: 0,
                blocked: 0,
                conflicted: 0,
                reverted: 0,
                failed: 0,
                unknown: 0,
              },
              groups: [],
              noFilesChanged: false,
            },
            operationIds: ['op-1'],
            targets: [{ path: 'package.json', operationIds: ['op-1'] }],
            recovery: value.recovery,
          },
        }),
  }
}

function fakeController(initial: CheckRunSnapshot) {
  let current = initial
  let observer: ((value: CheckRunSnapshot) => void) | undefined
  let unsubscribeCount = 0
  const controller: CheckRunController = {
    emit: () => undefined,
    snapshot: () => current,
    subscribe(next) {
      observer = next
      next(current)
      return () => {
        unsubscribeCount += 1
        observer = undefined
      }
    },
  }
  return {
    controller,
    push(next: CheckRunSnapshot) {
      current = next
      observer?.(next)
    },
    unsubscribeCount: () => unsubscribeCount,
  }
}

function fakeScheduler() {
  const callbacks: Array<{ active: boolean; callback: () => void }> = []
  const delays: number[] = []
  const scheduler: VisualPlusScheduler = {
    schedule(callback, delayMs) {
      delays.push(delayMs)
      const entry = { active: true, callback }
      callbacks.push(entry)
      return () => {
        entry.active = false
      }
    },
  }
  return {
    scheduler,
    delays,
    pending: () => callbacks.filter((entry) => entry.active).length,
    flushNewest() {
      const entry = callbacks.at(-1)
      if (entry) entry.callback()
    },
    invokeAllAdversarially() {
      for (const entry of callbacks) entry.callback()
    },
  }
}

function harness(caps = capable) {
  let output = ''
  const errors: unknown[] = []
  const scheduled = fakeScheduler()
  const renderer = createVisualPlusRenderer({
    capabilities: caps,
    writer: { write: (chunk) => (output += chunk) },
    scheduler: scheduled.scheduler,
    onError: (error) => errors.push(error),
  })
  return {
    renderer,
    scheduled,
    errors,
    output: () => output,
    writeExternal: (chunk: string) => (output += chunk),
  }
}

describe('Visual+ live renderer', () => {
  it('starts without undiscovered repository or package-manager placeholders', () => {
    const source = fakeController(snapshot())
    const view = harness()

    view.renderer.start(source.controller, startupRun)

    expect(view.output()).toContain('Check - major - write\n')
    expect(view.output()).toContain('Lifecycle\n')
    expect(view.output()).not.toContain('Repository unknown')
    expect(view.output()).not.toContain('Package manager unknown')
  })

  it('writes one discovered context transition before review and freezes it', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, startupRun)

    view.renderer.setRunMetadata(run)
    const selected = selectedSnapshot()
    source.push(selected)
    view.renderer.writeReview(input(selected))

    const output = view.output()
    expect(output).toContain('Repository fixture - packages/fixture - workspace\n')
    expect(output).toContain('Package manager observed - pnpm 10.0.0 - package.json\n')
    expect(output.indexOf('Repository fixture')).toBeLessThan(output.indexOf('Repository topology'))
  })

  it('rejects a repeated context transition before review', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, startupRun)
    view.renderer.setRunMetadata(run)

    expect(() => view.renderer.setRunMetadata(run)).toThrow(/exactly once|context|metadata/i)
  })

  it('rejects review when discovered context is missing', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, startupRun)
    const selected = selectedSnapshot()
    source.push(selected)

    expect(() => view.renderer.writeReview(input(selected))).toThrow(/context|metadata/i)
  })

  it('rejects a late context transition after selection evidence arrives', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, startupRun)
    source.push(selectedSnapshot())

    expect(() => view.renderer.setRunMetadata(run)).toThrow(/late|context|metadata/i)
  })

  it('rejects discovered metadata that conflicts with immutable startup detail', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, startupRun)

    expect(() => view.renderer.setRunMetadata({ ...run, detailLevel: 'compact' })).toThrow(
      /detail|startup|metadata/i,
    )
  })

  it.each([
    ['group', true],
    ['sort', 'name-desc'],
    ['timediff', true],
    ['nodecompat', true],
  ] as const)(
    'rejects discovered metadata whose %s display option differs from startup',
    (key, value) => {
      const source = fakeController(snapshot())
      const view = harness()
      view.renderer.start(source.controller, startupRun)
      const metadata: VisualPlusRunMetadata = {
        ...run,
        display: { ...run.display, [key]: value },
      }

      expect(() => view.renderer.setRunMetadata(metadata)).toThrow(/display|startup|metadata/i)
    },
  )

  it('accepts discovered metadata whose complete display contract matches startup', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, startupRun)

    expect(() =>
      view.renderer.setRunMetadata({
        ...run,
        display: { ...startupRun.display },
      }),
    ).not.toThrow()
  })

  it('does not mutate matching startup or discovered display inputs', () => {
    const source = fakeController(snapshot())
    const view = harness()
    const startup = structuredClone(startupRun)
    const discovered = structuredClone(run)
    const startupBefore = structuredClone(startup)
    const discoveredBefore = structuredClone(discovered)

    view.renderer.start(source.controller, startup)
    view.renderer.setRunMetadata(discovered)

    expect(startup).toEqual(startupBefore)
    expect(discovered).toEqual(discoveredBefore)
    expect(Object.isFrozen(startup)).toBe(false)
    expect(Object.isFrozen(startup.display)).toBe(false)
    expect(Object.isFrozen(discovered)).toBe(false)
    expect(Object.isFrozen(discovered.display)).toBe(false)
  })

  it.each([40, 60, 80, 118, 175])(
    'renders the complete successful hybrid read-only journey at %i columns',
    (width) => {
      const caps: VisualPlusCapabilities = {
        ...capable,
        interactive: false,
        color: false,
        unicode: width !== 40,
        motion: false,
        cursorControl: false,
        width,
        layout: width === 40 ? 'plain' : width >= 100 ? 'wide' : 'medium',
      }
      const initial = snapshot({ write: false })
      const source = fakeController(initial)
      const view = harness(caps)
      view.renderer.start(source.controller, compactRun)
      view.renderer.setRunMetadata(compactRun)
      const selected = { ...createVisualPlusFixtureSnapshot(), write: false }
      source.push(selected)
      view.renderer.writeReview({
        ...createVisualPlusFixtureInput(caps),
        snapshot: selected,
        run: compactRun,
      })
      const final: CheckRunSnapshot = {
        ...selected,
        sequence: 10,
        phases: statuses({
          discover: 'passed',
          inspect: 'passed',
          resolve: 'passed',
          review: 'passed',
          preflight: 'skipped',
          stage: 'skipped',
          apply: 'skipped',
          observe: 'skipped',
          recover: 'skipped',
          complete: 'passed',
        }),
        elapsedMs: 20,
        exitCode: 0,
      }
      source.push(final)
      view.renderer.finalize({
        ...createVisualPlusFixtureInput(caps),
        snapshot: final,
        run: compactRun,
      })
      const lines = view.output().trimEnd().split('\n').map(stripAnsi)
      const output = lines.join('\n')

      expect(lines.length).toBeGreaterThan(80)
      expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
      expect(output).toContain('Breaking changes')
      expect(output).toContain('Major 3')
      expect(output).toContain('Minor 37')
      expect(output).toContain('Patch 36')
      expect(output).toContain('lab-editor')
      expect(output).toContain('root-catalog')
      expect(output).toContain('dependency')
      expect(output.replaceAll('\n', '')).toContain(
        `Review complete ${caps.unicode ? '·' : '-'} 76 updates across 14 files ${caps.unicode ? '·' : '-'} write not attempted`,
      )
      expect(output).not.toMatch(/Lifecycle|Update preview|audit preview|omitted|more updates/iu)
      expect(output).not.toMatch(
        /Operation ID|Owner ID|Dependency ID|operation-|dependency:|package:|source:/u,
      )
    },
  )

  it('owns one replaceable compact active-phase line and clears it on successful finalization', () => {
    const source = fakeController(snapshot({ write: false }))
    const view = harness()

    view.renderer.start(source.controller, compactRun)
    expect(view.output()).toBe('\r\u001B[2Kdiscover - [*] active\n')

    source.push(
      snapshot({
        write: false,
        sequence: 1,
        phases: statuses({ discover: 'passed', inspect: 'active' }),
      }),
    )
    view.scheduled.flushNewest()
    expect(view.output()).not.toContain('discover - [+] passed')
    expect(view.output().endsWith('\r\u001B[2Kinspect - [*] active\n')).toBe(true)

    const beforeSuspend = view.output().length
    view.renderer.suspend(() => view.writeExternal('durable callback\n'))
    expect(view.output().slice(beforeSuspend)).toBe(
      '\u001B[1A\r\u001B[2K\n\u001B[1Adurable callback\n\r\u001B[2Kinspect - [*] active\n',
    )

    view.renderer.setRunMetadata(compactRun)
    const selected = { ...createVisualPlusFixtureSnapshot(), write: false }
    source.push(selected)
    view.renderer.writeReview({
      ...createVisualPlusFixtureInput(capable),
      snapshot: selected,
      run: compactRun,
    })
    const final: CheckRunSnapshot = {
      ...selected,
      sequence: 10,
      phases: statuses({
        discover: 'passed',
        inspect: 'passed',
        resolve: 'passed',
        review: 'passed',
        preflight: 'skipped',
        stage: 'skipped',
        apply: 'skipped',
        observe: 'skipped',
        recover: 'skipped',
        complete: 'passed',
      }),
      elapsedMs: 20,
      exitCode: 0,
    }
    source.push(final)
    view.renderer.finalize({
      ...createVisualPlusFixtureInput(capable),
      snapshot: final,
      run: compactRun,
    })

    const output = stripAnsi(view.output())
    expect(output).not.toContain('Lifecycle')
    for (const phase of phaseNames) expect(output).not.toContain(`${phase} - [+] passed`)
    expect(output).not.toContain('complete - [+] passed')
    expect(output).toContain('Review complete - 76 updates across 14 files - write not attempted')
    expect(view.output()).not.toContain('\u001B[?25l')
  })

  it('emits no compact lifecycle history in constrained mode across every output boundary', () => {
    const constrained = {
      ...capable,
      interactive: false,
      color: false,
      unicode: false,
      motion: false,
      cursorControl: false,
      layout: 'plain' as const,
    }
    const source = fakeController(snapshot({ write: false }))
    const view = harness(constrained)

    view.renderer.start(source.controller, compactRun)
    source.push(
      snapshot({
        write: false,
        sequence: 1,
        phases: statuses({ discover: 'passed', inspect: 'active' }),
      }),
    )
    view.renderer.setRunMetadata(compactRun)
    view.renderer.suspend(() => undefined)
    expect(view.output()).toBe('')

    const selected = { ...createVisualPlusFixtureSnapshot(), write: false }
    source.push(selected)
    view.renderer.writeReview({
      ...createVisualPlusFixtureInput(constrained),
      snapshot: selected,
      run: compactRun,
    })
    const final: CheckRunSnapshot = {
      ...selected,
      sequence: 10,
      phases: statuses({
        discover: 'passed',
        inspect: 'passed',
        resolve: 'passed',
        review: 'passed',
        preflight: 'skipped',
        stage: 'skipped',
        apply: 'skipped',
        observe: 'skipped',
        recover: 'skipped',
        complete: 'passed',
      }),
      elapsedMs: 20,
      exitCode: 0,
    }
    source.push(final)
    view.renderer.finalize({
      ...createVisualPlusFixtureInput(constrained),
      snapshot: final,
      run: compactRun,
    })

    expect(view.output()).toContain('Breaking changes')
    expect(view.output()).not.toMatch(/Lifecycle|\bactive\b/u)
    for (const phase of phaseNames) {
      expect(view.output()).not.toMatch(new RegExp(`^${phase} - `, 'mu'))
    }
  })

  it('reconciles the full synchronous initial notification before writing any bytes', () => {
    const advertised = snapshot()
    const delivered = snapshot({ sequence: 1 })
    let unsubscribed = 0
    const controller: CheckRunController = {
      emit: () => undefined,
      snapshot: () => advertised,
      subscribe(observer) {
        observer(delivered)
        return () => {
          unsubscribed += 1
        }
      },
    }
    const view = harness()

    expect(() => view.renderer.start(controller, run)).toThrow(/initial notification/i)
    expect(view.output()).toBe('')
    expect(view.errors).toEqual([])
    expect(unsubscribed).toBe(1)
  })

  it('rejects a late synchronous initial selection before writing any bytes', () => {
    const advertised = snapshot()
    const delivered = selectedSnapshot()
    let unsubscribed = 0
    const controller: CheckRunController = {
      emit: () => undefined,
      snapshot: () => advertised,
      subscribe(observer) {
        observer(delivered)
        return () => {
          unsubscribed += 1
        }
      },
    }
    const view = harness()

    expect(() => view.renderer.start(controller, run)).toThrow(/initial notification|late/i)
    expect(view.output()).toBe('')
    expect(view.errors).toEqual([])
    expect(unsubscribed).toBe(1)
  })

  it('writes synchronous startup feedback and coalesces bursts into one 50 ms callback', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)

    expect(view.output()).toContain('Check - major - write\n')
    expect(view.output()).toContain('Lifecycle\n')
    expect(view.output()).toContain('[*] active')
    expect(view.scheduled.pending()).toBe(0)

    source.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    source.push(
      snapshot({
        sequence: 2,
        phases: statuses({ discover: 'passed', inspect: 'passed', resolve: 'active' }),
      }),
    )
    expect(view.scheduled.delays).toEqual([50])
    expect(view.scheduled.pending()).toBe(1)
    view.scheduled.flushNewest()
    expect(view.output()).toContain('discover - [+] passed\n')
    expect(view.output()).toContain('inspect - [+] passed\n')
    expect(view.output()).toContain('resolve - [*] active')
  })

  it('emits the exact owned-line protocol when replacing a one-line frame', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)

    expect(view.output().endsWith('Lifecycle\n\r\u001B[2Kdiscover - [*] active\n')).toBe(true)
    const before = view.output().length
    source.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    view.scheduled.flushNewest()

    expect(view.output().slice(before)).toBe(
      '\u001B[1A\r\u001B[2K\n\u001B[1Adiscover - [+] passed\n\r\u001B[2Kinspect - [*] active\n',
    )
    expect(view.output()).not.toContain('\u001B[?25h')
    expect(view.output()).not.toContain('\u001B[?25l')
  })

  it('clears the exact wrapped frame size when a narrow active phase shrinks', () => {
    const narrow = { ...capable, width: 8, layout: 'narrow' as const }
    const source = fakeController(snapshot({ phases: statuses({ preflight: 'active' }) }))
    const view = harness(narrow)
    view.renderer.start(source.controller, run)
    const before = view.output().length
    source.push(snapshot({ sequence: 1, phases: statuses({ apply: 'active' }) }))
    view.scheduled.flushNewest()
    const replacement = view.output().slice(before)

    expect(replacement).toBe(
      '\u001B[3A\r\u001B[2K\n\r\u001B[2K\n\r\u001B[2K\n\u001B[3A\r\u001B[2Kapply - \n\r\u001B[2K[*] acti\n\r\u001B[2Kve\n',
    )
  })

  it('grows a narrow frame and preserves exact outer suspension bytes', () => {
    const narrow = { ...capable, width: 10, layout: 'narrow' as const }
    const source = fakeController(snapshot({ phases: statuses({ apply: 'active' }) }))
    const view = harness(narrow)
    view.renderer.start(source.controller, run)
    const beforeGrowth = view.output().length
    source.push(snapshot({ sequence: 1, phases: statuses({ preflight: 'active' }) }))
    view.scheduled.flushNewest()
    const growth = view.output().slice(beforeGrowth)

    expect(growth).toBe(
      '\u001B[2A\r\u001B[2K\n\r\u001B[2K\n\u001B[2A\r\u001B[2Kpreflight \n\r\u001B[2K- [*] acti\n\r\u001B[2Kve\n',
    )

    const beforeSuspend = view.output().length
    view.renderer.suspend(() => {
      view.writeExternal('durable callback\n')
    })
    expect(view.output().slice(beforeSuspend)).toBe(
      '\u001B[3A\r\u001B[2K\n\r\u001B[2K\n\r\u001B[2K\n\u001B[3Adurable callback\n\r\u001B[2Kpreflight \n\r\u001B[2K- [*] acti\n\r\u001B[2Kve\n',
    )
  })

  it('uses append-only lifecycle rows and no timer or cursor bytes in plain mode', () => {
    const plain = { ...capable, motion: false, cursorControl: false, layout: 'plain' as const }
    const source = fakeController(snapshot())
    const view = harness(plain)
    view.renderer.start(source.controller, run)
    source.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )

    expect(view.scheduled.delays).toEqual([])
    expect(view.output()).not.toContain('\r')
    expect(view.output()).not.toContain('\u001B')
    expect(view.output().match(/discover/g)).toHaveLength(2)
    expect(view.output()).toContain('inspect - [*] active\n')
  })

  it('keeps SGR but omits every motion byte for capable reduced motion', () => {
    const reduced = { ...capable, color: true, motion: false, cursorControl: false }
    const source = fakeController(snapshot())
    const view = harness(reduced)
    view.renderer.start(source.controller, run)

    expect(view.output()).toContain('\u001B[')
    expect(view.output()).not.toContain('\r')
    expect(view.output()).not.toContain('\u001B[2K')
    expect(view.output()).not.toContain('\u001B[?25h')
    expect(view.output()).not.toContain('\u001B[?25l')
    expect(view.scheduled.delays).toEqual([])
  })

  it('writes review once, then complete, transaction, and receipt once after final validation', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    view.renderer.setRunMetadata(run)
    const selected = selectedSnapshot()
    source.push(selected)
    view.renderer.writeReview(input(selected))
    view.renderer.writeReview(input(selected))

    const final = finalSnapshot()
    source.push(final)
    const beforeFinalize = view.output().length
    view.renderer.finalize(input(final))
    view.renderer.finalize(input(final))

    expect(view.output().slice(beforeFinalize)).toBe(
      [
        '\u001B[1A\r\u001B[2K\n\u001B[1A',
        'preflight - [+] passed\n',
        'stage - [+] passed\n',
        'apply - [+] passed\n',
        'observe - [+] passed\n',
        'recover - [.] skipped\n',
        'complete - [+] passed\n',
        'Apply transaction\n',
        'Target package.json - 1 update - applied\n',
        'Operations - outcome applied - blocked false - not attempted false - unknown fal\n',
        'se - IDs op-1\n',
        'Complete - 1 update applied across 1 file\n',
        'Applied 1  Blocked 0  Not attempted 0  Failed 0  Unknown 0\n',
        'All 1 target files were observed at the requested values. Recovery was not neede\n',
        'd. 120ms.\n',
        'Exit 0\n',
      ].join(''),
    )

    expect(view.output().match(/Repository topology/g)).toHaveLength(1)
    expect(view.output().match(/Distribution/g)).toHaveLength(1)
    expect(view.output().match(/Risk focus/g)).toHaveLength(1)
    expect(view.output().match(/Owner impact/g)).toHaveLength(1)
    expect(view.output().match(/Shared dependencies/g)).toHaveLength(1)
    expect(view.output().match(/Complete change list/g)).toHaveLength(1)
    const reviewHeadings = [
      'Repository topology',
      'Distribution',
      'Risk focus',
      'Owner impact',
      'Shared dependencies',
      'Complete change list',
    ]
    expect(reviewHeadings.map((heading) => view.output().indexOf(heading))).toEqual(
      [...reviewHeadings].map((heading) => view.output().indexOf(heading)).sort((a, b) => a - b),
    )
    expect(view.output().match(/complete - \[\+\] passed/g)).toHaveLength(1)
    expect(view.output().match(/Apply transaction/g)).toHaveLength(1)
    expect(view.output().match(/Complete - 1 update applied across 1 file/g)).toHaveLength(1)
    expect(source.unsubscribeCount()).toBe(1)
  })

  it('renders the full map hierarchy before all 76 unchanged change rows', () => {
    const reviewCapabilities: VisualPlusCapabilities = {
      ...capable,
      interactive: false,
      motion: false,
      cursorControl: false,
      width: 118,
      layout: 'plain',
    }
    const initial = snapshot({
      counts: {
        packages: 66,
        declared: 616,
        eligible: 612,
        unresolved: 0,
        updates: 99,
        operations: 0,
        targets: 0,
      },
    })
    const source = fakeController(initial)
    const view = harness(reviewCapabilities)
    view.renderer.start(source.controller, run)
    view.renderer.setRunMetadata(run)
    const selected = createVisualPlusFixtureSnapshot()
    source.push(selected)
    view.renderer.writeReview({ ...createVisualPlusFixtureInput(reviewCapabilities), run })

    const output = view.output()
    const headings = [
      'Repository topology',
      'Distribution',
      'Risk focus',
      'Owner impact',
      'Shared dependencies',
      'Complete change list',
    ]
    const positions = headings.map((heading) => output.indexOf(heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(output.match(/Operation ID operation-\d+-\d+/gu)).toHaveLength(76)
  })

  it('classifies insight failures as contract errors before any review bytes', () => {
    const initial = snapshot({
      counts: {
        packages: 66,
        declared: 616,
        eligible: 612,
        unresolved: 0,
        updates: 99,
        operations: 0,
        targets: 0,
      },
    })
    const source = fakeController(initial)
    const view = harness()
    view.renderer.start(source.controller, run)
    view.renderer.setRunMetadata(run)
    const selected = structuredClone(createVisualPlusFixtureSnapshot())
    ;(selected.changes[0] as { diff: string }).diff = 'unknown'
    source.push(selected)
    const review = createVisualPlusFixtureInput(capable)

    expect(() => view.renderer.writeReview({ ...review, snapshot: selected, run })).toThrow(
      /Visual\+ insights/u,
    )
    expect(view.output()).not.toContain('Repository topology')
    expect(view.output()).not.toContain('Complete change list')
    expect(view.errors).toEqual([])
  })

  it('emits the exact zero-selection finalization transcript and leaves no live frame', () => {
    const initial = snapshot()
    const source = fakeController(initial)
    const view = harness()
    view.renderer.start(source.controller, run)
    view.renderer.setRunMetadata(run)
    const final = snapshot({
      sequence: 2,
      phases: statuses({
        discover: 'passed',
        inspect: 'skipped',
        resolve: 'skipped',
        review: 'skipped',
        preflight: 'skipped',
        stage: 'skipped',
        apply: 'skipped',
        observe: 'skipped',
        recover: 'skipped',
        complete: 'passed',
      }),
      elapsedMs: 5,
      exitCode: 0,
    })
    source.push(final)
    view.renderer.finalize({
      snapshot: final,
      capabilities: capable,
      run,
      changes: [],
    })

    expect(view.output()).toBe(
      [
        'Check - major - write\n',
        'Lifecycle\n',
        '\r\u001B[2Kdiscover - [*] active\n',
        '\u001B[1A\r\u001B[2K\n\u001B[1A',
        'Repository fixture - packages/fixture - workspace\n',
        'Package manager observed - pnpm 10.0.0 - package.json\n',
        '\r\u001B[2Kdiscover - [*] active\n',
        '\u001B[1A\r\u001B[2K\n\u001B[1A',
        'discover - [+] passed\n',
        'inspect - [.] skipped\n',
        'resolve - [.] skipped\n',
        'review - [.] skipped\n',
        'preflight - [.] skipped\n',
        'stage - [.] skipped\n',
        'apply - [.] skipped\n',
        'observe - [.] skipped\n',
        'recover - [.] skipped\n',
        'complete - [+] passed\n',
        'Complete - no selected updates\n',
        'Applied 0  Blocked 0  Not attempted 0  Failed 0  Unknown 0\n',
        'Exit 0\n',
      ].join(''),
    )
    const finalBytes = view.output()
    view.scheduled.invokeAllAdversarially()
    view.renderer.dispose()
    expect(view.output()).toBe(finalBytes)
  })

  it('requires canonical receipt evidence and a terminal complete phase before final bytes', () => {
    const missingReceiptSource = fakeController(snapshot())
    const missingReceiptView = harness()
    missingReceiptView.renderer.start(missingReceiptSource.controller, run)
    missingReceiptView.renderer.setRunMetadata(run)
    const selected = selectedSnapshot()
    missingReceiptSource.push(selected)
    missingReceiptView.renderer.writeReview(input(selected))
    const final = finalSnapshot()
    missingReceiptSource.push(final)
    const withoutReceipt = { ...input(final), writeReceipt: undefined }

    expect(() => missingReceiptView.renderer.finalize(withoutReceipt)).toThrow(/receipt/i)
    expect(missingReceiptView.output()).not.toContain('Apply transaction')
    expect(missingReceiptView.output()).not.toContain('complete - [+] passed')
    expect(missingReceiptView.errors).toEqual([])

    const incompleteSource = fakeController(snapshot())
    const incompleteView = harness()
    incompleteView.renderer.start(incompleteSource.controller, run)
    incompleteView.renderer.setRunMetadata(run)
    incompleteSource.push(selected)
    incompleteView.renderer.writeReview(input(selected))
    const incomplete = finalSnapshot()
    const nonterminal = {
      ...incomplete,
      phases: statuses({
        discover: 'passed',
        inspect: 'passed',
        resolve: 'passed',
        review: 'passed',
        preflight: 'passed',
        stage: 'passed',
        apply: 'passed',
        observe: 'passed',
        recover: 'skipped',
        complete: 'active',
      }),
    }
    incompleteSource.push(nonterminal)
    expect(() => incompleteView.renderer.finalize(input(nonterminal))).toThrow(/complete phase/i)
    expect(incompleteView.output()).not.toContain('Apply transaction')
    expect(incompleteView.errors).toEqual([])
  })

  it('uses a neutral physical-target heading for a nonempty read-only final run', () => {
    const source = fakeController(snapshot({ write: false }))
    const view = harness()
    view.renderer.start(source.controller, run)
    view.renderer.setRunMetadata(run)
    const selected = selectedSnapshot({ write: false })
    source.push(selected)
    view.renderer.writeReview(input(selected))
    const final = selectedSnapshot({
      write: false,
      sequence: 8,
      phases: statuses({
        discover: 'passed',
        inspect: 'passed',
        resolve: 'passed',
        review: 'passed',
        preflight: 'skipped',
        stage: 'skipped',
        apply: 'skipped',
        observe: 'skipped',
        recover: 'skipped',
        complete: 'passed',
      }),
      elapsedMs: 10,
      exitCode: 1,
    })
    source.push(final)
    view.renderer.finalize(input(final))

    expect(view.output()).toContain('Reviewed physical targets')
    expect(view.output()).not.toContain('Apply transaction')
  })

  it('fails stale review and stale final input before durable review or success bytes', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    view.renderer.setRunMetadata(run)
    const selected = selectedSnapshot()
    source.push(selected)
    expect(() => view.renderer.writeReview(input(snapshot()))).toThrow(/snapshot/i)
    expect(view.output()).not.toContain('Repository topology')
    expect(view.output()).not.toContain('Apply transaction')
    expect(view.output()).not.toContain('Complete -')
    expect(view.errors).toEqual([])
  })

  it('rejects stale final controller evidence after review before final-only bytes', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    view.renderer.setRunMetadata(run)
    const selected = selectedSnapshot()
    source.push(selected)
    view.renderer.writeReview(input(selected))
    const final = finalSnapshot()
    source.push(final)

    expect(() => view.renderer.finalize(input(selected))).toThrow(/snapshot/i)
    expect(view.output()).not.toContain('Apply transaction')
    expect(view.output()).not.toContain('Complete - 1 update')
    expect(view.errors).toEqual([])
    expect(source.unsubscribeCount()).toBe(1)
  })

  it('fails capability drift and late result evidence before renderer-owned output', () => {
    const late = snapshot({
      results: {
        operations: [],
        targets: [],
        totals: { ...emptyTotals(), unknown: 1 },
        targetTotals: emptyTotals(),
      },
    })
    const lateSource = fakeController(late)
    const lateView = harness()
    expect(() => lateView.renderer.start(lateSource.controller, run)).toThrow(/late start/i)
    expect(lateView.output()).toBe('')
    expect(lateView.errors).toEqual([])

    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    const selected = selectedSnapshot()
    source.push(selected)
    expect(() => view.renderer.writeReview(input(selected, { ...capable, width: 79 }))).toThrow(
      /capabilities/i,
    )
    expect(view.output()).not.toContain('Repository topology')
    expect(view.errors).toEqual([])
  })

  it('keeps terminal-phase contract mutations out of onError in observer and explicit paths', () => {
    const observerSource = fakeController(snapshot())
    const observerView = harness()
    observerView.renderer.start(observerSource.controller, run)
    observerSource.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    observerView.scheduled.flushNewest()
    observerSource.push(
      snapshot({ sequence: 2, phases: statuses({ discover: 'blocked', inspect: 'active' }) }),
    )
    observerView.scheduled.flushNewest()
    expect(observerView.errors).toEqual([])

    const explicitSource = fakeController(snapshot())
    const explicitView = harness()
    explicitView.renderer.start(explicitSource.controller, run)
    explicitSource.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    explicitView.scheduled.flushNewest()
    explicitSource.push(
      snapshot({ sequence: 2, phases: statuses({ discover: 'blocked', inspect: 'active' }) }),
    )
    expect(() => explicitView.renderer.suspend(() => undefined)).toThrow(/terminal phase/i)
    expect(explicitView.errors).toEqual([])
  })

  it('fails closed when an injected writer catches reentrant renderer methods', () => {
    const source = fakeController(snapshot())
    const errors: unknown[] = []
    let output = ''
    let renderer!: ReturnType<typeof createVisualPlusRenderer>
    let reenter: (() => void) | undefined
    const writer = {
      write(chunk: string) {
        output += chunk
        if (!reenter) return
        const invoke = reenter
        reenter = undefined
        try {
          invoke()
        } catch {
          // The hostile writer deliberately swallows the reentrant failure.
        }
      },
    }
    renderer = createVisualPlusRenderer({
      capabilities: capable,
      writer,
      scheduler: fakeScheduler().scheduler,
      onError: (error) => errors.push(error),
    })
    reenter = () => renderer.dispose()
    expect(() => renderer.start(source.controller, run)).toThrow(/reentrant/i)
    const failedOutput = output
    source.push(snapshot({ sequence: 1 }))
    expect(output).toBe(failedOutput)
    expect(errors).toEqual([])

    const reviewSource = fakeController(snapshot())
    let reviewOutput = ''
    let reviewRenderer!: ReturnType<typeof createVisualPlusRenderer>
    let reviewReentry: (() => void) | undefined
    reviewRenderer = createVisualPlusRenderer({
      capabilities: capable,
      writer: {
        write(chunk) {
          reviewOutput += chunk
          if (!reviewReentry) return
          const invoke = reviewReentry
          reviewReentry = undefined
          try {
            invoke()
          } catch {}
        },
      },
      scheduler: fakeScheduler().scheduler,
      onError: (error) => errors.push(error),
    })
    reviewRenderer.start(reviewSource.controller, run)
    reviewRenderer.setRunMetadata(run)
    const selected = selectedSnapshot()
    reviewSource.push(selected)
    const selectedInput = input(selected)
    reviewReentry = () => reviewRenderer.writeReview(selectedInput)
    expect(() => reviewRenderer.writeReview(selectedInput)).toThrow(/reentrant/i)
    expect(reviewOutput.match(/Repository topology/g) ?? []).toHaveLength(0)
    expect(errors).toEqual([])

    const finalSource = fakeController(snapshot())
    let finalOutput = ''
    let finalRenderer!: ReturnType<typeof createVisualPlusRenderer>
    let finalReentry: (() => void) | undefined
    finalRenderer = createVisualPlusRenderer({
      capabilities: capable,
      writer: {
        write(chunk) {
          finalOutput += chunk
          if (!finalReentry) return
          const invoke = finalReentry
          finalReentry = undefined
          try {
            invoke()
          } catch {}
        },
      },
      scheduler: fakeScheduler().scheduler,
      onError: (error) => errors.push(error),
    })
    finalRenderer.start(finalSource.controller, run)
    finalRenderer.setRunMetadata(run)
    finalSource.push(selected)
    finalRenderer.writeReview(selectedInput)
    const final = finalSnapshot()
    const finalInput = input(final)
    finalSource.push(final)
    finalReentry = () => finalRenderer.finalize(finalInput)
    expect(() => finalRenderer.finalize(finalInput)).toThrow(/reentrant/i)
    expect(finalOutput.match(/complete - \[\+\] passed/g) ?? []).toHaveLength(0)
    expect(finalOutput).not.toContain('Apply transaction')
    expect(errors).toEqual([])
  })

  it('retains and exactly clears owned lines after swallowed reentry during replacement', () => {
    const source = fakeController(snapshot())
    const scheduled = fakeScheduler()
    const errors: unknown[] = []
    let output = ''
    let armed = false
    let renderer!: ReturnType<typeof createVisualPlusRenderer>
    renderer = createVisualPlusRenderer({
      capabilities: capable,
      writer: {
        write(chunk) {
          output += chunk
          if (!armed) return
          armed = false
          try {
            renderer.dispose()
          } catch {
            // Exercise a hostile writer that swallows the reentrant contract error.
          }
        },
      },
      scheduler: scheduled.scheduler,
      onError: (error) => errors.push(error),
    })
    renderer.start(source.controller, run)
    source.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    const before = output.length
    armed = true
    scheduled.flushNewest()

    expect(output.slice(before)).toBe('\u001B[1A\r\u001B[2K\n\u001B[1A')
    expect(errors).toEqual([])
    const failedBytes = output
    scheduled.invokeAllAdversarially()
    source.push(snapshot({ sequence: 2 }))
    expect(output).toBe(failedBytes)
    expect(source.unsubscribeCount()).toBe(1)
  })

  it('records an accepted new frame before swallowed reentry during draw cleanup', () => {
    const source = fakeController(snapshot())
    const scheduled = fakeScheduler()
    const errors: unknown[] = []
    let output = ''
    let armed = false
    let renderer!: ReturnType<typeof createVisualPlusRenderer>
    renderer = createVisualPlusRenderer({
      capabilities: capable,
      writer: {
        write(chunk) {
          output += chunk
          if (!(armed && chunk.includes('inspect - [*] active'))) return
          armed = false
          try {
            renderer.dispose()
          } catch {
            // Exercise a hostile writer that swallows the reentrant contract error.
          }
        },
      },
      scheduler: scheduled.scheduler,
      onError: (error) => errors.push(error),
    })
    renderer.start(source.controller, run)
    source.push(snapshot({ sequence: 1, phases: statuses({ inspect: 'active' }) }))
    const before = output.length
    armed = true
    scheduled.flushNewest()

    expect(output.slice(before)).toBe(
      [
        '\u001B[1A\r\u001B[2K\n\u001B[1A',
        '\r\u001B[2Kinspect - [*] active\n',
        '\u001B[1A\r\u001B[2K\n\u001B[1A',
      ].join(''),
    )
    expect(errors).toEqual([])
    const failedBytes = output
    scheduled.invokeAllAdversarially()
    source.push(snapshot({ sequence: 2 }))
    expect(output).toBe(failedBytes)
    expect(source.unsubscribeCount()).toBe(1)
  })

  it('depth-counts sync and async suspension and redraws only after the outermost callback', async () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    const before = view.output()
    const value = view.renderer.suspend(() => view.renderer.suspend(() => 42))
    expect(value).toBe(42)
    expect(view.output().length).toBeGreaterThan(before.length)

    let release!: () => void
    const pending = view.renderer.suspendAsync(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(7)
        }),
    )
    source.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    release()
    await expect(pending).resolves.toBe(7)
    expect(view.output()).toContain('inspect - [*] active')
  })

  it('rejects finalization during async suspension before transaction and never redraws', async () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    let release!: () => void
    const pending = view.renderer.suspendAsync(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    expect(() => view.renderer.finalize(input(snapshot({ exitCode: 0, elapsedMs: 1 })))).toThrow(
      /suspension/i,
    )
    const failedBytes = view.output()
    release()
    await pending
    expect(view.output()).toBe(failedBytes)
    expect(view.output()).not.toContain('Apply transaction')
  })

  it('preserves a caller suspension failure without reporting or redrawing', async () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    const callbackFailure = new Error('durable callback failed')
    const before = view.output()

    await expect(
      view.renderer.suspendAsync(async () => {
        throw callbackFailure
      }),
    ).rejects.toBe(callbackFailure)
    expect(view.errors).toEqual([])
    expect(view.output().length).toBeGreaterThan(before.length)
    const failedBytes = view.output()
    view.scheduled.invokeAllAdversarially()
    expect(view.output()).toBe(failedBytes)
  })

  it('invalidates adversarial callbacks after dispose and cleans up idempotently', () => {
    const source = fakeController(snapshot())
    const view = harness()
    view.renderer.start(source.controller, run)
    source.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    view.renderer.dispose()
    view.renderer.dispose()
    const disposedBytes = view.output()
    view.scheduled.invokeAllAdversarially()
    source.push(snapshot({ sequence: 2 }))
    expect(view.output()).toBe(disposedBytes)
    expect(source.unsubscribeCount()).toBe(1)
  })

  it('reports writer and scheduler failures once, tears down, and rethrows explicit failures', () => {
    const source = fakeController(snapshot())
    const writerFailure = new Error('writer failed')
    const errors: unknown[] = []
    const renderer = createVisualPlusRenderer({
      capabilities: capable,
      writer: {
        write: () => {
          throw writerFailure
        },
      },
      scheduler: fakeScheduler().scheduler,
      onError: (error) => errors.push(error),
    })
    expect(() => renderer.start(source.controller, run)).toThrow(writerFailure)
    expect(errors).toEqual([writerFailure])

    let output = ''
    const schedulerFailure = new Error('scheduler failed')
    const scheduledErrors: unknown[] = []
    const second = createVisualPlusRenderer({
      capabilities: capable,
      writer: { write: (chunk) => (output += chunk) },
      scheduler: {
        schedule: () => {
          throw schedulerFailure
        },
      },
      onError: (error) => scheduledErrors.push(error),
    })
    const secondSource = fakeController(snapshot())
    second.start(secondSource.controller, run)
    secondSource.push(
      snapshot({ sequence: 1, phases: statuses({ discover: 'passed', inspect: 'active' }) }),
    )
    expect(scheduledErrors).toEqual([schedulerFailure])
    expect(output).toContain('Lifecycle')
  })
})
