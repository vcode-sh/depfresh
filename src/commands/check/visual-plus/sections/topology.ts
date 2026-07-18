import type { VisualPlusCapabilities } from '../capabilities'
import type { VisualPlusInsights } from '../insights'
import { visualPlusMapLines, visualPlusMapSymbols } from '../theme'

export function renderVisualPlusTopology(
  insights: VisualPlusInsights,
  capabilities: VisualPlusCapabilities,
): readonly string[] {
  const topology = insights.topology
  const { arrow } = visualPlusMapSymbols(capabilities)
  return visualPlusMapLines(capabilities, [
    { value: 'Repository topology', style: 'heading' },
    {
      value: `${topology.packages} packages${arrow}${topology.declared} declared${arrow}${topology.eligible} eligible${arrow}${topology.updates} updates${arrow}${topology.files} files`,
    },
  ])
}
