import { sanitizeTerminalText } from '../../../../utils/format'
import type { VisualPlusSectionInput } from '../input'
import type { VisualPlusInsights } from '../insights'
import { formatVisualPlusAge, visualPlusMapSymbols, visualPlusSectionLines } from '../theme'

const OWNER_LIMIT = 5
const SHARED_LIMIT = 5
const UPDATE_LIMIT = 8
const TARGET_LIMIT = 8

export function renderVisualPlusCompactReview(
  input: VisualPlusSectionInput,
  insights: VisualPlusInsights,
): readonly string[] {
  const { arrow, separator } = visualPlusMapSymbols(input.capabilities)
  const topology = insights.topology
  const logical: string[] = [
    'Repository topology',
    `${topology.packages} packages${arrow}${topology.declared} declared${arrow}${topology.eligible} eligible${arrow}${topology.updates} updates${arrow}${topology.files} files`,
    'Distribution',
    `Major ${insights.distribution.major}${separator}Minor ${insights.distribution.minor}${separator}Patch ${insights.distribution.patch}`,
    'Risk focus',
  ]

  if (insights.majors.length === 0) logical.push('No major updates')
  for (const major of insights.majors) {
    logical.push(
      `Major card ${sanitizeTerminalText(major.name)}`,
      `${sanitizeTerminalText(major.current)}${arrow}${sanitizeTerminalText(major.target)}${separator}${major.occurrences.length} ${major.occurrences.length === 1 ? 'occurrence' : 'occurrences'}`,
      `${major.owners.length} ${major.owners.length === 1 ? 'owner' : 'owners'}${separator}${formatCompactAge(major.age)}${separator}compat ${major.compatibility.compatible}/${major.compatibility.incompatible}/${major.compatibility.unknown}`,
    )
  }

  logical.push('Owner impact')
  const owners = [...insights.owners].sort(
    (left, right) =>
      right.updates - left.updates ||
      left.owner.order - right.owner.order ||
      compareText(left.owner.id, right.owner.id),
  )
  for (const impact of owners.slice(0, OWNER_LIMIT)) {
    logical.push(
      `Owner ${sanitizeTerminalText(impact.owner.label)}${separator}${impact.updates} updates`,
    )
  }
  appendOmitted(logical, owners.length, OWNER_LIMIT, 'owners', input)

  logical.push('Shared dependencies')
  const shared = insights.shared
    .map((surface, index) => ({ surface, index }))
    .sort(
      (left, right) =>
        right.surface.occurrences.length - left.surface.occurrences.length ||
        left.index - right.index,
    )
  for (const { surface } of shared.slice(0, SHARED_LIMIT)) {
    logical.push(
      `Shared ${sanitizeTerminalText(surface.name)}${separator}${surface.occurrences.length} occurrences`,
    )
  }
  appendOmitted(logical, shared.length, SHARED_LIMIT, 'shared dependencies', input)

  logical.push('Update preview')
  const metadataById = new Map(input.changes.map((metadata) => [metadata.operationId, metadata]))
  const updates = [...input.snapshot.changes].sort((left, right) => {
    const leftMetadata = metadataById.get(left.id)!
    const rightMetadata = metadataById.get(right.id)!
    return (
      diffOrder(left.diff) - diffOrder(right.diff) ||
      leftMetadata.ownerGroup.order - rightMetadata.ownerGroup.order ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id)
    )
  })
  for (const change of updates.slice(0, UPDATE_LIMIT)) {
    const owner = metadataById.get(change.id)!.ownerGroup
    logical.push(
      `Update ${capitalize(change.diff)} ${sanitizeTerminalText(change.name)}${separator}${sanitizeTerminalText(owner.label)}`,
    )
  }
  appendOmitted(logical, updates.length, UPDATE_LIMIT, 'updates', input)
  if (input.snapshot.counts.operations > 0) {
    logical.push('Details: rerun with --long for the complete audit.')
  }
  return visualPlusSectionLines(input, logical)
}

export function renderVisualPlusCompactTransaction(
  input: VisualPlusSectionInput,
): readonly string[] {
  const { separator } = visualPlusMapSymbols(input.capabilities)
  const results = new Map(input.snapshot.results.targets.map((result) => [result.path, result]))
  const recovery = input.snapshot.recovery
  const restored = new Set(recovery.restoredPaths)
  const unrecovered = new Set(recovery.unrecoveredPaths)
  const requiresDetail = (path: string): boolean => {
    const result = results.get(path)
    const ordinaryReadOnlyResult =
      !input.snapshot.write &&
      result?.outcome === 'not-attempted' &&
      result.blocked === false &&
      result.notAttempted === true &&
      result.unknown === false
    if (ordinaryReadOnlyResult) return restored.has(path) || unrecovered.has(path)
    return (
      restored.has(path) ||
      unrecovered.has(path) ||
      result?.blocked === true ||
      result?.notAttempted === true ||
      result?.unknown === true ||
      (result !== undefined && result.outcome !== 'applied' && result.outcome !== 'skipped')
    )
  }
  const bounded = input.snapshot.targets
    .filter((target) => !requiresDetail(target.path))
    .slice(0, TARGET_LIMIT)
  const boundedPaths = new Set(bounded.map((target) => target.path))
  const selected = input.snapshot.targets.filter(
    (target) => boundedPaths.has(target.path) || requiresDetail(target.path),
  )
  const logical = [input.snapshot.write ? 'Apply transaction' : 'Reviewed physical targets']
  for (const target of selected) {
    const path = sanitizeTerminalText(target.path)
    if (!requiresDetail(target.path)) {
      logical.push(path)
      continue
    }
    const result = results.get(target.path)
    const recoveryStatus = restored.has(target.path)
      ? `${separator}restored`
      : unrecovered.has(target.path)
        ? `${separator}unrecovered`
        : ''
    const safetyStatus = result
      ? `${separator}blocked ${result.blocked}${separator}not attempted ${result.notAttempted}${separator}unknown ${result.unknown}`
      : ''
    logical.push(
      `Target ${path}${separator}${target.operationIds.length} ${target.operationIds.length === 1 ? 'update' : 'updates'}${separator}${result?.outcome ?? 'pending'}${safetyStatus}${recoveryStatus}`,
    )
  }
  appendOmitted(logical, input.snapshot.targets.length, selected.length, 'targets', input)
  return visualPlusSectionLines(input, logical)
}

function appendOmitted(
  lines: string[],
  total: number,
  shown: number,
  items: string,
  input: VisualPlusSectionInput,
): void {
  const omitted = total - Math.min(total, shown)
  if (omitted <= 0) return
  const ellipsis =
    input.capabilities.layout === 'plain' || !input.capabilities.unicode ? '...' : '…'
  lines.push(`${ellipsis} ${omitted} more ${items}`)
}

function formatCompactAge(age: VisualPlusInsights['majors'][number]['age']): string {
  if (age.state === 'known') return formatVisualPlusAge(age.ageMs)
  return age.state
}

function diffOrder(diff: string): number {
  if (diff === 'major') return 0
  if (diff === 'minor') return 1
  return 2
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
