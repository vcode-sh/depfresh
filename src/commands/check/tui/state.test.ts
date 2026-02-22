import { describe, expect, it } from 'vitest'
import type { DepFieldType, DiffType, ResolvedDepChange } from '../../../types'
import {
  cancel,
  confirm,
  createInitialState,
  enterDetail,
  exitDetail,
  jumpToFirst,
  jumpToLast,
  moveCursor,
  moveDetailCursor,
  pageMove,
  resize,
  selectDetailVersion,
  toggleAll,
  toggleSelection,
} from './state'

function makeDep(
  name: string,
  source: DepFieldType = 'dependencies',
  overrides: Partial<ResolvedDepChange> = {},
): ResolvedDepChange {
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
      time: { '2.0.0': new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    },
    ...overrides,
  }
}

function makeManyDeps(count: number, source: DepFieldType = 'dependencies'): ResolvedDepChange[] {
  return Array.from({ length: count }, (_, i) =>
    makeDep(`dep-${i + 1}`, source, {
      diff: (i % 3 === 0 ? 'major' : i % 3 === 1 ? 'minor' : 'patch') as DiffType,
      targetVersion: `^${i + 2}.0.0`,
    }),
  )
}

describe('createInitialState', () => {
  it('builds grouped list items and starts cursor on first dependency', () => {
    const updates = [makeDep('a', 'dependencies'), makeDep('b', 'devDependencies')]
    const state = createInitialState(updates, { termRows: 20, termCols: 100, explain: true })

    expect(state.items).toHaveLength(4)
    expect(state.items[0]?.type).toBe('group-header')
    expect(state.items[1]?.type).toBe('dep')
    expect(state.items[2]?.type).toBe('group-header')
    expect(state.items[3]?.type).toBe('dep')
    expect(state.cursor).toBe(1)
    expect(state.explain).toBe(true)
    expect(state.termRows).toBe(20)
    expect(state.termCols).toBe(100)
  })
})

describe('list navigation and selection', () => {
  it('moves cursor across dependencies and skips group headers', () => {
    const updates = [makeDep('a', 'dependencies'), makeDep('b', 'devDependencies')]
    const state = createInitialState(updates, { termRows: 20, termCols: 80 })

    const moved = moveCursor(state, 1)
    expect(moved.cursor).toBe(3)

    const clamped = moveCursor(moved, 1)
    expect(clamped.cursor).toBe(3)
  })

  it('supports jumping to first and last dependency', () => {
    const updates = [
      makeDep('a', 'dependencies'),
      makeDep('b', 'dependencies'),
      makeDep('c', 'dependencies'),
    ]
    const state = createInitialState(updates, { termRows: 20, termCols: 80 })

    const atLast = jumpToLast(state)
    expect(atLast.items[atLast.cursor]?.dep?.name).toBe('c')

    const backToFirst = jumpToFirst(atLast)
    expect(backToFirst.items[backToFirst.cursor]?.dep?.name).toBe('a')
  })

  it('pages cursor by viewport height', () => {
    const state = createInitialState(makeManyDeps(8), { termRows: 10, termCols: 80 })
    const paged = pageMove(state, 1)
    expect(paged.cursor).toBeGreaterThan(state.cursor)
  })

  it('toggles single selections and all selections', () => {
    const updates = [makeDep('a'), makeDep('b'), makeDep('c')]
    let state = createInitialState(updates, { termRows: 20, termCols: 80 })

    state = toggleSelection(state)
    expect(state.selectedNames.has('a')).toBe(true)

    state = toggleSelection(state)
    expect(state.selectedNames.has('a')).toBe(false)

    state = toggleAll(state)
    expect(state.selectedNames.size).toBe(3)

    state = toggleAll(state)
    expect(state.selectedNames.size).toBe(0)
  })
})

describe('detail view transitions', () => {
  it('enters and exits detail view', () => {
    const state = createInitialState([makeDep('a')], { termRows: 20, termCols: 80 })
    const detail = enterDetail(state)

    expect(detail.view).toBe('detail')
    expect(detail.detailDep?.name).toBe('a')
    expect(detail.detailVersions.length).toBeGreaterThan(0)

    const back = exitDetail(detail)
    expect(back.view).toBe('list')
    expect(back.detailDep).toBeNull()
    expect(back.detailVersions).toEqual([])
  })

  it('applies selected detail version and auto-selects dependency', () => {
    let state = createInitialState([makeDep('a')], { termRows: 20, termCols: 80 })
    state = enterDetail(state)
    state = moveDetailCursor(state, 1)
    state = selectDetailVersion(state)

    expect(state.view).toBe('list')
    const dep = state.items[1]?.dep
    expect(dep?.targetVersion).toBe('^1.1.0')
    expect(dep?.diff).toBe('minor')
    expect(state.selectedNames.has('a')).toBe(true)
  })

  it('clamps detail cursor at boundaries', () => {
    let state = createInitialState([makeDep('a')], { termRows: 20, termCols: 80 })
    state = enterDetail(state)

    const up = moveDetailCursor(state, -1)
    expect(up.detailCursor).toBe(0)

    const down = moveDetailCursor(state, 50)
    expect(down.detailCursor).toBe(down.detailVersions.length - 1)
  })
})

describe('flags and resize', () => {
  it('sets confirm/cancel flags', () => {
    const state = createInitialState([makeDep('a')], { termRows: 20, termCols: 80 })
    expect(confirm(state).confirmed).toBe(true)
    expect(cancel(state).cancelled).toBe(true)
  })

  it('recalculates scroll state on resize in list and detail view', () => {
    let listState = createInitialState(makeManyDeps(12), { termRows: 10, termCols: 80 })
    listState = moveCursor(listState, 6)

    const resizedList = resize(listState, 6, 60)
    expect(resizedList.termRows).toBe(6)
    expect(resizedList.termCols).toBe(60)
    expect(resizedList.scrollOffset).toBeGreaterThanOrEqual(0)

    const dep = makeDep('detail-pkg', 'dependencies', {
      pkgData: {
        name: 'detail-pkg',
        versions: ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '2.0.0', '2.1.0'],
        distTags: { latest: '2.1.0' },
      },
    })
    let detailState = createInitialState([dep], { termRows: 8, termCols: 80 })
    detailState = enterDetail(detailState)
    detailState = moveDetailCursor(detailState, 5)

    const resizedDetail = resize(detailState, 7, 70)
    expect(resizedDetail.termRows).toBe(7)
    expect(resizedDetail.detailScrollOffset).toBeGreaterThanOrEqual(0)
  })
})
