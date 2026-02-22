import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('--install flag', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
    mocks.existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs install after write when install=true and write=true', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, install: true })

    expect(mocks.execSyncMock).toHaveBeenCalledWith('pnpm install', {
      cwd: '/tmp/test',
      stdio: 'inherit',
    })
  })

  it('does not run install when write=false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: false, install: true })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run install when install=false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, install: false })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run install when no updates', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, install: true })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('handles install failure gracefully without changing exit code', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'npm', version: '10.0.0', raw: 'npm@10.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])
    mocks.execSyncMock.mockImplementation(() => {
      throw new Error('install failed')
    })

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, install: true })

    // Exit code should be 0 (write succeeded), not affected by install failure
    expect(result).toBe(0)
    expect(mocks.execSyncMock).toHaveBeenCalled()
  })

  it('does not run install when beforePackageWrite blocks all writes', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      write: true,
      install: true,
      beforePackageWrite: () => false,
    })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run install when verify reverts all deps', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    mocks.execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'npm test') throw new Error('test failed')
    })

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      write: true,
      install: true,
      verifyCommand: 'npm test',
    })

    // verify command was called but install should not fire (0 applied)
    expect(mocks.execSyncMock).not.toHaveBeenCalledWith('pnpm install', expect.anything())
  })
})
