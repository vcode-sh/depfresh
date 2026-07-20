import { describe, expect, it } from 'vitest'
import type { SortOption } from '../../../../types'
import { stripAnsi, visualLength } from '../../../../utils/format'
import type { VisualPlusCapabilities } from '../capabilities'
import type { VisualPlusSectionInput } from '../input'
import { createVisualPlusFixtureInput, createVisualPlusHybridFixtureInput } from '../test-fixture'
import { createVisualPlusLedgerRows, renderVisualPlusLedger } from './ledger'

function capabilities(
  width: number,
  overrides: Partial<VisualPlusCapabilities> = {},
): VisualPlusCapabilities {
  return {
    interactive: true,
    color: true,
    unicode: true,
    motion: false,
    cursorControl: false,
    width,
    layout: width >= 100 ? 'wide' : width >= 60 ? 'medium' : 'narrow',
    ...overrides,
  }
}

function ownerNames(input: VisualPlusSectionInput): readonly (readonly string[])[] {
  const rows = createVisualPlusLedgerRows(input)
  return [...new Set(rows.map((row) => row.owner.id))].map((ownerId) =>
    rows.filter((row) => row.owner.id === ownerId).map((row) => row.name),
  )
}

function internalIdentifiers(input: VisualPlusSectionInput): ReadonlySet<string> {
  const identifiers = new Set<string>()
  for (const change of input.snapshot.changes) {
    identifiers.add(change.id)
    const insight = change.insight!
    identifiers.add(insight.dependencyId)
    identifiers.add(insight.sourceFileId)
    identifiers.add(insight.owner.id)
    if ('id' in insight.catalog) identifiers.add(insight.catalog.id)
  }
  return identifiers
}

describe('Visual+ hybrid ledger row model', () => {
  it('joins every selected change exactly once and sorts by physical owner then display order', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80))
    const rows = createVisualPlusLedgerRows(input)

    expect(rows).toHaveLength(7)
    expect(new Set(rows.map((row) => row.operationId))).toEqual(
      new Set(input.snapshot.changes.map((change) => change.id)),
    )
    expect(rows.map((row) => [row.owner.label, row.owner.physicalTarget, row.name])).toEqual([
      ['web', 'apps/web/package.json', 'react-dropzone'],
      ['web', 'apps/web/package.json', 'vitest'],
      ['web', 'apps/web/package.json', 'typescript'],
      ['web', 'packages/web/package.json', 'react-dropzone'],
      ['web', 'packages/web/package.json', 'nanoid'],
      ['web', 'packages/web/package.json', 'picocolors'],
      ['default', 'pnpm-workspace.yaml', 'eslint'],
    ])
    expect(rows[6]?.catalog).toEqual({ name: 'default', sourcePath: 'pnpm-workspace.yaml' })
  })

  it.each([
    [
      'diff-asc',
      [
        ['react-dropzone', 'vitest', 'typescript'],
        ['react-dropzone', 'nanoid', 'picocolors'],
        ['eslint'],
      ],
    ],
    [
      'diff-desc',
      [
        ['typescript', 'react-dropzone', 'vitest'],
        ['picocolors', 'nanoid', 'react-dropzone'],
        ['eslint'],
      ],
    ],
    [
      'time-asc',
      [
        ['vitest', 'typescript', 'react-dropzone'],
        ['picocolors', 'react-dropzone', 'nanoid'],
        ['eslint'],
      ],
    ],
    [
      'time-desc',
      [
        ['react-dropzone', 'typescript', 'vitest'],
        ['nanoid', 'react-dropzone', 'picocolors'],
        ['eslint'],
      ],
    ],
    [
      'name-asc',
      [
        ['react-dropzone', 'typescript', 'vitest'],
        ['nanoid', 'picocolors', 'react-dropzone'],
        ['eslint'],
      ],
    ],
    [
      'name-desc',
      [
        ['vitest', 'typescript', 'react-dropzone'],
        ['react-dropzone', 'picocolors', 'nanoid'],
        ['eslint'],
      ],
    ],
  ] as const)('honors the authoritative %s display order inside each owner', (sort, expected) => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80), {
      sort: sort as SortOption,
    })

    expect(ownerNames(input)).toEqual(expected)
    expect(new Set(createVisualPlusLedgerRows(input).map((row) => row.operationId)).size).toBe(7)
  })

  it('fails closed when snapshot and metadata membership are missing or duplicated', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80))
    expect(() =>
      createVisualPlusLedgerRows({ ...input, changes: input.changes.slice(1) }),
    ).toThrow()
    expect(() =>
      createVisualPlusLedgerRows({
        ...input,
        changes: [input.changes[0]!, ...input.changes.slice(0, -1)],
      }),
    ).toThrow()
    expect(() =>
      renderVisualPlusLedger(input, createVisualPlusLedgerRows(input).slice(1)),
    ).toThrow()
  })

  it('keeps source flat when grouping is disabled', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80), { group: false })
    const output = renderVisualPlusLedger(input, createVisualPlusLedgerRows(input))
      .map(stripAnsi)
      .join('\n')

    expect(output).toContain('source')
    expect(output).toContain('devDependencies')
    expect(output).not.toMatch(/^ {2}dependencies$/mu)
  })

  it('removes every age field when timediff is disabled', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80), { timediff: false })
    const output = renderVisualPlusLedger(input, createVisualPlusLedgerRows(input))
      .map(stripAnsi)
      .join('\n')

    expect(output).not.toMatch(/\bage\b|~(?:\d|\.)/iu)
    expect(output).toContain('compat unknown')
  })

  it('removes compatibility detail when nodecompat is disabled', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80), { nodecompat: false })
    const output = renderVisualPlusLedger(input, createVisualPlusLedgerRows(input))
      .map(stripAnsi)
      .join('\n')

    expect(output).not.toMatch(/compat|compatible|incompatible|Node support|requires Node/iu)
    expect(output).toContain('catalog default: pnpm-workspace.yaml')
  })

  it('does not mutate its validated inputs or row projection', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80))
    const rows = createVisualPlusLedgerRows(input)
    const before = JSON.stringify({ input, rows })

    renderVisualPlusLedger(input, rows)

    expect(JSON.stringify({ input, rows })).toBe(before)
  })

  it('keeps every physical line bounded at the minimum validated width', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(1), { group: false })
    const lines = renderVisualPlusLedger(input, createVisualPlusLedgerRows(input))

    expect(lines.every((line) => visualLength(line) <= 1)).toBe(true)
    expect(lines.join('\n')).not.toMatch(/…|\.\.\./u)
  })
})

