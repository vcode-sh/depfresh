import type { VisualPlusCapabilities } from '../capabilities'
import type { VisualPlusInsights } from '../insights'
import { type VisualPlusMapLine, visualPlusMapLines, visualPlusMapSymbols } from '../theme'

export function renderVisualPlusImpact(
  insights: VisualPlusInsights,
  capabilities: VisualPlusCapabilities,
): readonly string[] {
  const { connector, separator } = visualPlusMapSymbols(capabilities)
  const prefix = connector === '' ? '' : `${connector} `
  const logical: VisualPlusMapLine[] = [{ value: 'Owner impact', style: 'heading' }]
  if (insights.owners.length === 0) logical.push({ value: 'No selected owners' })
  for (const impact of insights.owners) {
    logical.push(
      { value: `Owner ID ${impact.owner.id}` },
      { value: `Owner ${impact.owner.label}` },
      { value: `Target ${impact.owner.physicalTarget}` },
      {
        value: `${prefix}Updates ${impact.updates}${separator}Major ${impact.distribution.major}${separator}Minor ${impact.distribution.minor}${separator}Patch ${impact.distribution.patch}`,
      },
    )
  }
  return visualPlusMapLines(capabilities, logical)
}
