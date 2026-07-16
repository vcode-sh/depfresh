import c from 'ansis'
import type { ResolvedDepChange } from '../../../types'
import { sanitizeTerminalText } from '../../../utils/format'
import { fitCell, getTerminalWidth } from '../render-layout'

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

  const safePackageName = sanitizeTerminalText(packageName)
  const safeErrors = errors.map((dep) => ({
    ...dep,
    name: sanitizeTerminalText(dep.name),
    currentVersion: sanitizeTerminalText(dep.currentVersion),
  }))
  const terminalWidth = getTerminalWidth()
  const message = 'Failed to resolve from registry'
  let nameWidth = terminalWidth ? Math.max(4, ...safeErrors.map((dep) => dep.name.length)) : 0
  let currentWidth = terminalWidth
    ? Math.max(4, ...safeErrors.map((dep) => dep.currentVersion.length))
    : 0
  let messageWidth = terminalWidth ? Math.max(8, message.length) : 0

  if (terminalWidth) {
    while (4 + nameWidth + 2 + currentWidth + 2 + messageWidth > terminalWidth) {
      if (messageWidth > 8) {
        messageWidth--
        continue
      }
      if (nameWidth > 4) {
        nameWidth--
        continue
      }
      if (currentWidth > 4) {
        currentWidth--
        continue
      }
      break
    }
  }

  log()
  log(
    terminalWidth
      ? fitCell(c.cyan.bold(safePackageName), terminalWidth)
      : c.cyan.bold(safePackageName),
  )
  log(
    terminalWidth
      ? fitCell(`  ${c.red('resolution errors')}`, terminalWidth)
      : `  ${c.red('resolution errors')}`,
  )
  log(
    terminalWidth
      ? fitCell(`    ${c.gray('name')}  ${c.gray('current')}  ${c.gray('message')}`, terminalWidth)
      : `    ${c.gray('name')}  ${c.gray('current')}  ${c.gray('message')}`,
  )
  log(
    terminalWidth
      ? fitCell(`    ${'-'.repeat(Math.max(0, terminalWidth - 4))}`, terminalWidth)
      : `    ${c.gray('------------------------------------------------------------')}`,
  )

  for (const dep of safeErrors) {
    const name = terminalWidth ? fitCell(dep.name, nameWidth) : dep.name
    const current = terminalWidth ? fitCell(dep.currentVersion, currentWidth) : dep.currentVersion
    const msg = terminalWidth ? fitCell(message, messageWidth) : message
    log(`    ${name}  ${current}  ${c.red(msg)}`)
  }

  log()
}
