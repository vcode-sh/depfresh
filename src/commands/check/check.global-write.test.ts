import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageMeta } from '../../types'
import { baseOptions, type CheckMocks, makeResolved, setupMocks } from './test-helpers'

describe('global write dispatch', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls writeGlobalPackage for global type packages', async () => {
    const pkg: PackageMeta = {
      name: 'Global packages',
      type: 'global',
      filepath: 'global:npm',
      deps: [
        {
          name: 'typescript',
          currentVersion: '5.0.0',
          source: 'dependencies',
          update: true,
          parents: [],
        },
      ],
      resolved: [],
      raw: {},
      indent: '  ',
    }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'typescript',
        diff: 'major',
        currentVersion: '5.0.0',
        targetVersion: '6.0.0',
      }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true })

    expect(mocks.writeGlobalPackageMock).toHaveBeenCalledWith('npm', 'typescript', '6.0.0')
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
  })

  it('extracts PM name from filepath (global:pnpm -> pnpm)', async () => {
    const pkg: PackageMeta = {
      name: 'Global packages',
      type: 'global',
      filepath: 'global:pnpm',
      deps: [
        {
          name: 'eslint',
          currentVersion: '8.0.0',
          source: 'dependencies',
          update: true,
          parents: [],
        },
      ],
      resolved: [],
      raw: {},
      indent: '  ',
    }
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'eslint',
        diff: 'major',
        currentVersion: '8.0.0',
        targetVersion: '9.0.0',
      }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true })

    expect(mocks.writeGlobalPackageMock).toHaveBeenCalledWith('pnpm', 'eslint', '9.0.0')
  })

  it('skips regular writePackage for global type', async () => {
    const globalPkg: PackageMeta = {
      name: 'Global packages',
      type: 'global',
      filepath: 'global:bun',
      deps: [
        { name: 'tsx', currentVersion: '4.0.0', source: 'dependencies', update: true, parents: [] },
      ],
      resolved: [],
      raw: {},
      indent: '  ',
    }
    mocks.loadPackagesMock.mockResolvedValue([globalPkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ name: 'tsx', diff: 'minor', currentVersion: '4.0.0', targetVersion: '4.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true })

    expect(mocks.writeGlobalPackageMock).toHaveBeenCalledWith('bun', 'tsx', '4.1.0')
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
  })

  it('writes deduped global package updates to every mapped package manager target', async () => {
    const pkg: PackageMeta = {
      name: 'Global packages',
      type: 'global',
      filepath: 'global:npm+pnpm+bun',
      deps: [
        {
          name: 'typescript',
          currentVersion: '5.0.0',
          source: 'dependencies',
          update: true,
          parents: [],
        },
      ],
      resolved: [],
      raw: {
        managersByDependency: {
          typescript: ['npm', 'pnpm'],
        },
      },
      indent: '  ',
    }

    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'typescript',
        diff: 'major',
        currentVersion: '5.0.0',
        targetVersion: '6.0.0',
      }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true })

    expect(mocks.writeGlobalPackageMock).toHaveBeenCalledWith('npm', 'typescript', '6.0.0')
    expect(mocks.writeGlobalPackageMock).toHaveBeenCalledWith('pnpm', 'typescript', '6.0.0')
    expect(mocks.writeGlobalPackageMock).toHaveBeenCalledTimes(2)
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
  })
})
