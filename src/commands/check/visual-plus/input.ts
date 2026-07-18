import { isAbsolute, win32 } from 'node:path'
import { sanitizeTerminalText } from '../../../utils/format'
import {
  copyAndValidateRelationshipSelection,
  RelationshipEvidenceError,
} from '../relationship-evidence'
import type { CheckRunRecovery, CheckRunSnapshot } from '../run-model'
import type { WriteReceipt } from '../write-receipt'
import type { VisualPlusCapabilities } from './capabilities'

export interface VisualPlusRunMetadata {
  readonly repository?: {
    readonly name?: string
    readonly relativePath?: string
  }
  readonly workspaceScope: 'single-package' | 'workspace' | 'unknown'
  readonly packageManager: VisualPlusPackageManagerMetadata
}

export type VisualPlusPackageManagerMetadata =
  | {
      readonly status: 'observed'
      readonly name: string
      readonly version?: string
      readonly sources: readonly [string, ...string[]]
    }
  | {
      readonly status: 'ambiguous'
      readonly candidates: readonly {
        readonly name: string
        readonly version?: string
        readonly source: string
      }[]
    }
  | {
      readonly status: 'unavailable'
      readonly sources: readonly string[]
    }
  | {
      readonly status: 'unknown'
      readonly sources: readonly []
    }

export interface VisualPlusChangeMetadata {
  readonly operationId: string
  readonly ownerGroup: {
    readonly id: string
    readonly label: string
    readonly order: number
    readonly physicalTarget: string
  }
  readonly ageMs: number | null
  readonly compatibility: {
    readonly status: 'compatible' | 'incompatible' | 'unknown'
    readonly detail?: string
  }
  readonly catalog?: {
    readonly name: string
    readonly sourcePath: string
  }
}

export interface VisualPlusSectionInput {
  readonly snapshot: CheckRunSnapshot
  readonly capabilities: VisualPlusCapabilities
  readonly run: VisualPlusRunMetadata
  readonly changes: readonly VisualPlusChangeMetadata[]
  readonly writeReceipt?: VisualPlusWriteReceiptEvidence
}

