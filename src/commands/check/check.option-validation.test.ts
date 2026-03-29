import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, setupMocks } from './test-helpers'

describe('check option validation', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails fast when interactive mode is enabled without write', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, interactive: true, loglevel: 'info' })

    expect(result).toBe(2)
    expect(mocks.loadPackagesMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Check failed:',
      'Interactive mode requires write mode. Pass `--write` with `--interactive`.',
    )

    errorSpy.mockRestore()
  })
})
