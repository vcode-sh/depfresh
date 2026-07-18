import { sanitizeTerminalText } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import { visualPlusSectionLines, visualPlusSeparator } from '../theme'

export function renderVisualPlusTransaction(input: VisualPlusSectionInput): readonly string[] {
  const results = new Map(input.snapshot.results.targets.map((result) => [result.path, result]))
  const separator = visualPlusSeparator(input.capabilities)
  const logical = ['Apply transaction']
  for (const target of input.snapshot.targets) {
    const result = results.get(target.path)
    const status = result?.outcome ?? 'pending'
    logical.push(
      `Target ${sanitizeTerminalText(target.path)}${separator}${target.operationIds.length} ${target.operationIds.length === 1 ? 'update' : 'updates'}${separator}${status}`,
      `Operations ${target.operationIds.map(sanitizeTerminalText).join(', ')}`,
    )
  }
  return visualPlusSectionLines(input, logical)
}
