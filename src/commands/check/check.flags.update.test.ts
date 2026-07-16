import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, setupMocks } from './test-helpers'

describe('--update retirement', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  it('rejects manager update before discovery or execution', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { check } = await import('./index')

    const result = await check({ ...baseOptions, write: true, update: true })

    expect(result).toBe(2)
    expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })
})