describe('Visual+ 76-operation ledger invariants', () => {
  it.each([40, 60, 80, 118])('retains exact membership and geometry at %i columns', (width) => {
    const input = createVisualPlusFixtureInput(capabilities(width))
    const rows = createVisualPlusLedgerRows(input)
    const lines = renderVisualPlusLedger(input, rows)
    const output = lines.map(stripAnsi).join('\n')
    const distribution = { major: 0, minor: 0, patch: 0 }
    const metadataById = new Map(input.changes.map((metadata) => [metadata.operationId, metadata]))
    const expectedOperationIds = [...input.snapshot.changes]
      .sort((left, right) => {
        const leftMetadata = metadataById.get(left.id)!
        const rightMetadata = metadataById.get(right.id)!
        return (
          leftMetadata.ownerGroup.order - rightMetadata.ownerGroup.order ||
          leftMetadata.displayOrder - rightMetadata.displayOrder
        )
      })
      .map((change) => change.id)
    for (const row of rows) distribution[row.diff] += 1

    expect(rows).toHaveLength(76)
    expect(new Set(rows.map((row) => row.operationId)).size).toBe(76)
    expect(new Set(rows.map((row) => row.owner.id)).size).toBe(15)
    expect(
      rows
        .filter((row) => row.owner.label === 'shared-owner')
        .map((row) => row.owner.physicalTarget),
    ).toEqual([
      ...Array.from({ length: 5 }, () => 'packages/11-workspace/package.json'),
      ...Array.from({ length: 5 }, () => 'packages/12-workspace/package.json'),
    ])
    expect(distribution).toEqual({ major: 3, minor: 37, patch: 36 })
    expect(rows.map((row) => row.operationId)).toEqual(expectedOperationIds)
    expect(rows.map((row) => row.operationId).sort()).toEqual(
      input.snapshot.changes.map((change) => change.id).sort(),
    )
    expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
    expect(output).not.toMatch(
      /operation-\d+-\d+|(?:package|catalog|dependency|source):[a-f0-9]|Lifecycle|audit|preview|omitted|more updates/iu,
    )
    expect(output).not.toContain('…')
    expect(output).not.toContain('...')
    expect(lines.at(-1)).not.toBe('')
    expect(lines.some((line, index) => line === '' && lines[index + 1] === '')).toBe(false)
    for (const identifier of internalIdentifiers(input)) expect(output).not.toContain(identifier)
  })
})
