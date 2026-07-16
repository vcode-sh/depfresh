import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, setupMocks } from './test-helpers'

describe('legacy --execute flag', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  it('rejects shell-string execution before discovery and keeps hostile text inert', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { check } = await import('./index')

    const result = await check({
      ...baseOptions,
      write: true,
      execute: 'touch should-never-run; token=hidden',
    })

    expect(result).toBe(2)
    expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
    expect(mocks.execSyncMock).not.toHaveBeenCalled()
  })
})
