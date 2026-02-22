import c from 'ansis'
import type { DepFieldType, ResolvedDepChange, UpgrOptions } from '../../../types'
import { sortDeps } from '../../../utils/sort'
import { fitCell, getTerminalWidth } from '../render-layout'
import { renderRows } from './table-rows'
import { renderSummary } from './table-summary'

export const DEP_SOURCE_SHORT_NAMES: Record<DepFieldType, string> = {
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
  options: UpgrOptions,
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

  renderSummary(updates, log)
}

function renderGrouped(
  sorted: ResolvedDepChange[],
  options: UpgrOptions,
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
  options: UpgrOptions,
  log: (...args: unknown[]) => void,
  terminalWidth?: number,
): void {
  renderRows(sorted, options, log, true, terminalWidth)
  log()
}
