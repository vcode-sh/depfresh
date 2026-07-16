import { vi } from 'vitest'
import type { depfreshOptions, PackageMeta, ResolvedDepChange } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'

const physicalWriteMock = vi.hoisted(() => vi.fn())
const createGlobalApplyPlanMock = vi.hoisted(() => vi.fn())
const applyGlobalPlanMock = vi.hoisted(() => vi.fn())

vi.mock('../../io/packages', () => ({
  loadPackages: vi.fn(),
}))

vi.mock('../../io/resolve', () => ({
  resolvePackage: vi.fn(),
  createResolveContext: vi.fn(() => ({
    limit: ((fn: () => Promise<unknown>) => fn()) as (
      fn: () => Promise<unknown>,
    ) => Promise<unknown>,
    inFlight: new Map(),
    metrics: {
      fetchesStarted: 0,
      dedupeHits: 0,
    },
  })),
}))

vi.mock('../../io/write', () => ({
  writePackage: physicalWriteMock,
  backupPackageFiles: vi.fn(() => [{ filepath: '/tmp/test/package.json', content: '{}' }]),
  restorePackageFiles: vi.fn(),
}))

vi.mock('../../io/write/occurrence', () => ({
  observeFileOccurrence: vi.fn(),
}))

vi.mock('../apply/legacy', () => ({
  applyLegacyPackageWrite: physicalWriteMock,
}))

vi.mock('../../cache/index', () => ({
  createSqliteCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 0, misses: 0, size: 0 })),
  })),
}))

vi.mock('../../utils/npmrc', () => ({
  loadNpmrc: vi.fn(() => ({
    registries: new Map(),
    defaultRegistry: 'https://registry.npmjs.org/',
    strictSsl: true,
  })),
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  }
})

vi.mock('../../io/global', () => ({
  getGlobalWriteTargets: vi.fn((pkg: { filepath: string; raw: unknown }, depName: string) => {
    const raw = pkg.raw as { managersByDependency?: Record<string, string[]> }
    const fromRaw = raw.managersByDependency?.[depName]
    if (fromRaw && fromRaw.length > 0) {
      return fromRaw
    }
    if (!pkg.filepath.startsWith('global:')) {
      return []
    }
    return pkg.filepath
      .slice('global:'.length)
      .split('+')
      .map((pm) => pm.trim())
      .filter((pm) => pm.length > 0)
  }),
}))

vi.mock('../global-apply', () => ({
  createGlobalApplyPlan: createGlobalApplyPlanMock,
  applyGlobalPlan: applyGlobalPlanMock,
  createGlobalInvocationAuthority: vi.fn((managers, grants) => ({ managers, ...grants })),
}))

export const baseOptions: depfreshOptions = {
  ...(DEFAULT_OPTIONS as depfreshOptions),
  cwd: '/tmp/test',
  loglevel: 'silent',
}

export function makePkg(name: string, deps: ResolvedDepChange[] = []): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath: `/tmp/test/${name}/package.json`,
    deps: deps.map((d) => ({
      name: d.name,
      currentVersion: d.currentVersion,
      source: d.source,
      update: true,
      parents: [],
    })),
    resolved: [],
    raw: { name },
    indent: '  ',
  }
}

export function makeResolved(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'test-dep',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: { name: 'test-dep', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  }
}

export interface CapturedJsonEnvelope {
  packages: Array<{
    name: string
    updates: Array<{
      name: string
      current: string
      target: string
      diff: string
      source: string
    }>
  }>
  errors: unknown[]
  summary: {
    total: number
    major: number
    minor: number
    patch: number
    packages: number
    scannedPackages: number
    packagesWithUpdates: number
    plannedUpdates: number
    appliedUpdates: number
    revertedUpdates: number
    failedResolutions: number
  }
  meta: {
    noPackagesFound: boolean
    hadResolutionErrors: boolean
    didWrite: boolean
  }
}

