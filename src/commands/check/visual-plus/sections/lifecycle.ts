import type { CheckRunPhase } from '../../run-model'
import type { VisualPlusCapabilities } from '../capabilities'
import type { VisualPlusSectionInput } from '../input'
import {
  createVisualPlusTheme,
  visualPlusSectionLines,
  visualPlusSeparator,
  wrapVisualPlusStyledText,
} from '../theme'

export function renderVisualPlusLifecycleHeading(
  capabilities: VisualPlusCapabilities,
): readonly string[] {
  const theme = createVisualPlusTheme(capabilities)
  return wrapVisualPlusStyledText('Lifecycle', capabilities.width, theme, theme.heading)
}

export function renderVisualPlusLifecyclePhase(
  phase: CheckRunPhase,
  capabilities: VisualPlusCapabilities,
): readonly string[] {
  const theme = createVisualPlusTheme(capabilities)
  const separator = visualPlusSeparator(capabilities)
  const logical = `${phase.name}${separator}${theme.status(phase.status)}`
  return wrapVisualPlusStyledText(logical, capabilities.width, theme, (fragment) =>
    theme.styleStatus(phase.status, fragment),
  )
}

export function renderVisualPlusLifecycle(input: VisualPlusSectionInput): readonly string[] {
  const lines = [...visualPlusSectionLines(input, ['Lifecycle'])]
  for (const phase of input.snapshot.phases) {
    lines.push(...renderVisualPlusLifecyclePhase(phase, input.capabilities))
  }
  return lines
}
