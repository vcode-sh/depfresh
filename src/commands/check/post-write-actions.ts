import { execSync } from 'node:child_process'
import c from 'ansis'
import type { ResolvedDepChange } from '../../types'
import type { Logger } from '../../utils/logger'

export async function runExecute(command: string, cwd: string, logger: Logger): Promise<void> {
  try {
    logger.info(`Running: ${command}`)
    execSync(command, { cwd, stdio: 'inherit' })
  } catch {
    logger.error(`Command failed: ${command}`)
  }
}

export function renderUpToDate(packageName: string): void {
  // biome-ignore lint/suspicious/noConsole: intentional output
  const log = console.log
  log()
  log(c.cyan.bold(packageName))
  log(`  ${c.green('All dependencies are up to date')}`)
  log()
}

export async function selectInteractiveUpdates(
  updates: ResolvedDepChange[],
  explain: boolean,
): Promise<ResolvedDepChange[]> {
  const { runInteractive } = await import('./interactive')
  return runInteractive(updates, { explain })
}
