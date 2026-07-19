import { describe, expect, it } from 'vitest'
import { sanitizeTerminalText, stripAnsi, visualLength } from '../../../../utils/format'
import type { VisualPlusCapabilities } from '../capabilities'
import { buildVisualPlusInsights } from '../insights'
import { createVisualPlusFixtureInput, createVisualPlusFixtureSnapshot } from '../test-fixture'
import { renderVisualPlusCompactReview } from './compact'
import { renderVisualPlusDistribution } from './distribution'
import { renderVisualPlusImpact } from './impact'
import { renderVisualPlusRisk } from './risk'
import { renderVisualPlusShared } from './shared'
import { renderVisualPlusTopology } from './topology'

function capabilities(
  width: number,
  overrides: Partial<VisualPlusCapabilities> = {},
): VisualPlusCapabilities {
  return {
    interactive: true,
    color: false,
    unicode: true,
    motion: false,
    cursorControl: false,
    width,
    layout: width >= 96 ? 'wide' : width >= 56 ? 'medium' : 'narrow',
    ...overrides,
  }
}

function renderAll(width: number, overrides: Partial<VisualPlusCapabilities> = {}) {
  const insight = buildVisualPlusInsights(createVisualPlusFixtureSnapshot())
  const caps = capabilities(width, overrides)
  return [
    ...renderVisualPlusTopology(insight, caps),
    ...renderVisualPlusDistribution(insight, caps),
    ...renderVisualPlusRisk(insight, caps),
    ...renderVisualPlusImpact(insight, caps),
    ...renderVisualPlusShared(insight, caps),
  ]
}

