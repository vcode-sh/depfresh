import { relative, sep } from 'node:path'
import { vi } from 'vitest'
import type { ApplyResult } from '../../contracts/schemas'
import {
  createCatalogWriteRequest,
  createPackageWriteRequest,
  resolvePhysicalValues,
} from '../../io/write/occurrence'
import type { depfreshOptions, PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import { DEFAULT_OPTIONS, summarizeWriteOutcomes } from '../../types'
import type {
  LegacyCommandApplyResult,
  LegacyCommandSelection,
  LegacySelectionEvidenceResult,
} from '../apply/legacy-plan'

const physicalWriteMock = vi.hoisted(() => vi.fn())
const commandWriteMock = vi.hoisted(() => vi.fn())
const createLegacyPlanMock = vi.hoisted(() => vi.fn())
const spawnSyncMock = vi.hoisted(() => vi.fn())
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

vi.mock('../../io/write/occurrence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../io/write/occurrence')>()
  return { ...actual, observeFileOccurrence: vi.fn() }
})

vi.mock('../apply/legacy', () => ({
  applyLegacyPackageWrite: physicalWriteMock,
}))

vi.mock('../apply/legacy-plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apply/legacy-plan')>()
  return {
    ...actual,
    createLegacyPlan: createLegacyPlanMock,
    applyLegacyCommandWrite: commandWriteMock,
  }
})

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

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execSync: vi.fn(), spawnSync: spawnSyncMock }
})

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
  commandWriteMock: ReturnType<typeof vi.fn>
  execSyncMock: ReturnType<typeof vi.fn>
  spawnSyncMock: ReturnType<typeof vi.fn>
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

  ;(fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(() => false)
  const actualChildProcess =
    await vi.importActual<typeof import('node:child_process')>('node:child_process')
  spawnSyncMock.mockImplementation(actualChildProcess.spawnSync)

  writePackageMock.mockImplementation((pkg: PackageMeta, changes: ResolvedDepChange[]) => ({
    outcomes: changes.map((change) => ({
      name: change.name,
      occurrence: { file: pkg.filepath, path: [change.source, ...change.parents, change.name] },
      expectedValue: change.rawVersion ?? change.currentVersion,
      requestedValue: change.targetVersion,
      observedValue: change.targetVersion,
      status: 'applied',
      reason: 'APPLIED',
    })),
    diagnostics: [],
  }))
  createLegacyPlanMock.mockImplementation(
    (root: string, selections: readonly LegacyCommandSelection[]) => ({
      selectionEvidence: createTestSelectionEvidence(root, selections),
    }),
  )
  commandWriteMock.mockImplementation(
    async (
      root: string,
      selections: readonly LegacyCommandSelection[],
      _authority: unknown,
      observer?: (evidence: unknown) => void,
    ) => {
      observer?.(createTestSelectionEvidence(root, selections))
      return createSuccessfulCommandResult(root, selections)
    },
  )
  ;(occurrenceModule.observeFileOccurrence as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const lastResult = writePackageMock.mock.results.at(-1)?.value as
      | { outcomes: Array<{ expectedValue: string }> }
      | undefined
    return {
      known: true,
      version: lastResult?.outcomes[0]?.expectedValue,
      value: lastResult?.outcomes[0]?.expectedValue,
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
    commandWriteMock,
    execSyncMock: cp.execSync as ReturnType<typeof vi.fn>,
    spawnSyncMock,
    existsSyncMock: fs.existsSync as ReturnType<typeof vi.fn>,
    backupPackageFilesMock: writeModule.backupPackageFiles as ReturnType<typeof vi.fn>,
    restorePackageFilesMock: writeModule.restorePackageFiles as ReturnType<typeof vi.fn>,
    createGlobalApplyPlanMock,
    applyGlobalPlanMock,
  }
}

export function createSuccessfulCommandResult(
  root: string,
  selections: readonly LegacyCommandSelection[],
): LegacyCommandApplyResult {
  const operationByKey = new Map<
    string,
    ApplyResult['operations'][number] & { packageIndexes: number[] }
  >()
  const packages = selections.map((selection) => ({
    packageIndex: selection.packageIndex,
    outcomes: selection.changes.map((change) => {
      const request = commandWriteRequest(selection.pkg, change)
      const path = [...request.occurrence.path]
      const { expectedValue, requestedValue } = resolvePhysicalValues(request, undefined)
      const file = repositoryRelative(root, request.occurrence.file)
      const key = JSON.stringify({ file, path })
      const existing = operationByKey.get(key)
      if (existing) existing.packageIndexes.push(selection.packageIndex)
      else {
        const index = operationByKey.size
        operationByKey.set(key, {
          operationId: `operation-${index}`,
          occurrenceId: `occurrence-${index}`,
          sourceFileId: `source-${index}`,
          file,
          path,
          name: change.name,
          expectedValue,
          requestedValue,
          observedValue: requestedValue,
          observedByteHash: 'b'.repeat(64),
          status: 'applied',
          reason: 'APPLIED',
          packageIndexes: [selection.packageIndex],
        })
      }
      return {
        name: change.name,
        occurrence: { file: request.occurrence.file, path },
        expectedValue,
        requestedValue,
        observedValue: requestedValue,
        status: 'applied' as const,
        reason: 'APPLIED' as const,
      }
    }),
  }))
  const operations = [...operationByKey.values()].map(
    ({ packageIndexes: _indexes, ...entry }) => entry,
  )
  const attemptsByTarget = new Map<string, string[]>()
  for (const operation of operations) {
    const operationIds = attemptsByTarget.get(operation.file)
    if (operationIds) operationIds.push(operation.operationId)
    else attemptsByTarget.set(operation.file, [operation.operationId])
  }
  const summary = {
    planned: operations.length,
    applied: operations.length,
    skipped: 0,
    conflicted: 0,
    reverted: 0,
    failed: 0,
    unknown: 0,
  }
  return {
    status: 'executed',
    applyResult: {
      contract: 'depfresh.apply',
      schemaVersion: 1,
      toolVersion: '2.0.2',
      planFingerprint: 'a'.repeat(64),
      repositoryIdentity: 'repository-test',
      status: operations.length === 0 ? 'noop' : 'applied',
      operations,
      phases: [
        { name: 'preflight', status: 'passed', reason: 'PRECONDITIONS_CONFIRMED' },
        { name: 'lock', status: 'passed', reason: 'LOCK_ACQUIRED' },
        { name: 'stage', status: 'passed', reason: 'ALL_TARGETS_STAGED' },
        { name: 'precommit', status: 'passed', reason: 'ALL_TARGETS_RECHECKED' },
        { name: 'commit', status: 'passed', reason: 'ALL_FILES_REPLACED' },
        { name: 'inspect', status: 'passed', reason: 'FINAL_STATE_OBSERVED' },
        { name: 'cleanup', status: 'passed', reason: 'CLEAN' },
      ],
      summary,
      recovery: { status: 'not-needed' },
      requiredCapabilities: ['filesystem-read', 'file-write'],
    },
    packages,
    diagnostics: [],
    attempts: [...attemptsByTarget].map(([targetPath, operationIds]) => ({
      targetPath,
      operationIds,
      replacementAttempted: true,
    })),
  }
}

function createTestSelectionEvidence(
  root: string,
  selections: readonly LegacyCommandSelection[],
): LegacySelectionEvidenceResult {
  const operationsByKey = new Map<
    string,
    {
      operationId: string
      packageIndex: number
      changeIndex: number
      ownerLabel: string
      physicalTarget: string
      occurrencePath: string[]
      change: ResolvedDepChange
      current: string
      target: string
      catalog?: { name: string; sourcePath: string }
    }
  >()

  for (const selection of selections) {
    for (const [changeIndex, change] of selection.changes.entries()) {
      const request = commandWriteRequest(selection.pkg, change)
      const physicalTarget = repositoryRelative(root, request.occurrence.file)
      const occurrencePath = [...request.occurrence.path]
      const key = JSON.stringify({ file: physicalTarget, path: occurrencePath })
      if (operationsByKey.has(key)) continue
      const values = resolvePhysicalValues(request, undefined)
      const catalog = testCatalogIdentity(selection.pkg, change, physicalTarget)
      operationsByKey.set(key, {
        operationId: `operation-${operationsByKey.size}`,
        packageIndex: selection.packageIndex,
        changeIndex,
        ownerLabel: selection.pkg.name?.trim() || repositoryRelative(root, selection.pkg.filepath),
        physicalTarget,
        occurrencePath,
        change,
        current: values.expectedValue,
        target: values.requestedValue,
        ...(catalog ? { catalog } : {}),
      })
    }
  }

  const operations = [...operationsByKey.values()].map((entry) => ({
    operationId: entry.operationId,
    packageIndex: entry.packageIndex,
    changeIndex: entry.changeIndex,
    ownerLabel: entry.ownerLabel,
    physicalTarget: entry.physicalTarget,
    occurrencePath: entry.occurrencePath,
    name: entry.change.name,
    current: entry.current,
    target: entry.target,
    diff: entry.change.diff as 'major' | 'minor' | 'patch',
    ...(entry.change.publishedAt === undefined ? {} : { publishedAt: entry.change.publishedAt }),
    ...(entry.change.nodeCompatible === undefined
      ? {}
      : { nodeCompatible: entry.change.nodeCompatible }),
    ...(entry.change.nodeCompat === undefined ? {} : { nodeCompat: entry.change.nodeCompat }),
    ...(entry.catalog ? { catalog: entry.catalog } : {}),
  }))
  const targetIds = new Map<string, string[]>()
  for (const operation of operations) {
    const existing = targetIds.get(operation.physicalTarget)
    if (existing) existing.push(operation.operationId)
    else targetIds.set(operation.physicalTarget, [operation.operationId])
  }
  return {
    status: 'ready',
    evidence: {
      operations,
      targets: [...targetIds]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, operationIds]) => ({ path, operationIds })),
    },
  }
}

