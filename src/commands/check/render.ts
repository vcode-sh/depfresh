import c from 'ansis'
import type { BumpOptions, DepFieldType, ResolvedDepChange } from '../../types'
import {
  arrow,
  colorDiff,
  colorizeVersionDiff,
  timeDifference,
  visualPadEnd,
  visualPadStart,
} from '../../utils/format'
import { sortDeps } from '../../utils/sort'
import {
  buildColumnLayout,
  type ColumnLayout,
  fitCell,
  getTerminalWidth,
  totalRowWidth,
} from './render-layout'

const DEP_SOURCE_SHORT_NAMES: Record<DepFieldType, string> = {
  dependencies: 'dependencies',
  devDependencies: 'devDependencies',
  peerDependencies: 'peerDependencies',
  optionalDependencies: 'optionalDependencies',
  overrides: 'overrides',
  resolutions: 'resolutions',
  'pnpm.overrides': 'pnpm.overrides',
  catalog: 'catalog',
  packageManager: 'packageManager',
}

export function renderTable(
  packageName: string,
  updates: ResolvedDepChange[],
  options: BumpOptions,
): void {
  // biome-ignore lint/suspicious/noConsole: intentional output
  const log = console.log

  const terminalWidth = getTerminalWidth()
  const title = terminalWidth ? fitCell(packageName, Math.max(1, terminalWidth - 2)) : packageName

  log()
  log(c.cyan.bold(title))
  log()

  const sorted = sortDeps(updates, options.sort)

  if (options.group) {
    renderGrouped(sorted, options, log, terminalWidth)
  } else {
    renderFlat(sorted, options, log, terminalWidth)
  }

  const major = updates.filter((u) => u.diff === 'major').length
  const minor = updates.filter((u) => u.diff === 'minor').length
  const patch = updates.filter((u) => u.diff === 'patch').length

  const parts: string[] = []
  if (major) parts.push(c.red(`${major} major`))
  if (minor) parts.push(c.yellow(`${minor} minor`))
  if (patch) parts.push(c.green(`${patch} patch`))

  log(`  ${parts.join(c.gray(' | '))}  ${c.gray(`(${updates.length} total)`)}`)
  log()
}

function renderGrouped(
  sorted: ResolvedDepChange[],
  options: BumpOptions,
  log: (...args: unknown[]) => void,
  terminalWidth?: number,
): void {
  const groups = new Map<string, ResolvedDepChange[]>()
  for (const dep of sorted) {
    const source = dep.source
    const existing = groups.get(source)
    if (existing) {
      existing.push(dep)
    } else {
      groups.set(source, [dep])
    }
  }

  for (const [source, deps] of groups) {
    const label = DEP_SOURCE_SHORT_NAMES[source as DepFieldType] ?? source
    const outLabel = terminalWidth ? fitCell(label, Math.max(1, terminalWidth - 4)) : label
    log(c.gray(`  ${outLabel}`))
    renderRows(deps, options, log, false, terminalWidth)
    log()
  }
}

function renderFlat(
  sorted: ResolvedDepChange[],
  options: BumpOptions,
  log: (...args: unknown[]) => void,
  terminalWidth?: number,
): void {
  renderRows(sorted, options, log, true, terminalWidth)
  log()
}

function renderRows(
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

function buildHeader(layout: ColumnLayout): string {
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

function renderTimediff(publishedAt: string | undefined, ageWidth: number): string {
  const td = timeDifference(publishedAt)
  if (!td) return ' '.repeat(ageWidth)
  const colorFn = td.color === 'green' ? c.green : td.color === 'yellow' ? c.yellow : c.red
  return visualPadStart(colorFn(td.text), ageWidth)
}

function hasProvenanceDowngrade(dep: ResolvedDepChange): boolean {
  return (
    (dep.currentProvenance === 'trusted' || dep.currentProvenance === 'attested') &&
    dep.provenance === 'none'
  )
}
