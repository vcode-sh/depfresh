import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import type { CheckRunEvent, CheckRunSnapshot } from './run-model'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

const runControllerHarness = vi.hoisted(() => ({
  events: [] as unknown[],
  factoryCalls: 0,
  snapshot: undefined as undefined | (() => unknown),
}))

vi.mock('./run-controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./run-controller')>()
  return {
    ...actual,
    createCheckRunController: (options: Parameters<typeof actual.createCheckRunController>[0]) => {
      runControllerHarness.factoryCalls += 1
      const controller = actual.createCheckRunController(options)
      runControllerHarness.snapshot = controller.snapshot
      return {
        ...controller,
        emit: (event: CheckRunEvent) => {
          runControllerHarness.events.push(event)
          controller.emit(event)
        },
      }
    },
  }
})

describe('read-only check run model instrumentation', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    runControllerHarness.events.length = 0
    runControllerHarness.factoryCalls = 0
    runControllerHarness.snapshot = undefined
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits one complete local read-only stream without changing JSON bytes', async () => {
    const update = makeResolved({
      name: 'lodash',
      currentVersion: '^4.0.0',
      targetVersion: '^5.0.0',
      diff: 'major',
    })
    const pkg = makePkg('my-app', [update])
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(0)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      packages: [
        {
          name: 'my-app',
          updates: [
            {
              name: 'lodash',
              current: '^4.0.0',
              target: '^5.0.0',
              diff: 'major',
              source: 'dependencies',
            },
          ],
        },
      ],
      errors: [],
      summary: {
        scannedPackages: 1,
        packagesWithUpdates: 1,
        total: 1,
        plannedUpdates: 0,
        appliedUpdates: 0,
        failedResolutions: 0,
      },
      meta: { noPackagesFound: false, hadResolutionErrors: false, didWrite: false },
    })
    expect(stableJsonBytes(consoleSpy.mock.calls)).toBe(
      JSON.stringify(
        {
          packages: [
            {
              name: 'my-app',
              updates: [
                {
                  name: 'lodash',
                  current: '^4.0.0',
                  target: '^5.0.0',
                  diff: 'major',
                  source: 'dependencies',
                },
              ],
            },
          ],
          errors: [],
          writeOutcomes: [],
          summary: {
            total: 1,
            major: 1,
            minor: 0,
            patch: 0,
            packages: 1,
            scannedPackages: 1,
            packagesWithUpdates: 1,
            plannedUpdates: 0,
            appliedUpdates: 0,
            revertedUpdates: 0,
            skippedUpdates: 0,
            conflictedUpdates: 0,
            failedWrites: 0,
            unknownWrites: 0,
            failedResolutions: 0,
          },
          meta: {
            schemaVersion: 1,
            cwd: '/tmp/test',
            effectiveRoot: '/tmp/test',
            mode: 'default',
            timestamp: '<timestamp>',
            noPackagesFound: false,
            hadResolutionErrors: false,
            didWrite: false,
          },
        },
        null,
        2,
      ),
    )
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(runControllerHarness.factoryCalls).toBe(1)
    expect(events()).toEqual([
      { type: 'packages-discovered', packages: 1, declared: 1 },
      { type: 'repository-inspection-started' },
      { type: 'repository-inspection-completed', status: 'passed' },
      {
        type: 'resolution-completed',
        eligible: 1,
        unresolved: 0,
        updates: 1,
        status: 'passed',
      },
      {
        type: 'selection-completed',
        operations: 1,
        targets: 1,
        changes: [
          {
            id: 'change:0:0',
            name: 'lodash',
            owner: 'my-app/package.json',
            current: '^4.0.0',
            target: '^5.0.0',
            diff: 'major',
          },
        ],
        selectedTargets: [{ path: 'my-app/package.json', operationIds: ['change:0:0'] }],
      },
      {
        type: 'results-recorded',
        operations: [
          {
            operationId: 'change:0:0',
            outcome: 'not-attempted',
            blocked: false,
            notAttempted: true,
            unknown: false,
          },
        ],
        targets: [
          {
            path: 'my-app/package.json',
            operationIds: ['change:0:0'],
            outcome: 'not-attempted',
            blocked: false,
            notAttempted: true,
            unknown: false,
          },
        ],
      },
      { type: 'run-completed', eventId: 'run-completed', elapsedMs: 0, exitCode: 0 },
    ])
    expectCompleteSnapshot(0)
  })

  it.each([
    { strict: false, expectedExitCode: 0 },
    { strict: true, expectedExitCode: 2 },
  ] as const)(
    'retains ordinary resolution errors as unresolved facts (strict=$strict)',
    async ({ strict, expectedExitCode }) => {
      const unresolved = makeResolved({
        name: 'missing-package',
        currentVersion: '^1.0.0',
        targetVersion: '^1.0.0',
        diff: 'error',
      })
      const pkg = makePkg('broken-app', [unresolved])
      mocks.loadPackagesMock.mockResolvedValue([pkg])
      mocks.resolvePackageMock.mockResolvedValue([unresolved])
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { check } = await import('./index')
      const exitCode = await check({
        ...baseOptions,
        output: 'json',
        failOnResolutionErrors: strict,
      })

      expect(exitCode).toBe(expectedExitCode)
      expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
        packages: [],
        errors: [{ name: 'missing-package', message: 'Failed to resolve from registry' }],
        summary: { failedResolutions: 1, total: 0 },
        meta: { hadResolutionErrors: true, didWrite: false },
      })
      expect(events()).toEqual([
        { type: 'packages-discovered', packages: 1, declared: 1 },
        { type: 'repository-inspection-started' },
        { type: 'repository-inspection-completed', status: 'passed' },
        {
          type: 'resolution-completed',
          eligible: 1,
          unresolved: 1,
          updates: 0,
          status: 'passed',
        },
        {
          type: 'selection-completed',
          operations: 0,
          targets: 0,
          changes: [],
          selectedTargets: [],
        },
        { type: 'results-recorded', operations: [], targets: [] },
        {
          type: 'run-completed',
          eventId: 'run-completed',
          elapsedMs: 0,
          exitCode: expectedExitCode,
        },
      ])
      expectCompleteSnapshot(expectedExitCode)
    },
  )

  it('completes a zero-count no-package stream with the current exit code and JSON', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(0)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      packages: [],
      errors: [],
      summary: { scannedPackages: 0, total: 0, failedResolutions: 0 },
      meta: { noPackagesFound: true, hadResolutionErrors: false, didWrite: false },
    })
    expect(events()).toEqual([
      { type: 'packages-discovered', packages: 0, declared: 0 },
      { type: 'repository-inspection-started' },
      { type: 'repository-inspection-completed', status: 'passed' },
      {
        type: 'resolution-completed',
        eligible: 0,
        unresolved: 0,
        updates: 0,
        status: 'passed',
      },
      {
        type: 'selection-completed',
        operations: 0,
        targets: 0,
        changes: [],
        selectedTargets: [],
      },
      { type: 'results-recorded', operations: [], targets: [] },
      { type: 'run-completed', eventId: 'run-completed', elapsedMs: 0, exitCode: 0 },
    ])
    expectCompleteSnapshot(0)
  })

  it('keeps the strict no-package exit in the same complete zero-count stream', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json', failOnNoPackages: true })

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      packages: [],
      summary: { scannedPackages: 0, total: 0 },
      meta: { noPackagesFound: true },
    })
    expect(events().map((event) => event.type)).toEqual([
      'packages-discovered',
      'repository-inspection-started',
      'repository-inspection-completed',
      'resolution-completed',
      'selection-completed',
      'results-recorded',
      'run-completed',
    ])
    expect(events().at(-1)).toEqual({
      type: 'run-completed',
      eventId: 'run-completed',
      elapsedMs: 0,
      exitCode: 2,
    })
    expectCompleteSnapshot(2)
  })

  it('closes a thrown discovery journey once without changing the JSON error', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('Something went wrong'))
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      error: { code: 'ERR_UNKNOWN', message: 'Something went wrong', retryable: false },
      meta: { schemaVersion: 1, cwd: '/tmp/test', mode: 'default' },
    })
    expect(events()).toEqual([
      { type: 'phase-completed', phase: 'discover', status: 'failed' },
      { type: 'diagnostics-recorded', diagnostics: [{ code: 'CHECK_RUN_FAILED' }] },
      { type: 'results-recorded', operations: [], targets: [] },
      { type: 'run-completed', eventId: 'run-completed', elapsedMs: 0, exitCode: 2 },
    ])
    expectCompleteSnapshot(2)
  })

  it('closes the active resolve phase when registry resolution throws', async () => {
    const dependency = makeResolved({ name: 'registry-failure' })
    const pkg = makePkg('broken-app', [dependency])
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockRejectedValue(new Error('Registry unavailable'))
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      error: { code: 'ERR_UNKNOWN', message: 'Registry unavailable', retryable: false },
    })
    expect(events()).toEqual([
      { type: 'packages-discovered', packages: 1, declared: 1 },
      { type: 'repository-inspection-started' },
      { type: 'repository-inspection-completed', status: 'passed' },
      { type: 'phase-completed', phase: 'resolve', status: 'failed' },
      { type: 'diagnostics-recorded', diagnostics: [{ code: 'CHECK_RUN_FAILED' }] },
      { type: 'results-recorded', operations: [], targets: [] },
      { type: 'run-completed', eventId: 'run-completed', elapsedMs: 0, exitCode: 2 },
    ])
    expectCompleteSnapshot(2)
  })
})

