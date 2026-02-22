import type { ResolvedDepChange } from '../../../types'
import type { DetailVersion } from './detail'

export type ViewMode = 'list' | 'detail'

export interface ListItem {
  type: 'dep' | 'group-header'
  dep?: ResolvedDepChange
  groupLabel?: string
  index: number
  depIndex?: number
}

export interface TuiState {
  view: ViewMode
  items: ListItem[]
  cursor: number
  scrollOffset: number

  detailDep: ResolvedDepChange | null
  detailVersions: DetailVersion[]
  detailCursor: number
  detailScrollOffset: number

  selectedNames: Set<string>

  termRows: number
  termCols: number
  explain: boolean

  confirmed: boolean
  cancelled: boolean
}

export interface CreateStateOptions {
  termRows?: number
  termCols?: number
  explain?: boolean
}

export function safeTermSize(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback
}
