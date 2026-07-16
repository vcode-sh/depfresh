import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, setupMocks } from './test-helpers'

describe('legacy --install and --update flags', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  it.each(['install', 'update'] as const)(
    'rejects --%s before discovery or process execution',
    async (option) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { check } = await import('./index')

      const result = await check({ ...baseOptions, write: true, [option]: true })

      expect(result).toBe(2)
      expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
      expect(mocks.execSyncMock).not.toHaveBeenCalled()
    },
  )
})
