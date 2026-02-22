import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('--verify-command flag', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes deps one at a time and runs verify command', async () => {
    const pkg = makePkg('my-app')
    const dep1 = makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' })
    const dep2 = makeResolved({ name: 'dep-b', diff: 'patch', targetVersion: '^1.0.1' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep1, dep2])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, verifyCommand: 'npm test' })

    // writePackage called once per dep (one at a time)
    expect(mocks.writePackageMock).toHaveBeenCalledTimes(2)
    expect(mocks.writePackageMock).toHaveBeenCalledWith(pkg, [dep1], 'silent')
    expect(mocks.writePackageMock).toHaveBeenCalledWith(pkg, [dep2], 'silent')

    // verify command called for each dep
    expect(mocks.execSyncMock).toHaveBeenCalledTimes(2)
    expect(mocks.execSyncMock).toHaveBeenCalledWith(
      'npm test',
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })

  it('reverts on verify command failure and continues', async () => {
    const pkg = makePkg('my-app')
    const dep1 = makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' })
    const dep2 = makeResolved({ name: 'dep-b', diff: 'patch', targetVersion: '^1.0.1' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep1, dep2])

    // First dep fails verify, second succeeds
    mocks.execSyncMock
      .mockImplementationOnce(() => {
        throw new Error('test failed')
      })
      .mockImplementationOnce(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, verifyCommand: 'npm test' })

    // restore called for the failed dep
    expect(mocks.restorePackageFilesMock).toHaveBeenCalledTimes(1)
    // backup called for both deps
    expect(mocks.backupPackageFilesMock).toHaveBeenCalledTimes(2)
    // writePackage still called for both (tried both)
    expect(mocks.writePackageMock).toHaveBeenCalledTimes(2)
  })

  it('reports applied and reverted counts', async () => {
    const pkg = makePkg('my-app')
    const dep1 = makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' })
    const dep2 = makeResolved({ name: 'dep-b', diff: 'patch', targetVersion: '^1.0.1' })
    const dep3 = makeResolved({ name: 'dep-c', diff: 'major', targetVersion: '^2.0.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep1, dep2, dep3])

    // First succeeds, second fails, third succeeds
    mocks.execSyncMock
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('test failed')
      })
      .mockImplementationOnce(() => {})

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, verifyCommand: 'npm test' })

    // 2 applied, 1 reverted — still returns 0 because write=true
    expect(result).toBe(0)
    expect(mocks.restorePackageFilesMock).toHaveBeenCalledTimes(1)
  })

  it('works with interactive mode too', async () => {
    const pkg = makePkg('my-app')
    const dep1 = makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep1])

    // Mock interactive module
    vi.doMock('./interactive', () => ({
      runInteractive: vi.fn().mockResolvedValue([dep1]),
    }))

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, interactive: true, verifyCommand: 'npm test' })

    // Should still use verify flow
    expect(mocks.backupPackageFilesMock).toHaveBeenCalled()
    expect(mocks.execSyncMock).toHaveBeenCalledWith(
      'npm test',
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })

  it('passes explain option into interactive mode', async () => {
    const pkg = makePkg('my-app')
    const dep1 = makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep1])

    const runInteractiveMock = vi.fn().mockResolvedValue([dep1])
    vi.doMock('./interactive', () => ({
      runInteractive: runInteractiveMock,
    }))

    const { check } = await import('./index')
    await check({ ...baseOptions, interactive: true, explain: true })

    expect(runInteractiveMock).toHaveBeenCalledWith([dep1], { explain: true })
  })
})
