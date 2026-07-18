import { isAbsolute, win32 } from 'node:path'
import { canonicalJson } from '../../contracts/canonical-json'
import { createRepositoryId } from '../../repository/identity'
import { sanitizeTerminalText } from '../../utils/format'

export interface CheckRunOwnerReference {
  readonly id: string
  readonly role: 'manifest' | 'catalog'
  readonly label: string
  readonly path: string
  readonly order: number
  readonly physicalTarget: string
}

export type CheckRunCatalogEvidence =
  | { readonly role: 'direct' }
  | {
      readonly role: 'owner'
      readonly id: string
      readonly manager: 'pnpm' | 'bun' | 'yarn'
      readonly name: string
      readonly sourceFileId: string
      readonly sourcePath: string
    }

export interface CheckRunInsightEvidence {
  readonly dependencyId: string
  readonly rawName: string
  readonly sourceFileId: string
  readonly sourcePath: string
  readonly occurrencePath: readonly string[]
  readonly owner: CheckRunOwnerReference
  readonly catalog: CheckRunCatalogEvidence
  readonly ageMs: number | null
  readonly compatibility: {
    readonly status: 'compatible' | 'incompatible' | 'unknown'
    readonly detail?: string
  }
}

export interface RelationshipEvidenceCandidate {
  readonly operationId: string
  readonly displayName: string
  readonly rawDisplayName?: string
  readonly physicalTarget: string
  readonly displayedAgeMs?: number
  readonly dependencyId: string
  readonly rawName: string
  readonly sourceFileId: string
  readonly sourcePath: string
  readonly occurrencePath: readonly string[]
  readonly owner: Omit<CheckRunOwnerReference, 'order'> & { readonly order?: number }
  readonly catalog: CheckRunCatalogEvidence
  readonly ageMs: number | null
  readonly compatibility: CheckRunInsightEvidence['compatibility']
}

export interface RelationshipSelectionChange {
  readonly id: string
  readonly name: string
  readonly owner: string
  readonly ageMs?: number
  readonly insight?: CheckRunInsightEvidence
}

export class RelationshipEvidenceError extends Error {}

export function catalogOwnerLabel(name: string, sourcePath: string): string {
  return sanitizeTerminalText(name).trim() || sourcePath
}

export function normalizeRelationshipCompatibilityDetail(
  detail: string | undefined,
): string | undefined {
  if (detail === undefined) return undefined
  const normalized = sanitizeTerminalText(detail)
  return normalized.trim().length === 0 ? undefined : normalized
}

export function copyAndValidateRelationshipSelection(
  changes: readonly RelationshipSelectionChange[],
  requirement: 'optional' | 'required',
): readonly (CheckRunInsightEvidence | undefined)[] {
  const supplied = changes.filter((change) => change.insight !== undefined).length
  if (supplied === 0) {
    if (requirement === 'required' && changes.length > 0) {
      invalid('relationship insight inventory is required')
    }
    return changes.map(() => undefined)
  }
  if (supplied !== changes.length) invalid('relationship insight inventory is incomplete')

  return reconcileRelationshipEvidence(
    changes.map((change) => {
      const insight = change.insight!
      return {
        operationId: change.id,
        displayName: change.name,
        physicalTarget: change.owner,
        ...(change.ageMs === undefined ? {} : { displayedAgeMs: change.ageMs }),
        dependencyId: insight.dependencyId,
        rawName: insight.rawName,
        sourceFileId: insight.sourceFileId,
        sourcePath: insight.sourcePath,
        occurrencePath: insight.occurrencePath,
        owner: insight.owner,
        catalog: insight.catalog,
        ageMs: insight.ageMs,
        compatibility: insight.compatibility,
      }
    }),
    { suppliedOwnerOrder: true },
  )
}

