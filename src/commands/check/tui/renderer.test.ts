import { describe, expect, it } from 'vitest'
import type { ResolvedDepChange } from '../../../types'
import { stripAnsi } from '../../../utils/format'
import { eraseLines, renderFrame } from './render'
import { createInitialState, enterDetail, moveCursor, toggleSelection } from './state'

function makeDep(name: string, source: ResolvedDepChange['source']): ResolvedDepChange {
  return {
    name,
    currentVersion: '^1.0.0',
    source,
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: {
      name,
      versions: ['1.0.0', '1.1.0', '2.0.0'],
      distTags: { latest: '2.0.0', next: '2.1.0-beta.1' },
      homepage: `https://${name}.example.com`,
      time: { '2.0.0': new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    },
  }
}

function makeManyDeps(count: number): ResolvedDepChange[] {
  return Array.from({ length: count }, (_, i) =>
    makeDep(`dep-${i + 1}`, i % 2 === 0 ? 'dependencies' : 'devDependencies'),
  )
}

describe('renderFrame - list view', () => {
  it('renders title, groups, summary, and help bar', () => {
    const updates = [makeDep('alpha', 'dependencies'), makeDep('beta', 'devDependencies')]
    let state = createInitialState(updates, { termRows: 20, termCols: 120 })
    state = toggleSelection(state)
    const output = stripAnsi(renderFrame(state))

    expect(output).toContain('Select dependencies to update')
    expect(output).toContain('dependencies')
    expect(output).toContain('devDependencies')
    expect(output).toContain('1/2 selected')
    expect(output).toContain('Space toggle')
  })

  it('renders cursor and selection markers on dependency rows', () => {
    const updates = [makeDep('alpha', 'dependencies'), makeDep('beta', 'dependencies')]
    let state = createInitialState(updates, { termRows: 20, termCols: 120 })
    state = toggleSelection(state)
    const output = stripAnsi(renderFrame(state))

    expect(output).toContain('> * alpha')
    expect(output).toContain('  o beta')
  })

  it('shows overflow markers when list is scrolled', () => {
    let state = createInitialState(makeManyDeps(20), { termRows: 10, termCols: 120 })
    state = moveCursor(state, 8)
    const output = stripAnsi(renderFrame(state))

    expect(output).toContain('^ more')
    expect(output).toContain('v more')
  })
})

describe('renderFrame - detail view', () => {
  it('renders detail header, metadata, and detail help', () => {
    const base = createInitialState([makeDep('alpha', 'dependencies')], {
      termRows: 20,
      termCols: 120,
    })
    const detail = enterDetail(base)
    const output = stripAnsi(renderFrame(detail))

    expect(output).toContain('alpha  ^1.0.0 -> ?')
    expect(output).toContain('dist-tags: latest -> 2.0.0')
    expect(output).toContain('Homepage: https://alpha.example.com')
    expect(output).toContain('Space/Enter select')
  })

  it('renders explanations when explain mode is enabled', () => {
    const base = createInitialState([makeDep('alpha', 'dependencies')], {
      termRows: 20,
      termCols: 120,
      explain: true,
    })
    const detail = enterDetail(base)
    const output = stripAnsi(renderFrame(detail))

    expect(output).toContain('Breaking change. Check migration guide.')
  })
})

describe('eraseLines', () => {
  it('returns empty string for non-positive counts', () => {
    expect(eraseLines(0)).toBe('')
    expect(eraseLines(-1)).toBe('')
  })

  it('returns cursor up + clear sequence for positive counts', () => {
    expect(eraseLines(3)).toBe('\u001B[3A\u001B[0J')
  })
})
