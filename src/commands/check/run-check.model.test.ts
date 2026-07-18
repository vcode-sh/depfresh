import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInvocationAuthority } from '../../invocation-authority'
import type { PackageLoadObserver } from '../../io/packages/discovery'
import type { PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import { type CheckRunController, createCheckRunController } from './run-controller'
import type { CheckRunEvent } from './run-model'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

interface RecordingController {
  readonly controller: CheckRunController
  readonly events: CheckRunEvent[]
}

let recording: RecordingController

describe('read-only check run model instrumentation', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    recording = createRecordingController()
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
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json' })

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
      returnPackagesFromDiscovery(mocks, [pkg])
      mocks.resolvePackageMock.mockResolvedValue([unresolved])
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const exitCode = await runModeledCheck({
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
    returnPackagesFromDiscovery(mocks, [])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json' })

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
    returnPackagesFromDiscovery(mocks, [])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({
      ...baseOptions,
      output: 'json',
      failOnNoPackages: true,
    })

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

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json' })

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

  it('keeps discovery passed and fails inspection when policy work throws after discovery', async () => {
    const pkg = makePkg('policy-app')
    mocks.loadPackagesMock.mockImplementation(
      async (_options: unknown, observer?: PackageLoadObserver): Promise<PackageMeta[]> => {
        observer?.onPackagesDiscovered([pkg])
        expect(events()).toEqual([
          { type: 'packages-discovered', packages: 1, declared: 0 },
          { type: 'repository-inspection-started' },
        ])
        throw new Error('Policy projection failed')
      },
    )
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      error: { code: 'ERR_UNKNOWN', message: 'Policy projection failed', retryable: false },
    })
    expect(events()).toEqual([
      { type: 'packages-discovered', packages: 1, declared: 0 },
      { type: 'repository-inspection-started' },
      { type: 'phase-completed', phase: 'inspect', status: 'failed' },
      { type: 'diagnostics-recorded', diagnostics: [{ code: 'CHECK_RUN_FAILED' }] },
      { type: 'results-recorded', operations: [], targets: [] },
      { type: 'run-completed', eventId: 'run-completed', elapsedMs: 0, exitCode: 2 },
    ])
    expectCompleteSnapshot(2)
  })

  it('closes the active resolve phase when registry resolution throws', async () => {
    const dependency = makeResolved({ name: 'registry-failure' })
    const pkg = makePkg('broken-app', [dependency])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockRejectedValue(new Error('Registry unavailable'))
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json' })

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

  it('fails explicitly instead of clamping inconsistent resolver facts', async () => {
    const declared = makeResolved({ name: 'declared' })
    const first = makeResolved({ name: 'first' })
    const second = makeResolved({ name: 'second' })
    const pkg = makePkg('inconsistent-app', [declared])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([first, second])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      error: {
        code: 'ERR_UNKNOWN',
        message: 'Check run instrumentation invariant: resolved facts exceed eligible occurrences',
        retryable: false,
      },
    })
    expect(events()).toEqual([
      { type: 'packages-discovered', packages: 1, declared: 1 },
      { type: 'repository-inspection-started' },
      { type: 'repository-inspection-completed', status: 'passed' },
      { type: 'phase-completed', phase: 'resolve', status: 'failed' },
      { type: 'diagnostics-recorded', diagnostics: [{ code: 'CHECK_RUN_INVARIANT' }] },
      { type: 'results-recorded', operations: [], targets: [] },
      { type: 'run-completed', eventId: 'run-completed', elapsedMs: 0, exitCode: 2 },
    ])
    expectCompleteSnapshot(2)
  })

  it('does not let model cleanup replace a genuine command error', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('Original discovery failure'))
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const controller: CheckRunController = {
      ...recording.controller,
      emit(): void {
        throw new Error('Model cleanup failed')
      },
    }
    const { runCheck } = await import('./run-check')
    const options = { ...baseOptions, output: 'json' as const }

    const exitCode = await runCheck(
      options,
      createInvocationAuthority(options),
      false,
      undefined,
      controller,
    )

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      error: { code: 'ERR_UNKNOWN', message: 'Original discovery failure', retryable: false },
    })
  })

  it('composes model and progress observers without changing cursor or log bytes', async () => {
    const originalIsTTY = process.stdout.isTTY
    const originalCi = process.env.CI
    const originalTerm = process.env.TERM
    let observedModelObserver: PackageLoadObserver | undefined
    mocks.loadPackagesMock.mockImplementation(
      async (_options: unknown, observer?: PackageLoadObserver): Promise<PackageMeta[]> => {
        observedModelObserver = observer
        observer?.onPackagesDiscovered([])
        return []
      },
    )
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    delete process.env.CI
    process.env.TERM = 'xterm-256color'
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const options = { ...baseOptions, output: 'table' as const, loglevel: 'info' as const }
      await runModeledCheck(options, true)
      const modeledStdout = stdoutSpy.mock.calls.map((call) => [...call])
      const modeledLogs = consoleSpy.mock.calls.map((call) => [...call])

      expect(observedModelObserver).toEqual({
        onPackagesDiscovered: expect.any(Function),
        writeDurable: expect.any(Function),
      })
      stdoutSpy.mockClear()
      consoleSpy.mockClear()
      const { checkFromCli } = await import('./run-check')
      await checkFromCli(options)

      expect(stdoutSpy.mock.calls).toEqual(modeledStdout)
      expect(consoleSpy.mock.calls).toEqual(modeledLogs)
      expectCompleteSnapshot(0)
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: originalIsTTY,
      })
      if (originalCi === undefined) delete process.env.CI
      else process.env.CI = originalCi
      if (originalTerm === undefined) delete process.env.TERM
      else process.env.TERM = originalTerm
    }
  })
})