export function reconcileRelationshipEvidence(
  candidates: readonly RelationshipEvidenceCandidate[],
  options: { readonly suppliedOwnerOrder: boolean },
): readonly CheckRunInsightEvidence[] {
  const sourcePathsById = new Map<string, string>()
  const sourceIdsByPath = new Map<string, string>()
  const rawNamesById = new Map<string, string>()
  const dependencyIdsByRawName = new Map<string, string>()
  const ownerFactsById = new Map<string, OwnerEntry>()
  const occurrences = new Set<string>()
  const operationIds = new Set<string>()

  const copied = candidates.map((candidate) => {
    safeIdentifier(candidate.operationId, 'operation ID')
    if (operationIds.has(candidate.operationId)) invalid('operation IDs must be unique')
    operationIds.add(candidate.operationId)
    const displayName = sanitizeTerminalText(candidate.rawName)
    if (displayName.trim().length === 0) invalid('dependency display is empty')
    if (candidate.rawDisplayName !== undefined && candidate.rawDisplayName !== candidate.rawName) {
      invalid('dependency raw name is inconsistent')
    }
    if (candidate.displayName !== displayName) invalid('dependency display is inconsistent')
    safeRepositoryPath(candidate.physicalTarget, 'physical target')
    safeIdentifier(candidate.dependencyId, 'dependency identifier')
    safeIdentifier(candidate.sourceFileId, 'source identifier')
    safeRepositoryPath(candidate.sourcePath, 'source path')
    if (candidate.physicalTarget !== candidate.sourcePath) {
      invalid('operation physical target is inconsistent')
    }
    if (candidate.dependencyId !== createRepositoryId('dependency', candidate.rawName)) {
      invalid('dependency identifier is inconsistent')
    }
    if (candidate.sourceFileId !== createRepositoryId('source', candidate.sourcePath)) {
      invalid('source identifier is inconsistent')
    }
    if (!Array.isArray(candidate.occurrencePath) || candidate.occurrencePath.length === 0) {
      invalid('occurrence path cannot be empty')
    }
    if (candidate.occurrencePath.some((part) => typeof part !== 'string')) {
      invalid('occurrence path is invalid')
    }
    validateAge(candidate.ageMs, 'relationship age')
    if (
      candidate.ageMs === null
        ? candidate.displayedAgeMs !== undefined
        : candidate.displayedAgeMs !== candidate.ageMs
    ) {
      invalid('relationship age is inconsistent')
    }
    const owner = copyOwner(candidate.owner, options.suppliedOwnerOrder)
    const catalog = copyCatalog(candidate.catalog)
    const compatibility = copyCompatibility(candidate.compatibility)
    if (owner.physicalTarget !== candidate.sourcePath) {
      invalid('owner physical target is inconsistent')
    }
    validateOwnerCatalog(candidate.sourceFileId, candidate.sourcePath, owner, catalog)
    reconcileBijection(
      sourcePathsById,
      sourceIdsByPath,
      candidate.sourceFileId,
      candidate.sourcePath,
      'source identity',
    )
    reconcileBijection(
      rawNamesById,
      dependencyIdsByRawName,
      candidate.dependencyId,
      candidate.rawName,
      'dependency identity',
    )
    const ownerEntry = {
      owner,
      manager: catalog.role === 'owner' ? catalog.manager : '',
      catalogName: catalog.role === 'owner' ? catalog.name : '',
    }
    const existingOwner = ownerFactsById.get(owner.id)
    if (existingOwner !== undefined && canonicalJson(existingOwner) !== canonicalJson(ownerEntry)) {
      invalid('owner evidence is contradictory')
    }
    ownerFactsById.set(owner.id, ownerEntry)
    const occurrence = canonicalJson([candidate.sourceFileId, candidate.occurrencePath])
    if (occurrences.has(occurrence)) invalid('physical occurrences must be unique')
    occurrences.add(occurrence)
    return {
      dependencyId: candidate.dependencyId,
      rawName: candidate.rawName,
      sourceFileId: candidate.sourceFileId,
      sourcePath: candidate.sourcePath,
      occurrencePath: [...candidate.occurrencePath],
      owner,
      catalog,
      ageMs: candidate.ageMs,
      compatibility,
    }
  })

  const orderedOwners = [...ownerFactsById.values()].sort(compareOwnerEntries)
  if (options.suppliedOwnerOrder) validateSuppliedOwnerOrder(orderedOwners)
  const owners = new Map(
    orderedOwners.map((entry, order) => [entry.owner.id, { ...entry.owner, order }]),
  )
  return copied.map((insight) => ({ ...insight, owner: owners.get(insight.owner.id)! }))
}

interface OwnerEntry {
  readonly owner: Omit<CheckRunOwnerReference, 'order'> & { readonly order?: number }
  readonly manager: string
  readonly catalogName: string
}

function copyOwner(
  owner: RelationshipEvidenceCandidate['owner'],
  suppliedOwnerOrder: boolean,
): RelationshipEvidenceCandidate['owner'] {
  safeIdentifier(owner.id, 'owner identifier')
  if (owner.role !== 'manifest' && owner.role !== 'catalog') invalid('owner role is invalid')
  safeIdentifier(owner.label, 'owner label')
  safeRepositoryPath(owner.path, 'owner path')
  safeRepositoryPath(owner.physicalTarget, 'owner physical target')
  if (suppliedOwnerOrder) validateAge(owner.order ?? -1, 'owner order')
  return { ...owner }
}

