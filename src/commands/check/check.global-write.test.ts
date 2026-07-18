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

  it('routes npm global updates through the state-machine plan', async () => {
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
      raw: { versionsByDependency: { typescript: { npm: '5.0.0' } } },
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
    await check({ ...baseOptions, write: true, global: true })

    expect(mocks.createGlobalApplyPlanMock).toHaveBeenCalledWith(
      [
        {
          manager: 'npm',
          name: 'typescript',
          expectedVersion: '5.0.0',
          targetVersion: '6.0.0',
        },
      ],
      { cwd: '/tmp/test', timeoutMs: 120_000 },
    )
    expect(mocks.applyGlobalPlanMock).toHaveBeenCalledTimes(1)
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
      raw: { versionsByDependency: { eslint: { pnpm: '8.0.0' } } },
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
    await check({ ...baseOptions, write: true, global: true })

    expect(mocks.createGlobalApplyPlanMock).toHaveBeenCalledWith(
      [
        {
          manager: 'pnpm',
          name: 'eslint',
          expectedVersion: '8.0.0',
          targetVersion: '9.0.0',
        },
      ],
      { cwd: '/tmp/test', timeoutMs: 120_000 },
    )
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
      raw: { versionsByDependency: { tsx: { bun: '4.0.0' } } },
      indent: '  ',
    }
    mocks.loadPackagesMock.mockResolvedValue([globalPkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ name: 'tsx', diff: 'minor', currentVersion: '4.0.0', targetVersion: '4.1.0' }),
    ])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, global: true })

    expect(mocks.createGlobalApplyPlanMock).toHaveBeenCalledWith(
      [
        {
          manager: 'bun',
          name: 'tsx',
          expectedVersion: '4.0.0',
          targetVersion: '4.1.0',
        },
      ],
      { cwd: '/tmp/test', timeoutMs: 120_000 },
    )
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
        versionsByDependency: {
          typescript: { npm: '5.0.0', pnpm: '4.9.0' },
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
    await check({ ...baseOptions, write: true, globalAll: true })

    expect(mocks.createGlobalApplyPlanMock).toHaveBeenCalledWith(
      [
        {
          manager: 'npm',
          name: 'typescript',
          expectedVersion: '5.0.0',
          targetVersion: '6.0.0',
        },
        {
          manager: 'pnpm',
          name: 'typescript',
          expectedVersion: '4.9.0',
          targetVersion: '6.0.0',
        },
      ],
      { cwd: '/tmp/test', timeoutMs: 120_000 },
    )
    expect(mocks.writePackageMock).not.toHaveBeenCalled()
  })

  it('keeps global non-success truth out of the physical-file receipt', async () => {
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
      raw: { versionsByDependency: { typescript: { npm: '5.0.0' } } },
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
    mocks.applyGlobalPlanMock.mockResolvedValue({
      contract: 'depfresh.global-apply',
      schemaVersion: 1,
      toolVersion: '2.0.1',
      planFingerprint: 'a'.repeat(64),
      status: 'unknown',
      items: [
        {
          operationId: 'operation-0',
          occurrenceId: 'occurrence-0',
          manager: 'npm',
          name: 'typescript',
          expectedVersion: '5.0.0',
          targetVersion: '6.0.0',
          status: 'unknown',
          reason: 'INVENTORY_TIMEOUT',
        },
      ],
      commands: [],
      summary: {
        planned: 1,
        applied: 0,
        skipped: 0,
        conflicted: 0,
        failed: 0,
        unknown: 1,
      },
      requiredCapabilities: ['global-write', 'process-execute'],
      rollback: 'not-supported',
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({
      ...baseOptions,
      write: true,
      global: true,
      loglevel: 'info',
    })
    const stdout = logSpy.mock.calls.flat().map(String).join('\n')
    const stderr = warnSpy.mock.calls.flat().map(String).join('\n')

    expect(exitCode).toBe(2)
    expect(stdout).toContain('Global writes: 0 applied, 0 skipped, 0 failed, 1 unknown')
    expect(`${stdout}\n${stderr}`).not.toMatch(/(?:Complete|Partial result|Safety block).*across/u)
    expect(`${stdout}\n${stderr}`).not.toContain('global:npm ·')
  })

  it('exposes the state-machine run result in legacy JSON output', async () => {
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
      raw: { versionsByDependency: { typescript: { npm: '5.0.0' } } },
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
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { check } = await import('./index')

    await check({ ...baseOptions, write: true, global: true, output: 'json' })

    const envelope = output.mock.calls
      .map(([value]) => (typeof value === 'string' ? JSON.parse(value) : undefined))
      .find((value) => value?.packages)
    expect(envelope.globalResults).toMatchObject([
      { contract: 'depfresh.global-apply', status: 'applied', rollback: 'not-supported' },
    ])
  })
})
