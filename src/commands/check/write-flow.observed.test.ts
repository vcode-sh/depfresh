import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  depfreshOptions,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
} from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { createLogger } from '../../utils/logger'
import { applyPackageWrite } from './write-flow'

const createGlobalApplyPlanMock = vi.hoisted(() => vi.fn())
const applyGlobalPlanMock = vi.hoisted(() => vi.fn())

vi.mock('../../io/global', () => ({
  getGlobalWriteTargets: vi.fn((pkg: PackageMeta, name: string) => {
    const raw = pkg.raw as { managersByDependency?: Record<string, string[]> }
    return raw.managersByDependency?.[name] ?? []
  }),
}))

vi.mock('../global-apply', () => ({
  createGlobalApplyPlan: createGlobalApplyPlanMock,
  applyGlobalPlan: applyGlobalPlanMock,
  createGlobalInvocationAuthority: vi.fn((managers, grants) => ({ managers, ...grants })),
}))

interface Outcome {
  status: string
  reason: string
  observedValue?: string
  occurrence: { file: string; path: string[] }
}

type ResultWithOutcomes = Awaited<ReturnType<typeof applyPackageWrite>> & {
  outcomes: Outcome[]
  skipped: number
  conflicted: number
  failed: number
  unknown: number
}

const options = {
  ...DEFAULT_OPTIONS,
  cwd: '/tmp/project',
  write: true,
  loglevel: 'silent',
} as depfreshOptions

const authority: InvocationAuthority = {
  write: true,
  install: false,
  update: false,
  execute: false,
  processExecute: false,
  lockfileWrite: false,
  verifyCommand: false,
  globalWrite: true,
}

