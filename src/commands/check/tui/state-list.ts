import type { ResolvedDepChange } from '../../../types'
import { updateListScroll } from './state-layout'
import type { ListItem, TuiState } from './state-model'
import { type CreateStateOptions, safeTermSize } from './state-model'
import { getViewportHeight } from './viewport'

function findDepIndex(items: ListItem[], start: number, direction: 1 | -1): number {
  let i = start
  while (i >= 0 && i < items.length) {
    const item = items[i]
    if (item?.type === 'dep') return i
    i += direction
  }
  return -1
}

export function createInitialState(
  updates: ResolvedDepChange[],
  options: CreateStateOptions = {},
): TuiState {
  const termRows = safeTermSize(options.termRows, 24)
  const termCols = safeTermSize(options.termCols, 80)

  const grouped = new Map<string, Array<{ dep: ResolvedDepChange; depIndex: number }>>()
  for (const [depIndex, dep] of updates.entries()) {
    const existing = grouped.get(dep.source)
    if (existing) {
      existing.push({ dep, depIndex })
    } else {
      grouped.set(dep.source, [{ dep, depIndex }])
    }
  }

  const items: ListItem[] = []
  let index = 0
  for (const [groupLabel, deps] of grouped.entries()) {
    items.push({
      type: 'group-header',
      groupLabel,
      index,
    })
    index++

    for (const entry of deps) {
      items.push({
        type: 'dep',
        dep: entry.dep,
        depIndex: entry.depIndex,
        index,
      })
      index++
    }
  }

  const firstDepCursor = findDepIndex(items, 0, 1)
  const cursor = firstDepCursor >= 0 ? firstDepCursor : 0

  const initial: TuiState = {
    view: 'list',
    items,
    cursor,
    scrollOffset: 0,
    detailDep: null,
    detailDepIndex: null,
    detailVersions: [],
    detailCursor: 0,
    detailScrollOffset: 0,
    selectedDepIndices: new Set<number>(),
    termRows,
    termCols,
    explain: options.explain ?? false,
    confirmed: false,
    cancelled: false,
  }

  return {
    ...initial,
    scrollOffset: updateListScroll(initial, cursor, termRows),
  }
}

export function moveCursor(state: TuiState, delta: number): TuiState {
  if (state.view !== 'list' || delta === 0 || state.items.length === 0) return state

  const direction: 1 | -1 = delta > 0 ? 1 : -1
  let cursor = state.cursor
  const steps = Math.max(1, Math.abs(delta))

  for (let i = 0; i < steps; i++) {
    const next = findDepIndex(state.items, cursor + direction, direction)
    if (next === -1) break
    cursor = next
  }

  if (cursor === state.cursor) return state

  return {
    ...state,
    cursor,
    scrollOffset: updateListScroll(state, cursor, state.termRows),
  }
}

export function jumpToFirst(state: TuiState): TuiState {
  if (state.view !== 'list') return state
  const cursor = findDepIndex(state.items, 0, 1)
  if (cursor === -1 || cursor === state.cursor) return state

  return {
    ...state,
    cursor,
    scrollOffset: updateListScroll(state, cursor, state.termRows),
  }
}

export function jumpToLast(state: TuiState): TuiState {
  if (state.view !== 'list') return state
  const cursor = findDepIndex(state.items, state.items.length - 1, -1)
  if (cursor === -1 || cursor === state.cursor) return state

  return {
    ...state,
    cursor,
    scrollOffset: updateListScroll(state, cursor, state.termRows),
  }
}

export function pageMove(state: TuiState, direction: 1 | -1): TuiState {
  if (state.view !== 'list') return state
  const distance = getViewportHeight(state.termRows)
  return moveCursor(state, direction * distance)
}

export function toggleSelection(state: TuiState): TuiState {
  if (state.view !== 'list') return state
  const item = state.items[state.cursor]
  if (item?.type !== 'dep' || !item.dep || item.depIndex === undefined) return state

  const selectedDepIndices = new Set(state.selectedDepIndices)
  if (selectedDepIndices.has(item.depIndex)) {
    selectedDepIndices.delete(item.depIndex)
  } else {
    selectedDepIndices.add(item.depIndex)
  }

  return { ...state, selectedDepIndices }
}

export function toggleAll(state: TuiState): TuiState {
  const depIndices = state.items
    .filter(
      (item): item is ListItem & { dep: ResolvedDepChange; depIndex: number } =>
        item.type === 'dep' && !!item.dep && item.depIndex !== undefined,
    )
    .map((item) => item.depIndex)

  if (depIndices.length === 0) return state

  const allSelected = depIndices.every((depIndex) => state.selectedDepIndices.has(depIndex))
  return {
    ...state,
    selectedDepIndices: allSelected ? new Set<number>() : new Set(depIndices),
  }
}
