import c from 'ansis'
import type { BumpOptions, ResolvedDepChange } from '../../types'
import { arrow, colorDiff, colorVersion, padEnd } from '../../utils/format'

// ansis auto-detects TTY and respects NO_COLOR env var — no manual stripping needed

export function renderTable(
  packageName: string,
  updates: ResolvedDepChange[],
  _options: BumpOptions,
): void {
  // biome-ignore lint/suspicious/noConsole: intentional output
  const log = console.log

  log()
  log(c.cyan.bold(packageName))
  log()

  // Calculate column widths
  const nameWidth = Math.max(...updates.map((u) => u.name.length), 4)
  const sourceWidth = Math.max(...updates.map((u) => u.source.length), 6)
  const currentWidth = Math.max(...updates.map((u) => u.currentVersion.length), 7)
  const targetWidth = Math.max(...updates.map((u) => u.targetVersion.length), 6)

  // Header
  log(
    `  ${padEnd(c.gray('name'), nameWidth + 2)}  ` +
      `${padEnd(c.gray('source'), sourceWidth)}  ` +
      `${padEnd(c.gray('current'), currentWidth)}  ` +
      `   ${padEnd(c.gray('target'), targetWidth)}  ` +
      `${c.gray('diff')}`,
  )
  log(c.gray(`  ${'-'.repeat(nameWidth + sourceWidth + currentWidth + targetWidth + 20)}`))

  // Sort: major first, then minor, then patch
  const sorted = [...updates].sort((a, b) => {
    const order = { major: 0, minor: 1, patch: 2, error: 3, none: 4 }
    return (order[a.diff] ?? 4) - (order[b.diff] ?? 4)
  })

  for (const dep of sorted) {
    const name = padEnd(dep.name, nameWidth + 2)
    const source = padEnd(c.gray(dep.source), sourceWidth)
    const current = padEnd(dep.currentVersion, currentWidth)
    const target = padEnd(colorVersion(dep.targetVersion, dep.diff), targetWidth)
    const diff = colorDiff(dep.diff)
    const deprecated = dep.deprecated ? c.red(' (deprecated)') : ''

    log(`  ${name}  ${source}  ${current}${arrow()}${target}  ${diff}${deprecated}`)
  }

  log()

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
