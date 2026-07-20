import { describe, expect, it } from 'vitest'
import { createRepositoryId } from '../../../repository/identity'
import { DEFAULT_OPTIONS, type depfreshOptions } from '../../../types'
import type { LegacySelectionEvidenceOperation } from '../../apply/legacy-plan'
import { createCheckRunState, reduceCheckRun } from '../run-model'
import { createVisualPlusSelectionProjection, isVisualPlusEligible } from './integration'

const display = {
  group: false,
  sort: 'diff-asc' as const,
  timediff: false,
  nodecompat: false,
}

type MutableEvidenceOperation = {
  -readonly [Key in keyof LegacySelectionEvidenceOperation]: LegacySelectionEvidenceOperation[Key]
}

interface MutableEvidence {
  operations: Array<
    MutableEvidenceOperation & {
      dependencyId: string
      rawName: string
      sourceFileId: string
      sourcePath: string
      owner: {
        id: string
        role: 'manifest' | 'catalog'
        label: string
        path: string
        physicalTarget: string
      }
      catalog:
        | { role: 'direct' }
        | {
            role: 'owner'
            id: string
            manager: 'pnpm' | 'bun' | 'yarn'
            name: string
            sourceFileId: string
            sourcePath: string
          }
    }
  >
  targets: Array<{ path: string; operationIds: string[] }>
}

function evidence(): MutableEvidence {
  const catalogSourceId = createRepositoryId('source', 'package.json')
  const catalogId = createRepositoryId('catalog', 'package.json\0bun\0default')
  const manifestSourceId = createRepositoryId('source', 'packages/b/package.json')
  const manifestOwnerId = createRepositoryId('package', 'packages/b/package.json')
  return {
    operations: [
      {
        operationId: 'operation-shared',
        packageIndex: 1,
        changeIndex: 0,
        dependencyId: createRepositoryId('dependency', '\u001B[31mshared'),
        rawName: '\u001B[31mshared',
        source: 'catalog',
        sourceFileId: catalogSourceId,
        sourcePath: 'package.json',
        owner: {
          id: catalogId,
          role: 'catalog',
          label: 'default',
          path: 'package.json',
          physicalTarget: 'package.json',
        },
        physicalTarget: 'package.json',
        occurrencePath: ['workspaces', 'catalog', 'shared'],
        name: '\u001B[31mshared',
        current: '1.0.0',
        target: '2.0.0',
        diff: 'major',
        publishedAt: '2025-01-01T00:00:00.000Z',
        nodeCompatible: false,
        nodeCompat: '\u001B[31m<24',
        catalog: {
          role: 'owner',
          id: catalogId,
          manager: 'bun',
          name: 'default',
          sourceFileId: catalogSourceId,
          sourcePath: 'package.json',
        },
      },
      {
        operationId: 'operation-future',
        packageIndex: 2,
        changeIndex: 3,
        dependencyId: createRepositoryId('dependency', 'future'),
        rawName: 'future',
        source: 'dependencies',
        sourceFileId: manifestSourceId,
        sourcePath: 'packages/b/package.json',
        owner: {
          id: manifestOwnerId,
          role: 'manifest',
          label: 'workspace b',
          path: 'packages/b/package.json',
          physicalTarget: 'packages/b/package.json',
        },
        catalog: { role: 'direct' },
        physicalTarget: 'packages/b/package.json',
        occurrencePath: ['dependencies', 'future'],
        name: 'future',
        current: '1.0.0',
        target: '1.1.0',
        diff: 'minor',
        publishedAt: '2027-01-01T00:00:00.000Z',
        nodeCompatible: true,
      },
      {
        operationId: 'operation-unknown',
        packageIndex: 2,
        changeIndex: 4,
        dependencyId: createRepositoryId('dependency', 'unknown'),
        rawName: 'unknown',
        source: 'devDependencies',
        sourceFileId: manifestSourceId,
        sourcePath: 'packages/b/package.json',
        owner: {
          id: manifestOwnerId,
          role: 'manifest',
          label: 'workspace b',
          path: 'packages/b/package.json',
          physicalTarget: 'packages/b/package.json',
        },
        catalog: { role: 'direct' },
        physicalTarget: 'packages/b/package.json',
        occurrencePath: ['devDependencies', 'unknown'],
        name: 'unknown',
        current: '1.0.0',
        target: '1.0.1',
        diff: 'patch',
        publishedAt: 'not-a-date',
      },
      {
        operationId: 'operation-loose-date',
        packageIndex: 2,
        changeIndex: 5,
        dependencyId: createRepositoryId('dependency', 'loose-date'),
        rawName: 'loose-date',
        source: 'devDependencies',
        sourceFileId: manifestSourceId,
        sourcePath: 'packages/b/package.json',
        owner: {
          id: manifestOwnerId,
          role: 'manifest',
          label: 'workspace b',
          path: 'packages/b/package.json',
          physicalTarget: 'packages/b/package.json',
        },
        catalog: { role: 'direct' },
        physicalTarget: 'packages/b/package.json',
        occurrencePath: ['devDependencies', 'loose-date'],
        name: 'loose-date',
        current: '1.0.0',
        target: '1.0.1',
        diff: 'patch',
        publishedAt: '0',
      },
    ],
    targets: [
      { path: 'package.json', operationIds: ['operation-shared'] },
      {
        path: 'packages/b/package.json',
        operationIds: ['operation-future', 'operation-unknown', 'operation-loose-date'],
      },
    ],
  }
}

