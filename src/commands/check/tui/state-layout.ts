import type { TuiState } from './state-model'
import { safeTermSize } from './state-model'
import { calculateScrollOffset, getViewportHeight } from './viewport'

export function updateListScroll(state: TuiState, cursor: number, termRows: number): number {
  const viewport = getViewportHeight(termRows)
  return calculateScrollOffset(cursor, viewport, state.items.length, state.scrollOffset)
}

export function updateDetailScroll(
  state: TuiState,
  detailCursor: number,
  termRows: number,
  currentOffset: number,
): number {
  const viewport = getViewportHeight(termRows)
  return calculateScrollOffset(detailCursor, viewport, state.detailVersions.length, currentOffset)
}

export function resize(state: TuiState, rows: number, cols: number): TuiState {
  const termRows = safeTermSize(rows, state.termRows)
  const termCols = safeTermSize(cols, state.termCols)

  const resized: TuiState = {
    ...state,
    termRows,
    termCols,
  }

  if (resized.view === 'detail') {
    return {
      ...resized,
      detailScrollOffset: updateDetailScroll(
        resized,
        resized.detailCursor,
        termRows,
        resized.detailScrollOffset,
      ),
    }
  }

  return {
    ...resized,
    scrollOffset: updateListScroll(resized, resized.cursor, termRows),
  }
}
