import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('--update flag', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
    mocks.existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs pm update when update=true and write=true', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, update: true })

    expect(mocks.execSyncMock).toHaveBeenCalledWith('pnpm update', {
      cwd: '/tmp/test',
      stdio: 'inherit',
    })
  })

  it('does not run update when write=false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: false, update: true })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('update takes precedence over install', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'npm', version: '10.0.0', raw: 'npm@10.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, update: true, install: true })

    // Should run update, not install
    expect(mocks.execSyncMock).toHaveBeenCalledWith('npm update', {
      cwd: '/tmp/test',
      stdio: 'inherit',
    })
    expect(mocks.execSyncMock).not.toHaveBeenCalledWith('npm install', expect.anything())
  })

  it('does not run update when no updates', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, update: true })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run update when beforePackageWrite blocks all writes', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'npm', version: '10.0.0', raw: 'npm@10.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      write: true,
      update: true,
      beforePackageWrite: () => false,
    })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })
})