describe('legacy write and global run model boundary', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    runControllerHarness.events.length = 0
    runControllerHarness.factoryCalls = 0
    runControllerHarness.snapshot = undefined
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a successful legacy write unchanged and emits no model stream', async () => {
    const update = makeResolved({ name: 'lodash', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const pkg = makePkg('write-app', [update])
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(0)
    expect(mocks.writePackageMock).toHaveBeenCalledTimes(1)
    expect(mocks.writePackageMock).toHaveBeenCalledWith(
      pkg,
      [update],
      'silent',
      expect.objectContaining({ write: true }),
    )
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      summary: { plannedUpdates: 1, appliedUpdates: 1, conflictedUpdates: 0 },
      meta: { didWrite: true },
    })
    expect(runControllerHarness.factoryCalls).toBe(0)
    expect(events()).toEqual([])
  })

  it('keeps a partial legacy write unchanged and emits no model stream', async () => {
    const first = makeResolved({ name: 'first', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const second = makeResolved({ name: 'second', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const pkg = makePkg('partial-app', [first, second])
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([first, second])
    mocks.writePackageMock.mockReturnValue({
      outcomes: [
        writeOutcome(pkg, first, 'applied', 'APPLIED', '2.0.0'),
        writeOutcome(pkg, second, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [],
    })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(mocks.writePackageMock).toHaveBeenCalledTimes(1)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      summary: { plannedUpdates: 2, appliedUpdates: 1, unknownWrites: 1 },
      meta: { didWrite: true },
    })
    expect(runControllerHarness.factoryCalls).toBe(0)
    expect(events()).toEqual([])
  })

  it.each([
    { global: true, write: false },
    { global: true, write: true },
  ])('keeps global=$global write=$write outside the model boundary', async (overrides) => {
    mocks.loadPackagesMock.mockResolvedValue([])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json', ...overrides })

    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      meta: { noPackagesFound: true },
    })
    expect(runControllerHarness.factoryCalls).toBe(0)
    expect(events()).toEqual([])
  })
})

