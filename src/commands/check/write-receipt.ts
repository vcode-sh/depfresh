import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { WriteOutcome, WriteOutcomeReason, WriteOutcomeStatus } from '../../types'
import { summarizeWriteOutcomes } from '../../types'
import { sanitizeTerminalText } from '../../utils/format'
import type { LegacyWriteDiagnostic } from '../apply/legacy'

export type WriteReceiptVerdict = 'complete' | 'partial' | 'safety-block' | 'failed' | 'unknown'
export type WriteReceiptExitCode = 0 | 1 | 2

export interface WriteReceiptExit {
  code: WriteReceiptExitCode
  strictResolutionFailed: boolean
  globalWriteFailed: boolean
  strictPostWriteFailed: boolean
}

export interface WriteReceiptInput {
  outcomes: WriteOutcome[]
  diagnostics: LegacyWriteDiagnostic[]
  cwd: string
  commandEvidence?: CommandWriteReceiptEvidence
}

export interface CommandWriteReceiptEvidence {
  operations: Array<{
    file: string
    path: string[]
    status: WriteOutcomeStatus
    reason: string
    replacementAttempted: boolean
  }>
  recovery: CommandRecoveryEvidence
  cleanupUncertain: boolean
}

interface CommandRecoveryEvidence {
  status: 'not-needed' | 'completed' | 'partial' | 'unknown'
  journalId?: string
  restoredPaths?: string[]
  unrecoveredPaths?: string[]
  externalEffects?: string[]
}

export interface WriteReceiptDetail {
  name: string
  path: string[]
  status: WriteOutcomeStatus
  reason: string
}

export interface WriteReceiptGroup {
  file: string
  status: WriteOutcomeStatus
  reason: string
  diagnostic?: string
  occurrences: number
  replacementAttempted: boolean | null
  details: WriteReceiptDetail[]
}

export interface WriteReceiptFileSummary {
  planned: number
  applied: number
  skipped: number
  blocked: number
  conflicted: number
  reverted: number
  failed: number
  unknown: number
}

export interface WriteReceipt {
  verdict: WriteReceiptVerdict
  operations: ReturnType<typeof summarizeWriteOutcomes>
  files: WriteReceiptFileSummary
  groups: WriteReceiptGroup[]
  noFilesChanged: boolean
}

const PROVEN_NOT_ATTEMPTED_REASONS: ReadonlySet<WriteOutcomeReason> = new Set([
  'NO_CHANGE',
  'EXPECTED_VALUE_MISMATCH',
  'OCCURRENCE_NOT_FOUND',
  'AMBIGUOUS_OCCURRENCE',
  'READ_FAILED',
  'PARSE_FAILED',
  'VCS_UNAVAILABLE',
  'DOWNGRADE_BLOCKED',
  'GLOBAL_TARGET_MISSING',
  'UNSUPPORTED_WRITE_SOURCE',
])

const PROVEN_ATTEMPTED_REASONS: ReadonlySet<WriteOutcomeReason> = new Set([
  'APPLIED',
  'OBSERVATION_FAILED',
  'VERIFICATION_FAILED',
  'RESTORE_FAILED',
  'GLOBAL_OBSERVATION_FAILED',
])

export function buildWriteReceipt(input: WriteReceiptInput): WriteReceipt {
  const receiptOutcomes = reconcileReceiptOutcomes(input)
  const operations = summarizeWriteOutcomes(
    receiptOutcomes.map(({ outcome, status }) => ({ ...outcome, status })),
  )
  const diagnostics = groupDiagnostics(input.diagnostics)
  const groupedOutcomes = new Map<string, WriteReceiptGroup>()
  const outcomesByFile = new Map<string, WriteOutcome[]>()

  for (const receiptOutcome of receiptOutcomes) {
    const { outcome, status, reason } = receiptOutcome
    const target = normalizeTarget(outcome.occurrence.file, input.cwd)
    const fileOutcomes = outcomesByFile.get(target.identity) ?? []
    fileOutcomes.push({ ...outcome, status })
    outcomesByFile.set(target.identity, fileOutcomes)

    if (status === 'applied') continue

    const key = `${target.identity}\u0000${status}\u0000${reason}`
    const detail = sanitizeDetail(receiptOutcome)
    const existing = groupedOutcomes.get(key)
    if (existing) {
      existing.occurrences += 1
      existing.details.push(detail)
      continue
    }

    groupedOutcomes.set(key, {
      file: target.display,
      status,
      reason: sanitizeTerminalText(reason),
      ...(diagnostics.get(target.identity) ? { diagnostic: diagnostics.get(target.identity) } : {}),
      occurrences: 1,
      replacementAttempted: receiptOutcome.replacementAttempted,
      details: [detail],
    })
  }

  const groups = [...groupedOutcomes.values()]
  const files = summarizeFiles(outcomesByFile)
  const blockingGroups = groups.filter((group) => isBlockingStatus(group.status))
  const noFilesChanged =
    operations.applied === 0 &&
    operations.reverted === 0 &&
    blockingGroups.length > 0 &&
    blockingGroups.every((group) => group.replacementAttempted === false) &&
    !hasRecoveryUncertainty(input.commandEvidence, receiptOutcomes)

  return {
    verdict: receiptVerdict(operations, noFilesChanged),
    operations,
    files,
    groups,
    noFilesChanged,
  }
}

