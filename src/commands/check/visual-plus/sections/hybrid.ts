import { sanitizeTerminalText, visualLength } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import type {
  MajorBlastRadius,
  VisualPlusCompatibilityDistribution,
  VisualPlusInsights,
} from '../insights'
import {
  createVisualPlusTheme,
  formatVisualPlusAge,
  indentVisualPlusLines,
  visualPlusSeparator,
  wrapVisualPlusJoined,
  wrapVisualPlusText,
  wrapVisualPlusWords,
} from '../theme'
import {
  createVisualPlusLedgerRows,
  renderVisualPlusLedger,
  type VisualPlusLedgerRow,
} from './ledger'

export interface VisualPlusMajorRiskTransition {
  readonly current: string
  readonly target: string
  readonly operationIds: readonly string[]
  readonly owners: MajorBlastRadius['owners']
  readonly age: MajorBlastRadius['age']
  readonly compatibility: VisualPlusCompatibilityDistribution
}

export interface VisualPlusMajorRiskGroup {
  readonly dependencyId: string
  readonly name: string
  readonly transitions: readonly VisualPlusMajorRiskTransition[]
}

export class VisualPlusHybridError extends Error {
  constructor(message: string) {
    super(`Visual+ hybrid: ${message}`)
  }
}

export function createVisualPlusMajorRiskGroups(
  insights: VisualPlusInsights,
): readonly VisualPlusMajorRiskGroup[] {
  const groups = new Map<string, VisualPlusMajorRiskGroup>()
  for (const major of insights.majors) {
    const transition: VisualPlusMajorRiskTransition = {
      current: sanitizeTerminalText(major.current),
      target: sanitizeTerminalText(major.target),
      operationIds: [...major.operationIds],
      owners: major.owners.map((owner) => ({ ...owner })),
      age: { ...major.age },
      compatibility: { ...major.compatibility },
    }
    const existing = groups.get(major.dependencyId)
    if (existing) {
      groups.set(major.dependencyId, {
        ...existing,
        transitions: [...existing.transitions, transition],
      })
    } else {
      groups.set(major.dependencyId, {
        dependencyId: major.dependencyId,
        name: sanitizeTerminalText(major.name),
        transitions: [transition],
      })
    }
  }
  return [...groups.values()]
}

export function renderVisualPlusHybridReview(
  input: VisualPlusSectionInput,
  insights: VisualPlusInsights,
): readonly string[] {
  const rows = createVisualPlusLedgerRows(input)
  const riskGroups = createVisualPlusMajorRiskGroups(insights)
  validateInsightMembership(input, insights, rows, riskGroups)
  const theme = createVisualPlusTheme(input.capabilities)
  const width = input.capabilities.width
  const separator = visualPlusSeparator(input.capabilities)
  const context = wrapVisualPlusJoined(
    [
      repositoryContext(input),
      managerContext(input),
      workspaceContext(input),
      input.snapshot.mode,
      input.snapshot.write ? 'write' : 'read-only',
    ],
    separator,
    width,
    theme,
  ).map(theme.heading)
  const topology = insights.topology
  const topologyLines = wrapVisualPlusJoined(
    [
      `${topology.packages} packages`,
      `${topology.declared} declared`,
      `${topology.eligible} eligible`,
      `${topology.updates} updates`,
      `${topology.files} files`,
    ],
    separator,
    width,
    theme,
  )
  const labels = renderSeverityLabels(insights, input)
  const bar = renderSeverityBar(insights, input)
  const risk = renderRiskFocus(input, riskGroups)
  const ledger = renderVisualPlusLedger(input, rows)
  return [...context, ...topologyLines, '', ...labels, bar, '', ...risk, '', ...ledger]
}

function renderSeverityLabels(
  insights: VisualPlusInsights,
  input: VisualPlusSectionInput,
): readonly string[] {
  const theme = createVisualPlusTheme(input.capabilities)
  const separator = visualPlusSeparator(input.capabilities)
  const plain = [
    `Major ${insights.distribution.major}`,
    `Minor ${insights.distribution.minor}`,
    `Patch ${insights.distribution.patch}`,
  ]
  if (visualLength(plain.join(separator)) > input.capabilities.width) {
    return plain.flatMap((line) => wrapVisualPlusText(line, input.capabilities.width, theme))
  }
  return [
    `${theme.severity('major')} ${insights.distribution.major}${separator}${theme.severity('minor')} ${insights.distribution.minor}${separator}${theme.severity('patch')} ${insights.distribution.patch}`,
  ]
}

function renderSeverityBar(insights: VisualPlusInsights, input: VisualPlusSectionInput): string {
  const theme = createVisualPlusTheme(input.capabilities)
  const width = Math.min(40, input.capabilities.width)
  const allocations = proportionalAllocation(
    [insights.distribution.major, insights.distribution.minor, insights.distribution.patch],
    width,
  )
  const token = input.capabilities.unicode ? '█' : '#'
  return `${theme.styleSeverity('major', token.repeat(allocations[0]!))}${theme.styleSeverity('minor', token.repeat(allocations[1]!))}${theme.styleSeverity('patch', token.repeat(allocations[2]!))}`
}

