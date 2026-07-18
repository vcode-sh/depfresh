import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('check', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 when no packages found', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 2 when no packages found and failOnNoPackages=true', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, failOnNoPackages: true })

    expect(result).toBe(2)
  })

  it('returns 0 when no updates available', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 0 when updates available and write=false (default)', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'major', targetVersion: '^2.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: false })

    expect(result).toBe(0)
  })

  it('returns 1 when updates available and failOnOutdated=true', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'major', targetVersion: '^2.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: false, failOnOutdated: true })

    expect(result).toBe(1)
  })

  it('returns 0 when no updates regardless of failOnOutdated', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, failOnOutdated: true })

    expect(result).toBe(0)
  })

  it('returns 0 after successful write regardless of failOnOutdated', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, failOnOutdated: true })

    expect(result).toBe(0)
    expect(mocks.commandWriteMock).toHaveBeenCalled()
  })

  it('returns 0 when updates available and write=true', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true })

    expect(result).toBe(0)
    expect(mocks.commandWriteMock).toHaveBeenCalled()
  })

  it('handles errors gracefully and returns 2', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('filesystem crash'))

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(2)
  })

  it('returns 2 on error even when failOnOutdated is true', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('filesystem crash'))

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, failOnOutdated: true })

    expect(result).toBe(2)
  })

  it('does not report all-up-to-date when every dependency fails to resolve', async () => {
    const pkg = makePkg('broken-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'missing-pkg',
        diff: 'error',
        currentVersion: '^1.0.0',
        targetVersion: '^1.0.0',
      }),
    ])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, loglevel: 'info' })

    expect(result).toBe(0)
    expect(
      logSpy.mock.calls.some((call) =>
        call.some((arg) => String(arg).includes('All dependencies are up to date')),
      ),
    ).toBe(false)
    expect(
      warnSpy.mock.calls.some((call) =>
        call.some((arg) => String(arg).includes('failed to resolve')),
      ),
    ).toBe(true)

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('returns 2 when resolution errors occur and failOnResolutionErrors=true', async () => {
    const pkg = makePkg('broken-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'missing-pkg',
        diff: 'error',
        currentVersion: '^1.0.0',
        targetVersion: '^1.0.0',
      }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, failOnResolutionErrors: true })

    expect(result).toBe(2)
  })

  it('calls the command adapter when write=true and beforePackageWrite returns true', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    const beforePackageWrite = vi.fn().mockResolvedValue(true)
    const afterPackageWrite = vi.fn()

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, beforePackageWrite, afterPackageWrite })

    expect(mocks.commandWriteMock).toHaveBeenCalledWith(
      '/tmp/test',
      [
        {
          packageIndex: 0,
          pkg,
          changes: expect.arrayContaining([
            expect.objectContaining({ name: 'test-dep', targetVersion: '^1.0.1' }),
          ]),
        },
      ],
      expect.objectContaining({ write: true }),
    )
    expect(afterPackageWrite).toHaveBeenCalledWith(
      pkg,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'test-dep',
          targetVersion: '^1.0.1',
        }),
      ]),
    )
  })

  it('skips write when beforePackageWrite returns false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    const beforePackageWrite = vi.fn().mockResolvedValue(false)
    const afterPackageWrite = vi.fn()

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, beforePackageWrite, afterPackageWrite })

    expect(mocks.commandWriteMock).not.toHaveBeenCalled()
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(afterPackageWrite).not.toHaveBeenCalled()
  })

  it('ends the package once and omits write-result hooks when the writer throws', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'patch', targetVersion: '^1.0.1' }),
    ])
    mocks.commandWriteMock.mockRejectedValueOnce(new Error('writer failed'))
    const afterPackageWrite = vi.fn()
    const afterPackageEnd = vi.fn()

    const { check } = await import('./index')
    const result = await check({
      ...baseOptions,
      write: true,
      afterPackageWrite,
      afterPackageEnd,
    })

    expect(result).toBe(2)
    expect(afterPackageWrite).not.toHaveBeenCalled()
    expect(afterPackageEnd).toHaveBeenCalledTimes(1)
    expect(afterPackageEnd).toHaveBeenCalledWith(pkg)
  })
})