export function formatWriteReceipt(receipt: WriteReceipt, exit: WriteReceiptExit): string[] {
  const lines = [formatHeadline(receipt)]
  for (const group of receipt.groups) {
    lines.push(formatGroup(group), formatReason(group))
  }
  lines.push(formatExit(receipt, exit))
  return lines
}

function groupDiagnostics(diagnostics: LegacyWriteDiagnostic[]): Map<string, string> {
  const grouped = new Map<string, string>()
  for (const diagnostic of diagnostics) {
    if (!grouped.has(diagnostic.target.identity)) {
      grouped.set(diagnostic.target.identity, sanitizeTerminalText(diagnostic.code))
    }
  }
  return grouped
}

function normalizeTarget(file: string, cwd: string): { identity: string; display: string } {
  const root = resolve(cwd)
  const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file)
  const path = relative(root, absolute)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    return { identity: absolute, display: '[outside repository]' }
  }
  return { identity: absolute, display: sanitizeTerminalText(path || '.') }
}

interface ReceiptOutcome {
  outcome: WriteOutcome
  status: WriteOutcomeStatus
  reason: string
  replacementAttempted: boolean | null
}

function reconcileReceiptOutcomes(input: WriteReceiptInput): ReceiptOutcome[] {
  if (!input.commandEvidence) {
    return input.outcomes.map((outcome) => ({
      outcome,
      status: outcome.status,
      reason: outcome.reason,
      replacementAttempted: replacementAttempted(outcome),
    }))
  }
  const evidenceByKey = new Map<string, CommandWriteReceiptEvidence['operations'][number]>()
  for (const operation of input.commandEvidence.operations) {
    const target = normalizeTarget(operation.file, input.cwd)
    if (target.display === '[outside repository]' || !safeOccurrencePath(operation.path)) {
      throw new Error('command receipt evidence does not reconcile')
    }
    const key = physicalKey(target.identity, operation.path)
    if (evidenceByKey.has(key)) throw new Error('command receipt evidence does not reconcile')
    evidenceByKey.set(key, operation)
  }
  const matched = new Set<string>()
  const reconciled = input.outcomes.map((outcome) => {
    const target = normalizeTarget(outcome.occurrence.file, input.cwd)
    if (target.display === '[outside repository]' || !safeOccurrencePath(outcome.occurrence.path)) {
      throw new Error('command receipt evidence does not reconcile')
    }
    const key = physicalKey(target.identity, outcome.occurrence.path)
    const evidence = evidenceByKey.get(key)
    if (!evidence) throw new Error('command receipt evidence does not reconcile')
    matched.add(key)
    return {
      outcome,
      status: evidence.status,
      reason: evidence.reason,
      replacementAttempted: evidence.replacementAttempted,
    }
  })
  if (matched.size !== evidenceByKey.size) {
    throw new Error('command receipt evidence does not reconcile')
  }
  return reconciled
}

function safeOccurrencePath(path: readonly string[]): boolean {
  return path.length > 0 && path.every((part) => part.length > 0 && !part.includes('\u0000'))
}

function physicalKey(identity: string, path: readonly string[]): string {
  return `${identity}\u0000${JSON.stringify(path)}`
}

function hasRecoveryUncertainty(
  evidence: CommandWriteReceiptEvidence | undefined,
  outcomes: readonly ReceiptOutcome[],
): boolean {
  if (!evidence) return false
  const { recovery } = evidence
  if (evidence.cleanupUncertain) return true
  const retained =
    recovery.journalId !== undefined ||
    (recovery.restoredPaths?.length ?? 0) > 0 ||
    (recovery.unrecoveredPaths?.length ?? 0) > 0 ||
    (recovery.externalEffects?.length ?? 0) > 0
  if (retained || recovery.status === 'completed' || recovery.status === 'partial') return true
  if (recovery.status !== 'unknown') return false
  const cleanReasons = new Set([
    'VCS_UNAVAILABLE',
    'SOURCE_CHANGED',
    'STAGED_SOURCE_CHANGED',
    'BACKUP_SOURCE_CHANGED',
  ])
  const blocking = outcomes.filter(({ status }) => isBlockingStatus(status))
  return !(
    blocking.length > 0 &&
    blocking.every(
      ({ reason, replacementAttempted }) =>
        replacementAttempted === false && cleanReasons.has(reason),
    )
  )
}

function sanitizeDetail(receipt: ReceiptOutcome): WriteReceiptDetail {
  const { outcome } = receipt
  return {
    name: sanitizeTerminalText(outcome.name),
    path: outcome.occurrence.path.map((part) => sanitizeTerminalText(part)),
    status: receipt.status,
    reason: sanitizeTerminalText(receipt.reason),
  }
}

