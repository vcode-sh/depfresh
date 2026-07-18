import type { VisualPlusCapabilities } from '../capabilities'
import type { VisualPlusInsights } from '../insights'
import { type VisualPlusMapLine, visualPlusMapLines, visualPlusMapSymbols } from '../theme'

export function renderVisualPlusDistribution(
  insights: VisualPlusInsights,
  capabilities: VisualPlusCapabilities,
): readonly string[] {
  const { barEmpty, barFilled, separator } = visualPlusMapSymbols(capabilities)
  const total =
    insights.distribution.major + insights.distribution.minor + insights.distribution.patch
  const logical: VisualPlusMapLine[] = [{ value: 'Distribution', style: 'heading' }]
  for (const [label, value] of [
    ['Major', insights.distribution.major],
    ['Minor', insights.distribution.minor],
    ['Patch', insights.distribution.patch],
  ] as const) {
    const cells = total === 0 || value === 0 ? 0 : Math.max(1, Math.round((value / total) * 10))
    const bar = `${barFilled.repeat(cells)}${barEmpty.repeat(10 - cells)}`
    if (capabilities.layout === 'wide') {
      logical.push({ value: `${label} ${value}${separator}${bar}` })
    } else {
      logical.push({ value: `${label} ${value}` }, { value: `Bar ${bar}` })
    }
  }
  return visualPlusMapLines(capabilities, logical)
}
