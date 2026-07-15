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

const writeGlobalPackageMock = vi.fn()
const observeGlobalPackageVersionMock = vi.fn()

vi.mock('../../io/global', () => ({
  getGlobalWriteTargets: vi.fn((pkg: PackageMeta, name: string) => {
    const raw = pkg.raw as { managersByDependency?: Record<string, string[]> }
    return raw.managersByDependency?.[name] ?? []
  }),
  observeGlobalPackageVersion: observeGlobalPackageVersionMock,
  writeGlobalPackage: writeGlobalPackageMock,
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
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('derives reconciled counts from one applied and one conflicted physical result', async () => {
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

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['applied', 'conflicted'])
    expect(result).toMatchObject({
      planned: 2,
      applied: 1,
      skipped: 0,
      conflicted: 1,
      reverted: 0,
      failed: 0,
      unknown: 0,
      didWrite: true,
    })
    expect(parsed.dependencies.first).toBe('2.0.0')
    expect(parsed.dependencies.second).toBe('1.5.0')
  })

  it('reports mixed global manager states individually without claiming a transaction', async () => {
    const managerCalls = new Map<string, number>()
    observeGlobalPackageVersionMock.mockImplementation((manager: string) => {
      const call = managerCalls.get(manager) ?? 0
      managerCalls.set(manager, call + 1)
      if (manager === 'npm') return { known: true, version: '3.0.0' }
      if (manager === 'pnpm') {
        return call === 0 ? { known: true, version: '1.0.0' } : { known: true, version: '2.0.0' }
      }
      return { known: false }
    })

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
      authority,
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
    expect(writeGlobalPackageMock).toHaveBeenCalledTimes(1)
    expect(writeGlobalPackageMock).toHaveBeenCalledWith('pnpm', 'shared', '2.0.0')
  })

  it('continues after one global command fails and keeps the outcomes non-transactional', async () => {
    const managerCalls = new Map<string, number>()
    observeGlobalPackageVersionMock.mockImplementation((manager: string) => {
      const call = managerCalls.get(manager) ?? 0
      managerCalls.set(manager, call + 1)
      if (manager === 'npm') return { known: true, version: '1.0.0' }
      return { known: true, version: call === 0 ? '1.0.0' : '2.0.0' }
    })
    writeGlobalPackageMock.mockImplementation((manager: string) => {
      if (manager === 'npm') throw new Error('command failed')
    })
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
      authority,
      createLogger('silent'),
    )) as ResultWithOutcomes

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'applied'])
    expect(result).toMatchObject({ planned: 2, applied: 1, failed: 1, didWrite: true })
    expect(writeGlobalPackageMock).toHaveBeenCalledTimes(2)
  })

  it('reports applied when a failing global command still reaches the requested state', async () => {
    let observations = 0
    observeGlobalPackageVersionMock.mockImplementation(() => {
      observations++
      return { known: true, version: observations === 1 ? '1.0.0' : '2.0.0' }
    })
    writeGlobalPackageMock.mockImplementation(() => {
      throw new Error('command exited after applying')
    })
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
      authority,
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
