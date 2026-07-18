import type { VisualPlusSectionInput } from '../input'
import {
  createVisualPlusTheme,
  visualPlusSectionLines,
  visualPlusSeparator,
  wrapVisualPlusStyledText,
} from '../theme'

export function renderVisualPlusLifecycle(input: VisualPlusSectionInput): readonly string[] {
  const theme = createVisualPlusTheme(input.capabilities)
  const separator = visualPlusSeparator(input.capabilities)
  const lines = [...visualPlusSectionLines(input, ['Lifecycle'])]
  for (const phase of input.snapshot.phases) {
    const logical = `${phase.name}${separator}${theme.status(phase.status)}`
    lines.push(
      ...wrapVisualPlusStyledText(logical, input.capabilities.width, theme, (fragment) =>
        theme.styleStatus(phase.status, fragment),
      ),
    )
  }
  return lines
}
