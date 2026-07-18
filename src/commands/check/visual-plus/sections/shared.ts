import type { VisualPlusCapabilities } from '../capabilities'
import type { VisualPlusInsights } from '../insights'
import { type VisualPlusMapLine, visualPlusMapLines, visualPlusMapSymbols } from '../theme'

export function renderVisualPlusShared(
  insights: VisualPlusInsights,
  capabilities: VisualPlusCapabilities,
): readonly string[] {
  const { connector } = visualPlusMapSymbols(capabilities)
  const prefix = connector === '' ? '' : `${connector} `
  const logical: VisualPlusMapLine[] = [{ value: 'Shared dependencies', style: 'heading' }]
  if (insights.shared.length === 0) logical.push({ value: 'No shared dependencies' })
  for (const surface of insights.shared) {
    logical.push(
      { value: `Dependency ID ${surface.dependencyId}` },
      { value: `Dependency ${surface.name}` },
    )
    for (const occurrence of surface.occurrences) {
      logical.push(
        { value: 'Occurrence' },
        { value: `${prefix}Owner ${occurrence.owner.label}` },
        { value: `${prefix}Source ${occurrence.sourcePath}` },
        { value: `${prefix}Path ${formatOccurrencePath(occurrence.occurrencePath)}` },
      )
    }
  }
  return visualPlusMapLines(capabilities, logical)
}

function formatOccurrencePath(path: readonly string[]): string {
  return path.join(' / ')
}
