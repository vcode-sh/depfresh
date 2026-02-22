import type { TuiState } from '../state'
import { renderDetailView } from './detail-view'
import { renderListView } from './list-view'

export function renderFrame(state: TuiState): string {
  const lines = state.view === 'detail' ? renderDetailView(state) : renderListView(state)
  return `${lines.join('\n')}\n`
}

export function eraseLines(count: number): string {
  if (count <= 0) return ''
  return `\u001B[${count}A\u001B[0J`
}
