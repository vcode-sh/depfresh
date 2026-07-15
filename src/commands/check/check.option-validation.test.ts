import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('check option validation', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails fast when interactive mode is enabled without write', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, interactive: true, loglevel: 'info' })

    expect(result).toBe(2)
    expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Check failed:',
      'Interactive mode requires write mode. Pass `--write` with `--interactive`.',
    )

    errorSpy.mockRestore()
  })

  it.each([
    [
      'write',
      { write: true },
      {
        write: false,
        install: false,
        update: false,
        execute: false,
        verifyCommand: false,
        globalWrite: false,
      },
    ],
    [
      'install',
      { write: true, install: true },
      {
        write: true,
        install: false,
        update: false,
        execute: false,
        verifyCommand: false,
        globalWrite: false,
      },
    ],
    [
      'execute',
      { write: true, execute: 'touch forbidden' },
      {
        write: true,
        install: false,
        update: false,
        execute: false,
        verifyCommand: false,
        globalWrite: false,
      },
    ],
    [
      'verify-command',
      { write: true, verifyCommand: 'touch forbidden' },
      {
        write: true,
        install: false,
        update: false,
        execute: false,
        verifyCommand: false,
        globalWrite: false,
      },
    ],
    [
      'global-write',
      { write: true, global: true },
      {
        write: true,
        install: false,
        update: false,
        execute: false,
        verifyCommand: false,
        globalWrite: false,
      },
    ],
  ])(
    'rejects %s options without matching immutable invocation authority',
    async (_, options, authority) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { check } = await import('./index')

      const result = await check(
        { ...baseOptions, ...options, loglevel: 'info' },
        authority as never,
      )

      expect(result).toBe(2)
      expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
      expect(mocks.writePackageMock).not.toHaveBeenCalled()
      expect(mocks.execSyncMock).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.any(String),
        'Check failed:',
        expect.stringContaining('explicit invocation authority'),
      )
    },
  )

  it.each([
    [{ install: true }, '--install requires --write'],
    [{ update: true }, '--update requires --write'],
    [{ execute: 'echo done' }, '--execute requires --write'],
    [{ verifyCommand: 'pnpm test' }, '--verify-command requires --write'],
    [{ write: true, install: true, update: true }, '--install cannot be combined with --update'],
  ])('rejects unsupported option combination %j before discovery', async (options, message) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { check } = await import('./index')

    const result = await check({ ...baseOptions, ...options, loglevel: 'info' })

    expect(result).toBe(2)
    expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Check failed:',
      expect.stringContaining(message),
    )
  })

  it('snapshots caller-provided authority before asynchronous work', async () => {
    mocks.loadPackagesMock.mockResolvedValue([makePkg('authority-snapshot')])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])
    const authority = {
      write: true,
      install: false,
      update: false,
      execute: false,
      verifyCommand: false,
      globalWrite: false,
    }
    const { check } = await import('./index')

    const resultPromise = check({ ...baseOptions, write: true }, authority)
    authority.write = false
    const result = await resultPromise

    expect(result).toBe(0)
    expect(mocks.writePackageMock).toHaveBeenCalledTimes(1)
  })

  it('does not write when authority is broader than the resolved options', async () => {
    mocks.loadPackagesMock.mockResolvedValue([makePkg('authority-is-not-intent')])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])
    const { check } = await import('./index')

    const result = await check(
      { ...baseOptions, write: false },
      {
        write: true,
        install: true,
        update: true,
        execute: true,
        verifyCommand: true,
        globalWrite: true,
      },
    )

    expect(result).toBe(0)
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })
})
