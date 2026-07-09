import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions, PackageMeta, ResolvedDepChange } from '../../types'
import {
  baseOptions,
  type CheckMocks,
  findJsonEnvelope,
  makePkg,
  makeResolved,
  resolvedSnapshot,
  setupMocks,
} from './test-helpers'

type OrchestrationMode = 'concurrent' | 'sequential'

interface ScenarioResult {
  exitCode: number
  packages: PackageMeta[]
  resolved: Record<string, ResolvedDepChange[]>
  updateCount: number
  beforePackageStartNames: string[]
  json?: ReturnType<typeof findJsonEnvelope>
}

const originalIsTTY = process.stdout.isTTY

describe('run-check orchestration paths', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    setStdoutTTY(originalIsTTY)
    vi.restoreAllMocks()
  })

  it('passes one shared resolve context to every package on the concurrent path', async () => {
    await runScenario('concurrent')

    expect(mocks.resolvePackageMock).toHaveBeenCalledTimes(2)
    const calls = mocks.resolvePackageMock.mock.calls
    const firstContext = calls[0]?.[6]

    expect(firstContext).toBeDefined()
    expect(calls.every((call) => call.length >= 7)).toBe(true)
    expect(calls[1]?.[6]).toBe(firstContext)
  })

  it('passes one shared resolve context and progress callback on the sequential TTY table path', async () => {
    await runScenario('sequential', { profile: true })

    expect(mocks.resolvePackageMock).toHaveBeenCalledTimes(2)
    const calls = mocks.resolvePackageMock.mock.calls
    const firstContext = calls[0]?.[6]

    expect(firstContext).toBeDefined()
    expect(calls.every((call) => call.length >= 7)).toBe(true)
    expect(calls.every((call) => typeof call[5] === 'function')).toBe(true)
    expect(calls[1]?.[6]).toBe(firstContext)
  })

  it('keeps exit code, resolved sets, counts, and start hooks equal across both paths', async () => {
    const concurrent = await runScenario('concurrent')
    vi.clearAllMocks()
    mocks = await setupMocks()
    const sequential = await runScenario('sequential')

    expect(concurrent.exitCode).toBe(0)
    expect(sequential.exitCode).toBe(concurrent.exitCode)
    expect(sequential.resolved).toEqual(concurrent.resolved)
    expect(sequential.updateCount).toBe(concurrent.updateCount)
    expect(sequential.updateCount).toBe(1)
    expect(concurrent.beforePackageStartNames).toEqual(['app-update', 'app-current'])
    expect(sequential.beforePackageStartNames).toEqual(['app-update', 'app-current'])
  })

  it('returns failOnOutdated exit code on both orchestration paths', async () => {
    const concurrent = await runScenario('concurrent', { failOnOutdated: true })
    vi.clearAllMocks()
    mocks = await setupMocks()
    const sequential = await runScenario('sequential', { failOnOutdated: true })

    expect(concurrent.exitCode).toBe(1)
    expect(sequential.exitCode).toBe(concurrent.exitCode)
    expect(sequential.resolved).toEqual(concurrent.resolved)
  })

  it('reports the same mixed-fixture counts in the concurrent JSON envelope', async () => {
    const result = await runScenario('concurrent')

    expect(result.json?.summary).toMatchObject({
      scannedPackages: 2,
      packagesWithUpdates: 1,
      total: 1,
      major: 1,
      minor: 0,
      patch: 0,
      plannedUpdates: 0,
      appliedUpdates: 0,
      revertedUpdates: 0,
      failedResolutions: 0,
    })
    expect(result.json?.packages).toEqual([
      {
        name: 'app-update',
        updates: [
          {
            name: 'needs-update',
            current: '^1.0.0',
            target: '^2.0.0',
            diff: 'major',
            source: 'dependencies',
          },
        ],
      },
    ])
  })

  it('keeps single-package runs on the unified path even without progress rendering', async () => {
    const dep = makeResolved({
      name: 'solo-dep',
      diff: 'minor',
      currentVersion: '^1.0.0',
      targetVersion: '^1.1.0',
    })
    const pkg = makePkg('solo-app', [dep])
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(0)
    expect(mocks.resolvePackageMock).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePackageMock.mock.calls[0]?.length).toBeGreaterThanOrEqual(7)
    expect(mocks.resolvePackageMock.mock.calls[0]?.[5]).toBeUndefined()
    expect(mocks.resolvePackageMock.mock.calls[0]?.[6]).toBeDefined()
    expect(findJsonEnvelope(consoleSpy.mock.calls).summary.scannedPackages).toBe(1)
  })

  async function runScenario(
    mode: OrchestrationMode,
    overrides: Partial<depfreshOptions> = {},
  ): Promise<ScenarioResult> {
    const packages = makeMixedPackages()
    const beforePackageStart = vi.fn()
    mocks.loadPackagesMock.mockResolvedValue(packages)
    mocks.resolvePackageMock.mockImplementation(async (pkg: PackageMeta) => resolvedForPackage(pkg))

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const options =
      mode === 'concurrent'
        ? { ...baseOptions, output: 'json' as const, beforePackageStart, ...overrides }
        : {
            ...baseOptions,
            output: 'table' as const,
            loglevel: 'info' as const,
            beforePackageStart,
            ...overrides,
          }

    let stdoutWriteSpy: ReturnType<typeof vi.spyOn> | undefined
    if (mode === 'sequential') {
      setStdoutTTY(true)
      stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    } else {
      setStdoutTTY(false)
    }

    try {
      const { check } = await import('./index')
      const exitCode = await check(options)
      const resolved = resolvedSnapshot(packages)

      return {
        exitCode,
        packages,
        resolved,
        updateCount: countUpdates(resolved),
        beforePackageStartNames: packageNamesFrom(beforePackageStart),
        ...(mode === 'concurrent' ? { json: findJsonEnvelope(consoleSpy.mock.calls) } : {}),
      }
    } finally {
      stdoutWriteSpy?.mockRestore()
      consoleSpy.mockRestore()
      setStdoutTTY(originalIsTTY)
    }
  }
})

function makeMixedPackages(): PackageMeta[] {
  return [
    makePkg('app-update', [
      makeResolved({
        name: 'needs-update',
        diff: 'major',
        currentVersion: '^1.0.0',
        targetVersion: '^2.0.0',
      }),
    ]),
    makePkg('app-current', [
      makeResolved({
        name: 'already-current',
        diff: 'none',
        currentVersion: '^1.0.0',
        targetVersion: '^1.0.0',
      }),
    ]),
  ]
}

function resolvedForPackage(pkg: PackageMeta): ResolvedDepChange[] {
  if (pkg.name === 'app-update') {
    return [
      makeResolved({
        name: 'needs-update',
        diff: 'major',
        currentVersion: '^1.0.0',
        targetVersion: '^2.0.0',
      }),
    ]
  }

  return [
    makeResolved({
      name: 'already-current',
      diff: 'none',
      currentVersion: '^1.0.0',
      targetVersion: '^1.0.0',
    }),
  ]
}

function countUpdates(snapshot: Record<string, ResolvedDepChange[]>): number {
  return Object.values(snapshot)
    .flat()
    .filter((dep) => dep.diff !== 'none' && dep.diff !== 'error').length
}

function packageNamesFrom(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map(([pkg]) => (pkg as PackageMeta).name ?? '(unnamed)')
}

function setStdoutTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    writable: true,
    value,
  })
}
