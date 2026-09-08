import { describe, expect, it } from 'vitest'
import { stripAnsi, visualLength } from '../../../../utils/format'
import type { VisualPlusCapabilities } from '../capabilities'
import { buildVisualPlusInsights } from '../insights'
import {
  createVisualPlusFixtureInput,
  createVisualPlusHybridFixtureInput,
  createVisualPlusHybridFixtureSnapshot,
} from '../test-fixture'
import { createVisualPlusMajorRiskGroups, renderVisualPlusHybridReview } from './hybrid'
import { createVisualPlusLedgerRows } from './ledger'

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

function renderFixture(width: number, overrides: Partial<VisualPlusCapabilities> = {}) {
  const input = createVisualPlusHybridFixtureInput(capabilities(width, overrides))
  return renderVisualPlusHybridReview(input, buildVisualPlusInsights(input.snapshot))
}

function internalIdentifiers(input: ReturnType<typeof createVisualPlusFixtureInput>) {
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

describe('Visual+ hybrid semantic composition', () => {
  it('keeps the fixed hierarchy and excludes the audit transcript', () => {
    const lines = renderFixture(80).map(stripAnsi)
    const output = lines.join('\n')
    const context = lines.findIndex((line) => line.startsWith('hybrid-fixture'))
    const topology = lines.findIndex((line) => line.startsWith('3 packages'))
    const severity = lines.findIndex((line) => line.startsWith('Major 3'))
    const breaking = lines.indexOf('Major updates')
    const firstOwner = lines.indexOf('web · apps/web/package.json')

    expect(context).toBe(0)
    expect(context).toBeLessThan(topology)
    expect(topology).toBeLessThan(severity)
    expect(severity).toBeLessThan(breaking)
    expect(breaking).toBeLessThan(firstOwner)
    expect(output).not.toMatch(
      /Lifecycle|audit preview|Update preview|omitted|more updates|Operation ID|Owner ID|Dependency ID|operation-/iu,
    )
  })

  it('groups divergent major transitions by dependency identity without collapsing their facts', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80))
    const insights = buildVisualPlusInsights(createVisualPlusHybridFixtureSnapshot())
    const groups = createVisualPlusMajorRiskGroups(insights)
    const react = groups.find((group) => group.name === 'react-dropzone')
    const output = renderVisualPlusHybridReview(input, insights).map(stripAnsi).join('\n')

    expect(react?.transitions.map((transition) => [transition.current, transition.target])).toEqual(
      [
        ['^15.0.0', '^17.0.0'],
        ['^15.0.0', '^18.0.0'],
      ],
    )
    expect(output.match(/^react-dropzone$/gmu)).toHaveLength(1)
    expect(output).toContain('^15.0.0 → ^17.0.0')
    expect(output).toContain('^15.0.0 → ^18.0.0')
    expect(output).toContain('~5d')
    expect(output).toContain('~10d')
    expect(output.match(/Compatibility could not be determined/gu)).toHaveLength(1)
    expect(output).toContain('compat incompatible: requires Node')
    expect(output).not.toContain('[compat unknown]')
  })

  it('does not claim absence of breaking changes from semver alone', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80))
    const snapshot = {
      ...input.snapshot,
      changes: input.snapshot.changes.map((change) => ({ ...change, diff: 'minor' as const })),
    }
    const noMajorsInput = { ...input, snapshot }

    expect(
      renderVisualPlusHybridReview(noMajorsInput, buildVisualPlusInsights(snapshot))
        .map(stripAnsi)
        .join('\n'),
    ).not.toMatch(/No breaking changes|Major updates/u)
  })

  it('fails closed when supplied insights differ from the selected ledger', () => {
    const input = createVisualPlusHybridFixtureInput(capabilities(80))
    const insights = buildVisualPlusInsights(input.snapshot)

    expect(() =>
      renderVisualPlusHybridReview(input, {
        ...insights,
        distribution: { ...insights.distribution, major: 0 },
      }),
    ).toThrow(/Visual\+ hybrid/u)
  })
})

describe('Visual+ 76-operation hybrid invariants', () => {
  it.each([40, 60, 80, 118])('keeps complete semantic truth at %i columns', (width) => {
    const input = createVisualPlusFixtureInput(capabilities(width))
    const insights = buildVisualPlusInsights(input.snapshot)
    const rows = createVisualPlusLedgerRows(input)
    const lines = renderVisualPlusHybridReview(input, insights)
    const output = lines.map(stripAnsi).join('\n')
    const majorIds = new Set(
      rows.filter((row) => row.diff === 'major').map((row) => row.operationId),
    )
    const riskIds = new Set(
      createVisualPlusMajorRiskGroups(insights).flatMap((group) =>
        group.transitions.flatMap((transition) => transition.operationIds),
      ),
    )

    expect(rows).toHaveLength(76)
    expect(new Set(rows.map((row) => row.operationId)).size).toBe(76)
    expect(insights.distribution).toEqual({ major: 3, minor: 37, patch: 36 })
    expect(riskIds).toEqual(majorIds)
    expect(createVisualPlusMajorRiskGroups(insights)).toHaveLength(2)
    expect(new Set(rows.map((row) => row.owner.id)).size).toBe(15)
    expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
    expect(output).not.toMatch(
      /operation-\d+-\d+|(?:package|catalog|dependency|source):[a-f0-9]|Lifecycle|audit preview|Update preview|omitted|more updates/iu,
    )
    expect(output).not.toContain('…')
    expect(output).not.toContain('...')
    expect(lines.at(-1)).not.toBe('')
    expect(lines.some((line, index) => line === '' && lines[index + 1] === '')).toBe(false)
    for (const identifier of internalIdentifiers(input)) expect(output).not.toContain(identifier)
  })
})
