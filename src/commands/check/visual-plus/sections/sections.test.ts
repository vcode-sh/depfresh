import { describe, expect, it } from 'vitest'
import { createRepositoryId } from '../../../../repository/identity'
import { stripAnsi, visualLength } from '../../../../utils/format'
import type {
  CheckRunChange,
  CheckRunInsightEvidence,
  CheckRunOperationOutcome,
  CheckRunOperationResult,
  CheckRunPhaseName,
  CheckRunPhaseStatus,
  CheckRunRecovery,
  CheckRunResultTotals,
  CheckRunSnapshot,
  CheckRunTarget,
  CheckRunTargetOutcome,
  CheckRunTargetResult,
} from '../../run-model'
import type { WriteReceipt, WriteReceiptVerdict } from '../../write-receipt'
import type { VisualPlusCapabilities } from '../capabilities'
import {
  createVisualPlusSectionInput,
  type VisualPlusChangeMetadata,
  type VisualPlusPackageManagerMetadata,
  type VisualPlusSectionInput,
  type VisualPlusWriteReceiptEvidence,
} from '../input'
import { buildVisualPlusInsights } from '../insights'
import { createVisualPlusTheme, wrapVisualPlusText } from '../theme'
import { renderVisualPlusChanges } from './changes'
import { renderVisualPlusDistribution } from './distribution'
import { renderVisualPlusHeader } from './header'
import { renderVisualPlusImpact } from './impact'
import {
  renderVisualPlusLifecycle,
  renderVisualPlusLifecycleHeading,
  renderVisualPlusLifecyclePhase,
} from './lifecycle'
import { renderVisualPlusReceipt } from './receipt'
import { renderVisualPlusRisk } from './risk'
import { renderVisualPlusShared } from './shared'
import { renderVisualPlusTopology } from './topology'
import { renderVisualPlusTransaction } from './transaction'

const phaseNames: readonly CheckRunPhaseName[] = [
  'discover',
  'inspect',
  'resolve',
  'review',
  'preflight',
  'stage',
  'apply',
  'observe',
  'recover',
  'complete',
]

const capable: VisualPlusCapabilities = {
  interactive: true,
  color: true,
  unicode: true,
  motion: true,
  cursorControl: true,
  width: 118,
  layout: 'wide',
}

function renderedNextAction(lines: readonly string[]): string | undefined {
  const start = lines.findIndex((line) => line.startsWith('Next:'))
  if (start < 0) return undefined
  const exit = lines.findIndex((line, index) => index > start && line.startsWith('Exit '))
  if (exit < 0) return undefined
  return lines.slice(start, exit).join('')
}

function totals(overrides: Partial<CheckRunResultTotals> = {}): CheckRunResultTotals {
  return {
    applied: 0,
    skipped: 0,
    mixed: 0,
    blocked: 0,
    notAttempted: 0,
    failed: 0,
    reverted: 0,
    unknown: 0,
    ...overrides,
  }
}

function phases(statuses: Partial<Record<CheckRunPhaseName, CheckRunPhaseStatus>> = {}) {
  return phaseNames.map((name) => ({ name, status: statuses[name] ?? 'passed' }))
}

function operationResult(
  operationId: string,
  outcome: CheckRunOperationOutcome,
): CheckRunOperationResult {
  return {
    operationId,
    outcome,
    blocked: outcome === 'blocked',
    notAttempted: outcome === 'blocked' || outcome === 'not-attempted',
    unknown: outcome === 'unknown',
  }
}

function targetResult(
  target: CheckRunTarget,
  outcome: CheckRunTargetOutcome,
): CheckRunTargetResult {
  return {
    path: target.path,
    operationIds: target.operationIds,
    outcome,
    blocked: outcome === 'blocked',
    notAttempted: outcome === 'blocked' || outcome === 'not-attempted',
    unknown: outcome === 'unknown',
  }
}

function canonicalReceipt(
  verdict: WriteReceiptVerdict,
  operationCount: number,
  targetCount: number,
  status: 'applied' | 'skipped' | 'conflicted' | 'reverted' | 'failed' | 'unknown',
  noFilesChanged = false,
  targets: readonly CheckRunTarget[] = [],
): WriteReceipt {
  const operations = {
    planned: operationCount,
    applied: status === 'applied' ? operationCount : 0,
    skipped: status === 'skipped' ? operationCount : 0,
    conflicted: status === 'conflicted' ? operationCount : 0,
    reverted: status === 'reverted' ? operationCount : 0,
    failed: status === 'failed' ? operationCount : 0,
    unknown: status === 'unknown' ? operationCount : 0,
  }
  const files = {
    planned: targetCount,
    applied: status === 'applied' ? targetCount : 0,
    skipped: status === 'skipped' ? targetCount : 0,
    blocked: ['conflicted', 'failed', 'unknown'].includes(status) ? targetCount : 0,
    conflicted: status === 'conflicted' ? targetCount : 0,
    reverted: status === 'reverted' ? targetCount : 0,
    failed: status === 'failed' ? targetCount : 0,
    unknown: status === 'unknown' ? targetCount : 0,
  }
  const groups =
    status === 'applied'
      ? []
      : targets.map((target) => ({
          file: target.path,
          status,
          reason: status === 'conflicted' ? 'VCS_UNAVAILABLE' : status.toUpperCase(),
          occurrences: target.operationIds.length,
          replacementAttempted: status === 'conflicted' ? false : status !== 'skipped',
          details: target.operationIds.map((operationId) => ({
            name: operationId,
            path: ['dependencies', operationId],
            status,
            reason: status === 'conflicted' ? 'VCS_UNAVAILABLE' : status.toUpperCase(),
          })),
        }))
  return { verdict, operations, files, groups, noFilesChanged }
}

function receiptEvidence(
  snapshot: CheckRunSnapshot,
  canonical: WriteReceipt,
): VisualPlusWriteReceiptEvidence {
  return {
    canonical,
    operationIds: snapshot.changes.map((change) => change.id),
    targets: snapshot.targets,
    recovery: snapshot.recovery,
  }
}

function manifestInsight(
  name: string,
  sourcePath: string,
  label: string,
  order: number,
): CheckRunInsightEvidence {
  return {
    dependencyId: createRepositoryId('dependency', name),
    rawName: name,
    sourceFileId: createRepositoryId('source', sourcePath),
    sourcePath,
    occurrencePath: ['dependencies', name],
    owner: {
      id: createRepositoryId('package', sourcePath),
      role: 'manifest',
      label,
      path: sourcePath,
      order,
      physicalTarget: sourcePath,
    },
    catalog: { role: 'direct' },
    ageMs: null,
    compatibility: { status: 'unknown' },
  }
}

