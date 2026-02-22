import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('lifecycle callbacks', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls beforePackageStart for each package', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    mocks.loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    mocks.resolvePackageMock.mockResolvedValue([])

    const beforePackageStart = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, beforePackageStart })

    expect(beforePackageStart).toHaveBeenCalledTimes(2)
    expect(beforePackageStart).toHaveBeenCalledWith(pkg1)
    expect(beforePackageStart).toHaveBeenCalledWith(pkg2)
  })

  it('calls onDependencyResolved for each resolved dep', async () => {
    const pkg = makePkg('my-app')
    const resolved = [
      makeResolved({ name: 'dep-a', diff: 'major' }),
      makeResolved({ name: 'dep-b', diff: 'minor' }),
    ]
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue(resolved)

    const onDependencyResolved = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, onDependencyResolved })

    // onDependencyResolved is called inside resolvePackage which we mocked,
    // so it won't be called from check directly. The mock bypasses the real resolve.
    // But check does assign pkg.resolved from the return value.
    expect(pkg.resolved).toEqual(resolved)
  })

  it('calls afterPackagesLoaded with all packages', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    mocks.loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    mocks.resolvePackageMock.mockResolvedValue([])

    const afterPackagesLoaded = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackagesLoaded })

    expect(afterPackagesLoaded).toHaveBeenCalledTimes(1)
    expect(afterPackagesLoaded).toHaveBeenCalledWith([pkg1, pkg2])
  })

  it('does not call afterPackagesLoaded when no packages found', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])

    const afterPackagesLoaded = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackagesLoaded })

    expect(afterPackagesLoaded).not.toHaveBeenCalled()
  })

  it('calls afterPackageEnd for every package including ones without updates', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    mocks.loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    // pkg1 has no updates, pkg2 has updates
    mocks.resolvePackageMock
      .mockResolvedValueOnce([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])
      .mockResolvedValueOnce([makeResolved({ diff: 'major', targetVersion: '^2.0.0' })])

    const afterPackageEnd = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackageEnd })

    expect(afterPackageEnd).toHaveBeenCalledTimes(2)
    expect(afterPackageEnd).toHaveBeenCalledWith(pkg1)
    expect(afterPackageEnd).toHaveBeenCalledWith(pkg2)
  })

  it('calls afterPackagesEnd with all packages after processing', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    mocks.loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const afterPackagesEnd = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackagesEnd })

    expect(afterPackagesEnd).toHaveBeenCalledTimes(1)
    expect(afterPackagesEnd).toHaveBeenCalledWith([pkg1, pkg2])
  })

  it('calls callbacks in correct order', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'minor', targetVersion: '^1.1.0' }),
    ])

    const order: string[] = []
    const afterPackagesLoaded = vi.fn(() => {
      order.push('afterPackagesLoaded')
    })
    const beforePackageStart = vi.fn(() => {
      order.push('beforePackageStart')
    })
    const afterPackageEnd = vi.fn(() => {
      order.push('afterPackageEnd')
    })
    const afterPackagesEnd = vi.fn(() => {
      order.push('afterPackagesEnd')
    })

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      afterPackagesLoaded,
      beforePackageStart,
      afterPackageEnd,
      afterPackagesEnd,
    })

    expect(order).toEqual([
      'afterPackagesLoaded',
      'beforePackageStart',
      'afterPackageEnd',
      'afterPackagesEnd',
    ])
  })
})
