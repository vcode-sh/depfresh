import { describe, expect, it } from 'vitest'
import type { ResolvedDepChange } from '../../../../types'
import { stripAnsi } from '../../../../utils/format'
import { createInitialState } from '../state'
import { renderListDepLine, renderListLine, renderListView } from './list-view'

function makeDep(
  name: string,
  source: ResolvedDepChange['source'] = 'dependencies',
): ResolvedDepChange {
  return {
    name,
    currentVersion: '^1.0.0',
    source,
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    pkgData: {
      name,
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    },
  }
}

describe('renderListView', () => {
  it('shows zero selected when nothing is checked', () => {
    const state = createInitialState([makeDep('alpha')], { termRows: 20, termCols: 80 })
    const output = stripAnsi(renderListView(state).join('\n'))

    expect(output).toContain('0/1 selected')
  })
})

describe('renderListLine', () => {
  it('renders group headers', () => {
    const state = createInitialState([makeDep('alpha')], { termRows: 20, termCols: 80 })
    const header = state.items[0]!

    expect(stripAnsi(renderListLine(state, header, 10))).toContain('dependencies')
  })

  it('returns an empty string for malformed dependency rows', () => {
    const state = createInitialState([makeDep('alpha')], { termRows: 20, termCols: 80 })

    expect(renderListLine(state, { type: 'dep', index: 99 }, 10)).toBe('')
  })
})

describe('renderListDepLine', () => {
  it('renders package age metadata when publishedAt is present', () => {
    const line = stripAnsi(renderListDepLine(makeDep('alpha'), true, true, 10, 120))

    expect(line).toContain('alpha')
    expect(line).toContain('major')
    expect(line).toMatch(/~\d+d/)
  })
})
