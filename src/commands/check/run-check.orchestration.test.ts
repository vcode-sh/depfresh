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
  tableOutput?: string
  json?: ReturnType<typeof findJsonEnvelope>
}

const originalIsTTY = process.stdout.isTTY
const originalCi = process.env.CI
const originalTerm = process.env.TERM

describe('run-check orchestration paths', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    delete process.env.CI
    process.env.TERM = 'xterm-256color'
    mocks = await setupMocks()
  })

  afterEach(() => {
    setStdoutTTY(originalIsTTY)
    restoreEnvironment('CI', originalCi)
    restoreEnvironment('TERM', originalTerm)
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
    const result = await runScenario('sequential', { profile: true })

    expect(mocks.resolvePackageMock).toHaveBeenCalledTimes(2)
    const calls = mocks.resolvePackageMock.mock.calls
    const firstContext = calls[0]?.[6]

    expect(firstContext).toBeDefined()
    expect(calls.every((call) => call.length >= 7)).toBe(true)
    expect(calls.every((call) => typeof call[5] === 'function')).toBe(true)
    expect(calls[1]?.[6]).toBe(firstContext)
    expect(mocks.loadPackagesMock.mock.calls[0]?.[1]).toEqual({
      onPackagesDiscovered: expect.any(Function),
      writeDurable: expect.any(Function),
    })
    expect(result.tableOutput).toContain('Checked 2 packages')
    expect(result.tableOutput).toContain('1 update in 1 package')
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

  it('does not render durable package results until the repository resolution phase is complete', async () => {
    const packages = makeMixedPackages()
    mocks.loadPackagesMock.mockImplementation(
      async (
        _options: depfreshOptions,
        observer?: { onPackagesDiscovered(pkgs: PackageMeta[]): void },
      ) => {
        observer?.onPackagesDiscovered(packages)
        return packages
      },
    )
    const releases = new Map<string, (changes: ResolvedDepChange[]) => void>()
    mocks.resolvePackageMock.mockImplementation(
      (pkg: PackageMeta) =>
        new Promise<ResolvedDepChange[]>((resolve) => {
          releases.set(pkg.name ?? pkg.filepath, resolve)
        }),
    )
    setStdoutTTY(true)
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const { checkFromCli } = await import('./run-check')
      const checkPromise = checkFromCli({ ...baseOptions, output: 'table', loglevel: 'info' })
      await vi.waitFor(() => expect(releases.size).toBe(2))
      releases.get('app-update')?.(resolvedForPackage(packages[0]!))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(consoleSpy.mock.calls.flat().map(String).join(' ')).not.toContain('app-update')

      releases.get('app-current')?.(resolvedForPackage(packages[1]!))
      await expect(checkPromise).resolves.toBe(0)
      expect(consoleSpy.mock.calls.flat().map(String).join(' ')).toContain('app-update')
    } finally {
      stdoutWriteSpy.mockRestore()
      consoleSpy.mockRestore()
    }
  })

  it('suspends progress around the complete discovery report', async () => {
    const packages = makeMixedPackages()
    mocks.loadPackagesMock.mockImplementation(
      async (
        options: depfreshOptions,
        observer?: { onPackagesDiscovered(pkgs: PackageMeta[]): void },
      ) => {
        options.discoveryReport = {
          inputCwd: options.cwd,
          effectiveRoot: options.cwd,
          discoveryMode: 'direct-root',
          matchedManifests: ['/tmp/test/package.json'],
          loadedPackages: ['/tmp/test/package.json'],
          skippedManifests: [],
          loadedCatalogs: [],
        }
        observer?.onPackagesDiscovered(packages)
        return packages
      },
    )
    mocks.resolvePackageMock.mockImplementation(async (pkg: PackageMeta) => resolvedForPackage(pkg))
    setStdoutTTY(true)
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const { checkFromCli } = await import('./run-check')
      await expect(
        checkFromCli({ ...baseOptions, output: 'table', loglevel: 'info', explainDiscovery: true }),
      ).resolves.toBe(0)

      const discoveryCallIndex = consoleSpy.mock.calls.findIndex((call) =>
        call.map(String).join(' ').includes('Discovery: mode='),
      )
      expect(discoveryCallIndex).toBeGreaterThan(-1)
      const discoveryOrder = consoleSpy.mock.invocationCallOrder[discoveryCallIndex]!
      const writesBefore = stdoutWriteSpy.mock.calls
        .map((call, index) => ({
          output: String(call[0]),
          order: stdoutWriteSpy.mock.invocationCallOrder[index]!,
        }))
        .filter((write) => write.order < discoveryOrder)
      const writesAfter = stdoutWriteSpy.mock.calls
        .map((call, index) => ({
          output: String(call[0]),
          order: stdoutWriteSpy.mock.invocationCallOrder[index]!,
        }))
        .filter((write) => write.order > discoveryOrder)

      expect(writesBefore.some((write) => write.output === '\r\x1B[2K\n')).toBe(true)
      expect(writesAfter.some((write) => write.output.includes('Resolving dependencies'))).toBe(
        true,
      )
    } finally {
      stdoutWriteSpy.mockRestore()
      consoleSpy.mockRestore()
    }
  })

  it('never emits cursor control from the exported library check', async () => {
    const packages = makeMixedPackages()
    mocks.loadPackagesMock.mockResolvedValue(packages)
    mocks.resolvePackageMock.mockImplementation(async (pkg: PackageMeta) => resolvedForPackage(pkg))
    setStdoutTTY(true)
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const { check } = await import('./index')
      await expect(check({ ...baseOptions, output: 'table', loglevel: 'info' })).resolves.toBe(0)
      expect(stdoutWriteSpy).not.toHaveBeenCalled()
    } finally {
      stdoutWriteSpy.mockRestore()
      consoleSpy.mockRestore()
    }
  })

  it('keeps redirected table stdout, stderr, and cursor bytes stable', async () => {
    const update = makeResolved({
      name: 'needs-update',
      currentVersion: '^1.0.0',
      targetVersion: '^2.0.0',
      diff: 'major',
    })
    const pkg = makePkg('table-app', [update])
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([update])
    setStdoutTTY(false)
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { check } = await import('./index')
      const exitCode = await check({ ...baseOptions, output: 'table', loglevel: 'info' })

      expect(exitCode).toBe(0)
      expect({
        stdout: stdoutWriteSpy.mock.calls.map((call) => String(call[0])),
        logs: logSpy.mock.calls.map((call) => call.map(String)),
        errors: errorSpy.mock.calls.map((call) => call.map(String)),
      }).toEqual({
        stdout: [],
        logs: [
          [],
          ['table-app'],
          [],
          ['  dependencies'],
          ['    name          current -> target  diff        age'],
          ['    ------------------------------------------------'],
          ['    needs-update  ^1.0.0  -> ^2.0.0  major          '],
          [],
          ['  1 major  (1 total)'],
          [],
          ['i', 'Tip: Run `depfresh major` to check for major updates'],
          ['i', 'Tip: Add `-w` to write changes to package files'],
        ],
        errors: [
          ['Tip: Use --output json for structured output. Run --help-json for CLI capabilities.'],
        ],
      })
    } finally {
      stdoutWriteSpy.mockRestore()
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it('does not claim repository-evidence inspection for global CLI discovery', async () => {
    const packages = makeMixedPackages()
    mocks.loadPackagesMock.mockImplementation(
      async (
        _options: depfreshOptions,
        observer?: { onPackagesDiscovered(pkgs: PackageMeta[]): void },
      ) => {
        observer?.onPackagesDiscovered(packages)
        return packages
      },
    )
    mocks.resolvePackageMock.mockImplementation(async (pkg: PackageMeta) => resolvedForPackage(pkg))
    setStdoutTTY(true)
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const { checkFromCli } = await import('./run-check')
      await expect(
        checkFromCli({ ...baseOptions, output: 'table', loglevel: 'info', global: true }),
      ).resolves.toBe(0)

      expect(stdoutWriteSpy.mock.calls.flat().map(String).join(' ')).not.toContain(
        'Inspecting repository evidence',
      )
    } finally {
      stdoutWriteSpy.mockRestore()
      consoleSpy.mockRestore()
    }
  })

  it.each(['direct callback', 'addon hook'] as const)(
    'disables CLI cursor animation for a dependency lifecycle %s while preserving the hook',
    async (hookKind) => {
      const packages = makeMixedPackages()
      const directCallback = vi.fn()
      const addonCallback = vi.fn()
      mocks.loadPackagesMock.mockResolvedValue(packages)
      mocks.resolvePackageMock.mockImplementation(async (pkg, options) => {
        const changes = resolvedForPackage(pkg)
        for (const dependency of changes) await options.onDependencyResolved?.(pkg, dependency)
        return changes
      })
      setStdoutTTY(true)
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const { checkFromCli } = await import('./run-check')
        const lifecycleOptions =
          hookKind === 'direct callback'
            ? { onDependencyResolved: directCallback }
            : { addons: [{ name: 'observer', onDependencyResolved: addonCallback }] }

        await expect(
          checkFromCli({
            ...baseOptions,
            output: 'table',
            loglevel: 'info',
            ...lifecycleOptions,
          }),
        ).resolves.toBe(0)

        expect(stdoutWriteSpy).not.toHaveBeenCalled()
        expect(
          hookKind === 'direct callback' ? directCallback : addonCallback,
        ).toHaveBeenCalledTimes(2)
      } finally {
        stdoutWriteSpy.mockRestore()
        consoleSpy.mockRestore()
      }
    },
  )

  async function runScenario(
    mode: OrchestrationMode,
    overrides: Partial<depfreshOptions> = {},
  ): Promise<ScenarioResult> {
    const packages = makeMixedPackages()
    const beforePackageStart = vi.fn()
    mocks.loadPackagesMock.mockImplementation(
      async (
        _options: depfreshOptions,
        observer?: { onPackagesDiscovered(pkgs: PackageMeta[]): void },
      ) => {
        observer?.onPackagesDiscovered(packages)
        return packages
      },
    )
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
      const { checkFromCli } = await import('./run-check')
      const exitCode = await (mode === 'sequential' ? checkFromCli(options) : check(options))
      const resolved = resolvedSnapshot(packages)

      return {
        exitCode,
        packages,
        resolved,
        updateCount: countUpdates(resolved),
        beforePackageStartNames: packageNamesFrom(beforePackageStart),
        ...(mode === 'sequential'
          ? { tableOutput: consoleSpy.mock.calls.flat().map(String).join(' ') }
          : {}),
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

function restoreEnvironment(name: 'CI' | 'TERM', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
