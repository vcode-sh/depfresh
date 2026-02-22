import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('--execute flag interactions', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
    mocks.existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs before install', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const callOrder: string[] = []
    mocks.execSyncMock.mockImplementation((cmd: string) => {
      callOrder.push(cmd)
    })

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, execute: 'echo done', install: true })

    expect(callOrder[0]).toBe('echo done')
    expect(callOrder[1]).toBe('pnpm install')
  })

  it('runs before update', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'npm', version: '10.0.0', raw: 'npm@10.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const callOrder: string[] = []
    mocks.execSyncMock.mockImplementation((cmd: string) => {
      callOrder.push(cmd)
    })

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, execute: 'echo done', update: true })

    expect(callOrder[0]).toBe('echo done')
    expect(callOrder[1]).toBe('npm update')
  })

  it('install still runs when execute fails', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const callOrder: string[] = []
    mocks.execSyncMock.mockImplementation((cmd: string) => {
      callOrder.push(cmd)
      if (cmd === 'bad-cmd') {
        throw new Error('command not found')
      }
    })

    const { check } = await import('./index')
    const result = await check({
      ...baseOptions,
      write: true,
      execute: 'bad-cmd',
      install: true,
    })

    expect(result).toBe(0)
    expect(callOrder).toEqual(['bad-cmd', 'pnpm install'])
  })

  it('runs exactly once with multiple packages', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    const pkg3 = makePkg('app-c')
    mocks.loadPackagesMock.mockResolvedValue([pkg1, pkg2, pkg3])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const executeCalls: string[] = []
    mocks.execSyncMock.mockImplementation((cmd: string) => {
      executeCalls.push(cmd)
    })

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, execute: 'pnpm test' })

    expect(executeCalls).toEqual(['pnpm test'])
  })

  it('does not run when beforePackageWrite blocks all writes', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      write: true,
      execute: 'echo done',
      beforePackageWrite: () => false,
    })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run when verify reverts all deps', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' }),
      makeResolved({ name: 'dep-b', diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    mocks.execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'npm test') throw new Error('test failed')
    })

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      write: true,
      execute: 'echo done',
      verifyCommand: 'npm test',
    })

    expect(mocks.execSyncMock).not.toHaveBeenCalledWith('echo done', expect.anything())
  })

  it('runs when verify applies at least one dep', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ name: 'dep-a', diff: 'minor', targetVersion: '^1.1.0' }),
      makeResolved({ name: 'dep-b', diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    let verifyCallCount = 0
    mocks.execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'npm test') {
        verifyCallCount++
        if (verifyCallCount === 2) throw new Error('test failed')
      }
    })

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      write: true,
      execute: 'echo done',
      verifyCommand: 'npm test',
    })

    expect(mocks.execSyncMock).toHaveBeenCalledWith('echo done', {
      cwd: '/tmp/test',
      stdio: 'inherit',
    })
  })

  it('does not run when interactive selects nothing', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    vi.doMock('./interactive', () => ({
      runInteractive: vi.fn().mockResolvedValue([]),
    }))

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      write: true,
      interactive: true,
      execute: 'echo done',
    })

    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })
})
