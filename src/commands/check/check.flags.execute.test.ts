import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('--execute flag basics', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
    mocks.existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs command after write', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, execute: 'echo done' })

    expect(mocks.execSyncMock).toHaveBeenCalledWith('echo done', {
      cwd: '/tmp/test',
      stdio: 'inherit',
    })
  })

  it('does not run when write=false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: false, execute: 'echo done' })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run when no updates', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, execute: 'echo done' })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run when execute is undefined', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run when execute is empty string', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, execute: '' })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('handles command failure gracefully', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])
    mocks.execSyncMock.mockImplementation(() => {
      throw new Error('command failed')
    })

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, execute: 'exit 1' })

    expect(result).toBe(0)
    expect(mocks.execSyncMock).toHaveBeenCalled()
  })
})