function makeChange(overrides: Partial<ResolvedDepChange> & { rawVersion?: string } = {}) {
  return {
    name: 'shared',
    currentVersion: '1.0.0',
    rawVersion: '1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '2.0.0',
    diff: 'major',
    pkgData: { name: 'shared', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  } as ResolvedDepChange
}

describe('applyPackageWrite observed outcome accounting', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-write-flow-observed-'))
    vi.clearAllMocks()
    createGlobalApplyPlanMock.mockImplementation((requests: unknown[]) => ({ requests }))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('blocks the full legacy file run when any physical occurrence is stale', async () => {
    const filepath = join(tmpDir, 'package.json')
    writeFileSync(
      filepath,
      `${JSON.stringify({ dependencies: { first: '1.0.0', second: '1.5.0' } }, null, 2)}\n`,
    )
    const pkg: PackageMeta = {
      name: 'fixture',
      type: 'package.json',
      filepath,
      deps: [],
      resolved: [],
      raw: {},
      indent: '  ',
    }

    const result = (await applyPackageWrite(
      pkg,
      [makeChange({ name: 'first' }), makeChange({ name: 'second' })],
      options,
      authority,
      createLogger('silent'),
    )) as ResultWithOutcomes
    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['conflicted', 'conflicted'])
    expect(result).toMatchObject({
      planned: 2,
      applied: 0,
      skipped: 0,
      conflicted: 2,
      reverted: 0,
      failed: 0,
      unknown: 0,
      didWrite: false,
    })
    expect(parsed.dependencies.first).toBe('1.0.0')
    expect(parsed.dependencies.second).toBe('1.5.0')
  })

  it('reports mixed global manager states individually without claiming a transaction', async () => {
    applyGlobalPlanMock.mockResolvedValue(
      globalResult([
        globalItem('npm', 'shared', '3.0.0', '2.0.0', 'skipped', 'DOWNGRADE_BLOCKED', '3.0.0'),
        globalItem('pnpm', 'shared', '1.0.0', '2.0.0', 'applied', 'APPLIED', '2.0.0'),
        globalItem('bun', 'shared', '1.0.0', '2.0.0', 'unknown', 'INVENTORY_UNKNOWN'),
      ]),
    )

    const pkg: PackageMeta = {
      name: 'Global packages',
      type: 'global',
      filepath: 'global:npm+pnpm+bun',
      deps: [],
      resolved: [],
      raw: {
        managersByDependency: { shared: ['npm', 'pnpm', 'bun'] },
        versionsByDependency: {
          shared: { npm: '3.0.0', pnpm: '1.0.0', bun: '1.0.0' },
        },
      },
      indent: '  ',
    }

    const result = (await applyPackageWrite(
      pkg,
      [makeChange()],
      { ...options, globalAll: true },
      { ...authority, processExecute: true },
      createLogger('silent'),
    )) as ResultWithOutcomes

    expect(result.outcomes).toMatchObject([
      {
        status: 'skipped',
        reason: 'DOWNGRADE_BLOCKED',
        observedValue: '3.0.0',
        occurrence: { file: 'global:npm', path: ['dependencies', 'shared'] },
      },
      {
        status: 'applied',
        reason: 'APPLIED',
        observedValue: '2.0.0',
        occurrence: { file: 'global:pnpm', path: ['dependencies', 'shared'] },
      },
      {
        status: 'unknown',
        reason: 'GLOBAL_OBSERVATION_FAILED',
        occurrence: { file: 'global:bun', path: ['dependencies', 'shared'] },
      },
    ])
    expect(result).toMatchObject({
      planned: 3,
      applied: 1,
      skipped: 1,
      conflicted: 0,
      reverted: 0,
      failed: 0,
      unknown: 1,
      didWrite: true,
    })
    expect(applyGlobalPlanMock).toHaveBeenCalledTimes(1)
  })

  it('continues after one global command fails and keeps the outcomes non-transactional', async () => {
    applyGlobalPlanMock.mockResolvedValue(
      globalResult([
        globalItem('npm', 'shared', '1.0.0', '2.0.0', 'failed', 'COMMAND_FAILED', '1.0.0'),
        globalItem('pnpm', 'shared', '1.0.0', '2.0.0', 'applied', 'APPLIED', '2.0.0'),
      ]),
    )
    const pkg: PackageMeta = {
      name: 'Global packages',
      type: 'global',
      filepath: 'global:npm+pnpm',
      deps: [],
      resolved: [],
      raw: {
        managersByDependency: { shared: ['npm', 'pnpm'] },
        versionsByDependency: { shared: { npm: '1.0.0', pnpm: '1.0.0' } },
      },
      indent: '  ',
    }

    const result = (await applyPackageWrite(
      pkg,
      [makeChange()],
      { ...options, globalAll: true },
      { ...authority, processExecute: true },
      createLogger('silent'),
    )) as ResultWithOutcomes

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'applied'])
    expect(result).toMatchObject({ planned: 2, applied: 1, failed: 1, didWrite: true })
    expect(applyGlobalPlanMock).toHaveBeenCalledTimes(1)
  })

  it('reports applied when a failing global command still reaches the requested state', async () => {
    applyGlobalPlanMock.mockResolvedValue(
      globalResult([globalItem('npm', 'shared', '1.0.0', '2.0.0', 'applied', 'APPLIED', '2.0.0')]),
    )
    const pkg: PackageMeta = {
      name: 'Global packages',
      type: 'global',
      filepath: 'global:npm',
      deps: [],
      resolved: [],
      raw: {
        managersByDependency: { shared: ['npm'] },
        versionsByDependency: { shared: { npm: '1.0.0' } },
      },
      indent: '  ',
    }

    const result = (await applyPackageWrite(
      pkg,
      [makeChange()],
      { ...options, global: true },
      { ...authority, processExecute: true },
      createLogger('silent'),
    )) as ResultWithOutcomes

    expect(result).toMatchObject({ planned: 1, applied: 1, failed: 0, didWrite: true })
    expect(result.outcomes[0]).toMatchObject({
      status: 'applied',
      reason: 'APPLIED',
      observedValue: '2.0.0',
    })
  })
})

function globalItem(
  manager: 'npm' | 'pnpm' | 'bun',
  name: string,
  expectedVersion: string,
  targetVersion: string,
  status: 'applied' | 'skipped' | 'conflicted' | 'failed' | 'unknown',
  reason: string,
  observedVersion?: string,
) {
  return {
    operationId: `${manager}-${name}`,
    occurrenceId: `${manager}-${name}-occurrence`,
    manager,
    name,
    expectedVersion,
    targetVersion,
    ...(observedVersion === undefined ? {} : { observedVersion }),
    status,
    reason,
  }
}

function globalResult(items: ReturnType<typeof globalItem>[]) {
  const count = (status: string) => items.filter((item) => item.status === status).length
  const summary = {
    planned: items.length,
    applied: count('applied'),
    skipped: count('skipped'),
    conflicted: count('conflicted'),
    failed: count('failed'),
    unknown: count('unknown'),
  }
  return {
    contract: 'depfresh.global-apply',
    schemaVersion: 1,
    toolVersion: '1.2.0',
    planFingerprint: 'a'.repeat(64),
    status: summary.applied > 0 && summary.failed + summary.unknown > 0 ? 'partial' : 'applied',
    items,
    commands: [],
    summary,
    requiredCapabilities: ['global-write', 'process-execute'],
    rollback: 'not-supported',
  }
}