function renderRiskFocus(
  input: VisualPlusSectionInput,
  groups: readonly VisualPlusMajorRiskGroup[],
): readonly string[] {
  const theme = createVisualPlusTheme(input.capabilities)
  const separator = visualPlusSeparator(input.capabilities)
  const width = input.capabilities.width
  const lines = wrapVisualPlusText('Breaking changes', width, theme).map(theme.heading)
  if (groups.length === 0) {
    return [...lines, ...wrapVisualPlusText('No breaking changes', width, theme)]
  }
  const duplicateLabels = duplicateOwnerLabels(input)
  for (const group of groups) {
    lines.push(...wrapVisualPlusWords(group.name, width, theme).map(theme.emphasis))
    for (const transition of group.transitions) {
      const owners = transition.owners.map((owner) =>
        duplicateLabels.has(owner.label)
          ? `${owner.label} (${sanitizeTerminalText(owner.physicalTarget)})`
          : sanitizeTerminalText(owner.label),
      )
      const transitionLines = wrapVisualPlusJoined(
        [
          `${transition.current}${theme.arrow}${transition.target}`,
          ...(input.run.display.timediff ? [formatRiskAge(transition.age)] : []),
          owners.join(', '),
        ],
        separator,
        Math.max(1, width - 2),
        theme,
      )
      lines.push(...indentVisualPlusLines(transitionLines, width, theme))
      if (input.run.display.nodecompat) {
        const compatibility = transition.compatibility
        const compatibilityLines = wrapVisualPlusJoined(
          [
            `${compatibility.compatible} compatible`,
            `${compatibility.incompatible} incompatible`,
            `${compatibility.unknown} unknown`,
          ],
          separator,
          Math.max(1, width - 2),
          theme,
        )
        lines.push(...indentVisualPlusLines(compatibilityLines, width, theme))
      }
    }
  }
  return lines
}

function validateInsightMembership(
  input: VisualPlusSectionInput,
  insights: VisualPlusInsights,
  rows: readonly VisualPlusLedgerRow[],
  groups: readonly VisualPlusMajorRiskGroup[],
): void {
  if (
    insights.topology.packages !== input.snapshot.counts.packages ||
    insights.topology.declared !== input.snapshot.counts.declared ||
    insights.topology.eligible !== input.snapshot.counts.eligible ||
    insights.topology.updates !== input.snapshot.counts.operations ||
    insights.topology.files !== input.snapshot.counts.targets
  ) {
    invalid('topology differs from the selected snapshot')
  }
  const distribution = { major: 0, minor: 0, patch: 0 }
  for (const row of rows) distribution[row.diff] += 1
  if (
    distribution.major !== insights.distribution.major ||
    distribution.minor !== insights.distribution.minor ||
    distribution.patch !== insights.distribution.patch
  ) {
    invalid('distribution differs from ledger membership')
  }
  const majorRows = new Set(
    rows.filter((row) => row.diff === 'major').map((row) => row.operationId),
  )
  const riskOperations = groups.flatMap((group) =>
    group.transitions.flatMap((transition) => transition.operationIds),
  )
  if (
    riskOperations.length !== majorRows.size ||
    new Set(riskOperations).size !== riskOperations.length ||
    riskOperations.some((operationId) => !majorRows.has(operationId))
  ) {
    invalid('major risk membership differs from the ledger')
  }
}

function repositoryContext(input: VisualPlusSectionInput): string {
  const repository = input.run.repository
  if (repository?.name && repository.relativePath && repository.relativePath !== '.') {
    return `${repository.name} (${repository.relativePath})`
  }
  return repository?.name ?? repository?.relativePath ?? 'repository'
}

function managerContext(input: VisualPlusSectionInput): string {
  const manager = input.run.packageManager
  if (manager.status === 'observed') {
    return `${manager.name}${manager.version ? ` ${manager.version}` : ''}`
  }
  if (manager.status === 'ambiguous') return 'manager ambiguous'
  if (manager.status === 'unavailable') return 'manager unavailable'
  return 'manager unknown'
}

function workspaceContext(input: VisualPlusSectionInput): string {
  if (input.run.workspaceScope === 'single-package') return 'single package'
  return input.run.workspaceScope
}

function formatRiskAge(age: VisualPlusMajorRiskTransition['age']): string {
  if (age.state === 'known') return formatVisualPlusAge(age.ageMs)
  return age.state
}

function duplicateOwnerLabels(input: VisualPlusSectionInput): ReadonlySet<string> {
  const owners = new Map<string, Set<string>>()
  for (const metadata of input.changes) {
    const ids = owners.get(metadata.ownerGroup.label)
    if (ids) ids.add(metadata.ownerGroup.id)
    else owners.set(metadata.ownerGroup.label, new Set([metadata.ownerGroup.id]))
  }
  return new Set(
    [...owners].filter(([, identities]) => identities.size > 1).map(([label]) => label),
  )
}

function proportionalAllocation(values: readonly number[], width: number): readonly number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0 || width === 0) return values.map(() => 0)
  const exact = values.map((value) => (value / total) * width)
  const result = exact.map(Math.floor)
  let remaining = width - result.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (const candidate of order) {
    if (remaining === 0) break
    result[candidate.index]! += 1
    remaining -= 1
  }
  return result
}

function invalid(message: string): never {
  throw new VisualPlusHybridError(message)
}
