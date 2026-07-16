import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('legacy --verify-command flag', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  it('rejects shell-string verification before discovery or writes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { check } = await import('./index')

    const result = await check({ ...baseOptions, write: true, verifyCommand: 'npm test' })

    expect(result).toBe(2)
    expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })

  it('still forwards explain to the file-only interactive flow', async () => {
    const pkg = makePkg('my-app')
    const dependency = makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dependency])
    const runInteractive = vi.fn().mockResolvedValue([dependency])
    vi.doMock('./interactive', () => ({ runInteractive }))
    const { check } = await import('./index')

    await check({ ...baseOptions, write: true, interactive: true, explain: true })

    expect(runInteractive).toHaveBeenCalledWith([dependency], { explain: true })
  })
})
