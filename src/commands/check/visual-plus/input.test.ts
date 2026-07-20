import { describe, expect, it } from 'vitest'
import { createRepositoryId } from '../../../repository/identity'
import {
  type CheckRunChange,
  type CheckRunSnapshot,
  createCheckRunState,
  reduceCheckRun,
} from '../run-model'
import type { VisualPlusCapabilities } from './capabilities'
import {
  createVisualPlusSectionInput,
  type VisualPlusChangeMetadata,
  type VisualPlusSectionInput,
} from './input'

const capabilities: VisualPlusCapabilities = {
  interactive: false,
  color: false,
  unicode: false,
  motion: false,
  cursorControl: false,
  width: 80,
  layout: 'wide',
}

function selectedSnapshot(withInsight = true): CheckRunSnapshot {
  const sourcePath = 'package.json'
  const change: CheckRunChange = {
    id: 'operation-one',
    name: 'vitest',
    owner: sourcePath,
    current: '^3.0.0',
    target: '^4.0.0',
    diff: 'major',
    ageMs: 432_000_000,
    ...(withInsight
      ? {
          insight: {
            dependencyId: createRepositoryId('dependency', 'vitest'),
            rawName: 'vitest',
            sourceFileId: createRepositoryId('source', sourcePath),
            sourcePath,
            occurrencePath: ['dependencies', 'vitest'],
            owner: {
              id: createRepositoryId('package', sourcePath),
              role: 'manifest' as const,
              label: 'root',
              path: sourcePath,
              order: 0,
              physicalTarget: sourcePath,
            },
            catalog: { role: 'direct' as const },
            ageMs: 432_000_000,
            compatibility: { status: 'unknown' as const },
          },
        }
      : {}),
  }
  let snapshot = createCheckRunState({ mode: 'major', write: false })
  snapshot = reduceCheckRun(snapshot, {
    type: 'packages-discovered',
    packages: 1,
    declared: 1,
  })
  snapshot = reduceCheckRun(snapshot, {
    type: 'resolution-completed',
    eligible: 1,
    unresolved: 0,
    updates: 1,
  })
  return reduceCheckRun(snapshot, {
    type: 'selection-completed',
    operations: 1,
    targets: 1,
    changes: [change],
    selectedTargets: [{ path: sourcePath, operationIds: [change.id] }],
  })
}

function metadata(): VisualPlusChangeMetadata {
  return {
    operationId: 'operation-one',
    source: 'dependencies',
    displayOrder: 0,
    ownerGroup: {
      id: createRepositoryId('package', 'package.json'),
      label: 'root',
      order: 0,
      physicalTarget: 'package.json',
    },
    ageMs: 432_000_000,
    compatibility: { status: 'unknown' },
  }
}

function input(
  snapshot: CheckRunSnapshot,
  changeMetadata: VisualPlusChangeMetadata = metadata(),
): VisualPlusSectionInput {
  return {
    snapshot,
    capabilities,
    run: {
      display: {
        group: true,
        sort: 'diff-asc',
        timediff: true,
        nodecompat: true,
      },
      workspaceScope: 'single-package',
      packageManager: { status: 'unknown', sources: [] },
    },
    changes: [changeMetadata],
  }
}

