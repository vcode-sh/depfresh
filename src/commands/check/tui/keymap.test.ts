import { describe, expect, it } from 'vitest'
import type { ResolvedDepChange } from '../../../types'
import { handleKeypress } from './keymap'
import { createInitialState, enterDetail } from './state'

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
      distTags: { latest: '2.0.0' },
    },
  }
}

describe('handleKeypress - list view', () => {
  it('moves up and down with arrows and vim keys', () => {
    const state = createInitialState(
      [makeDep('a', 'dependencies'), makeDep('b', 'devDependencies')],
      { termRows: 20, termCols: 80 },
    )

    const down = handleKeypress(state, { name: 'j' })
    expect(down.cursor).toBe(3)

    const up = handleKeypress(down, { name: 'up' })
    expect(up.cursor).toBe(1)
  })

  it('toggles selection with space and toggles all with a', () => {
    let state = createInitialState([makeDep('a', 'dependencies'), makeDep('b', 'dependencies')], {
      termRows: 20,
      termCols: 80,
    })

    state = handleKeypress(state, { name: 'space' })
    expect(state.selectedNames.has('a')).toBe(true)

    state = handleKeypress(state, { name: 'a' })
    expect(state.selectedNames.size).toBe(2)
  })

  it('enters detail mode with right/l and confirms with return', () => {
    const state = createInitialState([makeDep('a', 'dependencies')], { termRows: 20, termCols: 80 })

    const detail = handleKeypress(state, { name: 'right' })
    expect(detail.view).toBe('detail')

    const confirmed = handleKeypress(state, { name: 'return' })
    expect(confirmed.confirmed).toBe(true)
  })

  it('cancels with escape, q, or ctrl+c', () => {
    const state = createInitialState([makeDep('a', 'dependencies')], { termRows: 20, termCols: 80 })

    expect(handleKeypress(state, { name: 'escape' }).cancelled).toBe(true)
    expect(handleKeypress(state, { name: 'q' }).cancelled).toBe(true)
    expect(handleKeypress(state, { name: 'c', ctrl: true }).cancelled).toBe(true)
  })

  it('supports paging and jump shortcuts', () => {
    const state = createInitialState(
      [
        makeDep('a', 'dependencies'),
        makeDep('b', 'dependencies'),
        makeDep('c', 'dependencies'),
        makeDep('d', 'dependencies'),
      ],
      { termRows: 10, termCols: 80 },
    )

    const paged = handleKeypress(state, { name: 'pagedown' })
    expect(paged.cursor).toBeGreaterThan(state.cursor)

    const first = handleKeypress(paged, { name: 'g' })
    expect(first.items[first.cursor]?.dep?.name).toBe('a')

    const last = handleKeypress(first, { name: 'g', shift: true, sequence: 'G' })
    expect(last.items[last.cursor]?.dep?.name).toBe('d')

    const pagedUp = handleKeypress(last, { name: 'pageup' })
    expect(pagedUp.cursor).toBeLessThan(last.cursor)
  })
})

describe('handleKeypress - detail view', () => {
  it('moves cursor with arrows/vim keys and exits with left/escape/q', () => {
    const base = createInitialState([makeDep('a', 'dependencies')], { termRows: 20, termCols: 80 })
    const state = enterDetail(base)

    const down = handleKeypress(state, { name: 'down' })
    expect(down.detailCursor).toBe(1)

    const up = handleKeypress(down, { name: 'k' })
    expect(up.detailCursor).toBe(0)

    expect(handleKeypress(state, { name: 'left' }).view).toBe('list')
    expect(handleKeypress(state, { name: 'escape' }).view).toBe('list')
    expect(handleKeypress(state, { name: 'q' }).view).toBe('list')
  })

  it('applies selected version with space/return and goes back to list', () => {
    const base = createInitialState([makeDep('a', 'dependencies')], { termRows: 20, termCols: 80 })
    const state = enterDetail(base)

    const selected = handleKeypress(state, { name: 'space' })
    expect(selected.view).toBe('list')
    expect(selected.selectedNames.has('a')).toBe(true)

    const state2 = enterDetail(
      createInitialState([makeDep('a', 'dependencies')], { termRows: 20, termCols: 80 }),
    )
    const selectedWithEnter = handleKeypress(state2, { name: 'return' })
    expect(selectedWithEnter.view).toBe('list')
    expect(selectedWithEnter.selectedNames.has('a')).toBe(true)
  })

  it('still cancels from detail mode with ctrl+c', () => {
    const state = enterDetail(
      createInitialState([makeDep('a', 'dependencies')], { termRows: 20, termCols: 80 }),
    )
    expect(handleKeypress(state, { name: 'c', ctrl: true }).cancelled).toBe(true)
  })
})