function fixture(
  outcome: CheckRunOperationOutcome = 'applied',
  exitCode: 0 | 1 | 2 | null = 0,
): VisualPlusSectionInput {
  const changes: CheckRunChange[] = []
  const metadata: VisualPlusChangeMetadata[] = []
  const ownerOrderByGroup = new Map(
    Array.from({ length: 15 }, (_, group) => {
      const targetIndex = group >= 13 ? 13 : group
      const physicalTarget = `packages/target-${targetIndex}/package.json`
      const ownerLabel = `workspace-${group}`
      const catalogOwner = group >= 13
      const id = catalogOwner
        ? createRepositoryId('catalog', `${physicalTarget}\0bun\0${ownerLabel}`)
        : createRepositoryId('package', physicalTarget)
      return {
        group,
        key: [
          physicalTarget,
          catalogOwner ? 'catalog' : 'manifest',
          catalogOwner ? 'bun' : '',
          catalogOwner ? ownerLabel : '',
          id,
        ].join('\0'),
      }
    })
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .map((entry, order) => [entry.group, order]),
  )
  for (let group = 0; group < 15; group += 1) {
    const count = group === 0 ? 6 : 5
    const targetIndex = group >= 13 ? 13 : group
    const physicalTarget = `packages/target-${targetIndex}/package.json`
    const ownerLabel = `workspace-${group}`
    const catalog =
      group >= 13
        ? {
            role: 'owner' as const,
            id: createRepositoryId('catalog', `${physicalTarget}\0bun\0${ownerLabel}`),
            manager: 'bun' as const,
            name: ownerLabel,
            sourceFileId: createRepositoryId('source', physicalTarget),
            sourcePath: physicalTarget,
          }
        : { role: 'direct' as const }
    const owner = {
      id: catalog.role === 'owner' ? catalog.id : createRepositoryId('package', physicalTarget),
      role: catalog.role === 'owner' ? ('catalog' as const) : ('manifest' as const),
      label: ownerLabel,
      path: physicalTarget,
      order: ownerOrderByGroup.get(group)!,
      physicalTarget,
    }
    for (let item = 0; item < count; item += 1) {
      const id = `operation-${group}-${item}`
      const name = `dependency-${group}-${item}`
      const ageMs = group === 0 && item === 0 ? 432_000_000 : null
      changes.push({
        id,
        name,
        owner: physicalTarget,
        current: '^1.0.0',
        target: group === 0 && item === 0 ? '^2.0.0' : '^1.1.0',
        diff: group === 0 && item === 0 ? 'major' : 'minor',
        ...(ageMs === null ? {} : { ageMs }),
        insight: {
          dependencyId: createRepositoryId('dependency', name),
          rawName: name,
          sourceFileId: createRepositoryId('source', physicalTarget),
          sourcePath: physicalTarget,
          occurrencePath:
            catalog.role === 'owner'
              ? ['workspaces', 'catalogs', catalog.name, name]
              : ['dependencies', name],
          owner: { ...owner },
          catalog: { ...catalog },
          ageMs,
          compatibility: { status: 'unknown' },
        },
      })
      metadata.push({
        operationId: id,
        ownerGroup: {
          id: owner.id,
          label: owner.label,
          order: owner.order,
          physicalTarget: owner.physicalTarget,
        },
        ageMs,
        compatibility: { status: 'unknown' },
        ...(catalog.role === 'owner'
          ? { catalog: { name: catalog.name, sourcePath: catalog.sourcePath } }
          : {}),
      })
    }
  }
  const targets: CheckRunTarget[] = Array.from({ length: 14 }, (_, index) => ({
    path: `packages/target-${index}/package.json`,
    operationIds: changes
      .filter((change) => change.owner === `packages/target-${index}/package.json`)
      .map((change) => change.id),
  }))
  const operationResults = changes.map((change) => operationResult(change.id, outcome))
  const targetOutcome = outcome as CheckRunTargetOutcome
  const targetResults = targets.map((target) => targetResult(target, targetOutcome))
  const operationTotals = totals({
    applied: outcome === 'applied' ? 76 : 0,
    blocked: outcome === 'blocked' ? 76 : 0,
    notAttempted: outcome === 'blocked' || outcome === 'not-attempted' ? 76 : 0,
    failed: outcome === 'failed' ? 76 : 0,
    reverted: outcome === 'reverted' ? 76 : 0,
    unknown: outcome === 'unknown' ? 76 : 0,
    skipped: outcome === 'skipped' ? 76 : 0,
  })
  const targetTotals = totals({
    applied: outcome === 'applied' ? 14 : 0,
    blocked: outcome === 'blocked' ? 14 : 0,
    notAttempted: outcome === 'blocked' || outcome === 'not-attempted' ? 14 : 0,
    failed: outcome === 'failed' ? 14 : 0,
    reverted: outcome === 'reverted' ? 14 : 0,
    unknown: outcome === 'unknown' ? 14 : 0,
    skipped: outcome === 'skipped' ? 14 : 0,
  })
  const recovery: CheckRunRecovery = {
    executed: false,
    status: 'not-needed',
    restoredPaths: [],
    unrecoveredPaths: [],
  }
  const snapshot: CheckRunSnapshot = {
    sequence: 12,
    mode: 'major',
    write: true,
    phases: phases({
      preflight: outcome === 'blocked' ? 'blocked' : 'passed',
      stage: outcome === 'blocked' ? 'skipped' : 'passed',
      apply: outcome === 'blocked' ? 'skipped' : 'passed',
      observe: outcome === 'blocked' ? 'skipped' : 'passed',
      recover: 'skipped',
      complete: exitCode === null ? 'active' : outcome === 'applied' ? 'passed' : 'blocked',
    }),
    counts: {
      packages: 66,
      declared: 616,
      eligible: 612,
      unresolved: 0,
      updates: 76,
      operations: 76,
      targets: 14,
    },
    changes,
    targets,
    diagnostics:
      outcome === 'blocked' ? [{ code: 'VCS_OUTPUT_LIMIT_EXCEEDED', path: 'package.json' }] : [],
    results: {
      operations: operationResults,
      targets: targetResults,
      totals: operationTotals,
      targetTotals,
    },
    recovery,
    elapsedMs: exitCode === null ? null : 2400,
    exitCode,
    terminalEvents: [],
  }
  const canonical = canonicalReceipt(
    outcome === 'applied' ? 'complete' : outcome === 'blocked' ? 'safety-block' : 'unknown',
    76,
    14,
    outcome === 'blocked' ? 'conflicted' : outcome === 'not-attempted' ? 'skipped' : outcome,
    outcome === 'blocked',
    targets,
  )
  return {
    snapshot,
    capabilities: capable,
    run: {
      repository: { name: 'spreadu', relativePath: '.' },
      workspaceScope: 'workspace',
      packageManager: {
        status: 'observed',
        name: 'pnpm',
        version: '10.33.0',
        sources: ['package.json'],
      },
    },
    changes: metadata,
    writeReceipt: receiptEvidence(snapshot, canonical),
  }
}

function allSections(input: VisualPlusSectionInput): readonly string[] {
  const insights = buildVisualPlusInsights(input.snapshot)
  return [
    ...renderVisualPlusHeader(input),
    ...renderVisualPlusLifecycle(input),
    ...renderVisualPlusTopology(insights, input.capabilities),
    ...renderVisualPlusDistribution(insights, input.capabilities),
    ...renderVisualPlusRisk(insights, input.capabilities),
    ...renderVisualPlusImpact(insights, input.capabilities),
    ...renderVisualPlusShared(insights, input.capabilities),
    ...renderVisualPlusChanges(input),
    ...renderVisualPlusTransaction(input),
    ...renderVisualPlusReceipt(input),
  ]
}

function collectColumnValues(lines: readonly string[], label: string): string {
  const prefix = `${label} `
  return lines
    .flatMap((line) => line.split(' | '))
    .map((cell) => cell.trimEnd())
    .filter((cell) => cell.startsWith(prefix))
    .map((cell) => cell.slice(prefix.length))
    .join('')
}

