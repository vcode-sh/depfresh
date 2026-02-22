import c from 'ansis'
import type { BumpOptions, ResolvedDepChange } from '../../../types'
import {
  arrow,
  colorDiff,
  colorizeVersionDiff,
  timeDifference,
  visualPadEnd,
  visualPadStart,
} from '../../../utils/format'
import { buildColumnLayout, type ColumnLayout, fitCell, totalRowWidth } from '../render-layout'

export function renderRows(
  deps: ResolvedDepChange[],
  options: BumpOptions,
  log: (...args: unknown[]) => void,
  showSource: boolean,
  terminalWidth?: number,
): void {
  const showTimediff = options.timediff
  const showNodecompat = options.nodecompat
  const showLong = options.long
  const layout = buildColumnLayout(deps, showSource, showTimediff, terminalWidth)

  const header = buildHeader(layout)
  log(header)

  const separatorLen = Math.max(0, totalRowWidth(layout) - 4)
  log(c.gray(`    ${'-'.repeat(separatorLen)}`))

  for (const dep of deps) {
    const name = visualPadEnd(fitCell(dep.name, layout.nameWidth), layout.nameWidth)
    const currentRaw = fitCell(dep.currentVersion, layout.currentWidth)
    const current = visualPadEnd(currentRaw, layout.currentWidth)
    const targetRaw = fitCell(dep.targetVersion, layout.targetWidth)
    const target = visualPadEnd(
      colorizeVersionDiff(dep.currentVersion, targetRaw, dep.diff),
      layout.targetWidth,
    )
    const diff = visualPadEnd(colorDiff(dep.diff), layout.diffWidth)
    const deprecated = dep.deprecated ? c.red(' (deprecated)') : ''

    let line = `    ${name}  `
    if (showSource) {
      const source = visualPadEnd(
        c.gray(fitCell(dep.source, layout.sourceWidth)),
        layout.sourceWidth,
      )
      line += `${source}  `
    }
    line += `${current}${arrow()}${target}  ${diff}`

    if (showTimediff) {
      line += `  ${renderTimediff(dep.publishedAt, layout.ageWidth)}`
    }

    if (hasProvenanceDowngrade(dep)) {
      line += `  ${c.yellow('\u26A0')}`
    }

    if (showNodecompat) {
      if (dep.nodeCompatible === true) {
        line += `  ${c.green.dim('\u2713')}`
      } else if (dep.nodeCompatible === false) {
        line += `  ${c.red('\u2717node')}`
      }
    }

    line += deprecated
    log(line)

    if (showLong && dep.pkgData.homepage) {
      log(c.gray(`      \u21B3 ${dep.pkgData.homepage}`))
    }
  }
}

export function buildHeader(layout: ColumnLayout): string {
  let header = `    ${visualPadEnd(c.gray('name'), layout.nameWidth)}  `
  if (layout.showSource) {
    header += `${visualPadEnd(c.gray('source'), layout.sourceWidth)}  `
  }
  header += `${visualPadEnd(c.gray('current'), layout.currentWidth)}`
  header += `${arrow()}${visualPadEnd(c.gray('target'), layout.targetWidth)}`
  header += `  ${visualPadEnd(c.gray('diff'), layout.diffWidth)}`
  if (layout.showTimediff) {
    header += `  ${visualPadStart(c.gray('age'), layout.ageWidth)}`
  }
  return header
}

export function renderTimediff(publishedAt: string | undefined, ageWidth: number): string {
  const td = timeDifference(publishedAt)
  if (!td) return ' '.repeat(ageWidth)
  const colorFn = td.color === 'green' ? c.green : td.color === 'yellow' ? c.yellow : c.red
  return visualPadStart(colorFn(td.text), ageWidth)
}

export function hasProvenanceDowngrade(dep: ResolvedDepChange): boolean {
  return (
    (dep.currentProvenance === 'trusted' || dep.currentProvenance === 'attested') &&
    dep.provenance === 'none'
  )
}
