import c from 'ansis'
import type { ResolvedDepChange } from '../../../types'
import { sanitizeTerminalText } from '../../../utils/format'
import { fitCell, getTerminalWidth } from '../render-layout'
import type { VisualPlusCapabilities } from '../visual-plus/capabilities'
import { createVisualPlusTheme, wrapVisualPlusText } from '../visual-plus/theme'

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
  const messages = safeErrors.map((dep) =>
    sanitizeTerminalText(
      dep.metadataWarning
        ? `Metadata unavailable: ${dep.metadataWarning.message}`
        : (dep.resolutionError?.message ?? 'Failed to resolve from registry'),
    ),
  )
  let nameWidth = terminalWidth ? Math.max(4, ...safeErrors.map((dep) => dep.name.length)) : 0
  let currentWidth = terminalWidth
    ? Math.max(4, ...safeErrors.map((dep) => dep.currentVersion.length))
    : 0
  let messageWidth = terminalWidth ? Math.max(8, ...messages.map((message) => message.length)) : 0

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
      ? fitCell(
          `  ${c.red(errors.every((error) => error.metadataWarning) ? 'metadata warnings' : 'resolution errors')}`,
          terminalWidth,
        )
      : `  ${c.red(errors.every((error) => error.metadataWarning) ? 'metadata warnings' : 'resolution errors')}`,
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

  for (const [index, dep] of safeErrors.entries()) {
    const message = messages[index]!
    const name = terminalWidth ? fitCell(dep.name, nameWidth) : dep.name
    const current = terminalWidth ? fitCell(dep.currentVersion, currentWidth) : dep.currentVersion
    const msg = terminalWidth ? fitCell(message, messageWidth) : message
    log(`    ${name}  ${current}  ${c.red(msg)}`)
  }

  log()
}

export function renderVisualPlusResolutionErrors(
  packageName: string,
  errors: readonly ResolvedDepChange[],
  capabilities: VisualPlusCapabilities,
  write: (chunk: string) => void,
): void {
  if (errors.length === 0) return

  const theme = createVisualPlusTheme(capabilities)
  const groups = new Map<string, string[]>()
  for (const dependency of errors) {
    const message = sanitizeTerminalText(
      dependency.metadataWarning
        ? `Metadata unavailable: ${dependency.metadataWarning.message}`
        : (dependency.resolutionError?.message ?? 'Failed to resolve from registry'),
    )
    const names = groups.get(message) ?? []
    names.push(
      `${sanitizeTerminalText(dependency.name)} ${sanitizeTerminalText(dependency.currentVersion)}`,
    )
    groups.set(message, names)
  }
  const logicalLines = [...groups].map(
    ([message, names]) =>
      `${sanitizeTerminalText(packageName)}: ${names.join(', ')} ${capabilities.unicode ? '—' : '-'} ${message}`,
  )

  for (const logicalLine of logicalLines) {
    for (const line of wrapVisualPlusText(logicalLine, capabilities.width, theme)) {
      write(`${line}\n`)
    }
  }
}
