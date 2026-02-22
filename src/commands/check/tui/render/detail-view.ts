import c from 'ansis'
import { arrow, colorDiff, padEnd } from '../../../../utils/format'
import type { DetailVersion } from '../detail'
import type { TuiState } from '../state'
import { getViewportHeight, getVisibleRange, hasOverflowAbove, hasOverflowBelow } from '../viewport'
import { colorAge, DETAIL_CHROME_LINES, DETAIL_HELP, fitLine } from './common'
import { renderListView } from './list-view'

export function renderDetailView(state: TuiState): string[] {
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

export function renderDetailVersionLine(
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
