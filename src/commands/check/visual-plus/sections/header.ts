import { sanitizeTerminalText } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import { visualPlusSectionLines, visualPlusSeparator } from '../theme'

export function renderVisualPlusHeader(input: VisualPlusSectionInput): readonly string[] {
  return [...renderVisualPlusCheckHeading(input), ...renderVisualPlusRunContext(input)]
}

export function renderVisualPlusCheckHeading(input: VisualPlusSectionInput): readonly string[] {
  const { snapshot } = input
  const separator = visualPlusSeparator(input.capabilities)
  const logical = [
    `Check${separator}${snapshot.mode}${separator}${snapshot.write ? 'write' : 'read-only'}`,
  ]
  return visualPlusSectionLines(input, logical)
}

export function renderVisualPlusRunContext(input: VisualPlusSectionInput): readonly string[] {
  const { run } = input
  const separator = visualPlusSeparator(input.capabilities)
  const logical: string[] = []
  const repository = [run.repository?.name, run.repository?.relativePath, run.workspaceScope]
    .filter((value): value is string => value !== undefined)
    .map(sanitizeTerminalText)
  logical.push(`Repository ${repository.join(separator)}`)

  const manager = run.packageManager
  if (manager.status === 'observed') {
    logical.push(
      `Package manager observed${separator}${sanitizeTerminalText(manager.name)}${manager.version ? ` ${sanitizeTerminalText(manager.version)}` : ''}${separator}${manager.sources.map(sanitizeTerminalText).join(', ')}`,
    )
  } else if (manager.status === 'ambiguous') {
    logical.push(
      `Package manager ambiguous${separator}${manager.candidates.map((candidate) => `${sanitizeTerminalText(candidate.name)}${candidate.version ? ` ${sanitizeTerminalText(candidate.version)}` : ''}${separator}${sanitizeTerminalText(candidate.source)}`).join(', ')}`,
    )
  } else if (manager.status === 'unavailable') {
    logical.push(
      `Package manager unavailable${manager.sources.length > 0 ? `${separator}${manager.sources.map(sanitizeTerminalText).join(', ')}` : ''}`,
    )
  } else {
    logical.push(`Package manager ${manager.status}`)
  }
  return visualPlusSectionLines(input, logical)
}
