import { canonicalJson } from '../../../contracts/canonical-json'
import {
  type CheckRunCatalogEvidence,
  type CheckRunInsightEvidence,
  type CheckRunOwnerReference,
  copyAndValidateRelationshipSelection,
  RelationshipEvidenceError,
} from '../relationship-evidence'
import type { CheckRunChange, CheckRunSnapshot } from '../run-model'

type SelectedDiff = 'major' | 'minor' | 'patch'

export interface PhysicalDependencyOccurrence {
  readonly operationId: string
  readonly dependencyId: string
  readonly name: string
  readonly sourceFileId: string
  readonly sourcePath: string
  readonly occurrencePath: readonly string[]
  readonly owner: CheckRunOwnerReference
  readonly catalog: CheckRunCatalogEvidence
  readonly current: string
  readonly target: string
  readonly diff: SelectedDiff
  readonly ageMs: number | null
  readonly compatibility: CheckRunInsightEvidence['compatibility']
}

export interface OwnerImpact {
  readonly owner: CheckRunOwnerReference
  readonly operationIds: readonly string[]
  readonly updates: number
  readonly distribution: VisualPlusDistribution
}

export interface SharedDependencySurface {
  readonly dependencyId: string
  readonly name: string
  readonly occurrences: readonly PhysicalDependencyOccurrence[]
}

export interface MajorBlastRadius {
  readonly dependencyId: string
  readonly name: string
  readonly current: string
  readonly target: string
  readonly operationIds: readonly string[]
  readonly owners: readonly CheckRunOwnerReference[]
  readonly occurrences: readonly PhysicalDependencyOccurrence[]
  readonly age:
    | { readonly state: 'known'; readonly ageMs: number }
    | { readonly state: 'unknown' }
    | { readonly state: 'mixed' }
  readonly compatibility: VisualPlusCompatibilityDistribution
}