describe('Visual+ authoritative insight reconciliation', () => {
  it.each([
    ['unknown sort', { sort: 'unknown-sort' }],
    ['non-boolean group', { group: 'yes' }],
    ['non-boolean timediff', { timediff: 1 }],
    ['non-boolean nodecompat', { nodecompat: null }],
  ])('rejects an invalid display %s', (_name, display) => {
    const source = input(selectedSnapshot())
    expect(() =>
      createVisualPlusSectionInput({
        ...source,
        run: { ...source.run, display: { ...source.run.display, ...display } } as typeof source.run,
      }),
    ).toThrow(/Visual\+ input/u)
  })

  it.each([
    ['source', { ...metadata(), source: 'unsupported-source' }],
    ['duplicate order', { ...metadata(), displayOrder: 1 }],
  ])('rejects invalid change metadata %s', (_name, candidate) => {
    expect(() =>
      createVisualPlusSectionInput(
        input(selectedSnapshot(), candidate as unknown as VisualPlusChangeMetadata),
      ),
    ).toThrow(/Visual\+ input/u)
  })

  it('rejects duplicate display orders across two otherwise valid metadata rows', () => {
    const base = selectedSnapshot()
    const first = base.changes[0]!
    const second = {
      ...first,
      id: 'operation-two',
      name: 'vite',
      insight: {
        ...first.insight!,
        dependencyId: createRepositoryId('dependency', 'vite'),
        rawName: 'vite',
        occurrencePath: ['dependencies', 'vite'],
      },
    }
    const snapshot: CheckRunSnapshot = {
      ...base,
      counts: { ...base.counts, operations: 2, updates: 2 },
      changes: [first, second],
      targets: [{ path: 'package.json', operationIds: [first.id, second.id] }],
    }

    expect(() =>
      createVisualPlusSectionInput({
        ...input(snapshot),
        changes: [metadata(), { ...metadata(), operationId: second.id, displayOrder: 0 }],
      }),
    ).toThrow(/display order is duplicated/u)
  })

  it('accepts exact transitional metadata and retains a deep immutable copy', () => {
    const source = input(selectedSnapshot())
    const result = createVisualPlusSectionInput(source)

    expect(result.changes).toEqual([metadata()])
    expect(Object.isFrozen(result.snapshot.changes[0]?.insight?.owner)).toBe(true)
    expect(result.snapshot).not.toBe(source.snapshot)
  })

  it.each([
    ['operation ID', { ...metadata(), operationId: 'operation-other' }],
    ['owner ID', { ...metadata(), ownerGroup: { ...metadata().ownerGroup, id: 'package:wrong' } }],
    ['owner order', { ...metadata(), ownerGroup: { ...metadata().ownerGroup, order: 1 } }],
    ['owner label', { ...metadata(), ownerGroup: { ...metadata().ownerGroup, label: 'other' } }],
    [
      'owner target',
      {
        ...metadata(),
        ownerGroup: { ...metadata().ownerGroup, physicalTarget: 'other/package.json' },
      },
    ],
    ['age', { ...metadata(), ageMs: null }],
    ['compatibility', { ...metadata(), compatibility: { status: 'compatible' as const } }],
    ['catalog', { ...metadata(), catalog: { name: 'default', sourcePath: 'package.json' } }],
  ])('fails closed when transitional %s differs from snapshot evidence', (_name, candidate) => {
    expect(() => createVisualPlusSectionInput(input(selectedSnapshot(), candidate))).toThrow(
      /Visual\+ input/u,
    )
  })

  it('rejects all-missing and partially missing insight inventories for non-empty Visual+ input', () => {
    const missing = input(selectedSnapshot(false))
    expect(() => createVisualPlusSectionInput(missing)).toThrow(/insight inventory is required/u)

    const complete = selectedSnapshot()
    const first = complete.changes[0]!
    const second = {
      ...first,
      id: 'operation-two',
      insight: {
        ...first.insight!,
        dependencyId: createRepositoryId('dependency', 'vite'),
        rawName: 'vite',
        occurrencePath: ['dependencies', 'vite'],
      },
      name: 'vite',
    }
    const partialSnapshot: CheckRunSnapshot = {
      ...complete,
      counts: { ...complete.counts, operations: 2, updates: 2 },
      changes: [{ ...first, insight: undefined }, second],
      targets: [{ path: 'package.json', operationIds: ['operation-one', 'operation-two'] }],
    }
    const partial: VisualPlusSectionInput = {
      ...input(complete),
      snapshot: partialSnapshot,
      changes: [
        metadata(),
        {
          ...metadata(),
          operationId: 'operation-two',
        },
      ],
    }
    expect(() => createVisualPlusSectionInput(partial)).toThrow(/insight inventory is incomplete/u)
  })

  it('keeps an empty Visual+ selection valid without synthetic insight evidence', () => {
    const empty = createCheckRunState({ mode: 'major', write: false })
    expect(() =>
      createVisualPlusSectionInput({
        ...input(empty),
        changes: [],
      }),
    ).not.toThrow()
  })

  it('rejects a noncontiguous owner order even when metadata repeats the same bad value', () => {
    const snapshot = selectedSnapshot()
    const invalidSnapshot: CheckRunSnapshot = {
      ...snapshot,
      changes: snapshot.changes.map((change) => ({
        ...change,
        insight: {
          ...change.insight!,
          owner: { ...change.insight!.owner, order: 1 },
        },
      })),
    }
    const invalidMetadata = {
      ...metadata(),
      ownerGroup: { ...metadata().ownerGroup, order: 1 },
    }
    expect(() => createVisualPlusSectionInput(input(invalidSnapshot, invalidMetadata))).toThrow(
      /owner group order is not contiguous/u,
    )
  })

  it('rejects a contiguous but noncanonical owner order', () => {
    const base = selectedSnapshot()
    const makeChange = (id: string, name: string, sourcePath: string, order: number) => ({
      ...base.changes[0]!,
      id,
      name,
      owner: sourcePath,
      insight: {
        ...base.changes[0]!.insight!,
        dependencyId: createRepositoryId('dependency', name),
        rawName: name,
        sourceFileId: createRepositoryId('source', sourcePath),
        sourcePath,
        occurrencePath: ['dependencies', name],
        owner: {
          id: createRepositoryId('package', sourcePath),
          role: 'manifest' as const,
          label: name,
          path: sourcePath,
          order,
          physicalTarget: sourcePath,
        },
      },
    })
    const first = makeChange('operation-a', 'alpha', 'a/package.json', 1)
    const second = makeChange('operation-z', 'zeta', 'z/package.json', 0)
    const snapshot: CheckRunSnapshot = {
      ...base,
      counts: { ...base.counts, operations: 2, targets: 2, updates: 2 },
      changes: [first, second],
      targets: [
        { path: first.owner, operationIds: [first.id] },
        { path: second.owner, operationIds: [second.id] },
      ],
    }
    const metadataFor = (change: typeof first): VisualPlusChangeMetadata => ({
      operationId: change.id,
      source: 'dependencies',
      displayOrder: change.id === first.id ? 0 : 1,
      ownerGroup: {
        id: change.insight.owner.id,
        label: change.insight.owner.label,
        order: change.insight.owner.order,
        physicalTarget: change.insight.owner.physicalTarget,
      },
      ageMs: change.insight.ageMs,
      compatibility: change.insight.compatibility,
    })
    expect(() =>
      createVisualPlusSectionInput({
        ...input(base),
        snapshot,
        changes: [metadataFor(first), metadataFor(second)],
      }),
    ).toThrow(/owner group order is not canonical/u)
  })

  it('rejects a wrong safe catalog label even when metadata repeats it exactly', () => {
    const base = selectedSnapshot()
    const catalogName = 'default'
    const catalogId = createRepositoryId('catalog', `package.json\0bun\0${catalogName}`)
    const owner = {
      id: catalogId,
      role: 'catalog' as const,
      label: 'wrong-safe-label',
      path: 'package.json',
      order: 0,
      physicalTarget: 'package.json',
    }
    const snapshot: CheckRunSnapshot = {
      ...base,
      changes: base.changes.map((change) => ({
        ...change,
        insight: {
          ...change.insight!,
          owner,
          catalog: {
            role: 'owner' as const,
            id: catalogId,
            manager: 'bun' as const,
            name: catalogName,
            sourceFileId: createRepositoryId('source', 'package.json'),
            sourcePath: 'package.json',
          },
        },
      })),
    }
    expect(() =>
      createVisualPlusSectionInput({
        ...input(base),
        snapshot,
        changes: [
          {
            ...metadata(),
            ownerGroup: {
              id: owner.id,
              label: owner.label,
              order: owner.order,
              physicalTarget: owner.physicalTarget,
            },
            catalog: { name: catalogName, sourcePath: 'package.json' },
          },
        ],
      }),
    ).toThrow(/catalog owner label/u)
  })

  it('rejects an empty sanitized dependency display through the shared relationship contract', () => {
    const base = selectedSnapshot()
    const rawName = '\u001B[31m'
    const snapshot: CheckRunSnapshot = {
      ...base,
      changes: base.changes.map((change) => ({
        ...change,
        name: '',
        insight: {
          ...change.insight!,
          dependencyId: createRepositoryId('dependency', rawName),
          rawName,
        },
      })),
    }

    expect(() => createVisualPlusSectionInput({ ...input(base), snapshot })).toThrow(
      /dependency display is empty/u,
    )
  })
})
