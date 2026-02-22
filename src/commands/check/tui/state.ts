export { enterDetail, exitDetail, moveDetailCursor, selectDetailVersion } from './state-detail'
export { resize } from './state-layout'
export {
  createInitialState,
  jumpToFirst,
  jumpToLast,
  moveCursor,
  pageMove,
  toggleAll,
  toggleSelection,
} from './state-list'
export type { CreateStateOptions, ListItem, TuiState, ViewMode } from './state-model'

import type { TuiState } from './state-model'

export function confirm(state: TuiState): TuiState {
  return { ...state, confirmed: true }
}

export function cancel(state: TuiState): TuiState {
  return { ...state, cancelled: true }
}
