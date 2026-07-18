import type { VisualPlusSectionInput } from '../input'
import { visualPlusSectionLines } from '../theme'

export function renderVisualPlusTopology(input: VisualPlusSectionInput): readonly string[] {
  const counts = input.snapshot.counts
  return visualPlusSectionLines(input, [
    'Repository topology',
    `${counts.packages} packages -> ${counts.declared} declared -> ${counts.eligible} eligible -> ${counts.updates} updates -> ${counts.targets} files`,
  ])
}