describe('Visual+ section input', () => {
  it('deep-copies, recursively freezes, and reconciles the complete 76/15/14 fixture', () => {
    const source = fixture()
    const prepared = createVisualPlusSectionInput(source)

    expect(prepared).not.toBe(source)
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.snapshot.changes)).toBe(true)
    expect(Object.isFrozen(prepared.writeReceipt?.canonical.groups)).toBe(true)
    expect(prepared.changes).toHaveLength(76)
    expect(new Set(prepared.changes.map((change) => change.ownerGroup.id))).toHaveLength(15)
    expect(new Set(prepared.snapshot.targets.map((target) => target.path))).toHaveLength(14)
  })

  it.each([
    [
      'missing metadata',
      (input: VisualPlusSectionInput) => ({ ...input, changes: input.changes.slice(1) }),
    ],
    [
      'duplicate metadata',
      (input: VisualPlusSectionInput) => ({
        ...input,
        changes: [input.changes[0]!, ...input.changes],
      }),
    ],
    [
      'extra metadata',
      (input: VisualPlusSectionInput) => ({
        ...input,
        changes: [...input.changes, { ...input.changes[0]!, operationId: 'extra' }],
      }),
    ],
    [
      'target mismatch',
      (input: VisualPlusSectionInput) => ({
        ...input,
        changes: [
          {
            ...input.changes[0]!,
            ownerGroup: { ...input.changes[0]!.ownerGroup, physicalTarget: 'other/package.json' },
          },
          ...input.changes.slice(1),
        ],
      }),
    ],
    [
      'unsafe path',
      (input: VisualPlusSectionInput) => ({
        ...input,
        run: { ...input.run, repository: { relativePath: '../outside' } },
      }),
    ],
    [
      'drive-relative path',
      (input: VisualPlusSectionInput) => ({
        ...input,
        run: { ...input.run, repository: { relativePath: 'C:outside' } },
      }),
    ],
    [
      'invalid age',
      (input: VisualPlusSectionInput) => ({
        ...input,
        changes: [{ ...input.changes[0]!, ageMs: 1.5 }, ...input.changes.slice(1)],
      }),
    ],
    [
      'receipt totals mismatch',
      (input: VisualPlusSectionInput) => ({
        ...input,
        writeReceipt: {
          ...input.writeReceipt!,
          canonical: {
            ...input.writeReceipt!.canonical,
            operations: { ...input.writeReceipt!.canonical.operations, applied: 75 },
          },
        },
      }),
    ],
    [
      'receipt recovery mismatch',
      (input: VisualPlusSectionInput) => ({
        ...input,
        writeReceipt: {
          ...input.writeReceipt!,
          recovery: { ...input.writeReceipt!.recovery, status: 'unknown' as const },
        },
      }),
    ],
    [
      'overlapping recovery paths',
      (input: VisualPlusSectionInput) => {
        const recovery = {
          ...input.snapshot.recovery,
          executed: true,
          status: 'partial' as const,
          restoredPaths: ['packages/target-0/package.json'],
          unrecoveredPaths: ['packages/target-0/package.json'],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
    [
      'final receipt without result inventories',
      (input: VisualPlusSectionInput) => ({
        ...input,
        snapshot: {
          ...input.snapshot,
          results: { ...input.snapshot.results, operations: [], targets: [] },
        },
      }),
    ],
    [
      'incoherent operation safety flags',
      (input: VisualPlusSectionInput) => ({
        ...input,
        snapshot: {
          ...input.snapshot,
          results: {
            ...input.snapshot.results,
            operations: [
              { ...input.snapshot.results.operations[0]!, blocked: true },
              ...input.snapshot.results.operations.slice(1),
            ],
          },
        },
      }),
    ],
    [
      'snapshot totals that do not reconcile to results',
      (input: VisualPlusSectionInput) => ({
        ...input,
        snapshot: {
          ...input.snapshot,
          results: {
            ...input.snapshot.results,
            totals: { ...input.snapshot.results.totals, applied: 75 },
          },
        },
        writeReceipt: {
          ...input.writeReceipt!,
          canonical: {
            ...input.writeReceipt!.canonical,
            operations: { ...input.writeReceipt!.canonical.operations, applied: 75 },
          },
        },
      }),
    ],
    [
      'safety block with attempted replacement',
      (_input: VisualPlusSectionInput) => {
        const blocked = fixture('blocked', 2)
        const first = blocked.writeReceipt!.canonical.groups[0]!
        return {
          ...blocked,
          writeReceipt: {
            ...blocked.writeReceipt!,
            canonical: {
              ...blocked.writeReceipt!.canonical,
              groups: [
                { ...first, replacementAttempted: true },
                ...blocked.writeReceipt!.canonical.groups.slice(1),
              ],
            },
          },
        }
      },
    ],
    [
      'canonical file totals that differ from target results',
      (input: VisualPlusSectionInput) => ({
        ...input,
        writeReceipt: {
          ...input.writeReceipt!,
          canonical: {
            ...input.writeReceipt!.canonical,
            files: { ...input.writeReceipt!.canonical.files, applied: 13 },
          },
        },
      }),
    ],
    [
      'canonical failed verdict with complete operation evidence',
      (input: VisualPlusSectionInput) => ({
        ...input,
        writeReceipt: {
          ...input.writeReceipt!,
          canonical: { ...input.writeReceipt!.canonical, verdict: 'failed' as const },
        },
      }),
    ],
    [
      'canonical complete verdict with failed operation evidence',
      (_input: VisualPlusSectionInput) => {
        const failed = fixture('failed', 2)
        return {
          ...failed,
          writeReceipt: {
            ...failed.writeReceipt!,
            canonical: { ...failed.writeReceipt!.canonical, verdict: 'complete' as const },
          },
        }
      },
    ],
    [
      'completed recovery that was not executed',
      (input: VisualPlusSectionInput) => {
        const recovery: CheckRunRecovery = {
          executed: false,
          status: 'completed',
          restoredPaths: ['packages/target-0/package.json'],
          unrecoveredPaths: [],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
    [
      'partial recovery that was not executed',
      (input: VisualPlusSectionInput) => {
        const recovery: CheckRunRecovery = {
          executed: false,
          status: 'partial',
          restoredPaths: [],
          unrecoveredPaths: ['packages/target-0/package.json'],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
    [
      'completed recovery without a restored path',
      (input: VisualPlusSectionInput) => {
        const recovery: CheckRunRecovery = {
          executed: true,
          status: 'completed',
          restoredPaths: [],
          unrecoveredPaths: [],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
    [
      'completed recovery with an unrecovered path',
      (input: VisualPlusSectionInput) => {
        const recovery: CheckRunRecovery = {
          executed: true,
          status: 'completed',
          restoredPaths: ['packages/target-0/package.json'],
          unrecoveredPaths: ['packages/target-1/package.json'],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
    [
      'not-needed recovery with retained evidence',
      (input: VisualPlusSectionInput) => {
        const recovery: CheckRunRecovery = {
          executed: false,
          status: 'not-needed',
          journalId: 'journal-1',
          restoredPaths: [],
          unrecoveredPaths: [],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
    [
      'not-needed recovery that was executed',
      (input: VisualPlusSectionInput) => {
        const recovery: CheckRunRecovery = {
          executed: true,
          status: 'not-needed',
          restoredPaths: [],
          unrecoveredPaths: [],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
    [
      'non-executed unknown recovery with changed paths',
      (input: VisualPlusSectionInput) => {
        const recovery: CheckRunRecovery = {
          executed: false,
          status: 'unknown',
          restoredPaths: ['packages/target-0/package.json'],
          unrecoveredPaths: [],
        }
        return {
          ...input,
          snapshot: { ...input.snapshot, recovery },
          writeReceipt: { ...input.writeReceipt!, recovery },
        }
      },
    ],
  ] as const)('fails closed for %s', (_name, mutate) => {
    expect(() => createVisualPlusSectionInput(mutate(fixture()))).toThrow(/Visual\+ input/u)
  })

  it.each([
    { status: 'observed', name: '', sources: ['package.json'] },
    { status: 'observed', name: 'pnpm', sources: [] },
    { status: 'ambiguous', candidates: [{ name: 'pnpm', source: 'package.json' }] },
    { status: 'unknown', sources: ['package.json'] },
  ] as unknown as VisualPlusPackageManagerMetadata[])(
    'rejects contradictory manager evidence %#',
    (packageManager) => {
      const input = fixture()
      expect(() =>
        createVisualPlusSectionInput({ ...input, run: { ...input.run, packageManager } }),
      ).toThrow(/Visual\+ input/u)
    },
  )
})

describe('Visual+ pure sections', () => {
  it('renders the exact complete hierarchy, every row once, and every transaction target once', () => {
    const input = createVisualPlusSectionInput(fixture())
    const lines = allSections(input).map(stripAnsi)
    const output = lines.join('\n')
    const changeOutput = renderVisualPlusChanges(input).map(stripAnsi).join('\n')
    const transactionLines = renderVisualPlusTransaction(input).map(stripAnsi)

    expect(lines.slice(0, 4)).toEqual([
      'Check · major · write',
      'Repository spreadu · . · workspace',
      'Package manager observed · pnpm 10.33.0 · package.json',
      'Lifecycle',
    ])
    expect(output).toContain('Distribution')
    expect(output).toContain('Risk focus')
    expect(output).toContain('Owner impact')
    expect(output).toContain('Shared dependencies')
    expect(output).toContain('66 packages → 616 declared → 612 eligible → 76 updates → 14 files')
    const reviewHeadings = [
      'Repository topology',
      'Distribution',
      'Risk focus',
      'Owner impact',
      'Shared dependencies',
      'Complete change list',
    ]
    const positions = reviewHeadings.map((heading) => output.indexOf(heading))
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    for (let group = 0; group < 15; group += 1) {
      const count = group === 0 ? 6 : 5
      for (let item = 0; item < count; item += 1) {
        expect(
          changeOutput.match(new RegExp(`dependency-${group}-${item}(?![0-9])`, 'gu')),
        ).toHaveLength(1)
        expect(
          changeOutput.match(new RegExp(`operation-${group}-${item}(?![0-9])`, 'gu')),
        ).toHaveLength(1)
      }
    }
    expect(transactionLines.filter((line) => line.startsWith('Target '))).toHaveLength(14)
    const review = renderVisualPlusChanges(input).map(stripAnsi).join('')
    for (const change of input.snapshot.changes) {
      expect(review.match(new RegExp(`Operation ID ${change.id}(?![0-9])`, 'gu'))).toHaveLength(1)
    }
    expect(output).toContain('Dependency dependency-0-0')
    expect(output).toMatch(/Current \^1\.0\.0\s+\| Target \^2\.0\.0/u)
    expect(output).toMatch(/Diff major\s+\| Age ~5d\s+\| Compatibility unknown/u)
    expect(renderVisualPlusReceipt(input).map(stripAnsi)).toEqual([
      'Complete · 76 updates applied across 14 files',
      'Applied 76  Blocked 0  Not attempted 0  Failed 0  Unknown 0',
      'All 14 target files were observed at the requested values. Recovery was not needed. 2.4s.',
      'Exit 0',
    ])
  })

  it('renders the exact authoritative safety block without inventing unknown outcomes', () => {
    const input = createVisualPlusSectionInput(fixture('blocked', 2))

    expect(renderVisualPlusReceipt(input).map(stripAnsi)).toEqual([
      'Safety block · no files were changed',
      'Applied 0  Blocked 76  Not attempted 76  Failed 0  Unknown 0',
      ...Array.from(
        { length: 14 },
        (_, index) =>
          `Preflight could not confirm Git state for packages/target-${index}/package.json.`,
      ),
      'Next: review all reported errors and restore trustworthy Git evidence for every reported target before rerunning.',
      'Exit 2',
    ])
  })

  it.each(
    [8, 10, 40, 60, 80, 118].flatMap((width) => [
      { width, constrained: false },
      { width, constrained: true },
    ]),
  )(
    'contains every visible line at width $width constrained=$constrained',
    ({ width, constrained }) => {
      const base = fixture()
      const input = createVisualPlusSectionInput({
        ...base,
        capabilities: {
          ...base.capabilities,
          interactive: !constrained,
          color: !constrained,
          motion: !constrained,
          cursorControl: !constrained,
          width,
          layout: constrained ? 'plain' : width < 60 ? 'narrow' : width < 100 ? 'medium' : 'wide',
        },
      })

      expect(allSections(input).every((line) => visualLength(line) <= width)).toBe(true)
    },
  )

  it('sanitizes hostile text, resets styled fragments, and uses reversible width-one ASCII', () => {
    const theme = createVisualPlusTheme({ ...capable, width: 1 })
    const value = 'safe\u001B]8;;https://evil.example\u0007link\u001B]8;;\u0007\u202E界👩‍💻'
    const lines = wrapVisualPlusText(value, 1, theme)
    const plain = lines.map(stripAnsi)

    expect(lines.every((line) => visualLength(line) <= 1)).toBe(true)
    expect(plain.join('')).toBe('safelinkU+{754C}U+{1F469}U+{1F4BB}')
    expect(lines.join('')).not.toContain('\u001B]')
  })

  it('contains hostile values through the real header, change, and receipt sections', () => {
    const base = fixture('blocked', 2)
    const hostile = '\u001B]8;;https://evil.example\u0007safe\u001B]8;;\u0007\u202E界👩‍💻'
    const input = createVisualPlusSectionInput({
      ...base,
      run: { ...base.run, repository: { ...base.run.repository, name: hostile } },
      snapshot: {
        ...base.snapshot,
        changes: [
          { ...base.snapshot.changes[0]!, current: hostile },
          ...base.snapshot.changes.slice(1),
        ],
        diagnostics: [{ code: hostile, path: 'package.json', detail: hostile }],
      },
    })
    const lines = allSections(input)

    expect(lines.join('')).not.toContain('\u001B]')
    expect(lines.every((line) => visualLength(line) <= input.capabilities.width)).toBe(true)
    expect(lines.map(stripAnsi).join('\n')).toContain('safe界👩💻')
  })

  it('retains identical words and numbers without color and uses ASCII when Unicode is disabled', () => {
    const input = fixture()
    const color = allSections(createVisualPlusSectionInput(input)).map(stripAnsi)
    const plain = allSections(
      createVisualPlusSectionInput({
        ...input,
        capabilities: { ...input.capabilities, color: false, unicode: false },
      }),
    ).map(stripAnsi)

    const semantic = (lines: readonly string[]) =>
      lines
        .join('\n')
        .replaceAll(' · ', ' - ')
        .replaceAll(' | ', ' - ')
        .replaceAll(' → ', ' -> ')
        .replaceAll('├ ', '- ')
        .replace(/[█░#]+/gu, '')
        .replace(/(?<=- )\.+/gu, '')
        .replace(/[✓✗◆?↩○·] /gu, '')
        .replace(/\[[+!*?<>.-]\] /gu, '')
    expect(semantic(plain)).toBe(semantic(color))
  })

  it('styles sanitized lifecycle fragments only when color is enabled', () => {
    const colorInput = createVisualPlusSectionInput(fixture())
    const plainInput = createVisualPlusSectionInput({
      ...fixture(),
      capabilities: { ...capable, color: false },
    })
    const colorLines = renderVisualPlusLifecycle(colorInput)
    const plainLines = renderVisualPlusLifecycle(plainInput)

    expect(colorLines.some((line) => line.includes('\u001B['))).toBe(true)
    expect(plainLines.some((line) => line.includes('\u001B['))).toBe(false)
    expect(colorLines.map(stripAnsi)).toEqual(plainLines)
    expect(
      colorLines
        .filter((line) => line.includes('\u001B['))
        .every((line) => line.endsWith('\u001B[39m')),
    ).toBe(true)
  })

  it('renders standalone lifecycle headings and phases with the section wrapping contract', () => {
    const heading = renderVisualPlusLifecycleHeading({ ...capable, color: false, width: 8 })
    const phase = renderVisualPlusLifecyclePhase(
      { name: 'discover', status: 'active' },
      { ...capable, color: false, width: 8 },
    )

    expect(heading).toEqual(['Lifecycl', 'e'])
    expect(phase.every((line) => visualLength(line) <= 8)).toBe(true)
    expect(phase.join('')).toBe('discover · ◆ active')
  })

  it('renders exact operation-ID membership under every structured transaction target', () => {
    const input = createVisualPlusSectionInput(fixture())
    const lines = renderVisualPlusTransaction(input).map(stripAnsi)
    const membership = lines.filter((line) => line.startsWith('Operations · outcome applied'))

    expect(membership).toHaveLength(14)
    expect(lines.length).toBeLessThanOrEqual(45)
    const transaction = lines.join('')
    for (const change of input.snapshot.changes) {
      expect(transaction.match(new RegExp(`${change.id}(?![0-9])`, 'gu'))).toHaveLength(1)
    }
  })

  it('renders exact operation outcomes, independent flags, and sanitized reasons under a mixed target', () => {
    const base = fixture()
    const operations = base.snapshot.results.operations.map((operation, index) => {
      if (index !== 1) return operation
      return {
        ...operationResult(operation.operationId, 'blocked'),
        reason: 'SOURCE\u001B[31m_CHANGED\u202E',
      }
    })
    const targetResults = base.snapshot.results.targets.map((target, index) =>
      index === 0
        ? {
            ...target,
            outcome: 'mixed' as const,
            blocked: true,
            notAttempted: true,
          }
        : target,
    )
    const input = createVisualPlusSectionInput({
      ...base,
      snapshot: {
        ...base.snapshot,
        results: {
          operations,
          targets: targetResults,
          totals: totals({ applied: 75, blocked: 1, notAttempted: 1 }),
          targetTotals: totals({ applied: 13, mixed: 1, blocked: 1, notAttempted: 1 }),
        },
      },
      writeReceipt: undefined,
    })
    const lines = renderVisualPlusTransaction(input).map(stripAnsi)
    const output = lines.join('')

    expect(output).toContain(
      'Operations · outcome applied · blocked false · not attempted false · unknown false · IDs operation-0-0',
    )
    expect(output).toContain(
      'Operations · outcome blocked · blocked true · not attempted true · unknown false · reason SOURCE_CHANGED · IDs operation-0-1',
    )
    expect(output.match(/IDs operation-0-1(?![0-9])/gu)).toHaveLength(1)
    expect(lines.join('')).not.toContain('\u001B')
    expect(lines.join('')).not.toContain('\u202E')
  })

  it.each([60, 80, 118])(
    'keeps every long medium/wide change field labeled and lossless at width %i',
    (width) => {
      const base = fixture()
      const dependency = `dependency-${'x'.repeat(72)}`
      const current = `npm:${'current'.repeat(10)}@1.0.0`
      const target = `npm:${'target'.repeat(12)}@2.0.0`
      const detail = `requires-${'runtime'.repeat(12)}`
      const input = createVisualPlusSectionInput({
        ...base,
        capabilities: {
          ...base.capabilities,
          color: false,
          width,
          layout: width < 100 ? 'medium' : 'wide',
        },
        snapshot: {
          ...base.snapshot,
          changes: [
            {
              ...base.snapshot.changes[0]!,
              name: dependency,
              current,
              target,
              insight: {
                ...base.snapshot.changes[0]!.insight!,
                dependencyId: createRepositoryId('dependency', dependency),
                rawName: dependency,
                occurrencePath: ['dependencies', dependency],
                compatibility: { status: 'unknown', detail },
              },
            },
            ...base.snapshot.changes.slice(1),
          ],
        },
        changes: base.changes.map((metadata, index) =>
          index === 0 ? { ...metadata, compatibility: { status: 'unknown', detail } } : metadata,
        ),
      })
      const lines = renderVisualPlusChanges(input).map(stripAnsi)
      const compact = lines.join('')

      expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
      const operationRows = lines.filter((line) => line.startsWith('Operation ID '))
      const currentRows = lines.filter((line) => line.startsWith('Current '))
      const detailRows = lines.filter((line) => line.startsWith('Diff '))
      expect(operationRows.length).toBeGreaterThanOrEqual(76)
      expect(detailRows.length).toBeGreaterThanOrEqual(76)
      if (width < 100) expect(currentRows.length).toBeGreaterThanOrEqual(76)
      else expect(operationRows.every((line) => line.includes(' | Current '))).toBe(true)
      for (const rows of [
        operationRows,
        ...(currentRows.length > 0 ? [currentRows] : []),
        detailRows,
      ]) {
        const separatorPositions = rows.map((line) =>
          [...line.matchAll(/ \| /gu)].map((match) => match.index),
        )
        expect(separatorPositions.every((positions) => positions.length > 0)).toBe(true)
        expect(new Set(separatorPositions.map((positions) => positions.join(','))).size).toBe(1)
      }
      expect(compact).toContain('Operation ID operation-0-0')
      expect(collectColumnValues(lines, 'Dependency')).toContain(dependency)
      expect(collectColumnValues(lines, 'Current')).toContain(current)
      expect(collectColumnValues(lines, 'Target')).toContain(target)
      expect(collectColumnValues(lines, 'Compatibility').replaceAll(' ', '')).toContain(
        `unknown(${detail})`,
      )
      expect(
        collectColumnValues(lines, 'Dependency').match(new RegExp(dependency, 'gu')),
      ).toHaveLength(1)
      expect(collectColumnValues(lines, 'Current').match(new RegExp(current, 'gu'))).toHaveLength(1)
      expect(collectColumnValues(lines, 'Target').match(new RegExp(target, 'gu'))).toHaveLength(1)
      expect(
        collectColumnValues(lines, 'Compatibility').match(new RegExp(detail, 'gu')),
      ).toHaveLength(1)
    },
  )

  it.each([
    { width: 8, layout: 'narrow' as const },
    { width: 8, layout: 'plain' as const },
  ])('keeps narrow $layout fields labeled and lossless at width $width', ({ width, layout }) => {
    const base = fixture()
    const input = createVisualPlusSectionInput({
      ...base,
      capabilities: {
        ...base.capabilities,
        color: false,
        unicode: false,
        width,
        layout,
      },
    })
    const lines = renderVisualPlusChanges(input).map(stripAnsi)
    const compact = lines.join('')

    expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
    expect(compact).toContain('Operation ID operation-0-0')
    expect(compact).toContain('Dependency dependency-0-0')
    expect(compact).toContain('Current ^1.0.0')
    expect(compact).toContain('Target ^2.0.0')
    expect(compact).toContain('Compatibility unknown')
  })

  it('uses a neutral transaction heading for read-only physical target evidence', () => {
    const source = fixture()
    const input = createVisualPlusSectionInput({
      ...source,
      snapshot: { ...source.snapshot, write: false },
      writeReceipt: undefined,
    })
    const lines = renderVisualPlusTransaction(input).map(stripAnsi)

    expect(lines[0]).toBe('Reviewed physical targets')
    expect(lines).not.toContain('Apply transaction')
    expect(lines.filter((line) => line.startsWith('Operations · outcome applied'))).toHaveLength(14)
  })

  it('renders ambiguous manager versions and unavailable evidence sources', () => {
    const ambiguous = fixture()
    const unavailable = fixture()
    const ambiguousLines = renderVisualPlusHeader(
      createVisualPlusSectionInput({
        ...ambiguous,
        run: {
          ...ambiguous.run,
          packageManager: {
            status: 'ambiguous',
            candidates: [
              { name: 'pnpm', version: '10.33.0', source: 'package.json' },
              { name: 'npm', version: '11.12.0', source: 'package-lock.json' },
            ],
          },
        },
      }),
    ).map(stripAnsi)
    const unavailableLines = renderVisualPlusHeader(
      createVisualPlusSectionInput({
        ...unavailable,
        run: {
          ...unavailable.run,
          packageManager: {
            status: 'unavailable',
            sources: ['package.json', 'pnpm-lock.yaml'],
          },
        },
      }),
    ).map(stripAnsi)

    expect(ambiguousLines).toContain(
      'Package manager ambiguous · pnpm 10.33.0 · package.json, npm 11.12.0 · package-lock.json',
    )
    expect(unavailableLines).toContain('Package manager unavailable · package.json, pnpm-lock.yaml')
  })

  it('uses aligned ASCII columns for catalog metadata in ASCII mode', () => {
    const base = fixture()
    const catalogChange = base.changes.find((change) => change.catalog !== undefined)
    if (!catalogChange?.catalog) throw new Error('Expected catalog fixture evidence')
    const input = createVisualPlusSectionInput({
      ...base,
      capabilities: { ...base.capabilities, unicode: false, color: false },
    })
    const output = renderVisualPlusChanges(input).map(stripAnsi).join('\n')

    expect(output).toMatch(
      new RegExp(
        `Catalog ${catalogChange.catalog.name}\\s+\\| Source ${catalogChange.catalog.sourcePath.replaceAll('.', '\\.')}`,
        'u',
      ),
    )
    expect(output).not.toContain(
      `Catalog ${catalogChange.catalog.name} · Source ${catalogChange.catalog.sourcePath}`,
    )
  })
})

describe('Visual+ receipt decision table', () => {
  function oneOperation(
    options: {
      write?: boolean
      exitCode?: 0 | 1 | 2 | null
      outcome?: CheckRunOperationOutcome
      verdict?: WriteReceiptVerdict
      recovery?: CheckRunRecovery
      receipt?: boolean
    } = {},
  ): VisualPlusSectionInput {
    const write = options.write ?? true
    const exitCode = options.exitCode === undefined ? 0 : options.exitCode
    const outcome = options.outcome ?? (write ? 'applied' : 'not-attempted')
    const change: CheckRunChange = {
      id: 'op',
      name: 'dep',
      owner: 'package.json',
      current: '1.0.0',
      target: '2.0.0',
      diff: 'major',
      insight: {
        dependencyId: createRepositoryId('dependency', 'dep'),
        rawName: 'dep',
        sourceFileId: createRepositoryId('source', 'package.json'),
        sourcePath: 'package.json',
        occurrencePath: ['dependencies', 'dep'],
        owner: {
          id: createRepositoryId('package', 'package.json'),
          role: 'manifest',
          label: 'root',
          path: 'package.json',
          order: 0,
          physicalTarget: 'package.json',
        },
        catalog: { role: 'direct' },
        ageMs: null,
        compatibility: { status: 'unknown' },
      },
    }
    const target: CheckRunTarget = { path: 'package.json', operationIds: ['op'] }
    const recovery = options.recovery ?? {
      executed: false,
      status: 'not-needed',
      restoredPaths: [],
      unrecoveredPaths: [],
    }
    const snapshot: CheckRunSnapshot = {
      sequence: 1,
      mode: 'major',
      write,
      phases: phases({
        observe: outcome === 'applied' ? 'passed' : 'skipped',
        recover: recovery.executed ? 'passed' : 'skipped',
        complete: exitCode === null ? 'active' : exitCode === 0 ? 'passed' : 'failed',
      }),
      counts: {
        packages: 1,
        declared: 1,
        eligible: 1,
        unresolved: 0,
        updates: 1,
        operations: 1,
        targets: 1,
      },
      changes: [change],
      targets: [target],
      diagnostics: [],
      results: {
        operations: [operationResult('op', outcome)],
        targets: [targetResult(target, outcome as CheckRunTargetOutcome)],
        totals: totals({
          applied: outcome === 'applied' ? 1 : 0,
          skipped: outcome === 'skipped' ? 1 : 0,
          blocked: outcome === 'blocked' ? 1 : 0,
          notAttempted: ['blocked', 'not-attempted'].includes(outcome) ? 1 : 0,
          failed: outcome === 'failed' ? 1 : 0,
          reverted: outcome === 'reverted' ? 1 : 0,
          unknown: outcome === 'unknown' ? 1 : 0,
        }),
        targetTotals: totals({
          applied: outcome === 'applied' ? 1 : 0,
          skipped: outcome === 'skipped' ? 1 : 0,
          blocked: outcome === 'blocked' ? 1 : 0,
          notAttempted: ['blocked', 'not-attempted'].includes(outcome) ? 1 : 0,
          failed: outcome === 'failed' ? 1 : 0,
          reverted: outcome === 'reverted' ? 1 : 0,
          unknown: outcome === 'unknown' ? 1 : 0,
        }),
      },
      recovery,
      elapsedMs: exitCode === null ? null : 100,
      exitCode,
      terminalEvents: [],
    }
    const canonicalStatus =
      outcome === 'blocked' ? 'conflicted' : outcome === 'not-attempted' ? 'skipped' : outcome
    const canonical = canonicalReceipt(
      options.verdict ??
        (canonicalStatus === 'applied' || canonicalStatus === 'skipped'
          ? 'complete'
          : canonicalStatus === 'reverted'
            ? 'partial'
            : canonicalStatus === 'conflicted'
              ? 'safety-block'
              : canonicalStatus),
      1,
      1,
      canonicalStatus,
      canonicalStatus === 'conflicted',
      [target],
    )
    return {
      snapshot,
      capabilities: { ...capable, color: false, unicode: false },
      run: { workspaceScope: 'single-package', packageManager: { status: 'unknown', sources: [] } },
      changes: [
        {
          operationId: 'op',
          ownerGroup: {
            id: createRepositoryId('package', 'package.json'),
            label: 'root',
            order: 0,
            physicalTarget: 'package.json',
          },
          ageMs: null,
          compatibility: { status: 'unknown' },
        },
      ],
      ...(write && options.receipt !== false
        ? { writeReceipt: receiptEvidence(snapshot, canonical) }
        : {}),
    }
  }

  it.each([
    ['Pending', { exitCode: null }],
    ['Review complete', { write: false, exitCode: 0 }],
    ['Review complete - updates available', { write: false, exitCode: 1 }],
    ['Review incomplete', { write: false, exitCode: 2 }],
    ['Result unknown - receipt evidence unavailable', { receipt: false }],
    ['Safety block - no files were changed', { outcome: 'blocked', exitCode: 2 }],
    ['Partial', { outcome: 'reverted', verdict: 'partial', exitCode: 2 }],
    ['Failed', { outcome: 'failed', verdict: 'failed', exitCode: 2 }],
    ['Unknown', { outcome: 'unknown', verdict: 'unknown', exitCode: 2 }],
    ['Complete - 1 update applied across 1 file', {}],
    ['Complete - 0 applied, 1 skipped across 1 file', { outcome: 'skipped' }],
    ['Write complete - command incomplete', { exitCode: 2 }],
  ] as const)('selects %s', (headline, options) => {
    expect(renderVisualPlusReceipt(createVisualPlusSectionInput(oneOperation(options)))[0]).toBe(
      headline,
    )
  })

  it.each([
    { width: 8, layout: 'plain' as const },
    { width: 60, layout: 'medium' as const },
    { width: 80, layout: 'medium' as const },
    { width: 118, layout: 'wide' as const },
  ])(
    'renders every authoritative read-only diagnostic once, sanitized and losslessly wrapped at width $width',
    ({ width, layout }) => {
      const base = oneOperation({ write: false, exitCode: 2 })
      const input = createVisualPlusSectionInput({
        ...base,
        capabilities: {
          ...base.capabilities,
          color: false,
          unicode: false,
          width,
          layout,
        },
        snapshot: {
          ...base.snapshot,
          diagnostics: [
            {
              code: 'READ_ONLY\u001B[31m_INCOMPLETE',
              path: 'package.json',
              detail: 'registry\u001B]8;;https://evil.example\u0007 unavailable\u202E safely',
            },
            {
              code: 'INSPECTION_UNAVAILABLE',
              path: 'packages/app/package.json',
              detail: 'manager evidence unavailable',
            },
          ],
        },
      })
      const lines = renderVisualPlusReceipt(input).map(stripAnsi)
      const compact = lines.join('')

      expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
      expect(compact.match(/Diagnostic READ_ONLY_INCOMPLETE/gu)).toHaveLength(1)
      expect(compact.match(/Diagnostic INSPECTION_UNAVAILABLE/gu)).toHaveLength(1)
      expect(compact).toContain(
        'Diagnostic READ_ONLY_INCOMPLETE - path package.json - detail registry unavailable safely',
      )
      expect(compact).toContain(
        'Diagnostic INSPECTION_UNAVAILABLE - path packages/app/package.json - detail manager evidence unavailable',
      )
      expect(compact).toContain(
        'Next: review every diagnostic and correct each reported cause before rerunning.',
      )
      expect(lines.filter((line) => line.startsWith('Next:'))).toHaveLength(1)
      expect(lines.at(-1)).toBe('Exit 2')
      expect(lines.join('')).not.toContain('\u001B')
      expect(lines.join('')).not.toContain('\u202E')
    },
  )

  it('renders canonical skipped operations as complete when not-attempted overlaps', () => {
    const base = oneOperation({ outcome: 'skipped' })
    const operation = { ...base.snapshot.results.operations[0]!, notAttempted: true }
    const target = { ...base.snapshot.results.targets[0]!, notAttempted: true }
    const snapshot: CheckRunSnapshot = {
      ...base.snapshot,
      results: {
        operations: [operation],
        targets: [target],
        totals: totals({ skipped: 1, notAttempted: 1 }),
        targetTotals: totals({ skipped: 1, notAttempted: 1 }),
      },
    }
    const input = createVisualPlusSectionInput({
      ...base,
      snapshot,
      capabilities: { ...base.capabilities, unicode: true },
    })

    expect(renderVisualPlusReceipt(input)[0]).toBe('Complete · 0 applied, 1 skipped across 1 file')
  })

  it.each([
    [
      'Recovered',
      {
        executed: true,
        status: 'completed',
        restoredPaths: ['package.json'],
        unrecoveredPaths: [],
      },
    ],
    [
      'Recovery incomplete',
      { executed: true, status: 'partial', restoredPaths: [], unrecoveredPaths: ['package.json'] },
    ],
    [
      'Recovery unknown',
      { executed: true, status: 'unknown', restoredPaths: [], unrecoveredPaths: ['package.json'] },
    ],
  ] as const)('prioritizes %s', (headline, recovery) => {
    const input = oneOperation({ outcome: 'reverted', verdict: 'partial', exitCode: 2, recovery })
    const withReceipt = { ...input, writeReceipt: { ...input.writeReceipt!, recovery } }
    expect(renderVisualPlusReceipt(createVisualPlusSectionInput(withReceipt))[0]).toBe(headline)
  })

  it.each([
    [
      'Result unknown - receipt evidence unavailable',
      { receipt: false, exitCode: 2 },
      'Next: inspect all reported diagnostics and repository state; do not rerun until every final state is known.',
    ],
    [
      'Safety block - no files were changed',
      { outcome: 'blocked', exitCode: 2 },
      'Next: review all reported errors and restore trustworthy Git evidence for every reported target before rerunning.',
    ],
    [
      'Partial',
      { outcome: 'reverted', verdict: 'partial', exitCode: 2 },
      'Next: review all reported errors and inspect every applied or incomplete target; do not rerun until the repository state is understood.',
    ],
    [
      'Failed',
      { outcome: 'failed', verdict: 'failed', exitCode: 2 },
      'Next: review all reported errors and inspect every failed target; rerun only after every known cause is corrected.',
    ],
    [
      'Unknown',
      { outcome: 'unknown', verdict: 'unknown', exitCode: 2 },
      'Next: review all reported errors and inspect every target; do not rerun until every final state is known.',
    ],
    [
      'Write complete - command incomplete',
      { exitCode: 2 },
      'Next: review all reported errors before running another write.',
    ],
  ] as const)('adds one safe next action to %s', (_headline, options, action) => {
    const lines = renderVisualPlusReceipt(createVisualPlusSectionInput(oneOperation(options))).map(
      stripAnsi,
    )

    expect(renderedNextAction(lines)).toBe(action)
    expect(lines.at(-1)).toBe('Exit 2')
    expect(lines.filter((line) => line.startsWith('Next:'))).toHaveLength(1)
  })

  it('adds one safe next action to an incomplete zero-selection write', () => {
    const base = oneOperation({ receipt: false, exitCode: 2 })
    const input = createVisualPlusSectionInput({
      ...base,
      changes: [],
      snapshot: {
        ...base.snapshot,
        counts: {
          packages: 1,
          declared: 0,
          eligible: 0,
          unresolved: 0,
          updates: 0,
          operations: 0,
          targets: 0,
        },
        changes: [],
        targets: [],
        results: {
          operations: [],
          targets: [],
          totals: totals(),
          targetTotals: totals(),
        },
      },
    })
    const lines = renderVisualPlusReceipt(input).map(stripAnsi)

    expect(renderedNextAction(lines)).toBe(
      'Next: inspect all reported diagnostics; do not rerun until the cause is understood.',
    )
    expect(lines.at(-1)).toBe('Exit 2')
    expect(lines.filter((line) => line.startsWith('Next:'))).toHaveLength(1)
  })

  it.each([
    [
      'Recovered',
      {
        executed: true,
        status: 'completed',
        restoredPaths: ['package.json'],
        unrecoveredPaths: [],
      },
      'Next: review all reported errors and restored paths; rerun only after every cause is corrected.',
    ],
    [
      'Recovery incomplete',
      {
        executed: true,
        status: 'partial',
        restoredPaths: [],
        unrecoveredPaths: ['package.json'],
      },
      'Next: preserve retained evidence and reconcile every applied, restored, and unrecovered path and external effect before any retry.',
    ],
    [
      'Recovery unknown',
      {
        executed: true,
        status: 'unknown',
        restoredPaths: [],
        unrecoveredPaths: ['package.json'],
      },
      'Next: preserve retained evidence and establish every named path and external effect; do not retry until every final state is known.',
    ],
  ] as const)('adds one recovery action to %s', (_headline, recovery, action) => {
    const input = oneOperation({ outcome: 'reverted', verdict: 'partial', exitCode: 2, recovery })
    const lines = renderVisualPlusReceipt(
      createVisualPlusSectionInput({
        ...input,
        writeReceipt: { ...input.writeReceipt!, recovery },
      }),
    ).map(stripAnsi)

    expect(renderedNextAction(lines)).toBe(action)
    expect(lines.at(-1)).toBe('Exit 2')
    expect(lines.filter((line) => line.startsWith('Next:'))).toHaveLength(1)
  })

  it('accepts partial recovery with restored paths and no unrecovered manifest path', () => {
    const recovery: CheckRunRecovery = {
      executed: true,
      status: 'partial',
      restoredPaths: ['package.json'],
      unrecoveredPaths: [],
    }
    const input = oneOperation({ outcome: 'reverted', verdict: 'partial', exitCode: 2, recovery })
    const lines = renderVisualPlusReceipt(
      createVisualPlusSectionInput({
        ...input,
        writeReceipt: { ...input.writeReceipt!, recovery },
      }),
    ).map(stripAnsi)

    expect(lines[0]).toBe('Recovery incomplete')
    expect(lines).toContain('Restored: package.json')
    expect(lines).toContain('Unrecovered: none')
  })

  it.each([
    [
      'VCS_UNAVAILABLE',
      undefined,
      'Preflight could not confirm Git state for package.json.',
      'Next: review all reported errors and restore trustworthy Git evidence for every reported target before rerunning.',
    ],
    [
      'AMBIGUOUS_OCCURRENCE',
      'CATALOG_AMBIGUOUS',
      'package.json - AMBIGUOUS_OCCURRENCE / CATALOG_AMBIGUOUS',
      'Next: review all reported errors and correct every reported preflight blocker before rerunning.',
    ],
    [
      'UNSUPPORTED_WRITE_SOURCE',
      undefined,
      'package.json - UNSUPPORTED_WRITE_SOURCE',
      'Next: review all reported errors and correct every reported preflight blocker before rerunning.',
    ],
    [
      'SOURCE_CHANGED',
      undefined,
      'package.json - SOURCE_CHANGED',
      'Next: review all reported errors and correct every reported preflight blocker before rerunning.',
    ],
  ] as const)(
    'renders canonical safety reason %s without inventing Git',
    (reason, diagnostic, expected, expectedAction) => {
      const input = oneOperation({ outcome: 'blocked', exitCode: 2 })
      const group = input.writeReceipt!.canonical.groups[0]!
      const canonical = {
        ...input.writeReceipt!.canonical,
        groups: [{ ...group, reason, ...(diagnostic ? { diagnostic } : {}) }],
      }
      const lines = renderVisualPlusReceipt(
        createVisualPlusSectionInput({
          ...input,
          writeReceipt: { ...input.writeReceipt!, canonical },
        }),
      ).map(stripAnsi)

      expect(lines).toContain(expected)
      expect(lines).toContain(expectedAction)
      if (reason !== 'VCS_UNAVAILABLE') {
        expect(lines.join('\n')).not.toContain('Preflight could not confirm Git state')
      }
    },
  )

  it('binds VCS-unavailable safety prose to each canonical group target', () => {
    const lines = renderVisualPlusReceipt(createVisualPlusSectionInput(fixture('blocked', 2))).map(
      stripAnsi,
    )

    expect(lines).toContain(
      'Preflight could not confirm Git state for packages/target-0/package.json.',
    )
    expect(lines).toContain(
      'Preflight could not confirm Git state for packages/target-13/package.json.',
    )
    expect(lines).not.toContain('Preflight could not confirm Git state for package.json.')
  })

  it('renders all retained evidence for partial and recovery branches', () => {
    const recovery: CheckRunRecovery = {
      executed: true,
      status: 'partial',
      journalId: 'journal-1',
      restoredPaths: [],
      unrecoveredPaths: ['package.json'],
      externalEffects: ['install tree may have changed'],
    }
    const input = oneOperation({ outcome: 'reverted', verdict: 'partial', exitCode: 2, recovery })
    const lines = renderVisualPlusReceipt(
      createVisualPlusSectionInput({
        ...input,
        writeReceipt: { ...input.writeReceipt!, recovery },
      }),
    ).map(stripAnsi)

    expect(lines).toContain('Restored: none')
    expect(lines).toContain('Unrecovered: package.json')
    expect(lines).toContain('Journal: journal-1')
    expect(lines).toContain('External effects: install tree may have changed')
    expect(lines).toContain('Applied: none')
    expect(lines.join('\n')).not.toContain('Targets:')
  })

  it('separates applied physical targets from restored and unrecovered targets', () => {
    const base = oneOperation()
    const changes: CheckRunChange[] = [
      {
        id: 'applied',
        name: 'applied-dep',
        owner: 'mixed/package.json',
        current: '1.0.0',
        target: '2.0.0',
        diff: 'major',
        insight: manifestInsight('applied-dep', 'mixed/package.json', 'mixed', 0),
      },
      {
        id: 'blocked',
        name: 'blocked-dep',
        owner: 'mixed/package.json',
        current: '1.0.0',
        target: '2.0.0',
        diff: 'major',
        insight: manifestInsight('blocked-dep', 'mixed/package.json', 'mixed', 0),
      },
      {
        id: 'reverted',
        name: 'reverted-dep',
        owner: 'reverted/package.json',
        current: '1.0.0',
        target: '2.0.0',
        diff: 'major',
        insight: manifestInsight('reverted-dep', 'reverted/package.json', 'reverted', 1),
      },
    ]
    const targets: CheckRunTarget[] = [
      { path: 'mixed/package.json', operationIds: ['applied', 'blocked'] },
      { path: 'reverted/package.json', operationIds: ['reverted'] },
    ]
    const recovery: CheckRunRecovery = {
      executed: true,
      status: 'partial',
      journalId: 'journal-mixed',
      restoredPaths: ['reverted/package.json'],
      unrecoveredPaths: ['mixed/package.json'],
      externalEffects: ['install tree may have changed'],
    }
    const snapshot: CheckRunSnapshot = {
      ...base.snapshot,
      counts: { ...base.snapshot.counts, updates: 3, operations: 3, targets: 2 },
      changes,
      targets,
      results: {
        operations: [
          operationResult('applied', 'applied'),
          operationResult('blocked', 'blocked'),
          operationResult('reverted', 'reverted'),
        ],
        targets: [
          {
            path: 'mixed/package.json',
            operationIds: ['applied', 'blocked'],
            outcome: 'mixed',
            blocked: true,
            notAttempted: true,
            unknown: false,
          },
          targetResult(targets[1]!, 'reverted'),
        ],
        totals: totals({ applied: 1, blocked: 1, notAttempted: 1, reverted: 1 }),
        targetTotals: totals({ mixed: 1, blocked: 1, notAttempted: 1, reverted: 1 }),
      },
      recovery,
      exitCode: 2,
    }
    const canonical: WriteReceipt = {
      verdict: 'partial',
      operations: {
        planned: 3,
        applied: 1,
        skipped: 0,
        conflicted: 1,
        reverted: 1,
        failed: 0,
        unknown: 0,
      },
      files: {
        planned: 2,
        applied: 1,
        skipped: 0,
        blocked: 1,
        conflicted: 1,
        reverted: 1,
        failed: 0,
        unknown: 0,
      },
      groups: [
        {
          file: 'mixed/package.json',
          status: 'conflicted',
          reason: 'VCS_UNAVAILABLE',
          occurrences: 1,
          replacementAttempted: false,
          details: [
            {
              name: 'blocked-dep',
              path: ['dependencies', 'blocked-dep'],
              status: 'conflicted',
              reason: 'VCS_UNAVAILABLE',
            },
          ],
        },
        {
          file: 'reverted/package.json',
          status: 'reverted',
          reason: 'REVERTED',
          occurrences: 1,
          replacementAttempted: true,
          details: [
            {
              name: 'reverted-dep',
              path: ['dependencies', 'reverted-dep'],
              status: 'reverted',
              reason: 'REVERTED',
            },
          ],
        },
      ],
      noFilesChanged: false,
    }
    const input = createVisualPlusSectionInput({
      ...base,
      snapshot,
      changes: [
        {
          operationId: 'applied',
          ownerGroup: {
            id: createRepositoryId('package', 'mixed/package.json'),
            label: 'mixed',
            order: 0,
            physicalTarget: 'mixed/package.json',
          },
          ageMs: null,
          compatibility: { status: 'unknown' },
        },
        {
          operationId: 'blocked',
          ownerGroup: {
            id: createRepositoryId('package', 'mixed/package.json'),
            label: 'mixed',
            order: 0,
            physicalTarget: 'mixed/package.json',
          },
          ageMs: null,
          compatibility: { status: 'unknown' },
        },
        {
          operationId: 'reverted',
          ownerGroup: {
            id: createRepositoryId('package', 'reverted/package.json'),
            label: 'reverted',
            order: 1,
            physicalTarget: 'reverted/package.json',
          },
          ageMs: null,
          compatibility: { status: 'unknown' },
        },
      ],
      writeReceipt: receiptEvidence(snapshot, canonical),
    })
    const lines = renderVisualPlusReceipt(input).map(stripAnsi)

    expect(lines).toContain('Applied: mixed/package.json')
    expect(lines).toContain('Restored: reverted/package.json')
    expect(lines).toContain('Unrecovered: mixed/package.json')
    expect(lines).toContain('Journal: journal-mixed')
    expect(lines).toContain('External effects: install tree may have changed')
    expect(lines.join('\n')).not.toContain('Targets:')
  })
})
