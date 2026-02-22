import c from 'ansis'
import type { ResolvedDepChange } from '../../../types'
import {
  arrow,
  colorDiff,
  colorizeVersionDiff,
  padEnd,
  stripAnsi,
  timeDifference,
  truncate,
} from '../../../utils/format'
import type { DetailVersion } from './detail'
import type { ListItem, TuiState } from './state'
import { getViewportHeight, getVisibleRange, hasOverflowAbove, hasOverflowBelow } from './viewport'

const LIST_HELP = '  up/down navigate  Space toggle  -> versions  a all  Enter confirm  Esc cancel'
const DETAIL_HELP = '  up/down navigate  Space/Enter select  left/Esc back'
const DETAIL_CHROME_LINES = 8

function colorAge(age: DetailVersion['age']): string {
  if (!age) return ''
  if (age.color === 'green') return c.green(age.text)
  if (age.color === 'yellow') return c.yellow(age.text)
  return c.red(age.text)
}

function fitLine(line: string, termCols: number): string {
  if (termCols <= 0) return line
  const visible = stripAnsi(line)
  if (visible.length <= termCols) return line
  return truncate(visible, termCols)
}

function getDepItems(state: TuiState): Array<ListItem & { dep: ResolvedDepChange }> {
  return state.items.filter(
    (item): item is ListItem & { dep: ResolvedDepChange } => item.type === 'dep' && !!item.dep,
  )
}

function renderListDepLine(
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

function renderListLine(state: TuiState, item: ListItem, nameWidth: number): string {
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

function renderListView(state: TuiState): string[] {
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

function renderDetailVersionLine(
  state: TuiState,
  version: DetailVersion,
  idx: number,
  versionWidth: number,
): string {
  const pointer = idx === state.detailCursor ? c.cyan('>') : ' '
  const versionText = padEnd(version.version, versionWidth)

  let line = `  ${pointer} ${versionText}  ${colorDiff(version.diff)}`
  if (version.age) line += `  ${colorAge(version.age)}`
  if (version.distTag) line += `  ${c.cyan(version.distTag)}`
  if (version.explain) line += `  ${c.gray(version.explain)}`
  if (version.deprecated) line += `  ${c.red('deprecated')}`
  if (version.provenance === 'none') line += `  ${c.yellow('no-provenance')}`
  if (version.nodeEngines) line += `  ${c.gray(`node ${version.nodeEngines}`)}`

  return fitLine(line, state.termCols)
}

function renderDetailView(state: TuiState): string[] {
  const lines: string[] = []
  const dep = state.detailDep
  if (!dep) return renderListView(state)

  const header = `  ${dep.name}  ${dep.currentVersion}${arrow()}?`
  lines.push(fitLine(header, state.termCols))
  lines.push('')

  const versionWidth = Math.min(
    state.detailVersions.reduce((max, item) => Math.max(max, item.version.length), 6),
    18,
  )

  const viewportHeight = getViewportHeight(state.termRows, DETAIL_CHROME_LINES)
  const { start, end } = getVisibleRange(
    state.detailScrollOffset,
    viewportHeight,
    state.detailVersions.length,
  )
  const visible = state.detailVersions.slice(start, end)

  if (hasOverflowAbove(state.detailScrollOffset)) {
    lines.push(fitLine(`  ${c.gray('^ more')}`, state.termCols))
  }

  for (const [index, version] of visible.entries()) {
    lines.push(renderDetailVersionLine(state, version, start + index, versionWidth))
  }

  if (hasOverflowBelow(state.detailScrollOffset, viewportHeight, state.detailVersions.length)) {
    lines.push(fitLine(`  ${c.gray('v more')}`, state.termCols))
  }

  const distTags = Object.entries(dep.pkgData.distTags)
    .map(([tag, version]) => `${tag}${arrow()}${version}`)
    .join(' | ')

  lines.push('')
  if (distTags) {
    lines.push(fitLine(`  dist-tags: ${distTags}`, state.termCols))
  }
  if (dep.pkgData.homepage) {
    lines.push(fitLine(`  Homepage: ${dep.pkgData.homepage}`, state.termCols))
  }
  lines.push('')
  lines.push(fitLine(DETAIL_HELP, state.termCols))

  return lines
}

export function renderFrame(state: TuiState): string {
  const lines = state.view === 'detail' ? renderDetailView(state) : renderListView(state)
  return `${lines.join('\n')}\n`
}

export function eraseLines(count: number): string {
  if (count <= 0) return ''
  return `\u001B[${count}A\u001B[0J`
}
