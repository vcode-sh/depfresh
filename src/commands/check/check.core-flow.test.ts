import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('check', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 when no packages found', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 0 when no updates available', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 0 when updates available and write=false (default)', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'major', targetVersion: '^2.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: false })

    expect(result).toBe(0)
  })

  it('returns 1 when updates available and failOnOutdated=true', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'major', targetVersion: '^2.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: false, failOnOutdated: true })

    expect(result).toBe(1)
  })

  it('returns 0 when no updates regardless of failOnOutdated', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, failOnOutdated: true })

    expect(result).toBe(0)
  })

  it('returns 0 after successful write regardless of failOnOutdated', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, failOnOutdated: true })

    expect(result).toBe(0)
    expect(mocks.writePackageMock).toHaveBeenCalled()
  })

  it('returns 0 when updates available and write=true', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true })

    expect(result).toBe(0)
    expect(mocks.writePackageMock).toHaveBeenCalled()
  })

  it('handles errors gracefully and returns 2', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('filesystem crash'))

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(2)
  })

  it('returns 2 on error even when failOnOutdated is true', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('filesystem crash'))

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, failOnOutdated: true })

    expect(result).toBe(2)
  })

  it('calls writePackage when write=true and beforePackageWrite returns true', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    const beforePackageWrite = vi.fn().mockResolvedValue(true)
    const afterPackageWrite = vi.fn()

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, beforePackageWrite, afterPackageWrite })

    expect(mocks.writePackageMock).toHaveBeenCalled()
    expect(afterPackageWrite).toHaveBeenCalledWith(pkg)
  })

  it('skips write when beforePackageWrite returns false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    const beforePackageWrite = vi.fn().mockResolvedValue(false)
    const afterPackageWrite = vi.fn()

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, beforePackageWrite, afterPackageWrite })

    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(afterPackageWrite).not.toHaveBeenCalled()
  })
})