describe('Visual+ relationship maps', () => {
  it('renders deterministic bounded compact review previews without internal identifiers', () => {
    const caps = capabilities(175)
    const input = createVisualPlusFixtureInput(caps)
    const insights = buildVisualPlusInsights(input.snapshot)
    const lines = renderVisualPlusCompactReview(input, insights).map(stripAnsi)
    const output = lines.join('\n')

    expect(output).toContain('Repository topology')
    expect(output).toContain('Distribution')
    expect(lines.filter((line) => line.startsWith('Major card '))).toHaveLength(
      insights.majors.length,
    )
    expect(
      lines.filter((line) => line.startsWith('Owner ') && line !== 'Owner impact'),
    ).toHaveLength(5)
    expect(lines).toContain('… 10 more owners')
    expect(
      lines.filter((line) => line.startsWith('Shared ') && line !== 'Shared dependencies'),
    ).toHaveLength(5)
    expect(lines).toContain('… 13 more shared dependencies')
    expect(
      lines.filter((line) => line.startsWith('Update ') && line !== 'Update preview'),
    ).toHaveLength(8)
    expect(lines).toContain('… 68 more updates')
    expect(lines.slice(-1)).toEqual(['Details: rerun with --long for the complete audit.'])
    expect(output).not.toMatch(
      /Operation ID|Owner ID|Dependency ID|operation-|dependency:|package:|source:/u,
    )

    const updates = lines.filter((line) => line.startsWith('Update ') && line !== 'Update preview')
    expect(updates.slice(0, 3)).toEqual([
      expect.stringMatching(/^Update Major react-dropzone .* lab-editor$/u),
      expect.stringMatching(/^Update Major react-dropzone .* web$/u),
      expect.stringMatching(/^Update Major nanoid .* root-catalog$/u),
    ])
  })

  it.each([40, 60, 80, 118, 175])(
    'keeps every compact review line within %i columns and uses portable omission text',
    (width) => {
      const caps = capabilities(
        width,
        width === 40 ? { unicode: false, layout: 'plain' } : { unicode: true },
      )
      const input = createVisualPlusFixtureInput(caps)
      const lines = renderVisualPlusCompactReview(input, buildVisualPlusInsights(input.snapshot))

      expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
      if (width === 40) {
        expect(lines).toContain('... 10 more owners')
        expect(lines.join('\n')).not.toContain('…')
      }
    },
  )

  it.each([40, 60, 80])('stacks distribution labels and values at %i columns', (width) => {
    const insights = buildVisualPlusInsights(createVisualPlusFixtureSnapshot())
    expect(
      renderVisualPlusDistribution(insights, capabilities(width)).join('\n'),
    ).toMatchInlineSnapshot(`
        "Distribution
        Major 3
        Bar █░░░░░░░░░
        Minor 37
        Bar █████░░░░░
        Patch 36
        Bar █████░░░░░"
      `)
  })

  it('keeps the wide distribution on compact rows at 118 columns', () => {
    const insights = buildVisualPlusInsights(createVisualPlusFixtureSnapshot())
    expect(
      renderVisualPlusDistribution(insights, capabilities(118)).join('\n'),
    ).toMatchInlineSnapshot(`
        "Distribution
        Major 3 · █░░░░░░░░░
        Minor 37 · █████░░░░░
        Patch 36 · █████░░░░░"
      `)
  })

  it.each([40, 60, 80, 118])('contains every line at %i columns', (width) => {
    const lines = renderAll(width)
    expect(lines.every((line) => visualLength(line) <= width)).toBe(true)
    expect(lines).toContain('Distribution')
    expect(lines).toContain('Risk focus')
    expect(lines).toContain('Owner impact')
    expect(lines).toContain('Shared dependencies')
  })

  it.each([
    [8, true],
    [8, false],
    [10, true],
    [10, false],
  ] as const)(
    'retains semantic evidence in plain mode at %i columns (Unicode %s)',
    (width, unicode) => {
      const output = renderAll(width, { layout: 'plain', unicode }).join('\n')
      const semantic = output.replaceAll('\n', '')
      expect(semantic).toContain(' -> ')
      expect(semantic).toContain(' | ')
      expect(semantic).toContain('#')
      expect(semantic).toContain('.')
      expect(semantic).toContain('Bar #.........')
      expect(semantic).toContain('Bar #####.....')
      expect([...output].every((character) => character.codePointAt(0)! <= 0x7f)).toBe(true)
      expect(output).not.toMatch(/[→·│─└├┬█░]/u)
      expect(output).not.toContain('\u001B')
      expect(output).toContain('Major')
      expect(output).toContain('Owner')
      expect(output).toContain('Source')
      expect(output).toContain('Path')
      expect(semantic).toContain('unknown')
      expect(output.split('\n').every((line) => visualLength(line) <= width)).toBe(true)
    },
  )

  it('renders the exact inventory without operation identifiers', () => {
    const insights = buildVisualPlusInsights(createVisualPlusFixtureSnapshot())
    const output = renderAll(118).join('\n')
    expect(output).toContain('76 updates')
    expect(output).toContain('Major 3')
    expect(output).toContain('Minor 37')
    expect(output).toContain('Patch 36')
    expect(output).toContain('react-dropzone')
    expect(output).toContain('^15.0.0 → ^17.0.0')
    expect(output).toContain('Occurrences 2')
    expect(output).toContain('nanoid')
    expect(output).toContain('^5.1.16 → ^6.0.0')
    expect(output).toContain('Occurrences 1')
    expect(output).toContain('~5d')
    expect(output).toContain('Compatibility compatible 0 · incompatible 0 · unknown 2')
    expect(output).toContain('Compatibility compatible 0 · incompatible 0 · unknown 1')
    expect(output).not.toMatch(/operation-\d+-\d+/u)
    expect(output.match(/^Owner ID /gmu) ?? []).toHaveLength(15)
    expect(output.match(/^Dependency ID /gmu) ?? []).toHaveLength(18)
    expect(output.match(/^Occurrence$/gmu) ?? []).toHaveLength(39)
    expect(output.match(/^Major card$/gmu) ?? []).toHaveLength(2)
    for (const impact of insights.owners) {
      expect(output).toContain(
        [
          `Owner ID ${impact.owner.id}`,
          `Owner ${impact.owner.label}`,
          `Target ${impact.owner.physicalTarget}`,
          `├ Updates ${impact.updates} · Major ${impact.distribution.major} · Minor ${impact.distribution.minor} · Patch ${impact.distribution.patch}`,
        ].join('\n'),
      )
    }
    for (const surface of insights.shared) {
      expect(output).toContain(`Dependency ID ${surface.dependencyId}\nDependency ${surface.name}`)
      for (const occurrence of surface.occurrences) {
        expect(output).toContain(
          [
            'Occurrence',
            `├ Owner ${occurrence.owner.label}`,
            `├ Source ${occurrence.sourcePath}`,
            `├ Path ${occurrence.occurrencePath.map(sanitizeTerminalText).join(' / ')}`,
          ].join('\n'),
        )
      }
    }
    for (const major of insights.majors) {
      for (const owner of major.owners) {
        expect(output).toContain(
          [`├ Owner ${owner.label}`, `├ Target ${owner.physicalTarget}`].join('\n'),
        )
      }
    }
  })

  it('uses selected operations when registry update candidates drift', () => {
    const snapshot = createVisualPlusFixtureSnapshot()
    const insights = buildVisualPlusInsights({
      ...snapshot,
      counts: { ...snapshot.counts, updates: 99 },
    })
    const output = renderVisualPlusTopology(insights, capabilities(118)).join('\n')

    expect(output).toContain('76 updates')
    expect(output).not.toContain('99 updates')
  })

  it('strips colored output to the same semantic bytes', () => {
    const colorless = renderAll(80, { color: false }).join('\n')
    const colored = renderAll(80, { color: true }).join('\n')
    expect(colored).toContain('\u001B[')
    expect(stripAnsi(colored)).toBe(colorless)
    expect(colorless).not.toContain('\u001B[')
  })

  it('renders stable zero-selection states without division by zero', () => {
    const snapshot = createVisualPlusFixtureSnapshot()
    const insights = buildVisualPlusInsights({
      ...snapshot,
      counts: { ...snapshot.counts, operations: 0, targets: 0 },
      changes: [],
      targets: [],
    })
    const caps = capabilities(40)
    const output = [
      ...renderVisualPlusDistribution(insights, caps),
      ...renderVisualPlusRisk(insights, caps),
      ...renderVisualPlusImpact(insights, caps),
      ...renderVisualPlusShared(insights, caps),
    ].join('\n')

    expect(output).toContain('Major 0')
    expect(output).toContain('Minor 0')
    expect(output).toContain('Patch 0')
    expect(output).toContain('No major updates')
    expect(output).toContain('No selected owners')
    expect(output).toContain('No shared dependencies')
  })

  it('sanitizes hostile map values and contains wide graphemes', () => {
    const source = buildVisualPlusInsights(createVisualPlusFixtureSnapshot())
    const hostile = structuredClone(source)
    ;(hostile.owners[0]!.owner as { label: string }).label =
      'safe\u001B]8;;https://evil.invalid\u0007\u001B[31m界👩‍💻\u200B\nunsafe\u202E'
    const lines = renderVisualPlusImpact(hostile, capabilities(10))

    expect(lines.join('')).not.toContain('\u001B')
    expect(lines.join('')).not.toContain('\n')
    expect(lines.every((line) => visualLength(line) <= 10)).toBe(true)
    expect(lines.join('')).toContain('safe')
  })
})
