import { describe, expect, it } from 'vitest'
import type { ResolvedDepChange } from '../../../../types'
import { stripAnsi } from '../../../../utils/format'
import { createInitialState, enterDetail } from '../state'
import { renderDetailVersionLine, renderDetailView } from './detail-view'

function makeDep(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'alpha',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: {
      name: 'alpha',
      versions: ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '2.0.0', '2.1.0'],
      distTags: { latest: '2.1.0', next: '3.0.0-beta.1' },
    },
    ...overrides,
  }
}

describe('renderDetailView', () => {
  it('renders overflow markers above and below when the detail list is clipped', () => {
    const base = createInitialState([makeDep()], { termRows: 10, termCols: 80 })
    const detail = enterDetail(base)
    const output = stripAnsi(
      renderDetailView({
        ...detail,
        detailScrollOffset: 1,
      }).join('\n'),
    )

    expect(output).toContain('^ more')
    expect(output).toContain('v more')
  })

  it('omits metadata rows when dist-tags and homepage are absent', () => {
    const base = createInitialState(
      [
        makeDep({
          pkgData: {
            name: 'alpha',
            versions: ['1.0.0', '2.0.0'],
            distTags: {},
          },
        }),
      ],
      { termRows: 20, termCols: 80 },
    )
    const detail = enterDetail(base)
    const output = stripAnsi(renderDetailView(detail).join('\n'))

    expect(output).not.toContain('dist-tags:')
    expect(output).not.toContain('Homepage:')
  })
})

describe('renderDetailVersionLine', () => {
  it('renders all detail badges when metadata is present', () => {
    const base = createInitialState([makeDep()], { termRows: 20, termCols: 200, explain: true })
    const state = enterDetail(base)
    const line = stripAnsi(
      renderDetailVersionLine(
        state,
        {
          version: '2.0.0',
          diff: 'major',
          distTag: 'latest',
          explain: 'Breaking change. Check migration guide.',
          deprecated: 'Use v3',
          provenance: 'none',
          nodeEngines: '>=999.0.0',
          age: { text: '~5d', color: 'yellow' },
        },
        0,
        6,
      ),
    )

    expect(line).toContain('latest')
    expect(line).toContain('Breaking change. Check migration guide.')
    expect(line).toContain('deprecated')
    expect(line).toContain('no-provenance')
    expect(line).toContain('node >=999.0.0')
    expect(line).toContain('~5d')
  })
})
