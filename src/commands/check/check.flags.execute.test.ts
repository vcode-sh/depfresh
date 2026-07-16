import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, setupMocks } from './test-helpers'

describe('--execute retirement', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  it('rejects the legacy string command without logging or executing its contents', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { check } = await import('./index')

    const result = await check({
      ...baseOptions,
      write: true,
      execute: 'deploy --token top-secret',
    })

    expect(result).toBe(2)
    expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
    expect(mocks.execSyncMock).not.toHaveBeenCalled()
    expect([...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ')).not.toContain(
      'top-secret',
    )
  })
})
