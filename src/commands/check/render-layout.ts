import type { ResolvedDepChange } from '../../types'
import { arrow, visualLength, visualTruncate } from '../../utils/format'

const MIN_NAME_COL = 8
const MIN_VERSION_COL = 6
const MIN_SOURCE_COL = 6

export interface ColumnLayout {
  nameWidth: number
  sourceWidth: number
  currentWidth: number
  targetWidth: number
  diffWidth: number
  ageWidth: number
  showSource: boolean
  showTimediff: boolean
}

export function buildColumnLayout(
  deps: ResolvedDepChange[],
  showSource: boolean,
  showTimediff: boolean,
  terminalWidth?: number,
): ColumnLayout {
  const layout: ColumnLayout = {
    nameWidth: Math.max(4, ...deps.map((u) => visualLength(u.name))),
    sourceWidth: showSource ? Math.max(6, ...deps.map((u) => visualLength(u.source))) : 0,
    currentWidth: Math.max(7, ...deps.map((u) => visualLength(u.currentVersion))),
    targetWidth: Math.max(6, ...deps.map((u) => visualLength(u.targetVersion))),
    diffWidth: Math.max(4, ...deps.map((u) => visualLength(u.diff))),
    ageWidth: showTimediff ? 8 : 0,
    showSource,
    showTimediff,
  }

  if (!terminalWidth || terminalWidth <= 0) {
    return layout
  }

  while (totalRowWidth(layout) > terminalWidth) {
    if (layout.nameWidth > MIN_NAME_COL) {
      layout.nameWidth--
      continue
    }
    if (layout.currentWidth > MIN_VERSION_COL) {
      layout.currentWidth--
      continue
    }
    if (layout.targetWidth > MIN_VERSION_COL) {
      layout.targetWidth--
      continue
    }
    if (layout.showSource && layout.sourceWidth > MIN_SOURCE_COL) {
      layout.sourceWidth--
      continue
    }
    break
  }

  return layout
}

export function totalRowWidth(layout: ColumnLayout): number {
  const base =
    4 + // indentation
    layout.nameWidth +
    2 +
    layout.currentWidth +
    visualLength(arrow()) +
    layout.targetWidth +
    2 +
    layout.diffWidth
  const source = layout.showSource ? layout.sourceWidth + 2 : 0
  const timediff = layout.showTimediff ? layout.ageWidth + 2 : 0
  return base + source + timediff
}

export function fitCell(value: string, width: number): string {
  return visualLength(value) > width ? visualTruncate(value, width) : value
}

export function getTerminalWidth(): number | undefined {
  if (!process.stdout.isTTY) return undefined
  return typeof process.stdout.columns === 'number' ? process.stdout.columns : undefined
}
