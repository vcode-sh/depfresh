import c from 'ansis'
import type { ResolvedDepChange } from '../../../types'

function defaultLog(...args: unknown[]): void {
  // biome-ignore lint/suspicious/noConsole: intentional render output
  console.log(...args)
}

export function renderResolutionErrors(
  packageName: string,
  errors: ResolvedDepChange[],
  log: (...args: unknown[]) => void = defaultLog,
): void {
  if (errors.length === 0) return

  log()
  log(c.cyan.bold(packageName))
  log(`  ${c.red('resolution errors')}`)
  log(`    ${c.gray('name')}  ${c.gray('current')}  ${c.gray('message')}`)
  log(`    ${c.gray('------------------------------------------------------------')}`)

  for (const dep of errors) {
    log(`    ${dep.name}  ${dep.currentVersion}  ${c.red('Failed to resolve from registry')}`)
  }

  log()
}
