import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, type depfreshOptions } from '../../../types'
import type { LegacySelectionEvidenceOperation } from '../../apply/legacy-plan'
import { createVisualPlusSelectionProjection, isVisualPlusEligible } from './integration'

type MutableEvidenceOperation = {
  -readonly [Key in keyof LegacySelectionEvidenceOperation]: LegacySelectionEvidenceOperation[Key]
}

interface MutableEvidence {
  operations: MutableEvidenceOperation[]
  targets: Array<{ path: string; operationIds: string[] }>
}

function evidence(): MutableEvidence {
  return {
    operations: [
      {
        operationId: 'operation-shared',
        packageIndex: 1,
        changeIndex: 0,
        ownerLabel: 'workspace a',
        physicalTarget: 'package.json',
        occurrencePath: ['workspaces', 'catalog', 'shared'],
        name: '\u001B[31mshared',
        current: '1.0.0',
        target: '2.0.0',
        diff: 'major',
        publishedAt: '2025-01-01T00:00:00.000Z',
        nodeCompatible: false,
        nodeCompat: '\u001B[31m<24',
        catalog: { name: 'default', sourcePath: 'package.json' },
      },
      {
        operationId: 'operation-future',
        packageIndex: 2,
        changeIndex: 3,
        ownerLabel: 'workspace b',
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
        ownerLabel: 'workspace b',
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
        ownerLabel: 'workspace b',
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
  it('projects one immutable selection model with fixed-clock metadata and exact targets', () => {
    const source = evidence()
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const result = createVisualPlusSelectionProjection(source, now)

    expect(result.changes).toEqual([
      {
        id: 'operation-shared',
        name: 'shared',
        owner: 'package.json',
        current: '1.0.0',
        target: '2.0.0',
        diff: 'major',
        ageMs: 365 * 24 * 60 * 60 * 1000,
      },
      {
        id: 'operation-future',
        name: 'future',
        owner: 'packages/b/package.json',
        current: '1.0.0',
        target: '1.1.0',
        diff: 'minor',
      },
      {
        id: 'operation-unknown',
        name: 'unknown',
        owner: 'packages/b/package.json',
        current: '1.0.0',
        target: '1.0.1',
        diff: 'patch',
      },
      {
        id: 'operation-loose-date',
        name: 'loose-date',
        owner: 'packages/b/package.json',
        current: '1.0.0',
        target: '1.0.1',
        diff: 'patch',
      },
    ])
    expect(result.targets).toEqual(source.targets)
    expect(result.metadata).toEqual([
      {
        operationId: 'operation-shared',
        ownerGroup: {
          id: 'package:1',
          order: 1,
          label: 'workspace a',
          physicalTarget: 'package.json',
        },
        ageMs: 365 * 24 * 60 * 60 * 1000,
        compatibility: { status: 'incompatible', detail: '<24' },
        catalog: { name: 'default', sourcePath: 'package.json' },
      },
      {
        operationId: 'operation-future',
        ownerGroup: {
          id: 'package:2',
          order: 2,
          label: 'workspace b',
          physicalTarget: 'packages/b/package.json',
        },
        ageMs: null,
        compatibility: { status: 'compatible' },
      },
      {
        operationId: 'operation-unknown',
        ownerGroup: {
          id: 'package:2',
          order: 2,
          label: 'workspace b',
          physicalTarget: 'packages/b/package.json',
        },
        ageMs: null,
        compatibility: { status: 'unknown' },
      },
      {
        operationId: 'operation-loose-date',
        ownerGroup: {
          id: 'package:2',
          order: 2,
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
    expect(result.changes).not.toBe(source.operations)
    expect(result.targets).not.toBe(source.targets)
  })

  it('rejects an invalid fixed wall clock', () => {
    expect(() => createVisualPlusSelectionProjection(evidence(), Number.NaN)).toThrow(
      /finite nonnegative integer/u,
    )
    expect(() => createVisualPlusSelectionProjection(evidence(), -1)).toThrow(
      /finite nonnegative integer/u,
    )
  })

  it('accepts strict ISO timestamps without milliseconds and with timezone offsets', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const withoutMilliseconds = evidence()
    withoutMilliseconds.operations[0]!.publishedAt = '2025-01-01T00:00:00Z'
    const withOffset = evidence()
    withOffset.operations[0]!.publishedAt = '2025-01-01T01:00:00+01:00'

    expect(createVisualPlusSelectionProjection(withoutMilliseconds, now).metadata[0]?.ageMs).toBe(
      365 * 24 * 60 * 60 * 1000,
    )
    expect(createVisualPlusSelectionProjection(withOffset, now).metadata[0]?.ageMs).toBe(
      365 * 24 * 60 * 60 * 1000,
    )
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
    )
    expect(result.metadata[0]?.ageMs).toBeNull()
    expect(result.changes[0]).not.toHaveProperty('ageMs')
  })

  it.each(['', '\u001B[31moperation-hostile'])('rejects unsafe operation ID %j', (operationId) => {
    const source = evidence()
    source.operations[0]!.operationId = operationId
    source.targets[0]!.operationIds[0] = operationId

    expect(() =>
      createVisualPlusSelectionProjection(source, Date.parse('2026-01-01T00:00:00.000Z')),
    ).toThrow(/operation ID is unsafe/u)
  })

  it('fails closed on contradictory target inventories', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const duplicateOperation = evidence()
    duplicateOperation.operations[1]!.operationId = duplicateOperation.operations[0]!.operationId
    expect(() => createVisualPlusSelectionProjection(duplicateOperation, now)).toThrow(
      /operation IDs must be unique/u,
    )

    const duplicateTarget = evidence()
    duplicateTarget.targets.push({
      path: duplicateTarget.targets[0]!.path,
      operationIds: ['operation-extra'],
    })
    expect(() => createVisualPlusSelectionProjection(duplicateTarget, now)).toThrow(
      /target inventory is inconsistent/u,
    )

    const emptyTarget = evidence()
    emptyTarget.targets[0]!.operationIds = []
    expect(() => createVisualPlusSelectionProjection(emptyTarget, now)).toThrow(
      /target inventory is inconsistent/u,
    )

    const incomplete = evidence()
    incomplete.targets[1]!.operationIds.pop()
    expect(() => createVisualPlusSelectionProjection(incomplete, now)).toThrow(
      /target membership is incomplete/u,
    )

    const physicalMismatch = evidence()
    physicalMismatch.operations[0]!.physicalTarget = 'other/package.json'
    expect(() => createVisualPlusSelectionProjection(physicalMismatch, now)).toThrow(
      /operation physical target is inconsistent/u,
    )

    const catalogMismatch = evidence()
    catalogMismatch.operations[0]!.catalog = {
      name: 'default',
      sourcePath: 'other/package.json',
    }
    expect(() => createVisualPlusSelectionProjection(catalogMismatch, now)).toThrow(
      /catalog physical target is inconsistent/u,
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
