import { beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

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
})