function replacementAttempted(outcome: WriteOutcome): boolean | null {
  if (outcome.status === 'applied' || outcome.status === 'reverted') return true
  if (PROVEN_NOT_ATTEMPTED_REASONS.has(outcome.reason)) return false
  if (PROVEN_ATTEMPTED_REASONS.has(outcome.reason)) return true
  return null
}

function summarizeFiles(outcomesByFile: Map<string, WriteOutcome[]>): WriteReceiptFileSummary {
  const summary: WriteReceiptFileSummary = {
    planned: outcomesByFile.size,
    applied: 0,
    skipped: 0,
    blocked: 0,
    conflicted: 0,
    reverted: 0,
    failed: 0,
    unknown: 0,
  }

  for (const outcomes of outcomesByFile.values()) {
    const statuses = new Set(outcomes.map((outcome) => outcome.status))
    if (statuses.has('applied')) summary.applied += 1
    if (statuses.has('skipped')) summary.skipped += 1
    if ([...statuses].some(isBlockingStatus)) summary.blocked += 1
    if (statuses.has('conflicted')) summary.conflicted += 1
    if (statuses.has('reverted')) summary.reverted += 1
    if (statuses.has('failed')) summary.failed += 1
    if (statuses.has('unknown')) summary.unknown += 1
  }

  return summary
}

function receiptVerdict(
  operations: ReturnType<typeof summarizeWriteOutcomes>,
  noFilesChanged: boolean,
): WriteReceiptVerdict {
  const incomplete = operations.conflicted + operations.failed + operations.unknown
  if (operations.reverted > 0) return 'partial'
  if (incomplete === 0) return 'complete'
  if (operations.applied > 0) return 'partial'
  if (noFilesChanged) return 'safety-block'
  if (operations.unknown > 0) return 'unknown'
  return 'failed'
}

function isBlockingStatus(status: WriteOutcomeStatus): boolean {
  return status === 'conflicted' || status === 'failed' || status === 'unknown'
}

function formatHeadline(receipt: WriteReceipt): string {
  if (receipt.verdict === 'complete') {
    return `Complete · ${count(receipt.operations.applied, 'update')} applied across ${count(receipt.files.applied, 'file')}`
  }
  if (receipt.verdict === 'partial') {
    const totals = [
      `${count(receipt.operations.applied, 'update')} applied across ${count(receipt.files.applied, 'file')}`,
    ]
    if (receipt.operations.reverted > 0) {
      totals.push(
        `${count(receipt.operations.reverted, 'update')} reverted across ${count(receipt.files.reverted, 'file')}`,
      )
    }
    if (receipt.files.blocked > 0) totals.push(`${count(receipt.files.blocked, 'file')} blocked`)
    return `Partial result · ${totals.join('; ')}`
  }
  if (receipt.verdict === 'safety-block') return 'Safety block · no files were changed'
  if (receipt.verdict === 'unknown') {
    return `Unknown result · ${count(receipt.files.blocked, 'file')} needs inspection`
  }
  return `Write failed · ${count(receipt.files.blocked, 'file')} blocked`
}

function formatGroup(group: WriteReceiptGroup): string {
  const result = group.replacementAttempted === false ? 'not attempted' : group.status
  return `${group.file} · ${count(group.occurrences, 'update')} ${result}`
}

function formatReason(group: WriteReceiptGroup): string {
  const reason = group.diagnostic ? `${group.reason} / ${group.diagnostic}` : group.reason
  if (group.reason === 'VCS_UNAVAILABLE') {
    return `Preflight could not confirm Git state (${reason})`
  }
  return `Write ${group.status} (${reason})`
}

function formatExit(receipt: WriteReceipt, exit: WriteReceiptExit): string {
  if (exit.code === 0) return 'Exit 0'
  const blockingGroups = receipt.groups.filter((group) => isBlockingStatus(group.status))
  const onlyVcsUnavailable =
    blockingGroups.length > 0 && blockingGroups.every((group) => group.reason === 'VCS_UNAVAILABLE')
  const hasNonLocalExitCause =
    exit.strictResolutionFailed || exit.globalWriteFailed || exit.strictPostWriteFailed
  if (hasNonLocalExitCause && receipt.verdict !== 'complete') {
    if (receipt.verdict === 'partial') {
      return `Exit ${exit.code} · review all reported errors and changed files, then correct each blocked target before rerunning`
    }
    return `Exit ${exit.code} · review all reported errors and correct each blocked target before rerunning`
  }
  if (receipt.verdict === 'partial') {
    if (onlyVcsUnavailable) {
      return `Exit ${exit.code} · inspect the changed files, fix the Git evidence problem, then rerun`
    }
    if (blockingGroups.length > 0) {
      return `Exit ${exit.code} · inspect the changed files and correct each blocked target before rerunning`
    }
    return `Exit ${exit.code} · inspect the changed files before rerunning`
  }
  if (receipt.verdict === 'complete') {
    return `Exit ${exit.code} · inspect the errors above before rerunning`
  }
  if (onlyVcsUnavailable) {
    return `Exit ${exit.code} · fix the Git evidence problem, then rerun`
  }
  return `Exit ${exit.code} · inspect and correct each blocked target before rerunning`
}

function count(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`
}
