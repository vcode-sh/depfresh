import c from 'ansis'
import { ConfigError } from '../../errors'
import type { ResolvedDepChange } from '../../types'
import { sanitizeTerminalText } from '../../utils/format'
import type { Logger } from '../../utils/logger'
import { fitCell, getTerminalWidth } from './render-layout'

export async function runExecute(command: string, cwd: string, logger: Logger): Promise<boolean> {
  void command
  void cwd
  void logger
  throw new ConfigError('--execute requires the explicit plan/apply phase workflow.', {
    reason: 'UNSUPPORTED_COMBINATION',
  })
}

export function renderUpToDate(packageName: string): void {
  // biome-ignore lint/suspicious/noConsole: intentional output
  const log = console.log
  log()
  const safeName = sanitizeTerminalText(packageName)
  const terminalWidth = getTerminalWidth()
  log(c.cyan.bold(terminalWidth ? fitCell(safeName, terminalWidth) : safeName))
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