function testCatalogIdentity(
  pkg: PackageMeta,
  change: ResolvedDepChange,
  physicalTarget: string,
): { name: string; sourcePath: string } | undefined {
  if (pkg.type === 'package.json' || pkg.type === 'package.yaml') return undefined
  const catalog = pkg.catalogs?.find((candidate) =>
    candidate.deps.some(
      (dependency) =>
        dependency.name === change.name &&
        (change.parents.length === 0 ||
          (dependency.parents.length === change.parents.length &&
            dependency.parents.every((parent, index) => parent === change.parents[index]))),
    ),
  )
  return catalog ? { name: catalog.name, sourcePath: physicalTarget } : undefined
}

export function createCommandResultWithOutcomes(
  root: string,
  selections: readonly LegacyCommandSelection[],
  packages: Array<{ packageIndex: number; outcomes: WriteOutcome[] }>,
  diagnostics: LegacyCommandApplyResult['diagnostics'] = [],
  replacementAttempted = true,
): LegacyCommandApplyResult {
  const successful = createSuccessfulCommandResult(root, selections)
  if (successful.status !== 'executed') throw new Error('Expected an executed command result')
  const projectedOutcomes = packages.flatMap((entry) => entry.outcomes)
  const operationOutcomes = new Map<string, WriteOutcome>()
  for (const outcome of projectedOutcomes) {
    const key = JSON.stringify({
      file: repositoryRelative(root, outcome.occurrence.file),
      path: outcome.occurrence.path,
    })
    if (!operationOutcomes.has(key)) operationOutcomes.set(key, outcome)
  }
  const operations = successful.applyResult.operations.map((operation) => {
    const outcome = operationOutcomes.get(
      JSON.stringify({ file: operation.file, path: operation.path }),
    )
    if (!outcome) return operation
    return {
      ...operation,
      ...(outcome.observedValue === undefined ? {} : { observedValue: outcome.observedValue }),
      status: outcome.status,
      reason: outcome.reason,
    }
  })
  const summary = summarizeWriteOutcomes(
    operations.map((operation) => ({
      name: operation.name,
      occurrence: { file: operation.file, path: [...operation.path] },
      expectedValue: operation.expectedValue,
      requestedValue: operation.requestedValue,
      ...(operation.observedValue === undefined ? {} : { observedValue: operation.observedValue }),
      status: operation.status,
      reason: 'WRITE_FAILED',
    })),
  )
  const applyStatus =
    summary.unknown > 0
      ? 'unknown'
      : summary.failed > 0
        ? 'failed'
        : summary.reverted > 0
          ? 'reverted'
          : summary.conflicted > 0
            ? 'conflicted'
            : summary.applied > 0
              ? 'applied'
              : 'noop'
  return {
    ...successful,
    packages,
    diagnostics,
    attempts: successful.attempts.map((attempt) => ({ ...attempt, replacementAttempted })),
    applyResult: { ...successful.applyResult, status: applyStatus, operations, summary },
  }
}

function commandWriteRequest(pkg: PackageMeta, change: ResolvedDepChange) {
  if (pkg.type === 'package.json' || pkg.type === 'package.yaml') {
    return createPackageWriteRequest(pkg, change)
  }
  const catalogs = (pkg.catalogs ?? []).filter((catalog) =>
    catalog.deps.some(
      (dependency) =>
        dependency.name === change.name &&
        (change.parents.length === 0 ||
          (dependency.parents.length === change.parents.length &&
            dependency.parents.every((parent, index) => parent === change.parents[index]))),
    ),
  )
  if (catalogs.length !== 1) {
    throw new Error('Test command selection requires one exact physical catalog owner')
  }
  return createCatalogWriteRequest(catalogs[0]!, change)
}

function repositoryRelative(root: string, filepath: string): string {
  return relative(root, filepath).split(sep).join('/')
}
