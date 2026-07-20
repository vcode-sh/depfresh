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

describe('Visual+ hybrid exact geometry', () => {
  it('wraps fixed heading chrome losslessly at a constrained width of 8', () => {
    const lines = renderFixture(8).map(stripAnsi)
    const headingStart = lines.indexOf('Breaking')
    const input = createVisualPlusHybridFixtureInput(capabilities(8))
    const snapshot = {
      ...input.snapshot,
      changes: input.snapshot.changes.map((change) => ({ ...change, diff: 'minor' as const })),
    }
    const noMajorsInput = { ...input, snapshot }
    const noMajorsLines = renderVisualPlusHybridReview(
      noMajorsInput,
      buildVisualPlusInsights(snapshot),
    ).map(stripAnsi)
    const emptyHeadingStart = noMajorsLines.indexOf('No break')

    expect(lines.every((line) => visualLength(line) <= 8)).toBe(true)
    expect(lines.slice(headingStart, headingStart + 2)).toEqual(['Breaking', ' changes'])
    expect(lines.slice(headingStart, headingStart + 2).join('')).toBe('Breaking changes')
    expect(noMajorsLines.every((line) => visualLength(line) <= 8)).toBe(true)
    expect(noMajorsLines.slice(emptyHeadingStart, emptyHeadingStart + 3)).toEqual([
      'No break',
      'ing chan',
      'ges',
    ])
    expect(noMajorsLines.slice(emptyHeadingStart, emptyHeadingStart + 3).join('')).toBe(
      'No breaking changes',
    )
  })

  it('renders the exact Unicode color-capable 40-column geometry after ANSI stripping', () => {
    expect(renderFixture(40).map(stripAnsi).join('\n')).toMatchInlineSnapshot(`
      "hybrid-fixture · pnpm 10.33.0
      workspace · major · read-only
      3 packages · 7 declared · 7 eligible
      7 updates · 3 files

      Major 3 · Minor 2 · Patch 2
      ████████████████████████████████████████

      Breaking changes
      react-dropzone
        ^15.0.0 → ^17.0.0 · ~5d
        web (apps/web/package.json)
        0 compatible · 0 incompatible
        1 unknown
        ^15.0.0 → ^18.0.0 · ~10d
        web (packages/web/package.json)
        1 compatible · 0 incompatible
        0 unknown
      vitest
        ^3.2.0 → ^4.0.0 · unknown
        web (apps/web/package.json)
        0 compatible · 1 incompatible
        0 unknown

      web · apps/web/package.json
        dependencies
      dependency · transition · severity · age
      ────────────────────────────────────────
      react-dropzone
        ^15.0.0 → ^17.0.0 · Major · ~5d
        compat unknown: Node support unknown

        devDependencies
      dependency · transition · severity · age
      ────────────────────────────────────────
      vitest
        ^3.2.0 → ^4.0.0 · Major · unknown
        compat incompatible: requires Node
        >=22
      typescript
        ^5.8.0 → ^5.9.0 · Minor · ~45d

      web · packages/web/package.json
        dependencies
      dependency · transition · severity · age
      ────────────────────────────────────────
      react-dropzone
        ^15.0.0 → ^18.0.0 · Major · ~10d
      nanoid
        ^5.1.0 → ^5.2.0 · Minor · ~2d
        compat incompatible: requires Node
        >=20
      picocolors [compat unknown]
        ^1.1.0 → ^1.1.1 · Patch · unknown

      default · pnpm-workspace.yaml
        catalog
      dependency · transition · severity · age
      ────────────────────────────────────────
      eslint [compat unknown]
        ^9.0.0 → ^9.1.0 · Patch · ~4mo
        catalog default: pnpm-workspace.yaml"
    `)
  })

  it('renders the exact Unicode color-capable 60-column geometry after ANSI stripping', () => {
    expect(renderFixture(60).map(stripAnsi).join('\n')).toMatchInlineSnapshot(`
      "hybrid-fixture · pnpm 10.33.0 · workspace · major
      read-only
      3 packages · 7 declared · 7 eligible · 7 updates · 3 files

      Major 3 · Minor 2 · Patch 2
      ████████████████████████████████████████

      Breaking changes
      react-dropzone
        ^15.0.0 → ^17.0.0 · ~5d · web (apps/web/package.json)
        0 compatible · 0 incompatible · 1 unknown
        ^15.0.0 → ^18.0.0 · ~10d · web (packages/web/package.json)
        1 compatible · 0 incompatible · 0 unknown
      vitest
        ^3.2.0 → ^4.0.0 · unknown · web (apps/web/package.json)
        0 compatible · 1 incompatible · 0 unknown

      web · apps/web/package.json
        dependencies
      dependency              current → target   severity  age
      ────────────────────────────────────────────────────────────
      react-dropzone          ^15.0.0 → ^17.0.0  Major     ~5d
        compat unknown: Node support unknown

        devDependencies
      dependency               current → target  severity  age
      ────────────────────────────────────────────────────────────
      vitest                   ^3.2.0 → ^4.0.0   Major     unknown
        compat incompatible: requires Node >=22
      typescript               ^5.8.0 → ^5.9.0   Minor     ~45d

      web · packages/web/package.json
        dependencies
      dependency              current → target   severity  age
      ────────────────────────────────────────────────────────────
      react-dropzone          ^15.0.0 → ^18.0.0  Major     ~10d
      nanoid                  ^5.1.0 → ^5.2.0    Minor     ~2d
        compat incompatible: requires Node >=20
      picocolors              ^1.1.0 → ^1.1.1    Patch     unknown
        compat unknown

      default · pnpm-workspace.yaml
        catalog
      dependency               current → target  severity  age
      ────────────────────────────────────────────────────────────
      eslint [compat unknown]  ^9.0.0 → ^9.1.0   Patch     ~4mo
        catalog default: pnpm-workspace.yaml"
    `)
  })

  it('renders the exact Unicode color-capable 80-column geometry after ANSI stripping', () => {
    expect(renderFixture(80).map(stripAnsi).join('\n')).toMatchInlineSnapshot(`
      "hybrid-fixture · pnpm 10.33.0 · workspace · major · read-only
      3 packages · 7 declared · 7 eligible · 7 updates · 3 files

      Major 3 · Minor 2 · Patch 2
      ████████████████████████████████████████

      Breaking changes
      react-dropzone
        ^15.0.0 → ^17.0.0 · ~5d · web (apps/web/package.json)
        0 compatible · 0 incompatible · 1 unknown
        ^15.0.0 → ^18.0.0 · ~10d · web (packages/web/package.json)
        1 compatible · 0 incompatible · 0 unknown
      vitest
        ^3.2.0 → ^4.0.0 · unknown · web (apps/web/package.json)
        0 compatible · 1 incompatible · 0 unknown

      web · apps/web/package.json
        dependencies
      dependency                                  current → target   severity  age
      ────────────────────────────────────────────────────────────────────────────────
      react-dropzone                              ^15.0.0 → ^17.0.0  Major     ~5d
        compat unknown: Node support unknown

        devDependencies
      dependency                                   current → target  severity  age
      ────────────────────────────────────────────────────────────────────────────────
      vitest                                       ^3.2.0 → ^4.0.0   Major     unknown
        compat incompatible: requires Node >=22
      typescript                                   ^5.8.0 → ^5.9.0   Minor     ~45d

      web · packages/web/package.json
        dependencies
      dependency                                  current → target   severity  age
      ────────────────────────────────────────────────────────────────────────────────
      react-dropzone                              ^15.0.0 → ^18.0.0  Major     ~10d
      nanoid                                      ^5.1.0 → ^5.2.0    Minor     ~2d
        compat incompatible: requires Node >=20
      picocolors [compat unknown]                 ^1.1.0 → ^1.1.1    Patch     unknown

      default · pnpm-workspace.yaml
        catalog
      dependency                                   current → target  severity  age
      ────────────────────────────────────────────────────────────────────────────────
      eslint [compat unknown]                      ^9.0.0 → ^9.1.0   Patch     ~4mo
        catalog default: pnpm-workspace.yaml"
    `)
  })

  it('renders the exact Unicode color-capable 118-column geometry after ANSI stripping', () => {
    expect(renderFixture(118).map(stripAnsi).join('\n')).toMatchInlineSnapshot(`
      "hybrid-fixture · pnpm 10.33.0 · workspace · major · read-only
      3 packages · 7 declared · 7 eligible · 7 updates · 3 files

      Major 3 · Minor 2 · Patch 2
      ████████████████████████████████████████

      Breaking changes
      react-dropzone
        ^15.0.0 → ^17.0.0 · ~5d · web (apps/web/package.json)
        0 compatible · 0 incompatible · 1 unknown
        ^15.0.0 → ^18.0.0 · ~10d · web (packages/web/package.json)
        1 compatible · 0 incompatible · 0 unknown
      vitest
        ^3.2.0 → ^4.0.0 · unknown · web (apps/web/package.json)
        0 compatible · 1 incompatible · 0 unknown

      web · apps/web/package.json
        dependencies
      dependency                                current  target   severity  age
      ─────────────────────────────────────────────────────────────────────────────
      react-dropzone                            ^15.0.0  ^17.0.0  Major     ~5d
        compat unknown: Node support unknown

        devDependencies
      dependency                                current  target  severity  age
      ────────────────────────────────────────────────────────────────────────────
      vitest                                    ^3.2.0   ^4.0.0  Major     unknown
        compat incompatible: requires Node >=22
      typescript                                ^5.8.0   ^5.9.0  Minor     ~45d

      web · packages/web/package.json
        dependencies
      dependency                                current  target   severity  age
      ─────────────────────────────────────────────────────────────────────────────
      react-dropzone                            ^15.0.0  ^18.0.0  Major     ~10d
      nanoid                                    ^5.1.0   ^5.2.0   Minor     ~2d
        compat incompatible: requires Node >=20
      picocolors [compat unknown]               ^1.1.0   ^1.1.1   Patch     unknown

      default · pnpm-workspace.yaml
        catalog
      dependency                                current  target  severity  age
      ────────────────────────────────────────────────────────────────────────────
      eslint [compat unknown]                   ^9.0.0   ^9.1.0  Patch     ~4mo
        catalog default: pnpm-workspace.yaml"
    `)
  })

  it('renders the exact raw ANSI geometry at 80 columns', () => {
    expect(renderFixture(80).join('\n')).toMatchInlineSnapshot(`
      "[1mhybrid-fixture · pnpm 10.33.0 · workspace · major · read-only[22m
      3 packages · 7 declared · 7 eligible · 7 updates · 3 files

      [31mMajor[39m 3 · [33mMinor[39m 2 · [32mPatch[39m 2
      [31m█████████████████[39m[33m████████████[39m[32m███████████[39m

      [1mBreaking changes[22m
      [36mreact-dropzone[39m
        ^15.0.0 → ^17.0.0 · ~5d · web (apps/web/package.json)
        0 compatible · 0 incompatible · 1 unknown
        ^15.0.0 → ^18.0.0 · ~10d · web (packages/web/package.json)
        1 compatible · 0 incompatible · 0 unknown
      [36mvitest[39m
        ^3.2.0 → ^4.0.0 · unknown · web (apps/web/package.json)
        0 compatible · 1 incompatible · 0 unknown

      [1mweb · apps/web/package.json[22m
      [36m  dependencies[39m
      dependency                                  current → target   severity  age
      ────────────────────────────────────────────────────────────────────────────────
      react-dropzone                              [90m^15.0.0[39m → [31m^17.0.0[39m  [31mMajor[39m     ~5d
      [90m  compat unknown: Node support unknown[39m

      [36m  devDependencies[39m
      dependency                                   current → target  severity  age
      ────────────────────────────────────────────────────────────────────────────────
      vitest                                       [90m^3.2.0[39m → [31m^4.0.0[39m   [31mMajor[39m     unknown
      [90m  compat incompatible: requires Node >=22[39m
      typescript                                   [90m^5.8.0[39m → [33m^5.9.0[39m   [33mMinor[39m     ~45d

      [1mweb · packages/web/package.json[22m
      [36m  dependencies[39m
      dependency                                  current → target   severity  age
      ────────────────────────────────────────────────────────────────────────────────
      react-dropzone                              [90m^15.0.0[39m → [31m^18.0.0[39m  [31mMajor[39m     ~10d
      nanoid                                      [90m^5.1.0[39m → [33m^5.2.0[39m    [33mMinor[39m     ~2d
      [90m  compat incompatible: requires Node >=20[39m
      picocolors [compat unknown]                 [90m^1.1.0[39m → [32m^1.1.1[39m    [32mPatch[39m     unknown

      [1mdefault · pnpm-workspace.yaml[22m
      [36m  catalog[39m
      dependency                                   current → target  severity  age
      ────────────────────────────────────────────────────────────────────────────────
      eslint [compat unknown]                      [90m^9.0.0[39m → [32m^9.1.0[39m   [32mPatch[39m     ~4mo
      [90m  catalog default: pnpm-workspace.yaml[39m"
    `)
  })

  it('keeps the exact 80-column geometry under NO_COLOR', () => {
    expect(renderFixture(80, { color: false }).join('\n')).toMatchInlineSnapshot(`
      "hybrid-fixture · pnpm 10.33.0 · workspace · major · read-only
      3 packages · 7 declared · 7 eligible · 7 updates · 3 files

      Major 3 · Minor 2 · Patch 2
      ████████████████████████████████████████

      Breaking changes
      react-dropzone
        ^15.0.0 → ^17.0.0 · ~5d · web (apps/web/package.json)
        0 compatible · 0 incompatible · 1 unknown
        ^15.0.0 → ^18.0.0 · ~10d · web (packages/web/package.json)
        1 compatible · 0 incompatible · 0 unknown
      vitest
        ^3.2.0 → ^4.0.0 · unknown · web (apps/web/package.json)
        0 compatible · 1 incompatible · 0 unknown

      web · apps/web/package.json
        dependencies
      dependency                                  current → target   severity  age
      ────────────────────────────────────────────────────────────────────────────────
      react-dropzone                              ^15.0.0 → ^17.0.0  Major     ~5d
        compat unknown: Node support unknown

        devDependencies
      dependency                                   current → target  severity  age
      ────────────────────────────────────────────────────────────────────────────────
      vitest                                       ^3.2.0 → ^4.0.0   Major     unknown
        compat incompatible: requires Node >=22
      typescript                                   ^5.8.0 → ^5.9.0   Minor     ~45d

      web · packages/web/package.json
        dependencies
      dependency                                  current → target   severity  age
      ────────────────────────────────────────────────────────────────────────────────
      react-dropzone                              ^15.0.0 → ^18.0.0  Major     ~10d
      nanoid                                      ^5.1.0 → ^5.2.0    Minor     ~2d
        compat incompatible: requires Node >=20
      picocolors [compat unknown]                 ^1.1.0 → ^1.1.1    Patch     unknown

      default · pnpm-workspace.yaml
        catalog
      dependency                                   current → target  severity  age
      ────────────────────────────────────────────────────────────────────────────────
      eslint [compat unknown]                      ^9.0.0 → ^9.1.0   Patch     ~4mo
        catalog default: pnpm-workspace.yaml"
    `)
  })

  it('renders the exact ASCII fallback at 80 columns', () => {
    expect(
      renderFixture(80, {
        color: false,
        unicode: false,
        interactive: false,
        layout: 'plain',
      }).join('\n'),
    ).toMatchInlineSnapshot(`
      "hybrid-fixture - pnpm 10.33.0 - workspace - major - read-only
      3 packages - 7 declared - 7 eligible - 7 updates - 3 files

      Major 3 - Minor 2 - Patch 2
      ########################################

      Breaking changes
      react-dropzone
        ^15.0.0 -> ^17.0.0 - ~5d - web (apps/web/package.json)
        0 compatible - 0 incompatible - 1 unknown
        ^15.0.0 -> ^18.0.0 - ~10d - web (packages/web/package.json)
        1 compatible - 0 incompatible - 0 unknown
      vitest
        ^3.2.0 -> ^4.0.0 - unknown - web (apps/web/package.json)
        0 compatible - 1 incompatible - 0 unknown

      web - apps/web/package.json
        dependencies
      dependency                                 current -> target   severity  age
      --------------------------------------------------------------------------------
      react-dropzone                             ^15.0.0 -> ^17.0.0  Major     ~5d
        compat unknown: Node support unknown

        devDependencies
      dependency                                  current -> target  severity  age
      --------------------------------------------------------------------------------
      vitest                                      ^3.2.0 -> ^4.0.0   Major     unknown
        compat incompatible: requires Node >=22
      typescript                                  ^5.8.0 -> ^5.9.0   Minor     ~45d

      web - packages/web/package.json
        dependencies
      dependency                                 current -> target   severity  age
      --------------------------------------------------------------------------------
      react-dropzone                             ^15.0.0 -> ^18.0.0  Major     ~10d
      nanoid                                     ^5.1.0 -> ^5.2.0    Minor     ~2d
        compat incompatible: requires Node >=20
      picocolors [compat unknown]                ^1.1.0 -> ^1.1.1    Patch     unknown

      default - pnpm-workspace.yaml
        catalog
      dependency                                  current -> target  severity  age
      --------------------------------------------------------------------------------
      eslint [compat unknown]                     ^9.0.0 -> ^9.1.0   Patch     ~4mo
        catalog default: pnpm-workspace.yaml"
    `)
  })
})

describe('Visual+ hybrid semantic composition', () => {
  it('keeps the fixed hierarchy and excludes the audit transcript', () => {
    const lines = renderFixture(80).map(stripAnsi)
    const output = lines.join('\n')
    const context = lines.findIndex((line) => line.startsWith('hybrid-fixture'))
    const topology = lines.findIndex((line) => line.startsWith('3 packages'))
    const severity = lines.findIndex((line) => line.startsWith('Major 3'))
    const breaking = lines.indexOf('Breaking changes')
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
    expect(output).toContain('0 compatible · 0 incompatible · 1 unknown')
    expect(output).toContain('1 compatible · 0 incompatible · 0 unknown')
  })

  it('renders No breaking changes when authoritative insights contain no majors', () => {
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
    ).toContain('No breaking changes')
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
