import type { TuiState } from './state'
import {
  cancel,
  confirm,
  enterDetail,
  exitDetail,
  jumpToFirst,
  jumpToLast,
  moveCursor,
  moveDetailCursor,
  pageMove,
  selectDetailVersion,
  toggleAll,
  toggleSelection,
} from './state'

export interface KeypressEvent {
  name?: string
  sequence?: string
  ctrl?: boolean
  shift?: boolean
}

function isShiftG(key: KeypressEvent): boolean {
  return key.name === 'G' || (key.name === 'g' && key.shift) || key.sequence === 'G'
}

function handleListViewKeypress(state: TuiState, key: KeypressEvent): TuiState {
  switch (key.name) {
    case 'down':
    case 'j':
      return moveCursor(state, 1)
    case 'up':
    case 'k':
      return moveCursor(state, -1)
    case 'space':
      return toggleSelection(state)
    case 'a':
      return toggleAll(state)
    case 'right':
    case 'l':
      return enterDetail(state)
    case 'return':
      return confirm(state)
    case 'escape':
    case 'q':
      return cancel(state)
    case 'pagedown':
      return pageMove(state, 1)
    case 'pageup':
      return pageMove(state, -1)
    case 'g':
      return isShiftG(key) ? jumpToLast(state) : jumpToFirst(state)
    default:
      return isShiftG(key) ? jumpToLast(state) : state
  }
}

function handleDetailViewKeypress(state: TuiState, key: KeypressEvent): TuiState {
  switch (key.name) {
    case 'down':
    case 'j':
      return moveDetailCursor(state, 1)
    case 'up':
    case 'k':
      return moveDetailCursor(state, -1)
    case 'space':
    case 'return':
      return selectDetailVersion(state)
    case 'left':
    case 'h':
    case 'escape':
    case 'q':
      return exitDetail(state)
    default:
      return state
  }
}

export function handleKeypress(state: TuiState, key: KeypressEvent): TuiState {
  if (key.ctrl && key.name === 'c') {
    return cancel(state)
  }

  if (state.view === 'detail') {
    return handleDetailViewKeypress(state, key)
  }

  return handleListViewKeypress(state, key)
}
