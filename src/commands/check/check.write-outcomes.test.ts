import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageMeta, ResolvedDepChange } from '../../types'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

const runExecuteMock = vi.hoisted(() => vi.fn())

vi.mock('../../validate-options', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../validate-options')>()
  return {
    ...actual,
    validateOptions: vi.fn((options, authority) =>
      actual.validateOptions({ ...options, execute: undefined, strictPostWrite: false }, authority),
    ),
  }
})

vi.mock('./post-write-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./post-write-actions')>()
  return { ...actual, runExecute: runExecuteMock }
})

describe('observed write outcome reporting', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  it('emits itemized JSON outcomes whose terminal counts reconcile exactly', async () => {
    const pkg = makePkg('my-app')
    const first = makeResolved({ name: 'first', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    const second = makeResolved({ name: 'second', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([first, second])
    mocks.writePackageMock.mockReturnValue({
      outcomes: [
        {
          name: 'first',
          occurrence: { file: pkg.filepath, path: ['dependencies', 'first'] },
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
          observedValue: '2.0.0',
          status: 'applied',
          reason: 'APPLIED',
        },
        {
          name: 'second',
          occurrence: { file: pkg.filepath, path: ['dependencies', 'second'] },
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
          observedValue: '1.5.0',
          status: 'conflicted',
          reason: 'EXPECTED_VALUE_MISMATCH',
        },
      ],
      diagnostics: [],
    })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json', write: true })
    const envelope = consoleSpy.mock.calls
      .map(([value]) => (typeof value === 'string' ? JSON.parse(value) : undefined))
      .find((value) => value?.packages)

    expect(exitCode).toBe(2)
    expect(envelope.writeOutcomes.map((outcome: { status: string }) => outcome.status)).toEqual([
      'applied',
      'conflicted',
    ])
    expect(envelope.summary).toMatchObject({
      plannedUpdates: 2,
      appliedUpdates: 1,
      skippedUpdates: 0,
      conflictedUpdates: 1,
      revertedUpdates: 0,
      failedWrites: 0,
      unknownWrites: 0,
    })
  })

  it('redacts secrets from itemized JSON write outcomes', async () => {
    const pkg = makePkg('my-app')
    const dep = makeResolved({
      name: 'hostile',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep])
    mocks.writePackageMock.mockReturnValue({
      outcomes: [
        {
          name: 'hostile',
          occurrence: { file: pkg.filepath, path: ['dependencies', 'hostile'] },
          expectedValue: 'https://user:password@registry.example/pkg?token=expected-secret',
          requestedValue: 'Bearer requested-secret',
          observedValue: 'NPM_TOKEN=observed-secret',
          status: 'conflicted',
          reason: 'EXPECTED_VALUE_MISMATCH',
        },
      ],
      diagnostics: [],
    })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json', write: true })
    const serialized = consoleSpy.mock.calls.map(([value]) => String(value)).join('\n')

    expect(exitCode).toBe(2)
    expect(serialized).toContain('registry.example')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toMatch(
      /user:password|expected-secret|requested-secret|observed-secret/u,
    )
  })

  it('does not run post-write actions after a conflicted physical occurrence', async () => {
    const pkg = makePkg('my-app')
    const dep = makeResolved({ name: 'shared', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep])
    mocks.writePackageMock.mockReturnValue({
      outcomes: [
        {
          name: 'shared',
          occurrence: { file: pkg.filepath, path: ['dependencies', 'shared'] },
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
          observedValue: '1.5.0',
          status: 'conflicted',
          reason: 'EXPECTED_VALUE_MISMATCH',
        },
      ],
      diagnostics: [],
    })

    const { check } = await import('./index')
    const exitCode = await check({
      ...baseOptions,
      write: true,
      execute: 'echo should-not-run',
      install: true,
    })

    expect(exitCode).toBe(2)
    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('keeps VCS_UNAVAILABLE in JSON without exposing internal diagnostics', async () => {
    const pkg = makePkg('my-app')
    const dep = makeResolved({ name: 'shared', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep])
    mocks.writePackageMock.mockReturnValue({
      outcomes: [
        {
          name: 'shared',
          occurrence: { file: pkg.filepath, path: ['dependencies', 'shared'] },
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
          status: 'unknown',
          reason: 'VCS_UNAVAILABLE',
        },
      ],
      diagnostics: [{ code: 'VCS_OUTPUT_LIMIT_EXCEEDED', path: 'package.json' }],
    })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json', write: true })
    const envelope = consoleSpy.mock.calls
      .map(([value]) => (typeof value === 'string' ? JSON.parse(value) : undefined))
      .find((value) => value?.packages)

    expect(exitCode).toBe(2)
    expect(envelope.writeOutcomes[0]).toMatchObject({
      status: 'unknown',
      reason: 'VCS_UNAVAILABLE',
    })
    expect(envelope.meta.schemaVersion).toBe(1)
    expect(envelope).not.toHaveProperty('diagnostics')
  })

  it('returns exit 2 and reports physical recovery for a reverted-only write', async () => {
    const pkg = makePkg('recovered-app')
    const dep = makeResolved({ name: 'recovered', currentVersion: '1.0.0', targetVersion: '2.0.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep])
    mocks.writePackageMock.mockReturnValue({
      outcomes: [
        {
          name: 'recovered',
          occurrence: { file: pkg.filepath, path: ['dependencies', 'recovered'] },
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
          observedValue: '1.0.0',
          status: 'reverted',
          reason: 'WRITE_FAILED',
        },
      ],
      diagnostics: [],
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'table', loglevel: 'info', write: true })
    const output = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().map(String).join('\n')

    expect(exitCode).toBe(2)
    expect(output).toContain(
      'Partial result · 0 updates applied across 0 files; 1 update reverted across 1 file',
    )
    expect(output).toContain('Exit 2 · inspect the changed files before rerunning')
  })

  it('renders the strict resolution exit after an otherwise complete write', async () => {
    const pkg = makePkg('resolution-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ name: 'applied', currentVersion: '1.0.0', targetVersion: '2.0.0' }),
      makeResolved({
        name: 'missing',
        currentVersion: '1.0.0',
        targetVersion: '1.0.0',
        diff: 'error',
      }),
    ])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({
      ...baseOptions,
      output: 'table',
      loglevel: 'info',
      write: true,
      failOnResolutionErrors: true,
    })
    const output = logSpy.mock.calls.flat().map(String).join('\n')

    expect(exitCode).toBe(2)
    expect(output).toContain('Complete · 1 update applied across 1 file')
    expect(output).toContain('Exit 2 · inspect the errors above before rerunning')
    expect(output).not.toContain('Exit 0')
  })

  it('renders the strict post-write exit after an otherwise complete write', async () => {
    const pkg = makePkg('post-write-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ name: 'applied', currentVersion: '1.0.0', targetVersion: '2.0.0' }),
    ])
    runExecuteMock.mockResolvedValue(false)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({
      ...baseOptions,
      output: 'table',
      loglevel: 'info',
      write: true,
      execute: 'retired-test-command',
      strictPostWrite: true,
    })
    const output = logSpy.mock.calls.flat().map(String).join('\n')

    expect(exitCode).toBe(2)
    expect(runExecuteMock).toHaveBeenCalledOnce()
    expect(output).toContain('Complete · 1 update applied across 1 file')
    expect(output).toContain('Exit 2 · inspect the errors above before rerunning')
    expect(output).not.toContain('Exit 0')
  })

  it('renders one physical-target receipt for a partial legacy write', async () => {
    const appliedPackages = Array.from({ length: 13 }, (_, index) => makePkg(`package-${index}`))
    const blockedPackage = { ...makePkg('root'), filepath: '/tmp/test/package.json' }
    mocks.loadPackagesMock.mockResolvedValue([...appliedPackages, blockedPackage])
    mocks.resolvePackageMock.mockImplementation((pkg: PackageMeta) => {
      const count =
        pkg.name === 'root' ? 41 : Number(pkg.name?.slice('package-'.length)) < 9 ? 3 : 2
      return Array.from({ length: count }, (_, index) =>
        makeResolved({ name: `${pkg.name}-dependency-${index}` }),
      )
    })
    mocks.writePackageMock.mockImplementation((pkg: PackageMeta, changes: ResolvedDepChange[]) => ({
      outcomes: changes.map((change) => ({
        name: change.name,
        occurrence: { file: pkg.filepath, path: ['dependencies', change.name] },
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
        ...(pkg.name === 'root'
          ? { status: 'unknown' as const, reason: 'VCS_UNAVAILABLE' as const }
          : {
              observedValue: '2.0.0',
              status: 'applied' as const,
              reason: 'APPLIED' as const,
            }),
      })),
      diagnostics:
        pkg.name === 'root'
          ? [{ code: 'VCS_OUTPUT_LIMIT_EXCEEDED' as const, path: 'package.json' }]
          : [],
    }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'table', loglevel: 'info', write: true })
    const output = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().map(String).join('\n')

    expect(exitCode).toBe(2)
    expect(output).toContain('Partial result · 35 updates applied across 13 files; 1 file blocked')
    expect(output.match(/package\.json · 41 updates not attempted/gu)).toHaveLength(1)
    expect(output).toContain(
      'Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_OUTPUT_LIMIT_EXCEEDED)',
    )
    expect(output).toContain('Exit 2 · inspect the changed files before rerunning')
    expect(output).not.toContain('Write unknown:')
  })
})
