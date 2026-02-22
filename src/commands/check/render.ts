import c from 'ansis'
import type { BumpOptions, DepFieldType, ResolvedDepChange } from '../../types'
import { arrow, colorDiff, colorizeVersionDiff, padEnd, timeDifference } from '../../utils/format'
import { sortDeps } from '../../utils/sort'

// ansis auto-detects TTY and respects NO_COLOR env var — no manual stripping needed

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

  log()
  log(c.cyan.bold(packageName))
  log()

  const sorted = sortDeps(updates, options.sort)

  if (options.group) {
    renderGrouped(sorted, options, log)
  } else {
    renderFlat(sorted, options, log)
  }

  // Summary
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
): void {
  // Group by source
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
    log(c.gray(`  ${label}`))
    renderRows(deps, options, log, false)
    log()
  }
}

function renderFlat(
  sorted: ResolvedDepChange[],
  options: BumpOptions,
  log: (...args: unknown[]) => void,
): void {
  renderRows(sorted, options, log, true)
  log()
}

function hasProvenanceDowngrade(dep: ResolvedDepChange): boolean {
  return (
    (dep.currentProvenance === 'trusted' || dep.currentProvenance === 'attested') &&
    dep.provenance === 'none'
  )
}

function renderRows(
  deps: ResolvedDepChange[],
  options: BumpOptions,
  log: (...args: unknown[]) => void,
  showSource: boolean,
): void {
  const showTimediff = options.timediff
  const showNodecompat = options.nodecompat
  const showLong = options.long
  // Calculate column widths
  const nameWidth = Math.max(...deps.map((u) => u.name.length), 4)
  const currentWidth = Math.max(...deps.map((u) => u.currentVersion.length), 7)
  const targetWidth = Math.max(...deps.map((u) => u.targetVersion.length), 6)

  // Conditionally include source column
  const sourceWidth = showSource ? Math.max(...deps.map((u) => u.source.length), 6) : 0

  // Build header
  let header = `    ${padEnd(c.gray('name'), nameWidth + 2)}  `
  if (showSource) header += `${padEnd(c.gray('source'), sourceWidth)}  `
  header += `${padEnd(c.gray('current'), currentWidth)}  `
  header += `   ${padEnd(c.gray('target'), targetWidth)}  `
  header += c.gray('diff')
  if (showTimediff) header += `  ${c.gray('age')}`

  log(header)

  const separatorLen =
    nameWidth +
    currentWidth +
    targetWidth +
    18 +
    (showSource ? sourceWidth + 2 : 0) +
    (showTimediff ? 10 : 0)
  log(c.gray(`    ${'-'.repeat(separatorLen)}`))

  for (const dep of deps) {
    const name = padEnd(dep.name, nameWidth + 2)
    const current = padEnd(dep.currentVersion, currentWidth)
    const target = padEnd(
      colorizeVersionDiff(dep.currentVersion, dep.targetVersion, dep.diff),
      targetWidth,
    )
    const diff = colorDiff(dep.diff)
    const deprecated = dep.deprecated ? c.red(' (deprecated)') : ''

    let line = `    ${name}  `
    if (showSource) line += `${padEnd(c.gray(dep.source), sourceWidth)}  `
    line += `${current}${arrow()}${target}  ${diff}`

    if (showTimediff) {
      const td = timeDifference(dep.publishedAt)
      if (td) {
        const colorFn = td.color === 'green' ? c.green : td.color === 'yellow' ? c.yellow : c.red
        line += `  ${padEnd(colorFn(td.text), 8)}`
      }
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