function copyCatalog(catalog: CheckRunCatalogEvidence): CheckRunCatalogEvidence {
  if (catalog.role === 'direct') return { role: 'direct' }
  if (catalog.role !== 'owner' || !['pnpm', 'bun', 'yarn'].includes(catalog.manager)) {
    invalid('catalog evidence is invalid')
  }
  safeIdentifier(catalog.id, 'catalog identifier')
  if (typeof catalog.name !== 'string') invalid('catalog name is invalid')
  safeIdentifier(catalog.sourceFileId, 'catalog source identifier')
  safeRepositoryPath(catalog.sourcePath, 'catalog source path')
  return { ...catalog }
}

function copyCompatibility(
  compatibility: CheckRunInsightEvidence['compatibility'],
): CheckRunInsightEvidence['compatibility'] {
  if (!['compatible', 'incompatible', 'unknown'].includes(compatibility.status)) {
    invalid('compatibility state is invalid')
  }
  if (compatibility.detail !== undefined) {
    if (
      sanitizeTerminalText(compatibility.detail) !== compatibility.detail ||
      compatibility.detail.trim().length === 0
    ) {
      invalid('compatibility detail is unsafe')
    }
  }
  return { ...compatibility }
}

function validateOwnerCatalog(
  sourceFileId: string,
  sourcePath: string,
  owner: RelationshipEvidenceCandidate['owner'],
  catalog: CheckRunCatalogEvidence,
): void {
  if (catalog.role === 'direct') {
    if (
      owner.role !== 'manifest' ||
      owner.path !== sourcePath ||
      owner.id !== createRepositoryId('package', owner.path)
    ) {
      invalid('manifest owner evidence is inconsistent')
    }
    return
  }
  if (owner.label !== catalogOwnerLabel(catalog.name, catalog.sourcePath)) {
    invalid('catalog owner label is inconsistent')
  }
  if (
    owner.role !== 'catalog' ||
    owner.id !== catalog.id ||
    owner.path !== catalog.sourcePath ||
    catalog.sourcePath !== sourcePath ||
    catalog.sourceFileId !== sourceFileId ||
    catalog.id !==
      createRepositoryId('catalog', `${catalog.sourcePath}\0${catalog.manager}\0${catalog.name}`)
  ) {
    invalid('catalog owner evidence is inconsistent')
  }
}

function validateSuppliedOwnerOrder(owners: readonly OwnerEntry[]): void {
  const supplied = owners.map((entry) => entry.owner.order)
  if (new Set(supplied).size !== supplied.length) invalid('owner group order is tied')
  for (let order = 0; order < supplied.length; order += 1) {
    if (!supplied.includes(order)) invalid('owner group order is not contiguous')
  }
  if (owners.some((entry, order) => entry.owner.order !== order)) {
    invalid('owner group order is not canonical')
  }
}

function reconcileBijection(
  valueById: Map<string, string>,
  idByValue: Map<string, string>,
  id: string,
  value: string,
  label: string,
): void {
  const existingValue = valueById.get(id)
  const existingId = idByValue.get(value)
  if (
    (existingValue !== undefined && existingValue !== value) ||
    (existingId !== undefined && existingId !== id)
  ) {
    invalid(`${label} is contradictory`)
  }
  valueById.set(id, value)
  idByValue.set(value, id)
}

function compareOwnerEntries(left: OwnerEntry, right: OwnerEntry): number {
  return compareTextTuples(
    [left.owner.path, left.owner.role, left.manager, left.catalogName, left.owner.id],
    [right.owner.path, right.owner.role, right.manager, right.catalogName, right.owner.id],
  )
}

function compareTextTuples(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? ''
    const rightValue = right[index] ?? ''
    if (leftValue < rightValue) return -1
    if (leftValue > rightValue) return 1
  }
  return 0
}

function safeIdentifier(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    sanitizeTerminalText(value) !== value
  ) {
    invalid(`${label} is unsafe`)
  }
}

function safeRepositoryPath(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    sanitizeTerminalText(value) !== value ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\\') ||
    value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    invalid(`${label} is unsafe`)
  }
}

function validateAge(value: number | null, label: string): void {
  if (value !== null && !(Number.isFinite(value) && Number.isInteger(value) && value >= 0)) {
    invalid(`${label} is invalid`)
  }
}

function invalid(message: string): never {
  throw new RelationshipEvidenceError(message)
}
