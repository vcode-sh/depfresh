import c from 'ansis'
import type { ResolvedDepChange } from '../../../../types'
import { stripAnsi, truncate } from '../../../../utils/format'
import type { DetailVersion } from '../detail'
import type { ListItem, TuiState } from '../state'

export const LIST_HELP =
  '  up/down navigate  Space toggle  -> versions  a all  Enter confirm  Esc cancel'
export const DETAIL_HELP = '  up/down navigate  Space/Enter select  left/Esc back'
export const DETAIL_CHROME_LINES = 8

export function colorAge(age: DetailVersion['age']): string {
  if (!age) return ''
  if (age.color === 'green') return c.green(age.text)
  if (age.color === 'yellow') return c.yellow(age.text)
  return c.red(age.text)
}

export function fitLine(line: string, termCols: number): string {
  if (termCols <= 0) return line
  const visible = stripAnsi(line)
  if (visible.length <= termCols) return line
  return truncate(visible, termCols)
}

export function getDepItems(state: TuiState): Array<ListItem & { dep: ResolvedDepChange }> {
  return state.items.filter(
    (item): item is ListItem & { dep: ResolvedDepChange } => item.type === 'dep' && !!item.dep,
  )
}
