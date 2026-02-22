import c from 'ansis'
import type { ResolvedDepChange } from '../../../../types'
import {
  arrow,
  colorDiff,
  colorizeVersionDiff,
  padEnd,
  timeDifference,
  truncate,
} from '../../../../utils/format'
import type { ListItem, TuiState } from '../state'
import { getViewportHeight, getVisibleRange, hasOverflowAbove, hasOverflowBelow } from '../viewport'
import { colorAge, fitLine, getDepItems, LIST_HELP } from './common'

export function renderListView(state: TuiState): string[] {
  const lines: string[] = []
  const depItems = getDepItems(state)
  const nameWidth = Math.min(
    depItems.reduce((max, item) => Math.max(max, item.dep.name.length), 4),
    24,
  )

  const viewportHeight = getViewportHeight(state.termRows)
  const { start, end } = getVisibleRange(state.scrollOffset, viewportHeight, state.items.length)
  const visibleItems = state.items.slice(start, end)

  lines.push(fitLine('  Select dependencies to update', state.termCols))
  lines.push('')

  if (hasOverflowAbove(state.scrollOffset)) {
    lines.push(fitLine(`  ${c.gray('^ more')}`, state.termCols))
  }

  for (const item of visibleItems) {
    lines.push(renderListLine(state, item, nameWidth))
  }

  if (hasOverflowBelow(state.scrollOffset, viewportHeight, state.items.length)) {
    lines.push(fitLine(`  ${c.gray('v more')}`, state.termCols))
  }

  const totalDeps = depItems.length
  const selectedCount = depItems.reduce(
    (count, item) => (state.selectedNames.has(item.dep.name) ? count + 1 : count),
    0,
  )

  lines.push(fitLine(`  ${selectedCount}/${totalDeps} selected`, state.termCols))
  lines.push('')
  lines.push(fitLine(LIST_HELP, state.termCols))

  return lines
}

export function renderListLine(state: TuiState, item: ListItem, nameWidth: number): string {
  if (item.type === 'group-header') {
    return fitLine(`  ${c.gray(item.groupLabel ?? '')}`, state.termCols)
  }

  if (!item.dep) return ''
  return renderListDepLine(
    item.dep,
    item.index === state.cursor,
    state.selectedNames.has(item.dep.name),
    nameWidth,
    state.termCols,
  )
}

export function renderListDepLine(
  dep: ResolvedDepChange,
  focused: boolean,
  selected: boolean,
  nameWidth: number,
  termCols: number,
): string {
  const pointer = focused ? c.cyan('>') : ' '
  const selectedMark = selected ? c.green('*') : c.gray('o')
  const name = padEnd(truncate(dep.name, nameWidth), nameWidth)
  const target = colorizeVersionDiff(dep.currentVersion, dep.targetVersion, dep.diff)
  const age = timeDifference(dep.publishedAt)

  let line = `  ${pointer} ${selectedMark} ${name}  ${dep.currentVersion}${arrow()}${target}  ${colorDiff(dep.diff)}`
  if (age) line += `  ${colorAge(age)}`

  return fitLine(line, termCols)
}
