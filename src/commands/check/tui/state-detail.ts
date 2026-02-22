import { applyVersionSelection, prepareDetailVersions } from './detail'
import { updateDetailScroll } from './state-layout'
import type { TuiState } from './state-model'
import { calculateScrollOffset, getViewportHeight } from './viewport'

export function enterDetail(state: TuiState): TuiState {
  if (state.view !== 'list') return state
  const item = state.items[state.cursor]
  if (item?.type !== 'dep' || !item.dep) return state

  const detailVersions = prepareDetailVersions(item.dep, state.explain)
  if (detailVersions.length === 0) return state

  return {
    ...state,
    view: 'detail',
    detailDep: item.dep,
    detailVersions,
    detailCursor: 0,
    detailScrollOffset: calculateScrollOffset(
      0,
      getViewportHeight(state.termRows),
      detailVersions.length,
      0,
    ),
  }
}

export function exitDetail(state: TuiState): TuiState {
  if (state.view !== 'detail') return state
  return {
    ...state,
    view: 'list',
    detailDep: null,
    detailVersions: [],
    detailCursor: 0,
    detailScrollOffset: 0,
  }
}

export function selectDetailVersion(state: TuiState): TuiState {
  if (state.view !== 'detail' || !state.detailDep || state.detailVersions.length === 0) return state
  const selected = state.detailVersions[state.detailCursor]
  if (!selected) return state

  applyVersionSelection(state.detailDep, selected.version)
  const selectedNames = new Set(state.selectedNames)
  selectedNames.add(state.detailDep.name)

  return {
    ...state,
    view: 'list',
    detailDep: null,
    detailVersions: [],
    detailCursor: 0,
    detailScrollOffset: 0,
    selectedNames,
  }
}

export function moveDetailCursor(state: TuiState, delta: number): TuiState {
  if (state.view !== 'detail' || state.detailVersions.length === 0 || delta === 0) return state

  const max = state.detailVersions.length - 1
  const next = Math.min(max, Math.max(0, state.detailCursor + delta))
  if (next === state.detailCursor) return state

  return {
    ...state,
    detailCursor: next,
    detailScrollOffset: updateDetailScroll(state, next, state.termRows, state.detailScrollOffset),
  }
}
