import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInvocationAuthority } from '../../invocation-authority'
import type { PackageLoadObserver } from '../../io/packages/discovery'
import type { PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import { createLogger } from '../../utils/logger'
import { type CheckRunController, createCheckRunController } from './run-controller'
import type { CheckRunEvent } from './run-model'
import {
  baseOptions,
  type CheckMocks,
  createCommandResultWithOutcomes,
  makePkg,
  makeResolved,
  setupMocks,
} from './test-helpers'

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

  it('preserves default discovery log bytes for explicit model injection without progress', async () => {
    const dependency = makeResolved({ name: 'logged-dependency' })
    const pkg = makePkg('logged-app', [dependency])
    mocks.resolvePackageMock.mockResolvedValue([dependency])
    mocks.loadPackagesMock.mockImplementation(
      async (
        options: typeof baseOptions,
        observer?: PackageLoadObserver,
      ): Promise<PackageMeta[]> => {
        observer?.onPackagesDiscovered([pkg])
        if (!observer) {
          createLogger(options.loglevel).info('Found 1 packages with 1 dependencies')
        }
        return [pkg]
      },
    )
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const options = { ...baseOptions, output: 'table' as const, loglevel: 'info' as const }
    const { runCheck } = await import('./run-check')

    await runCheck(options, createInvocationAuthority(options), false)
    const defaultLogs = consoleSpy.mock.calls.map((call) => [...call])
    expect(mocks.loadPackagesMock.mock.calls[0]).toHaveLength(1)
    consoleSpy.mockClear()
    await runModeledCheck(options)

    expect(mocks.loadPackagesMock.mock.calls[1]?.[1]).toEqual({
      onPackagesDiscovered: expect.any(Function),
    })
    expect(packageCountLogs(defaultLogs)).toEqual([
      [expect.any(String), 'Found 1 packages with 1 dependencies'],
    ])
    expect(consoleSpy.mock.calls).toEqual(defaultLogs)
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
    recording = createRecordingController(true)
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drives one successful local write stream from the command apply result', async () => {
    const update = makeResolved({ name: 'lodash', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const pkg = makePkg('write-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(0)
    expect(mocks.commandWriteMock).toHaveBeenCalledTimes(1)
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      summary: { plannedUpdates: 1, appliedUpdates: 1, conflictedUpdates: 0 },
      meta: { didWrite: true },
    })
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
            id: 'operation-0',
            name: 'lodash',
            owner: 'write-app/package.json',
            current: '1.0.0',
            target: '2.0.0',
            diff: 'major',
          },
        ],
        selectedTargets: [{ path: 'write-app/package.json', operationIds: ['operation-0'] }],
      },
      { type: 'phase-completed', phase: 'preflight', status: 'passed' },
      { type: 'phase-completed', phase: 'stage', status: 'passed' },
      {
        type: 'apply-completed',
        status: 'passed',
        recoveryRequired: false,
        observationRequired: true,
      },
      { type: 'phase-completed', phase: 'observe', status: 'passed' },
      {
        type: 'results-recorded',
        operations: [
          {
            operationId: 'operation-0',
            outcome: 'applied',
            reason: 'APPLIED',
            blocked: false,
            notAttempted: false,
            unknown: false,
          },
        ],
        targets: [
          {
            path: 'write-app/package.json',
            operationIds: ['operation-0'],
            outcome: 'applied',
            blocked: false,
            notAttempted: false,
            unknown: false,
          },
        ],
      },
      { type: 'run-completed', eventId: 'run-completed', elapsedMs: 0, exitCode: 0 },
    ])
    expectCompleteSnapshot(0)
  })

  it('completes a zero-selection local write without invoking the command adapter', async () => {
    const current = makeResolved({
      name: 'current',
      currentVersion: '1.0.0',
      targetVersion: '1.0.0',
      diff: 'none',
    })
    const pkg = makePkg('current-app', [current])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([current])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(0)
    expect(mocks.commandWriteMock).not.toHaveBeenCalled()
    expect(events()).toContainEqual({
      type: 'selection-completed',
      operations: 0,
      targets: 0,
      changes: [],
      selectedTargets: [],
    })
    expect(events()).toContainEqual({
      type: 'phase-completed',
      phase: 'stage',
      status: 'skipped',
    })
    expectCompleteSnapshot(0)
  })

  it.each([
    {
      name: 'npm alias',
      source: 'dependencies' as const,
      rawVersion: 'npm:real-package@^1.0.0',
      currentVersion: '^1.0.0',
      targetVersion: '^2.0.0',
      requestedValue: 'npm:real-package@^2.0.0',
      path: ['dependencies', 'protocol-dep'],
    },
    {
      name: 'JSR alias',
      source: 'dependencies' as const,
      rawVersion: 'jsr:@scope/real@^1.0.0',
      currentVersion: '^1.0.0',
      targetVersion: '^2.0.0',
      requestedValue: 'jsr:@scope/real@^2.0.0',
      path: ['dependencies', 'protocol-dep'],
    },
    {
      name: 'workspace range',
      source: 'dependencies' as const,
      rawVersion: 'workspace:^1.0.0',
      currentVersion: '^1.0.0',
      targetVersion: '^2.0.0',
      requestedValue: 'workspace:^2.0.0',
      path: ['dependencies', 'protocol-dep'],
    },
    {
      name: 'package manager field',
      source: 'packageManager' as const,
      rawVersion: 'pnpm@9.0.0+sha512.digest',
      currentVersion: '9.0.0',
      targetVersion: '10.0.0',
      requestedValue: 'pnpm@10.0.0+sha512.digest',
      path: ['packageManager'],
    },
  ])('projects authentic stored values for a $name', async (fixture) => {
    const update = makeResolved({
      name: 'protocol-dep',
      source: fixture.source,
      rawVersion: fixture.rawVersion,
      currentVersion: fixture.currentVersion,
      targetVersion: fixture.targetVersion,
    })
    const pkg = makePkg('protocol-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })
    const result = await mocks.commandWriteMock.mock.results[0]?.value

    expect(exitCode).toBe(0)
    expect(result.packages[0]?.outcomes[0]).toMatchObject({
      expectedValue: fixture.rawVersion,
      requestedValue: fixture.requestedValue,
      occurrence: { file: pkg.filepath, path: fixture.path },
    })
    expect(recording.controller.snapshot().changes).toEqual([
      expect.objectContaining({
        owner: 'protocol-app/package.json',
        current: fixture.rawVersion,
        target: fixture.requestedValue,
      }),
    ])
    expectCompleteSnapshot(0)
  })

  it('deduplicates two logical catalog owners into one authentic physical model target', async () => {
    const update = makeResolved({
      name: 'shared',
      source: 'catalog',
      rawVersion: '^1.0.0',
      currentVersion: '^1.0.0',
      targetVersion: '^2.0.0',
    })
    const catalog = {
      type: 'pnpm' as const,
      name: 'default',
      filepath: '/tmp/test/pnpm-workspace.yaml',
      deps: [
        {
          name: 'shared',
          source: 'catalog' as const,
          currentVersion: '^1.0.0',
          rawVersion: '^1.0.0',
          update: true,
          parents: [],
        },
      ],
      raw: { catalog: { shared: '^1.0.0' } },
      indent: '  ',
    }
    const packages = ['consumer-a', 'consumer-b'].map((name) => ({
      ...makePkg(name, [update]),
      type: 'pnpm-workspace' as const,
      filepath: '/tmp/test/pnpm-workspace.yaml',
      catalogs: [catalog],
    }))
    returnPackagesFromDiscovery(mocks, packages)
    mocks.resolvePackageMock.mockResolvedValue([update])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })
    const result = await mocks.commandWriteMock.mock.results[0]?.value

    expect(exitCode).toBe(0)
    expect(result.packages).toHaveLength(2)
    expect(result.packages[0]?.outcomes[0]).toMatchObject({
      occurrence: {
        file: '/tmp/test/pnpm-workspace.yaml',
        path: ['catalog', 'shared'],
      },
      expectedValue: '^1.0.0',
      requestedValue: '^2.0.0',
    })
    expect(recording.controller.snapshot()).toMatchObject({
      counts: { updates: 2, operations: 1, targets: 1 },
      changes: [{ owner: 'pnpm-workspace.yaml' }],
      targets: [{ path: 'pnpm-workspace.yaml' }],
    })
    expectCompleteSnapshot(0)
  })

  it('retains mixed target and partial recovery truth from the command result', async () => {
    const first = makeResolved({ name: 'first', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const second = makeResolved({ name: 'second', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const pkg = makePkg('partial-app', [first, second])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([first, second])
    mocks.commandWriteMock.mockImplementation(async (root, selections) => {
      const packages = [
        {
          packageIndex: 0,
          outcomes: [
            writeOutcome(pkg, first, 'applied', 'APPLIED', '2.0.0'),
            writeOutcome(pkg, second, 'unknown', 'VCS_UNAVAILABLE'),
          ],
        },
      ]
      const result = createCommandResultWithOutcomes(root, selections, packages)
      if (result.status !== 'executed') throw new Error('Expected executed result')
      return {
        ...result,
        applyResult: {
          ...result.applyResult,
          status: 'unknown' as const,
          phases: [
            { name: 'preflight' as const, status: 'passed' as const, reason: 'READY' },
            { name: 'lock' as const, status: 'passed' as const, reason: 'LOCKED' },
            { name: 'stage' as const, status: 'passed' as const, reason: 'STAGED' },
            { name: 'precommit' as const, status: 'passed' as const, reason: 'RECHECKED' },
            { name: 'commit' as const, status: 'failed' as const, reason: 'COMMIT_FAILED' },
            { name: 'recovery' as const, status: 'failed' as const, reason: 'PARTIAL' },
            { name: 'inspect' as const, status: 'unknown' as const, reason: 'UNOBSERVABLE' },
            { name: 'cleanup' as const, status: 'passed' as const, reason: 'CLEAN' },
          ],
          recovery: {
            status: 'partial' as const,
            journalId: 'journal-partial',
            restoredPaths: [],
            unrecoveredPaths: ['partial-app/package.json'],
            externalEffects: ['package-manager-cache' as const],
          },
        },
      }
    })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(mocks.commandWriteMock).toHaveBeenCalledTimes(1)
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      summary: { plannedUpdates: 2, appliedUpdates: 1, unknownWrites: 1 },
      meta: { didWrite: true },
    })
    expect(events()).toContainEqual({
      type: 'recovery-recorded',
      executed: true,
      status: 'partial',
      journalId: 'journal-partial',
      restoredPaths: [],
      unrecoveredPaths: ['partial-app/package.json'],
      externalEffects: ['package-manager-cache'],
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      results: {
        totals: { applied: 1, unknown: 1 },
        targetTotals: { mixed: 1, unknown: 1 },
      },
      recovery: {
        executed: true,
        status: 'partial',
        journalId: 'journal-partial',
      },
    })
    expectCompleteSnapshot(2)
  })

  it('keeps applied and skipped operations exact on one attempted physical target', async () => {
    const applied = makeResolved({
      name: 'applied',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    const skipped = makeResolved({
      name: 'skipped',
      currentVersion: '1.0.0',
      targetVersion: '1.0.0',
    })
    const pkg = makePkg('mixed-app', [applied, skipped])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([applied, skipped])
    mocks.commandWriteMock.mockImplementation(async (root, selections) =>
      createCommandResultWithOutcomes(root, selections, [
        {
          packageIndex: 0,
          outcomes: [
            writeOutcome(pkg, applied, 'applied', 'APPLIED', '2.0.0'),
            writeOutcome(pkg, skipped, 'skipped', 'NO_CHANGE', '1.0.0'),
          ],
        },
      ]),
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(0)
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 0,
      results: {
        totals: { applied: 1, skipped: 1, notAttempted: 0 },
        targetTotals: { mixed: 1, notAttempted: 0 },
      },
    })
    expectCompleteSnapshot(0)
  })

  it('retains cleanup ambiguity as unexecuted unknown recovery evidence', async () => {
    const update = makeResolved({
      name: 'cleanup',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    const pkg = makePkg('cleanup-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    mocks.commandWriteMock.mockImplementation(async (root, selections) => {
      const result = createCommandResultWithOutcomes(root, selections, [
        {
          packageIndex: 0,
          outcomes: [writeOutcome(pkg, update, 'unknown', 'WRITE_FAILED')],
        },
      ])
      if (result.status !== 'executed') throw new Error('Expected executed result')
      return {
        ...result,
        applyResult: {
          ...result.applyResult,
          status: 'unknown' as const,
          phases: [
            { name: 'preflight' as const, status: 'passed' as const, reason: 'READY' },
            { name: 'lock' as const, status: 'passed' as const, reason: 'LOCKED' },
            { name: 'stage' as const, status: 'passed' as const, reason: 'STAGED' },
            { name: 'precommit' as const, status: 'passed' as const, reason: 'RECHECKED' },
            { name: 'commit' as const, status: 'passed' as const, reason: 'COMMITTED' },
            { name: 'inspect' as const, status: 'passed' as const, reason: 'OBSERVED' },
            { name: 'cleanup' as const, status: 'unknown' as const, reason: 'RETAINED' },
          ],
          recovery: {
            status: 'unknown' as const,
            journalId: 'journal-cleanup',
            externalEffects: ['dependency-install-state' as const],
          },
        },
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(events()).toContainEqual({
      type: 'recovery-recorded',
      executed: false,
      status: 'unknown',
      journalId: 'journal-cleanup',
      restoredPaths: [],
      unrecoveredPaths: [],
      externalEffects: ['dependency-install-state'],
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      recovery: { executed: false, status: 'unknown', journalId: 'journal-cleanup' },
      results: { totals: { unknown: 1, notAttempted: 0 } },
    })
    expectCompleteSnapshot(2)
  })

  it('retains all-no-change inspection after skipping stage, apply, and recovery', async () => {
    const update = makeResolved({
      name: 'unchanged',
      currentVersion: '1.0.0',
      targetVersion: '1.0.0',
      diff: 'major',
    })
    const pkg = makePkg('unchanged-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    mocks.commandWriteMock.mockImplementation(async (root, selections) => {
      const result = createCommandResultWithOutcomes(
        root,
        selections,
        [
          {
            packageIndex: 0,
            outcomes: [writeOutcome(pkg, update, 'skipped', 'NO_CHANGE', '1.0.0')],
          },
        ],
        [],
        false,
      )
      if (result.status !== 'executed') throw new Error('Expected executed result')
      return {
        ...result,
        applyResult: {
          ...result.applyResult,
          status: 'noop' as const,
          phases: [
            { name: 'preflight' as const, status: 'passed' as const, reason: 'READY' },
            { name: 'lock' as const, status: 'skipped' as const, reason: 'NO_CHANGES' },
            { name: 'inspect' as const, status: 'passed' as const, reason: 'OBSERVED' },
          ],
          recovery: { status: 'not-needed' as const },
        },
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(0)
    expect(events()).toContainEqual({
      type: 'stage-completed',
      status: 'skipped',
      observationRequired: true,
    })
    expect(events()).toContainEqual({
      type: 'phase-completed',
      phase: 'observe',
      status: 'passed',
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 0,
      results: { totals: { skipped: 1, notAttempted: 1 } },
    })
    expectCompleteSnapshot(0)
  })

  it('maps a clean lock conflict to a blocked zero-mutation stage', async () => {
    const update = makeResolved({ name: 'locked', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const pkg = makePkg('locked-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    mocks.commandWriteMock.mockImplementation(async (root, selections) => {
      const result = createCommandResultWithOutcomes(
        root,
        selections,
        [
          {
            packageIndex: 0,
            outcomes: [writeOutcome(pkg, update, 'conflicted', 'WRITE_FAILED')],
          },
        ],
        [],
        false,
      )
      if (result.status !== 'executed') throw new Error('Expected executed result')
      return {
        ...result,
        applyResult: {
          ...result.applyResult,
          status: 'conflicted' as const,
          phases: [
            { name: 'preflight' as const, status: 'passed' as const, reason: 'READY' },
            { name: 'lock' as const, status: 'failed' as const, reason: 'LOCK_HELD' },
          ],
          recovery: { status: 'not-needed' as const },
        },
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(events()).toContainEqual({
      type: 'phase-completed',
      phase: 'stage',
      status: 'blocked',
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      results: { totals: { blocked: 1, notAttempted: 1 } },
    })
    expectCompleteSnapshot(2)
  })

  it('retains stage failure and non-executed cleanup uncertainty', async () => {
    const update = makeResolved({
      name: 'staging',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    const pkg = makePkg('staging-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    mocks.commandWriteMock.mockImplementation(async (root, selections) => {
      const result = createCommandResultWithOutcomes(
        root,
        selections,
        [
          {
            packageIndex: 0,
            outcomes: [writeOutcome(pkg, update, 'unknown', 'WRITE_FAILED')],
          },
        ],
        [],
        false,
      )
      if (result.status !== 'executed') throw new Error('Expected executed result')
      return {
        ...result,
        applyResult: {
          ...result.applyResult,
          status: 'unknown' as const,
          phases: [
            { name: 'preflight' as const, status: 'passed' as const, reason: 'READY' },
            { name: 'lock' as const, status: 'passed' as const, reason: 'LOCKED' },
            { name: 'stage' as const, status: 'failed' as const, reason: 'STAGING_FAILED' },
            { name: 'cleanup' as const, status: 'unknown' as const, reason: 'RETAINED' },
          ],
          recovery: {
            status: 'unknown' as const,
            journalId: 'journal-stage',
            externalEffects: ['package-manager-cache' as const],
          },
        },
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(events()).toContainEqual({
      type: 'phase-completed',
      phase: 'stage',
      status: 'failed',
    })
    expect(events()).toContainEqual({
      type: 'recovery-recorded',
      executed: false,
      status: 'unknown',
      journalId: 'journal-stage',
      restoredPaths: [],
      unrecoveredPaths: [],
      externalEffects: ['package-manager-cache'],
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      results: { totals: { unknown: 1, notAttempted: 1 } },
    })
    expectCompleteSnapshot(2)
  })

  it('retains a clean precommit conflict without inventing recovery or observation', async () => {
    const update = makeResolved({
      name: 'precommit',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    const pkg = makePkg('precommit-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    mocks.commandWriteMock.mockImplementation(async (root, selections) => {
      const result = createCommandResultWithOutcomes(
        root,
        selections,
        [
          {
            packageIndex: 0,
            outcomes: [writeOutcome(pkg, update, 'conflicted', 'EXPECTED_VALUE_MISMATCH')],
          },
        ],
        [],
        false,
      )
      if (result.status !== 'executed') throw new Error('Expected executed result')
      return {
        ...result,
        applyResult: {
          ...result.applyResult,
          status: 'conflicted' as const,
          phases: [
            { name: 'preflight' as const, status: 'passed' as const, reason: 'READY' },
            { name: 'lock' as const, status: 'passed' as const, reason: 'LOCKED' },
            { name: 'stage' as const, status: 'passed' as const, reason: 'STAGED' },
            { name: 'precommit' as const, status: 'failed' as const, reason: 'SOURCE_CHANGED' },
            { name: 'cleanup' as const, status: 'passed' as const, reason: 'CLEAN' },
          ],
          recovery: { status: 'not-needed' as const },
        },
      }
    })
    const afterPackageEnd = vi.fn()
    const afterPackagesEnd = vi.fn()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({
      ...baseOptions,
      output: 'json',
      write: true,
      afterPackageEnd,
      afterPackagesEnd,
    })

    expect(exitCode).toBe(2)
    expect(events()).toContainEqual({
      type: 'apply-completed',
      status: 'failed',
      recoveryRequired: false,
      observationRequired: false,
    })
    expect(events()).not.toContainEqual(expect.objectContaining({ type: 'recovery-recorded' }))
    expect(afterPackageEnd).toHaveBeenCalledWith(pkg)
    expect(afterPackagesEnd).toHaveBeenCalledWith([pkg])
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      phases: expect.arrayContaining([
        { name: 'apply', status: 'failed' },
        { name: 'observe', status: 'skipped' },
        { name: 'recover', status: 'skipped' },
      ]),
      results: { totals: { blocked: 1, notAttempted: 1 } },
    })
    expectCompleteSnapshot(2)
  })

  it('finalizes one retained write result when a completion callback throws', async () => {
    const update = makeResolved({
      name: 'callback',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    const pkg = makePkg('callback-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({
      ...baseOptions,
      output: 'json',
      write: true,
      afterPackageWrite: () => {
        throw new Error('callback failed')
      },
    })

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      error: { message: 'callback failed' },
    })
    expect(events().filter((event) => event.type === 'results-recorded')).toHaveLength(1)
    expect(events().filter((event) => event.type === 'run-completed')).toHaveLength(1)
    expect(events()).toContainEqual({
      type: 'diagnostics-recorded',
      diagnostics: [{ code: 'CHECK_RUN_FAILED' }],
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      results: { totals: { applied: 1 } },
    })
    expectCompleteSnapshot(2)
  })

  it('keeps a model projection error primary while completing every returned package result', async () => {
    const updates = [
      makeResolved({ name: 'first', currentVersion: '1.0.0', targetVersion: '2.0.0' }),
      makeResolved({ name: 'second', currentVersion: '1.0.0', targetVersion: '2.0.0' }),
    ]
    const packages = [makePkg('first-app', [updates[0]!]), makePkg('second-app', [updates[1]!])]
    returnPackagesFromDiscovery(mocks, packages)
    mocks.resolvePackageMock.mockImplementation(async (pkg: PackageMeta) =>
      pkg === packages[0] ? [updates[0]!] : [updates[1]!],
    )
    mocks.commandWriteMock.mockImplementation(async (root, selections) => {
      const result = createCommandResultWithOutcomes(
        root,
        selections,
        selections.map(
          (selection: {
            packageIndex: number
            pkg: PackageMeta
            changes: ResolvedDepChange[]
          }) => ({
            packageIndex: selection.packageIndex,
            outcomes: selection.changes.map((change) =>
              writeOutcome(selection.pkg, change, 'applied', 'APPLIED', change.targetVersion),
            ),
          }),
        ),
      )
      if (result.status !== 'executed') throw new Error('Expected executed result')
      return { ...result, attempts: [] }
    })
    const afterPackageWrite = vi.fn((_pkg: PackageMeta) => {
      throw new Error('completion must not replace model error')
    })
    const afterPackageEnd = vi.fn()
    const afterPackagesEnd = vi.fn()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({
      ...baseOptions,
      output: 'json',
      write: true,
      afterPackageWrite,
      afterPackageEnd,
      afterPackagesEnd,
    })

    expect(exitCode).toBe(2)
    expect(normalizeJsonOutput(consoleSpy.mock.calls)).toMatchObject({
      error: {
        message: 'Check run instrumentation invariant: command target inventory is incomplete',
      },
    })
    expect(afterPackageWrite.mock.calls.map(([pkg]) => pkg.name)).toEqual([
      'first-app',
      'second-app',
    ])
    expect(afterPackageEnd.mock.calls.map(([pkg]) => pkg.name)).toEqual(['first-app', 'second-app'])
    expect(afterPackagesEnd).not.toHaveBeenCalled()
    expect(events()).toContainEqual({
      type: 'diagnostics-recorded',
      diagnostics: [{ code: 'CHECK_RUN_INVARIANT' }],
    })
    expectCompleteSnapshot(2)
  })

  it('records a fully bound pre-engine block as blocked and not attempted', async () => {
    const update = makeResolved({
      name: 'blocked',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    const pkg = makePkg('blocked-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    mocks.commandWriteMock.mockResolvedValue({
      status: 'blocked',
      packages: [
        {
          packageIndex: 0,
          outcomes: [writeOutcome(pkg, update, 'conflicted', 'AMBIGUOUS_OCCURRENCE')],
        },
      ],
      diagnostics: [],
      attempts: [
        {
          targetPath: 'blocked-app/package.json',
          operationIds: ['operation-blocked'],
          replacementAttempted: false,
        },
      ],
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(events()).toContainEqual({
      type: 'phase-completed',
      phase: 'preflight',
      status: 'blocked',
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      counts: { operations: 1, targets: 1 },
      results: {
        totals: { blocked: 1, notAttempted: 1 },
        targetTotals: { blocked: 1, notAttempted: 1 },
      },
    })
    expectCompleteSnapshot(2)
  })

  it('fails closed before selection when a blocked projection cannot bind to operation evidence', async () => {
    const update = makeResolved({
      name: 'unbound',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    const pkg = makePkg('unbound-app', [update])
    returnPackagesFromDiscovery(mocks, [pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    mocks.commandWriteMock.mockResolvedValue({
      status: 'blocked',
      packages: [
        {
          packageIndex: 0,
          outcomes: [writeOutcome(pkg, update, 'conflicted', 'AMBIGUOUS_OCCURRENCE')],
        },
      ],
      diagnostics: [],
      attempts: [],
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await runModeledCheck({ ...baseOptions, output: 'json', write: true })

    expect(exitCode).toBe(2)
    expect(events()).not.toContainEqual(expect.objectContaining({ type: 'selection-completed' }))
    expect(events()).toContainEqual({
      type: 'diagnostics-recorded',
      diagnostics: [{ code: 'CHECK_RUN_SELECTION_UNBOUND' }],
    })
    expect(events()).toContainEqual({
      type: 'phase-completed',
      phase: 'review',
      status: 'unknown',
    })
    expect(recording.controller.snapshot()).toMatchObject({
      exitCode: 2,
      counts: { operations: 0, targets: 0 },
      results: { operations: [], targets: [] },
    })
    expectCompleteSnapshot(2)
  })

  it.each([
    { global: true, write: false },
    { global: true, write: true },
  ])('keeps global=$global write=$write outside the model boundary', async (overrides) => {
    recording = createRecordingController(false)
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

function createRecordingController(write = false): RecordingController {
  const delegate = createCheckRunController({ mode: 'default', write, now: () => 0 })
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

function packageCountLogs(calls: unknown[][]): unknown[][] {
  return calls.filter((call) =>
    call.some((value) => typeof value === 'string' && value.startsWith('Found ')),
  )
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