export interface VisualPlusWriteReceiptEvidence {
  readonly canonical: DeepReadonly<WriteReceipt>
  readonly operationIds: readonly string[]
  readonly targets: readonly {
    readonly path: string
    readonly operationIds: readonly string[]
  }[]
  readonly recovery: DeepReadonly<CheckRunRecovery>
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly []
    ? readonly []
    : T extends readonly [infer Head, ...infer Tail]
      ? readonly [DeepReadonly<Head>, ...DeepReadonly<Tail>]
      : T extends readonly (infer Item)[]
        ? readonly DeepReadonly<Item>[]
        : T extends object
          ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
          : T

export class VisualPlusInputError extends Error {
  constructor(message: string) {
    super(`Visual+ input: ${message}`)
  }
}

export function createVisualPlusSectionInput(
  source: VisualPlusSectionInput,
): DeepReadonly<VisualPlusSectionInput> {
  const copy = deepCopy(source)
  validateInput(copy)
  return deepFreeze(copy)
}

export function validateVisualPlusSectionInput(input: VisualPlusSectionInput): void {
  validateInput(input)
}

function validateInput(input: VisualPlusSectionInput): void {
  validateCapabilities(input.capabilities)
  validateRunMetadata(input.run)
  validateSnapshotRelationships(input.snapshot)
  const targetsByOperation = validateSnapshotSelection(input.snapshot)
  validateChangeMetadata(input, targetsByOperation)
  if (input.writeReceipt) {
    if (
      input.snapshot.exitCode !== null &&
      input.snapshot.counts.operations > 0 &&
      (input.snapshot.results.operations.length !== input.snapshot.counts.operations ||
        input.snapshot.results.targets.length !== input.snapshot.counts.targets)
    ) {
      invalid('final write receipt requires complete result inventories')
    }
    validateWriteReceipt(input.snapshot, input.writeReceipt)
  }
}

function validateSnapshotRelationships(snapshot: CheckRunSnapshot): void {
  try {
    copyAndValidateRelationshipSelection(snapshot.changes, 'required')
  } catch (error) {
    if (error instanceof RelationshipEvidenceError) invalid(error.message)
    throw error
  }
}

function validateCapabilities(capabilities: VisualPlusCapabilities): void {
  if (!(Number.isInteger(capabilities.width) && capabilities.width >= 1)) {
    invalid('terminal width must be a positive integer')
  }
}

function validateRunMetadata(run: VisualPlusRunMetadata): void {
  if (!['single-package', 'workspace', 'unknown'].includes(run.workspaceScope)) {
    invalid('workspace scope is invalid')
  }
  if (run.repository?.name !== undefined) safeText(run.repository.name, 'repository name')
  if (run.repository?.relativePath !== undefined) {
    safeRepositoryPath(run.repository.relativePath, 'repository path')
  }
  const manager = run.packageManager
  if (manager.status === 'observed') {
    safeText(manager.name, 'observed manager name')
    if (manager.version !== undefined) safeText(manager.version, 'observed manager version')
    if (manager.sources.length === 0) invalid('observed manager requires a source')
    unique(manager.sources, 'observed manager sources')
    for (const source of manager.sources) safeRepositoryPath(source, 'manager source')
    return
  }
  if (manager.status === 'ambiguous') {
    if (manager.candidates.length < 2) invalid('ambiguous manager requires two candidates')
    const identities = manager.candidates.map((candidate) => {
      safeText(candidate.name, 'manager candidate name')
      if (candidate.version !== undefined) safeText(candidate.version, 'manager candidate version')
      safeRepositoryPath(candidate.source, 'manager candidate source')
      return `${candidate.name}\u0000${candidate.version ?? ''}\u0000${candidate.source}`
    })
    unique(identities, 'manager candidates')
    return
  }
  if (manager.status === 'unavailable') {
    unique(manager.sources, 'unavailable manager sources')
    for (const source of manager.sources) safeRepositoryPath(source, 'manager source')
    return
  }
  if (manager.status !== 'unknown' || manager.sources.length !== 0) {
    invalid('unknown manager evidence is contradictory')
  }
}

function validateSnapshotSelection(snapshot: CheckRunSnapshot): Map<string, string> {
  if (snapshot.changes.length !== snapshot.counts.operations) {
    invalid('snapshot changes do not match operation count')
  }
  if (snapshot.targets.length !== snapshot.counts.targets) {
    invalid('snapshot targets do not match target count')
  }
  const changeIds = snapshot.changes.map((change) => {
    safeText(change.id, 'operation ID')
    safeText(change.name, 'dependency name')
    safeRepositoryPath(change.owner, 'change owner')
    safeText(change.current, 'current value')
    safeText(change.target, 'target value')
    return change.id
  })
  unique(changeIds, 'snapshot operation IDs')
  const selectedIds = new Set(changeIds)
  const targetByOperation = new Map<string, string>()
  const targetPaths = snapshot.targets.map((target) => {
    safeRepositoryPath(target.path, 'target path')
    if (target.operationIds.length === 0) invalid('target membership cannot be empty')
    unique(target.operationIds, `operation IDs for ${target.path}`)
    for (const operationId of target.operationIds) {
      if (!selectedIds.has(operationId) || targetByOperation.has(operationId)) {
        invalid('target membership does not reconcile')
      }
      targetByOperation.set(operationId, target.path)
    }
    return target.path
  })
  unique(targetPaths, 'target paths')
  if (targetByOperation.size !== selectedIds.size) invalid('target membership is incomplete')

  validateRecoveryEvidence(snapshot.recovery, new Set(targetPaths))
  validateResultInventory(snapshot)
  return targetByOperation
}

function validateResultInventory(snapshot: CheckRunSnapshot): void {
  const operationResults = snapshot.results.operations
  const targetResults = snapshot.results.targets
  if (operationResults.length !== 0 && operationResults.length !== snapshot.changes.length) {
    invalid('operation result inventory is incomplete')
  }
  if (targetResults.length !== 0 && targetResults.length !== snapshot.targets.length) {
    invalid('target result inventory is incomplete')
  }
  if (operationResults.length > 0) {
    sameOrderedSet(
      operationResults.map((result) => result.operationId),
      snapshot.changes.map((change) => change.id),
      'operation result IDs',
    )
    for (const result of operationResults) validateOperationResult(result)
    if (!sameJson(deriveOperationTotals(operationResults), snapshot.results.totals)) {
      invalid('operation result totals do not reconcile')
    }
  }
  if (targetResults.length > 0) {
    const selected = new Map(snapshot.targets.map((target) => [target.path, target.operationIds]))
    unique(
      targetResults.map((target) => target.path),
      'target result paths',
    )
    for (const result of targetResults) {
      const operationIds = selected.get(result.path)
      if (!(operationIds && sameStrings(operationIds, result.operationIds))) {
        invalid('target results do not reconcile')
      }
      validateTargetResult(result)
      validateTargetOperationCoherence(result, operationResults)
    }
    if (!sameJson(deriveTargetTotals(targetResults), snapshot.results.targetTotals)) {
      invalid('target result totals do not reconcile')
    }
  }
}

function validateOperationResult(result: CheckRunSnapshot['results']['operations'][number]): void {
  const { outcome, blocked, notAttempted, unknown } = result
  if (outcome === 'applied' && (blocked || notAttempted || unknown)) {
    invalid('applied operation has contradictory safety flags')
  }
  if (outcome === 'reverted' && (blocked || notAttempted || unknown)) {
    invalid('reverted operation has contradictory safety flags')
  }
  if (outcome === 'failed' && (blocked || unknown)) {
    invalid('failed operation has contradictory safety flags')
  }
  if (outcome === 'blocked' && !blocked) invalid('blocked operation lacks blocked truth')
  if (outcome === 'not-attempted' && !notAttempted) {
    invalid('not-attempted operation lacks receipt truth')
  }
  if (outcome === 'unknown' && !unknown) invalid('unknown operation lacks unknown truth')
  if (blocked && !notAttempted) invalid('blocked operation was structurally attempted')
}

function validateTargetResult(result: CheckRunSnapshot['results']['targets'][number]): void {
  const { outcome, blocked, notAttempted, unknown } = result
  if (outcome === 'applied' && (blocked || notAttempted || unknown)) {
    invalid('applied target has contradictory safety flags')
  }
  if (outcome === 'blocked' && !blocked) invalid('blocked target lacks blocked truth')
  if (outcome === 'not-attempted' && !notAttempted) {
    invalid('not-attempted target lacks receipt truth')
  }
  if (outcome === 'unknown' && !unknown) invalid('unknown target lacks unknown truth')
  if (blocked && !notAttempted) invalid('blocked target was structurally attempted')
}

function validateTargetOperationCoherence(
  target: CheckRunSnapshot['results']['targets'][number],
  operationResults: CheckRunSnapshot['results']['operations'],
): void {
  const byId = new Map(operationResults.map((operation) => [operation.operationId, operation]))
  const operations = target.operationIds.map((operationId) => byId.get(operationId)!)
  if (
    target.blocked !== operations.some((operation) => operation.blocked) ||
    target.notAttempted !== operations.some((operation) => operation.notAttempted) ||
    target.unknown !== operations.some((operation) => operation.unknown)
  ) {
    invalid('target safety flags differ from operations')
  }
  const outcomes = new Set(operations.map((operation) => operation.outcome))
  const expected = outcomes.size === 1 ? operations[0]!.outcome : 'mixed'
  if (target.outcome !== expected) invalid('target outcome differs from operations')
}

function deriveOperationTotals(
  results: CheckRunSnapshot['results']['operations'],
): CheckRunSnapshot['results']['totals'] {
  return {
    applied: results.filter((result) => result.outcome === 'applied').length,
    skipped: results.filter((result) => result.outcome === 'skipped').length,
    mixed: 0,
    blocked: results.filter((result) => result.blocked).length,
    notAttempted: results.filter((result) => result.notAttempted).length,
    failed: results.filter((result) => result.outcome === 'failed').length,
    reverted: results.filter((result) => result.outcome === 'reverted').length,
    unknown: results.filter((result) => result.unknown).length,
  }
}

function deriveTargetTotals(
  results: CheckRunSnapshot['results']['targets'],
): CheckRunSnapshot['results']['targetTotals'] {
  return {
    applied: results.filter((result) => result.outcome === 'applied').length,
    skipped: results.filter((result) => result.outcome === 'skipped').length,
    mixed: results.filter((result) => result.outcome === 'mixed').length,
    blocked: results.filter((result) => result.blocked).length,
    notAttempted: results.filter((result) => result.notAttempted).length,
    failed: results.filter((result) => result.outcome === 'failed').length,
    reverted: results.filter((result) => result.outcome === 'reverted').length,
    unknown: results.filter((result) => result.unknown).length,
  }
}

function validateChangeMetadata(
  input: VisualPlusSectionInput,
  targetsByOperation: ReadonlyMap<string, string>,
): void {
  const selectedIds = input.snapshot.changes.map((change) => change.id)
  const metadataIds = input.changes.map((metadata) => metadata.operationId)
  sameOrderedSet(metadataIds, selectedIds, 'change metadata IDs')

  const groups = new Map<string, { label: string; order: number; physicalTarget: string }>()
  const orderOwners = new Map<number, string>()
  const insightsByOperation = new Map(
    input.snapshot.changes.map((change) => [change.id, change.insight!] as const),
  )
  for (const metadata of input.changes) {
    safeText(metadata.operationId, 'metadata operation ID')
    const group = metadata.ownerGroup
    safeText(group.id, 'owner group ID')
    safeText(group.label, 'owner group label')
    safeRepositoryPath(group.physicalTarget, 'owner physical target')
    if (!(Number.isInteger(group.order) && group.order >= 0)) invalid('owner order is invalid')
    if (targetsByOperation.get(metadata.operationId) !== group.physicalTarget) {
      invalid('owner physical target does not match selection')
    }
    const existing = groups.get(group.id)
    if (existing) {
      if (
        existing.label !== group.label ||
        existing.order !== group.order ||
        existing.physicalTarget !== group.physicalTarget
      ) {
        invalid('owner group facts are contradictory')
      }
    } else {
      const orderOwner = orderOwners.get(group.order)
      if (orderOwner !== undefined) invalid('owner group order is tied')
      orderOwners.set(group.order, group.id)
      groups.set(group.id, {
        label: group.label,
        order: group.order,
        physicalTarget: group.physicalTarget,
      })
    }
    if (metadata.ageMs !== null) {
      if (
        !(
          Number.isFinite(metadata.ageMs) &&
          Number.isInteger(metadata.ageMs) &&
          metadata.ageMs >= 0
        )
      ) {
        invalid('change age is invalid')
      }
    }
    if (!['compatible', 'incompatible', 'unknown'].includes(metadata.compatibility.status)) {
      invalid('compatibility state is invalid')
    }
    if (metadata.compatibility.detail !== undefined) {
      safeText(metadata.compatibility.detail, 'compatibility detail')
    }
    if (metadata.catalog) {
      safeText(metadata.catalog.name, 'catalog name')
      safeRepositoryPath(metadata.catalog.sourcePath, 'catalog source')
    }
    const insight = insightsByOperation.get(metadata.operationId)
    if (insight) validateMetadataInsightEquality(metadata, insight)
  }
  if (orderOwners.size !== groups.size) invalid('owner group order is incomplete')
  for (let order = 0; order < groups.size; order += 1) {
    if (!orderOwners.has(order)) invalid('owner group order is not contiguous')
  }
}

function validateMetadataInsightEquality(
  metadata: VisualPlusChangeMetadata,
  insight: NonNullable<CheckRunSnapshot['changes'][number]['insight']>,
): void {
  if (
    metadata.ownerGroup.id !== insight.owner.id ||
    metadata.ownerGroup.label !== insight.owner.label ||
    metadata.ownerGroup.order !== insight.owner.order ||
    metadata.ownerGroup.physicalTarget !== insight.owner.physicalTarget ||
    metadata.ageMs !== insight.ageMs ||
    !sameJson(metadata.compatibility, insight.compatibility)
  ) {
    invalid('change metadata differs from insight evidence')
  }
  const expectedCatalog =
    insight.catalog.role === 'direct'
      ? undefined
      : { name: insight.catalog.name, sourcePath: insight.catalog.sourcePath }
  if (!sameJson(metadata.catalog, expectedCatalog)) {
    invalid('change catalog metadata differs from insight evidence')
  }
}

function validateWriteReceipt(
  snapshot: CheckRunSnapshot,
  evidence: VisualPlusWriteReceiptEvidence,
): void {
  if (!snapshot.write) invalid('read-only input cannot carry a write receipt')
  sameOrderedSet(
    evidence.operationIds,
    snapshot.changes.map((change) => change.id),
    'receipt operation IDs',
  )
  if (evidence.targets.length !== snapshot.targets.length) invalid('receipt target count differs')
  for (let index = 0; index < snapshot.targets.length; index += 1) {
    const selected = snapshot.targets[index]
    const supplied = evidence.targets[index]
    if (
      !(
        selected &&
        supplied &&
        selected.path === supplied.path &&
        sameStrings(selected.operationIds, supplied.operationIds)
      )
    ) {
      invalid('receipt target membership differs')
    }
  }
  if (!sameJson(evidence.recovery, snapshot.recovery)) invalid('receipt recovery differs')

  const canonical = evidence.canonical
  const snapshotTotals = snapshot.results.totals
  const pairs: ReadonlyArray<readonly [number, number]> = [
    [canonical.operations.applied, snapshotTotals.applied],
    [canonical.operations.skipped, snapshotTotals.skipped],
    [canonical.operations.conflicted, snapshotTotals.blocked],
    [canonical.operations.reverted, snapshotTotals.reverted],
    [canonical.operations.failed, snapshotTotals.failed],
    [canonical.operations.unknown, snapshotTotals.unknown],
  ]
  if (pairs.some(([left, right]) => left !== right)) invalid('canonical operation totals differ')
  if (
    canonical.operations.planned !== snapshot.counts.operations ||
    canonical.files.planned !== snapshot.counts.targets
  ) {
    invalid('canonical planned totals differ')
  }
  const selectedTargets = new Set(snapshot.targets.map((target) => target.path))
  if (!sameJson(canonical.files, deriveCanonicalFileTotals(snapshot))) {
    invalid('canonical file totals differ')
  }
  for (const group of canonical.groups) {
    safeRepositoryPath(group.file, 'receipt group path')
    if (!selectedTargets.has(group.file)) invalid('receipt group is not a selected target')
    safeText(group.reason, 'receipt reason')
    if (group.diagnostic !== undefined) safeText(group.diagnostic, 'receipt diagnostic')
    if (!(Number.isInteger(group.occurrences) && group.occurrences > 0)) {
      invalid('receipt group occurrence count is invalid')
    }
    for (const detail of group.details) {
      safeText(detail.name, 'receipt detail name')
      safeText(detail.reason, 'receipt detail reason')
      if (detail.path.length === 0) invalid('receipt detail path is empty')
      for (const part of detail.path) safeText(part, 'receipt detail path')
    }
  }
  const expectedVerdict = deriveCanonicalVerdict(canonical)
  if (canonical.verdict !== expectedVerdict) invalid('canonical verdict differs')
  if (canonical.verdict === 'safety-block' && canonical.noFilesChanged !== true) {
    invalid('safety block lacks the canonical zero-file predicate')
  }
  if (canonical.noFilesChanged && canonical.verdict !== 'safety-block') {
    invalid('zero-file predicate contradicts canonical verdict')
  }
  if (canonical.noFilesChanged) validateZeroFileClaim(snapshot, canonical)
}

function deriveCanonicalVerdict(canonical: DeepReadonly<WriteReceipt>): WriteReceipt['verdict'] {
  const incomplete =
    canonical.operations.conflicted + canonical.operations.failed + canonical.operations.unknown
  if (canonical.operations.reverted > 0) return 'partial'
  if (incomplete === 0) return 'complete'
  if (canonical.operations.applied > 0) return 'partial'
  if (canonical.noFilesChanged) return 'safety-block'
  if (canonical.operations.unknown > 0) return 'unknown'
  return 'failed'
}

function deriveCanonicalFileTotals(snapshot: CheckRunSnapshot): WriteReceipt['files'] {
  const operations = new Map(
    snapshot.results.operations.map((operation) => [operation.operationId, operation.outcome]),
  )
  const summary: WriteReceipt['files'] = {
    planned: snapshot.targets.length,
    applied: 0,
    skipped: 0,
    blocked: 0,
    conflicted: 0,
    reverted: 0,
    failed: 0,
    unknown: 0,
  }
  for (const target of snapshot.targets) {
    const statuses = new Set(
      target.operationIds.map((operationId) => {
        const outcome = operations.get(operationId)!
        return outcome === 'blocked' ? 'conflicted' : outcome
      }),
    )
    if (statuses.has('applied')) summary.applied += 1
    if (statuses.has('skipped')) summary.skipped += 1
    if (statuses.has('conflicted') || statuses.has('failed') || statuses.has('unknown')) {
      summary.blocked += 1
    }
    if (statuses.has('conflicted')) summary.conflicted += 1
    if (statuses.has('reverted')) summary.reverted += 1
    if (statuses.has('failed')) summary.failed += 1
    if (statuses.has('unknown')) summary.unknown += 1
  }
  return summary
}

function validateZeroFileClaim(
  snapshot: CheckRunSnapshot,
  canonical: DeepReadonly<WriteReceipt>,
): void {
  if (
    snapshot.results.totals.applied > 0 ||
    snapshot.results.totals.reverted > 0 ||
    snapshot.results.targetTotals.applied > 0 ||
    snapshot.results.targetTotals.reverted > 0 ||
    canonical.operations.applied > 0 ||
    canonical.operations.reverted > 0 ||
    canonical.files.applied > 0 ||
    canonical.files.reverted > 0
  ) {
    invalid('zero-file claim contradicts mutation results')
  }
  if (
    canonical.groups.length === 0 ||
    canonical.groups.some((group) => group.replacementAttempted !== false)
  ) {
    invalid('zero-file claim lacks not-attempted evidence')
  }
  const recovery = snapshot.recovery
  if (
    recovery.executed ||
    recovery.status !== 'not-needed' ||
    recovery.journalId !== undefined ||
    recovery.restoredPaths.length > 0 ||
    recovery.unrecoveredPaths.length > 0 ||
    (recovery.externalEffects?.length ?? 0) > 0
  ) {
    invalid('zero-file claim contradicts recovery evidence')
  }
}

function validateRecoveryEvidence(
  recovery: CheckRunRecovery,
  selectedTargets: ReadonlySet<string>,
): void {
  for (const path of [...recovery.restoredPaths, ...recovery.unrecoveredPaths]) {
    safeRepositoryPath(path, 'recovery path')
    if (!selectedTargets.has(path)) invalid('recovery path is not a selected target')
  }
  unique(recovery.restoredPaths, 'restored paths')
  unique(recovery.unrecoveredPaths, 'unrecovered paths')
  const restored = new Set(recovery.restoredPaths)
  if (recovery.unrecoveredPaths.some((path) => restored.has(path))) {
    invalid('restored and unrecovered paths overlap')
  }
  if (recovery.journalId !== undefined) safeText(recovery.journalId, 'recovery journal ID')
  for (const effect of recovery.externalEffects ?? []) safeText(effect, 'recovery external effect')

  const hasRetainedEvidence =
    recovery.journalId !== undefined ||
    recovery.restoredPaths.length > 0 ||
    recovery.unrecoveredPaths.length > 0 ||
    (recovery.externalEffects?.length ?? 0) > 0
  if ((recovery.status === 'completed' || recovery.status === 'partial') && !recovery.executed) {
    invalid('completed or partial recovery was not executed')
  }
  if (
    recovery.status === 'completed' &&
    (recovery.restoredPaths.length === 0 || recovery.unrecoveredPaths.length > 0)
  ) {
    invalid('completed recovery lacks complete restoration evidence')
  }
  if (recovery.status === 'not-needed' && (recovery.executed || hasRetainedEvidence)) {
    invalid('not-needed recovery has contradictory evidence')
  }
  if (
    recovery.status === 'unknown' &&
    !recovery.executed &&
    (recovery.restoredPaths.length > 0 || recovery.unrecoveredPaths.length > 0)
  ) {
    invalid('non-executed unknown recovery claims changed paths')
  }
}

function safeText(value: string, label: string): void {
  if (sanitizeTerminalText(value).trim().length === 0) invalid(`${label} is empty`)
}

function safeRepositoryPath(value: string, label: string): void {
  if (
    value.length === 0 ||
    sanitizeTerminalText(value) !== value ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\\')
  ) {
    invalid(`${label} is unsafe`)
  }
  if (value === '.') return
  const parts = value.split('/')
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    invalid(`${label} is unsafe`)
  }
}

function sameOrderedSet(left: readonly string[], right: readonly string[], label: string): void {
  unique(left, label)
  if (left.length !== right.length || left.some((value) => !right.includes(value))) {
    invalid(`${label} do not reconcile`)
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`${label} are duplicated`)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function invalid(message: string): never {
  throw new VisualPlusInputError(message)
}

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepCopy(item)]),
    ) as T
  }
  return value
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}
