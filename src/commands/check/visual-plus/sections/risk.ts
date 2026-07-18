import type { VisualPlusCapabilities } from '../capabilities'
import type { VisualPlusInsights } from '../insights'
import {
  formatVisualPlusAge,
  type VisualPlusMapLine,
  visualPlusMapLines,
  visualPlusMapSymbols,
} from '../theme'

export function renderVisualPlusRisk(
  insights: VisualPlusInsights,
  capabilities: VisualPlusCapabilities,
): readonly string[] {
  const { arrow, connector, separator } = visualPlusMapSymbols(capabilities)
  const prefix = connector === '' ? '' : `${connector} `
  const logical: VisualPlusMapLine[] = [{ value: 'Risk focus', style: 'heading' }]
  if (insights.majors.length === 0) logical.push({ value: 'No major updates' })
  for (const major of insights.majors) {
    logical.push(
      { value: 'Major card' },
      { value: `Dependency ${major.name}` },
      { value: `Transition ${major.current}${arrow}${major.target}` },
      { value: `Occurrences ${major.occurrences.length}` },
      { value: `Age ${formatAge(major.age)}` },
      {
        value: `Compatibility compatible ${major.compatibility.compatible}${separator}incompatible ${major.compatibility.incompatible}${separator}unknown ${major.compatibility.unknown}`,
      },
    )
    for (const owner of major.owners) {
      logical.push(
        { value: `${prefix}Owner ${owner.label}` },
        { value: `${prefix}Target ${owner.physicalTarget}` },
      )
    }
  }
  return visualPlusMapLines(capabilities, logical)
}

function formatAge(age: VisualPlusInsights['majors'][number]['age']): string {
  if (age.state === 'known') return formatVisualPlusAge(age.ageMs)
  return age.state
}