export function findJsonEnvelope(calls: unknown[][]): CapturedJsonEnvelope {
  for (const call of calls) {
    const [firstArg] = call
    if (typeof firstArg !== 'string') continue

    try {
      const parsed = JSON.parse(firstArg) as Partial<CapturedJsonEnvelope>
      if (parsed.packages !== undefined && parsed.summary !== undefined) {
        return parsed as CapturedJsonEnvelope
      }
    } catch {
      // Ignore non-JSON logger output from table-mode tests.
    }
  }

  throw new Error('Expected a JSON output envelope')
}

export function resolvedSnapshot(packages: PackageMeta[]): Record<string, ResolvedDepChange[]> {
  return Object.fromEntries(packages.map((pkg) => [pkg.name ?? pkg.filepath, pkg.resolved]))
}

export interface CheckMocks {
  loadPackagesMock: ReturnType<typeof vi.fn>
  resolvePackageMock: ReturnType<typeof vi.fn>
  writePackageMock: ReturnType<typeof vi.fn>
  execSyncMock: ReturnType<typeof vi.fn>
  existsSyncMock: ReturnType<typeof vi.fn>
  backupPackageFilesMock: ReturnType<typeof vi.fn>
  restorePackageFilesMock: ReturnType<typeof vi.fn>
  createGlobalApplyPlanMock: ReturnType<typeof vi.fn>
  applyGlobalPlanMock: ReturnType<typeof vi.fn>
}

export async function setupMocks(): Promise<CheckMocks> {
  const packagesModule = await import('../../io/packages')
  const resolveModule = await import('../../io/resolve')
  const writeModule = await import('../../io/write')
  const cp = await import('node:child_process')
  const fs = await import('node:fs')
  const occurrenceModule = await import('../../io/write/occurrence')
  const writePackageMock = physicalWriteMock

  writePackageMock.mockImplementation((pkg: PackageMeta, changes: ResolvedDepChange[]) =>
    changes.map((change) => ({
      name: change.name,
      occurrence: { file: pkg.filepath, path: [change.source, ...change.parents, change.name] },
      expectedValue: change.rawVersion ?? change.currentVersion,
      requestedValue: change.targetVersion,
      observedValue: change.targetVersion,
      status: 'applied',
      reason: 'APPLIED',
    })),
  )
  ;(occurrenceModule.observeFileOccurrence as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const lastResult = writePackageMock.mock.results.at(-1)?.value as
      | Array<{ expectedValue: string }>
      | undefined
    return {
      known: true,
      version: lastResult?.[0]?.expectedValue,
      value: lastResult?.[0]?.expectedValue,
    }
  })

  createGlobalApplyPlanMock.mockImplementation((requests: unknown[]) => ({ requests }))
  applyGlobalPlanMock.mockImplementation(
    async (plan: { requests: Array<Record<string, string>> }) => {
      const items = plan.requests.map((request, index) => ({
        operationId: `operation-${index}`,
        occurrenceId: `occurrence-${index}`,
        manager: request.manager,
        name: request.name,
        expectedVersion: request.expectedVersion,
        targetVersion: request.targetVersion,
        observedVersion: request.targetVersion,
        status: 'applied',
        reason: 'APPLIED',
      }))
      return {
        contract: 'depfresh.global-apply',
        schemaVersion: 1,
        toolVersion: '1.2.0',
        planFingerprint: 'a'.repeat(64),
        status: 'applied',
        items,
        commands: [],
        summary: {
          planned: items.length,
          applied: items.length,
          skipped: 0,
          conflicted: 0,
          failed: 0,
          unknown: 0,
        },
        requiredCapabilities: ['global-write', 'process-execute'],
        rollback: 'not-supported',
      }
    },
  )

  return {
    loadPackagesMock: packagesModule.loadPackages as ReturnType<typeof vi.fn>,
    resolvePackageMock: resolveModule.resolvePackage as ReturnType<typeof vi.fn>,
    writePackageMock,
    execSyncMock: cp.execSync as ReturnType<typeof vi.fn>,
    existsSyncMock: fs.existsSync as ReturnType<typeof vi.fn>,
    backupPackageFilesMock: writeModule.backupPackageFiles as ReturnType<typeof vi.fn>,
    restorePackageFilesMock: writeModule.restorePackageFiles as ReturnType<typeof vi.fn>,
    createGlobalApplyPlanMock,
    applyGlobalPlanMock,
  }
}