export interface VisualPlusDistribution {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

export interface VisualPlusCompatibilityDistribution {
  readonly compatible: number
  readonly incompatible: number
  readonly unknown: number
}

export interface VisualPlusInsights {
  readonly topology: {
    readonly packages: number
    readonly declared: number
    readonly eligible: number
    readonly updates: number
    readonly files: number
  }
  readonly distribution: VisualPlusDistribution
  readonly owners: readonly OwnerImpact[]
  readonly shared: readonly SharedDependencySurface[]
  readonly majors: readonly MajorBlastRadius[]
}

export class VisualPlusInsightError extends Error {
  constructor(message: string) {
    super(`Visual+ insights: ${message}`)
  }
}

export function buildVisualPlusInsights(snapshot: CheckRunSnapshot): VisualPlusInsights {
  validateSelectionInventory(snapshot)
  if (snapshot.changes.some((change) => !isSelectedDiff(change.diff))) {
    invalid('selected differences must be major, minor, or patch')
  }

  let insights: readonly CheckRunInsightEvidence[]
  try {
    insights = copyAndValidateRelationshipSelection(snapshot.changes, 'required').map(
      (insight) => insight!,
    )
  } catch (error) {
    if (error instanceof RelationshipEvidenceError) invalid(error.message)
    throw error
  }

  const occurrences = snapshot.changes.map((change, index) =>
    copyOccurrence(change, insights[index]!),
  )
  const distribution = countDistribution(occurrences)
  if (distribution.major + distribution.minor + distribution.patch !== snapshot.counts.operations) {
    invalid('selected distribution does not match operation count')
  }

  return deepFreeze({
    topology: {
      packages: snapshot.counts.packages,
      declared: snapshot.counts.declared,
      eligible: snapshot.counts.eligible,
      updates: snapshot.counts.operations,
      files: snapshot.counts.targets,
    },
    distribution,
    owners: buildOwnerImpact(occurrences),
    shared: buildSharedSurfaces(occurrences),
    majors: buildMajorCards(occurrences),
  })
}

function validateSelectionInventory(snapshot: CheckRunSnapshot): void {
  if (snapshot.changes.length !== snapshot.counts.operations) {
    invalid('selected operation inventory does not match operation count')
  }
  if (snapshot.targets.length !== snapshot.counts.targets) {
    invalid('selected target inventory does not match target count')
  }

  const changesById = new Map<string, CheckRunChange>()
  for (const change of snapshot.changes) {
    if (changesById.has(change.id)) invalid('target membership is inconsistent')
    changesById.set(change.id, change)
  }

  const targetPaths = new Set<string>()
  const memberships = new Set<string>()
  for (const target of snapshot.targets) {
    if (targetPaths.has(target.path) || target.operationIds.length === 0) {
      invalid('target membership is inconsistent')
    }
    targetPaths.add(target.path)
    const targetOperationIds = new Set<string>()
    for (const operationId of target.operationIds) {
      const change = changesById.get(operationId)
      if (
        targetOperationIds.has(operationId) ||
        memberships.has(operationId) ||
        change === undefined ||
        change.owner !== target.path
      ) {
        invalid('target membership is inconsistent')
      }
      targetOperationIds.add(operationId)
      memberships.add(operationId)
    }
  }
  if (memberships.size !== snapshot.changes.length) invalid('target membership is inconsistent')
}

function copyOccurrence(
  change: CheckRunChange,
  insight: CheckRunInsightEvidence,
): PhysicalDependencyOccurrence {
  return {
    operationId: change.id,
    dependencyId: insight.dependencyId,
    name: change.name,
    sourceFileId: insight.sourceFileId,
    sourcePath: insight.sourcePath,
    occurrencePath: [...insight.occurrencePath],
    owner: { ...insight.owner },
    catalog: copyCatalog(insight.catalog),
    current: change.current,
    target: change.target,
    diff: change.diff as SelectedDiff,
    ageMs: insight.ageMs,
    compatibility: { ...insight.compatibility },
  }
}

function copyCatalog(catalog: CheckRunCatalogEvidence): CheckRunCatalogEvidence {
  return catalog.role === 'direct' ? { role: 'direct' } : { ...catalog }
}

function countDistribution(
  occurrences: readonly PhysicalDependencyOccurrence[],
): VisualPlusDistribution {
  const distribution = { major: 0, minor: 0, patch: 0 }
  for (const occurrence of occurrences) distribution[occurrence.diff] += 1
  return distribution
}

function buildOwnerImpact(
  occurrences: readonly PhysicalDependencyOccurrence[],
): readonly OwnerImpact[] {
  const groups = groupBy(occurrences, (occurrence) => occurrence.owner.id)
  return [...groups.values()]
    .map((group) => {
      const ordered = [...group].sort(compareOccurrences)
      return {
        owner: { ...ordered[0]!.owner },
        operationIds: ordered.map((occurrence) => occurrence.operationId),
        updates: ordered.length,
        distribution: countDistribution(ordered),
      }
    })
    .sort(
      (left, right) =>
        left.owner.order - right.owner.order || compareText(left.owner.id, right.owner.id),
    )
}

function buildSharedSurfaces(
  occurrences: readonly PhysicalDependencyOccurrence[],
): readonly SharedDependencySurface[] {
  const groups = groupBy(occurrences, (occurrence) => occurrence.dependencyId)
  const shared: SharedDependencySurface[] = []
  for (const [dependencyId, group] of groups) {
    if (group.length < 2) continue
    const ordered = [...group].sort(compareOccurrences)
    shared.push({ dependencyId, name: ordered[0]!.name, occurrences: ordered })
  }
  return shared.sort(
    (left, right) =>
      compareText(left.dependencyId, right.dependencyId) || compareText(left.name, right.name),
  )
}

function buildMajorCards(
  occurrences: readonly PhysicalDependencyOccurrence[],
): readonly MajorBlastRadius[] {
  const groups = groupBy(
    occurrences.filter((occurrence) => occurrence.diff === 'major'),
    (occurrence) => canonicalJson([occurrence.dependencyId, occurrence.current, occurrence.target]),
  )
  const cards: MajorBlastRadius[] = []
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareOccurrences)
    const first = ordered[0]!
    const ownersById = new Map<string, CheckRunOwnerReference>()
    for (const occurrence of ordered) ownersById.set(occurrence.owner.id, occurrence.owner)
    const owners = [...ownersById.values()]
      .map((owner) => ({ ...owner }))
      .sort((left, right) => left.order - right.order || compareText(left.id, right.id))
    cards.push({
      dependencyId: first.dependencyId,
      name: first.name,
      current: first.current,
      target: first.target,
      operationIds: ordered.map((occurrence) => occurrence.operationId),
      owners,
      occurrences: ordered,
      age: summarizeAge(ordered),
      compatibility: summarizeCompatibility(ordered),
    })
  }
  return cards.sort(
    (left, right) =>
      compareText(left.dependencyId, right.dependencyId) ||
      compareText(left.current, right.current) ||
      compareText(left.target, right.target),
  )
}

function summarizeAge(
  occurrences: readonly PhysicalDependencyOccurrence[],
): MajorBlastRadius['age'] {
  const first = occurrences[0]!.ageMs
  if (occurrences.every((occurrence) => occurrence.ageMs === first)) {
    return first === null ? { state: 'unknown' } : { state: 'known', ageMs: first }
  }
  return { state: 'mixed' }
}

function summarizeCompatibility(
  occurrences: readonly PhysicalDependencyOccurrence[],
): VisualPlusCompatibilityDistribution {
  const distribution = { compatible: 0, incompatible: 0, unknown: 0 }
  for (const occurrence of occurrences) distribution[occurrence.compatibility.status] += 1
  return distribution
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const identity = key(value)
    const group = groups.get(identity)
    if (group) group.push(value)
    else groups.set(identity, [value])
  }
  return groups
}

function compareOccurrences(
  left: PhysicalDependencyOccurrence,
  right: PhysicalDependencyOccurrence,
): number {
  return (
    compareText(left.sourcePath, right.sourcePath) ||
    compareText(canonicalJson(left.occurrencePath), canonicalJson(right.occurrencePath)) ||
    compareText(left.operationId, right.operationId)
  )
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function isSelectedDiff(diff: CheckRunChange['diff']): diff is SelectedDiff {
  return diff === 'major' || diff === 'minor' || diff === 'patch'
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function invalid(message: string): never {
  throw new VisualPlusInsightError(message)
}