describe('Visual+ integration projection', () => {
  it('projects source and deterministic display order without mutating evidence', () => {
    const source = evidence()
    const before = structuredClone(source)
    const result = createVisualPlusSelectionProjection(source, Date.parse('2026-01-01T00:00:00Z'), {
      ...display,
      sort: 'name-asc',
    })

    expect(result.metadata.map((metadata) => [metadata.source, metadata.displayOrder])).toEqual([
      ['catalog', 0],
      ['dependencies', 1],
      ['devDependencies', 3],
      ['devDependencies', 2],
    ])
    expect(source).toEqual(before)
  })

  it('projects one immutable selection model with fixed-clock metadata and exact targets', () => {
    const source = evidence()
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const result = createVisualPlusSelectionProjection(source, now, display)
    const catalogSourceId = createRepositoryId('source', 'package.json')
    const catalogId = createRepositoryId('catalog', 'package.json\0bun\0default')
    const manifestSourceId = createRepositoryId('source', 'packages/b/package.json')
    const manifestOwnerId = createRepositoryId('package', 'packages/b/package.json')

    expect(result.changes).toEqual([
      {
        id: 'operation-shared',
        name: 'shared',
        owner: 'package.json',
        current: '1.0.0',
        target: '2.0.0',
        diff: 'major',
        ageMs: 365 * 24 * 60 * 60 * 1000,
        insight: {
          dependencyId: createRepositoryId('dependency', '\u001B[31mshared'),
          rawName: '\u001B[31mshared',
          sourceFileId: catalogSourceId,
          sourcePath: 'package.json',
          occurrencePath: ['workspaces', 'catalog', 'shared'],
          owner: {
            id: catalogId,
            role: 'catalog',
            label: 'default',
            path: 'package.json',
            order: 0,
            physicalTarget: 'package.json',
          },
          catalog: {
            role: 'owner',
            id: catalogId,
            manager: 'bun',
            name: 'default',
            sourceFileId: catalogSourceId,
            sourcePath: 'package.json',
          },
          ageMs: 365 * 24 * 60 * 60 * 1000,
          compatibility: { status: 'incompatible', detail: '<24' },
        },
      },
      {
        id: 'operation-future',
        name: 'future',
        owner: 'packages/b/package.json',
        current: '1.0.0',
        target: '1.1.0',
        diff: 'minor',
        insight: {
          dependencyId: createRepositoryId('dependency', 'future'),
          rawName: 'future',
          sourceFileId: manifestSourceId,
          sourcePath: 'packages/b/package.json',
          occurrencePath: ['dependencies', 'future'],
          owner: {
            id: manifestOwnerId,
            role: 'manifest',
            label: 'workspace b',
            path: 'packages/b/package.json',
            order: 1,
            physicalTarget: 'packages/b/package.json',
          },
          catalog: { role: 'direct' },
          ageMs: null,
          compatibility: { status: 'compatible' },
        },
      },
      {
        id: 'operation-unknown',
        name: 'unknown',
        owner: 'packages/b/package.json',
        current: '1.0.0',
        target: '1.0.1',
        diff: 'patch',
        insight: {
          dependencyId: createRepositoryId('dependency', 'unknown'),
          rawName: 'unknown',
          sourceFileId: manifestSourceId,
          sourcePath: 'packages/b/package.json',
          occurrencePath: ['devDependencies', 'unknown'],
          owner: {
            id: manifestOwnerId,
            role: 'manifest',
            label: 'workspace b',
            path: 'packages/b/package.json',
            order: 1,
            physicalTarget: 'packages/b/package.json',
          },
          catalog: { role: 'direct' },
          ageMs: null,
          compatibility: { status: 'unknown' },
        },
      },
      {
        id: 'operation-loose-date',
        name: 'loose-date',
        owner: 'packages/b/package.json',
        current: '1.0.0',
        target: '1.0.1',
        diff: 'patch',
        insight: {
          dependencyId: createRepositoryId('dependency', 'loose-date'),
          rawName: 'loose-date',
          sourceFileId: manifestSourceId,
          sourcePath: 'packages/b/package.json',
          occurrencePath: ['devDependencies', 'loose-date'],
          owner: {
            id: manifestOwnerId,
            role: 'manifest',
            label: 'workspace b',
            path: 'packages/b/package.json',
            order: 1,
            physicalTarget: 'packages/b/package.json',
          },
          catalog: { role: 'direct' },
          ageMs: null,
          compatibility: { status: 'unknown' },
        },
      },
    ])
    expect(result.targets).toEqual(source.targets)
    expect(result.metadata).toEqual([
      {
        operationId: 'operation-shared',
        source: 'catalog',
        displayOrder: 0,
        ownerGroup: {
          id: catalogId,
          order: 0,
          label: 'default',
          physicalTarget: 'package.json',
        },
        ageMs: 365 * 24 * 60 * 60 * 1000,
        compatibility: { status: 'incompatible', detail: '<24' },
        catalog: { name: 'default', sourcePath: 'package.json' },
      },
      {
        operationId: 'operation-future',
        source: 'dependencies',
        displayOrder: 1,
        ownerGroup: {
          id: manifestOwnerId,
          order: 1,
          label: 'workspace b',
          physicalTarget: 'packages/b/package.json',
        },
        ageMs: null,
        compatibility: { status: 'compatible' },
      },
      {
        operationId: 'operation-unknown',
        source: 'devDependencies',
        displayOrder: 2,
        ownerGroup: {
          id: manifestOwnerId,
          order: 1,
          label: 'workspace b',
          physicalTarget: 'packages/b/package.json',
        },
        ageMs: null,
        compatibility: { status: 'unknown' },
      },
      {
        operationId: 'operation-loose-date',
        source: 'devDependencies',
        displayOrder: 3,
        ownerGroup: {
          id: manifestOwnerId,
          order: 1,
          label: 'workspace b',
          physicalTarget: 'packages/b/package.json',
        },
        ageMs: null,
        compatibility: { status: 'unknown' },
      },
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.changes)).toBe(true)
    expect(Object.isFrozen(result.targets[1]?.operationIds)).toBe(true)
    expect(Object.isFrozen(result.metadata[0]?.ownerGroup)).toBe(true)
    expect(Object.isFrozen(result.changes[0]?.insight?.owner)).toBe(true)
    expect(Object.isFrozen(result.changes[0]?.insight?.occurrencePath)).toBe(true)
    expect(result.changes).not.toBe(source.operations)
    expect(result.targets).not.toBe(source.targets)
  })

  it('rejects an invalid fixed wall clock', () => {
    expect(() => createVisualPlusSelectionProjection(evidence(), Number.NaN, display)).toThrow(
      /finite nonnegative integer/u,
    )
    expect(() => createVisualPlusSelectionProjection(evidence(), -1, display)).toThrow(
      /finite nonnegative integer/u,
    )
  })

  it('accepts strict ISO timestamps without milliseconds and with timezone offsets', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const withoutMilliseconds = evidence()
    withoutMilliseconds.operations[0]!.publishedAt = '2025-01-01T00:00:00Z'
    const withOffset = evidence()
    withOffset.operations[0]!.publishedAt = '2025-01-01T01:00:00+01:00'

    expect(
      createVisualPlusSelectionProjection(withoutMilliseconds, now, display).metadata[0]?.ageMs,
    ).toBe(365 * 24 * 60 * 60 * 1000)
    expect(createVisualPlusSelectionProjection(withOffset, now, display).metadata[0]?.ageMs).toBe(
      365 * 24 * 60 * 60 * 1000,
    )
  })

  it('omits a node compatibility detail that sanitizes to empty and remains reducer-valid', () => {
    const source = evidence()
    source.operations[0]!.nodeCompat = '\u001B[31m'
    const projection = createVisualPlusSelectionProjection(
      source,
      Date.parse('2026-01-01T00:00:00.000Z'),
      display,
    )
    expect(projection.changes[0]?.insight?.compatibility).toEqual({
      status: 'incompatible',
    })

    let state = createCheckRunState({ mode: 'major', write: false })
    state = reduceCheckRun(state, {
      type: 'packages-discovered',
      packages: 2,
      declared: projection.changes.length,
    })
    state = reduceCheckRun(state, {
      type: 'resolution-completed',
      eligible: projection.changes.length,
      unresolved: 0,
      updates: projection.changes.length,
    })
    expect(() =>
      reduceCheckRun(state, {
        type: 'selection-completed',
        operations: projection.changes.length,
        targets: projection.targets.length,
        changes: projection.changes,
        selectedTargets: projection.targets,
      }),
    ).not.toThrow()
  })

  it.each([
    '0',
    'not-a-date',
    '2025-13-01T00:00:00Z',
    '2025-02-30T00:00:00Z',
    '2025-01-01T25:00:00Z',
    '2027-01-01T00:00:00Z',
  ])('projects malformed, loose, or future timestamp %s as unknown age', (publishedAt) => {
    const source = evidence()
    source.operations[0]!.publishedAt = publishedAt
    const result = createVisualPlusSelectionProjection(
      source,
      Date.parse('2026-01-01T00:00:00.000Z'),
      display,
    )
    expect(result.metadata[0]?.ageMs).toBeNull()
    expect(result.changes[0]).not.toHaveProperty('ageMs')
  })

  it.each(['', '\u001B[31moperation-hostile'])('rejects unsafe operation ID %j', (operationId) => {
    const source = evidence()
    source.operations[0]!.operationId = operationId
    source.targets[0]!.operationIds[0] = operationId

    expect(() =>
      createVisualPlusSelectionProjection(source, Date.parse('2026-01-01T00:00:00.000Z'), display),
    ).toThrow(/operation ID is unsafe/u)
  })

  it('fails closed on contradictory target inventories', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const duplicateOperation = evidence()
    duplicateOperation.operations[1]!.operationId = duplicateOperation.operations[0]!.operationId
    expect(() => createVisualPlusSelectionProjection(duplicateOperation, now, display)).toThrow(
      /operation IDs must be unique/u,
    )

    const duplicateTarget = evidence()
    duplicateTarget.targets.push({
      path: duplicateTarget.targets[0]!.path,
      operationIds: ['operation-extra'],
    })
    expect(() => createVisualPlusSelectionProjection(duplicateTarget, now, display)).toThrow(
      /target inventory is inconsistent/u,
    )

    const emptyTarget = evidence()
    emptyTarget.targets[0]!.operationIds = []
    expect(() => createVisualPlusSelectionProjection(emptyTarget, now, display)).toThrow(
      /target inventory is inconsistent/u,
    )

    const incomplete = evidence()
    incomplete.targets[1]!.operationIds.pop()
    expect(() => createVisualPlusSelectionProjection(incomplete, now, display)).toThrow(
      /target membership is incomplete/u,
    )

    const physicalMismatch = evidence()
    physicalMismatch.operations[0]!.physicalTarget = 'other/package.json'
    expect(() => createVisualPlusSelectionProjection(physicalMismatch, now, display)).toThrow(
      /operation physical target is inconsistent/u,
    )

    const catalogMismatch = evidence()
    const catalog = catalogMismatch.operations[0]!.catalog
    if (catalog.role !== 'owner') throw new Error('Expected catalog owner evidence')
    catalogMismatch.operations[0]!.catalog = {
      ...catalog,
      sourcePath: 'other/package.json',
    }
    expect(() => createVisualPlusSelectionProjection(catalogMismatch, now, display)).toThrow(
      /catalog owner evidence is inconsistent/u,
    )
  })

  it('assigns physical owner order independently from selection and consumer order', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const first = createVisualPlusSelectionProjection(evidence(), now, display)
    const permuted = evidence()
    permuted.operations.reverse()
    permuted.targets.reverse()
    for (const target of permuted.targets) target.operationIds.reverse()
    const second = createVisualPlusSelectionProjection(permuted, now, display)

    const ownerOrders = (projection: typeof first) =>
      Object.fromEntries(
        projection.changes.map((change) => [change.id, change.insight?.owner.order]),
      )
    expect(ownerOrders(second)).toEqual(ownerOrders(first))
    expect(new Set(first.changes.map((change) => change.insight?.owner.order))).toEqual(
      new Set([0, 1]),
    )
  })

  it.each([
    {
      name: 'manifest owner role',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.owner.role = 'catalog'
      },
    },
    {
      name: 'manifest owner path',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.owner.path = 'other/package.json'
      },
    },
    {
      name: 'manifest owner ID',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.owner.id = 'package:wrong'
      },
    },
    {
      name: 'owner physical target',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.owner.physicalTarget = 'other/package.json'
      },
    },
    {
      name: 'catalog owner role',
      mutate: (source: MutableEvidence) => {
        source.operations[0]!.owner.role = 'manifest'
      },
    },
    {
      name: 'catalog owner ID',
      mutate: (source: MutableEvidence) => {
        source.operations[0]!.owner.id = 'catalog:wrong'
      },
    },
    {
      name: 'catalog evidence ID formula',
      mutate: (source: MutableEvidence) => {
        const catalog = source.operations[0]!.catalog
        if (catalog.role !== 'owner') throw new Error('Expected catalog owner evidence')
        catalog.id = 'catalog:wrong'
      },
    },
    {
      name: 'catalog manager ID formula',
      mutate: (source: MutableEvidence) => {
        const catalog = source.operations[0]!.catalog
        if (catalog.role !== 'owner') throw new Error('Expected catalog owner evidence')
        catalog.manager = 'pnpm'
      },
    },
    {
      name: 'catalog source file ID',
      mutate: (source: MutableEvidence) => {
        const catalog = source.operations[0]!.catalog
        if (catalog.role !== 'owner') throw new Error('Expected catalog owner evidence')
        catalog.sourceFileId = 'source:wrong'
      },
    },
    {
      name: 'catalog source path',
      mutate: (source: MutableEvidence) => {
        const catalog = source.operations[0]!.catalog
        if (catalog.role !== 'owner') throw new Error('Expected catalog owner evidence')
        catalog.sourcePath = 'other/package.json'
      },
    },
    {
      name: 'catalog owner path',
      mutate: (source: MutableEvidence) => {
        source.operations[0]!.owner.path = 'other/package.json'
      },
    },
    {
      name: 'source path differs from physical target',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.sourcePath = 'other/package.json'
      },
    },
    {
      name: 'source reverse mapping',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.sourcePath = source.operations[0]!.sourcePath
      },
    },
    {
      name: 'dependency reverse mapping',
      mutate: (source: MutableEvidence) => {
        source.operations[2]!.rawName = source.operations[1]!.rawName
        source.operations[2]!.name = source.operations[1]!.name
      },
    },
    {
      name: 'dependency ID formula',
      mutate: (source: MutableEvidence) => {
        source.operations[0]!.dependencyId = 'dependency:wrong'
      },
    },
    {
      name: 'source ID formula',
      mutate: (source: MutableEvidence) => {
        source.operations[0]!.sourceFileId = 'source:wrong'
      },
    },
    {
      name: 'unsafe source path',
      mutate: (source: MutableEvidence) => {
        source.operations[0]!.sourcePath = '../package.json'
      },
    },
    {
      name: 'empty sanitized dependency display',
      mutate: (source: MutableEvidence) => {
        const rawName = '\u001B[31m'
        source.operations[0]!.rawName = rawName
        source.operations[0]!.name = rawName
        source.operations[0]!.dependencyId = createRepositoryId('dependency', rawName)
      },
    },
    {
      name: 'contradictory owner reference',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.owner = { ...source.operations[1]!.owner, label: 'other' }
      },
    },
    {
      name: 'duplicate physical occurrence',
      mutate: (source: MutableEvidence) => {
        source.operations[1]!.sourceFileId = source.operations[2]!.sourceFileId
        source.operations[1]!.sourcePath = source.operations[2]!.sourcePath
        source.operations[1]!.physicalTarget = source.operations[2]!.physicalTarget
        source.operations[1]!.owner = { ...source.operations[2]!.owner }
        source.operations[1]!.occurrencePath = [...source.operations[2]!.occurrencePath]
        source.operations[1]!.catalog = { role: 'direct' }
      },
    },
  ])('fails closed on $name', ({ mutate }) => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const source = evidence()
    mutate(source)
    expect(() => createVisualPlusSelectionProjection(source, now, display)).toThrow(
      /Visual\+ integration/u,
    )
  })
})

describe('isVisualPlusEligible', () => {
  const options: depfreshOptions = {
    ...(DEFAULT_OPTIONS as depfreshOptions),
    cwd: '/tmp/test',
    output: 'table',
    loglevel: 'info',
    interactive: false,
    global: false,
    globalAll: false,
  }

  it.each(['info', 'debug'] as const)('accepts local noninteractive CLI table %s', (loglevel) => {
    expect(isVisualPlusEligible({ ...options, loglevel }, true)).toBe(true)
  })

  it.each([
    ['library', options, false],
    ['json', { ...options, output: 'json' as const }, true],
    ['silent', { ...options, loglevel: 'silent' as const }, true],
    ['interactive', { ...options, interactive: true }, true],
    ['global', { ...options, global: true }, true],
    ['global all', { ...options, globalAll: true }, true],
    ['direct veto hook', { ...options, beforePackageWrite: () => false }, true],
    [
      'addon veto hook',
      { ...options, addons: [{ name: 'veto', beforePackageWrite: () => false }] },
      true,
    ],
  ])('rejects %s route', (_name, candidate, renderProgress) => {
    expect(isVisualPlusEligible(candidate as depfreshOptions, renderProgress)).toBe(false)
  })
})
