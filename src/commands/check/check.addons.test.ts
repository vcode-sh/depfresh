import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVSCodeAddon } from '../../addons'
import { ConfigError } from '../../errors'
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

    const order: string[] = []
    const setup = vi.fn(() => {
      order.push('setup')
    })
    const afterPackagesLoaded = vi.fn(() => {
      order.push('afterPackagesLoaded')
    })
    const beforePackageStart = vi.fn(() => {
      order.push('beforePackageStart')
    })
    const beforePackageWrite = vi.fn(() => {
      order.push('beforePackageWrite')
      return true
    })
    const afterPackageWrite = vi.fn(() => {
      order.push('afterPackageWrite')
    })
    const afterPackageEnd = vi.fn(() => {
      order.push('afterPackageEnd')
    })
    const afterPackagesEnd = vi.fn(() => {
      order.push('afterPackagesEnd')
    })

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
    expect(order).toEqual([
      'setup',
      'afterPackagesLoaded',
      'beforePackageStart',
      'beforePackageWrite',
      'afterPackageWrite',
      'afterPackageEnd',
      'afterPackagesEnd',
    ])
    expect(beforePackageWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writePackageMock.mock.invocationCallOrder[0]!,
    )
    expect(mocks.writePackageMock.mock.invocationCallOrder[0]).toBeLessThan(
      afterPackageWrite.mock.invocationCallOrder[0]!,
    )
  })

  it('skips write when addon beforePackageWrite returns false', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'patch', targetVersion: '^1.0.1' }),
    ])

    const afterPackageWrite = vi.fn()
    const afterPackageEnd = vi.fn()
    const afterPackagesEnd = vi.fn()
    const addon: depfreshAddon = {
      name: 'skip-write',
      beforePackageWrite: () => false,
      afterPackageWrite,
      afterPackageEnd,
      afterPackagesEnd,
    }

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, addons: [addon] })

    expect(mocks.writePackageMock).not.toHaveBeenCalled()
    expect(afterPackageWrite).not.toHaveBeenCalled()
    expect(afterPackageEnd).toHaveBeenCalledTimes(1)
    expect(afterPackagesEnd).toHaveBeenCalledTimes(1)
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

  it('binds CLI selection before addon setup can perform side effects', async () => {
    const setup = vi.fn()
    mocks.loadPackagesMock.mockRejectedValue(
      new ConfigError('Selection target is unavailable.', {
        reason: 'SELECTION_TARGET_UNPROVEN',
      }),
    )

    const { checkFromCli } = await import('./run-check')
    const code = await checkFromCli(
      { ...baseOptions, addons: [{ name: 'side-effect-addon', setup }] },
      undefined,
      { workspaces: ['apps/missing'], catalogs: [] },
    )

    expect(code).toBe(2)
    expect(setup).not.toHaveBeenCalled()
  })

  it('creates engines.vscode when syncing @types/vscode into a package without engines', async () => {
    const pkg = makePkg('vscode-ext')
    ;(pkg.raw as { engines?: unknown }).engines = undefined
    const resolved = [
      makeResolved({
        name: '@types/vscode',
        diff: 'minor',
        targetVersion: '^1.92.0',
      }),
    ]

    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue(resolved)

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, addons: [createVSCodeAddon()] })

    expect(pkg.raw).toMatchObject({
      engines: {
        vscode: '^1.92.0',
      },
    })
    expect(mocks.writePackageMock).toHaveBeenCalledWith(
      pkg,
      resolved,
      'silent',
      expect.objectContaining({ write: true }),
    )
  })
})