describe('legacy write and global run model boundary', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    recording = createRecordingController()
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

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

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

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(mocks.writePackageMock).toHaveBeenCalledTimes(1)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      summary: { plannedUpdates: 2, appliedUpdates: 1, unknownWrites: 1 },
      meta: { didWrite: true },
    })
    expect(events()).toEqual([])
  })

  it.each([
    { global: true, write: false },
    { global: true, write: true },
  ])('keeps global=$global write=$write outside the model boundary', async (overrides) => {
    mocks.loadPackagesMock.mockResolvedValue([])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runModeledCheck({ ...baseOptions, output: 'json', ...overrides })

    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      meta: { noPackagesFound: true },
    })
    expect(events()).toEqual([])
  })
})

function events(): CheckRunEvent[] {
  return recording.events
}

function expectCompleteSnapshot(exitCode: 0 | 1 | 2): void {
  const snapshot = recording.controller.snapshot()
  expect(snapshot.exitCode).toBe(exitCode)
  expect(snapshot.phases.filter((phase) => phase.status === 'active')).toEqual([])
  expect(events().filter((event) => event.type === 'run-completed')).toHaveLength(1)
}

function createRecordingController(): RecordingController {
  const delegate = createCheckRunController({ mode: 'default', write: false, now: () => 0 })
  const events: CheckRunEvent[] = []
  return {
    events,
    controller: {
      emit(event): void {
        events.push(event)
        delegate.emit(event)
      },
      snapshot: delegate.snapshot,
      subscribe: delegate.subscribe,
    },
  }
}

async function runModeledCheck(
  options: typeof baseOptions,
  renderProgress = false,
): Promise<number> {
  const { runCheck } = await import('./run-check')
  return runCheck(
    options,
    createInvocationAuthority(options),
    renderProgress,
    undefined,
    recording.controller,
  )
}

function returnPackagesFromDiscovery(mocks: CheckMocks, packages: PackageMeta[]): void {
  mocks.loadPackagesMock.mockImplementation(
    async (_options: unknown, observer?: PackageLoadObserver): Promise<PackageMeta[]> => {
      observer?.onPackagesDiscovered(packages)
      return packages
    },
  )
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
