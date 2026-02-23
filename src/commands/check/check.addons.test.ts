import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshAddon } from '../../types'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('addons', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs addon lifecycle hooks in check flow', async () => {
    const pkg = makePkg('my-app')
    const resolved = [makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })]
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue(resolved)

    const setup = vi.fn()
    const afterPackagesLoaded = vi.fn()
    const beforePackageStart = vi.fn()
    const beforePackageWrite = vi.fn(() => true)
    const afterPackageWrite = vi.fn()
    const afterPackageEnd = vi.fn()
    const afterPackagesEnd = vi.fn()

    const addon: depfreshAddon = {
      name: 'test-addon',
      setup,
      afterPackagesLoaded,
      beforePackageStart,
      beforePackageWrite,
      afterPackageWrite,
      afterPackageEnd,
      afterPackagesEnd,
    }

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, addons: [addon] })

    expect(setup).toHaveBeenCalledTimes(1)
    expect(afterPackagesLoaded).toHaveBeenCalledTimes(1)
    expect(beforePackageStart).toHaveBeenCalledTimes(1)
    expect(beforePackageWrite).toHaveBeenCalledTimes(1)
    expect(afterPackageWrite).toHaveBeenCalledTimes(1)
    expect(afterPackageWrite).toHaveBeenCalledWith(expect.any(Object), pkg, resolved)
    expect(afterPackageEnd).toHaveBeenCalledTimes(1)
    expect(afterPackagesEnd).toHaveBeenCalledTimes(1)
    expect(mocks.writePackageMock).toHaveBeenCalledTimes(1)
  })

  it('skips write when addon beforePackageWrite returns false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    const addon: depfreshAddon = {
      name: 'skip-write',
      beforePackageWrite: () => false,
    }

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, addons: [addon] })

    expect(mocks.writePackageMock).not.toHaveBeenCalled()
  })

  it('returns exit code 2 when addon setup throws', async () => {
    const addon: depfreshAddon = {
      name: 'failing-addon',
      setup() {
        throw new Error('setup failed')
      },
    }

    const { check } = await import('./index')
    const code = await check({ ...baseOptions, addons: [addon] })

    expect(code).toBe(2)
  })
})