function events(): CheckRunEvent[] {
  return runControllerHarness.events as CheckRunEvent[]
}

function expectCompleteSnapshot(exitCode: 0 | 1 | 2): void {
  const snapshot = runControllerHarness.snapshot?.() as CheckRunSnapshot | undefined
  expect(snapshot?.exitCode).toBe(exitCode)
  expect(snapshot?.phases.filter((phase) => phase.status === 'active')).toEqual([])
  expect(events().filter((event) => event.type === 'run-completed')).toHaveLength(1)
}

function normalizeJsonOutput(calls: unknown[][]): Record<string, unknown> {
  for (const [value] of calls) {
    if (typeof value !== 'string') continue
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (!(parsed.packages || parsed.error || parsed.meta)) continue
      const meta = parsed.meta as Record<string, unknown> | undefined
      if (!meta) return parsed
      const { timestamp: _timestamp, ...stableMeta } = meta
      return { ...parsed, meta: stableMeta }
    } catch {
      // Ignore non-JSON logger calls.
    }
  }
  throw new Error('Expected JSON output')
}

function stableJsonBytes(calls: unknown[][]): string {
  for (const [value] of calls) {
    if (typeof value !== 'string') continue
    try {
      const parsed = JSON.parse(value) as { meta?: { timestamp?: string } }
      const timestamp = parsed.meta?.timestamp
      if (timestamp) return value.replace(JSON.stringify(timestamp), '"<timestamp>"')
    } catch {
      // Ignore non-JSON logger calls.
    }
  }
  throw new Error('Expected timestamped JSON output')
}

function writeOutcome(
  pkg: PackageMeta,
  change: ResolvedDepChange,
  status: WriteOutcome['status'],
  reason: WriteOutcome['reason'],
  observedValue?: string,
): WriteOutcome {
  return {
    name: change.name,
    occurrence: { file: pkg.filepath, path: [change.source, change.name] },
    expectedValue: change.currentVersion,
    requestedValue: change.targetVersion,
    ...(observedValue === undefined ? {} : { observedValue }),
    status,
    reason,
  }
}
