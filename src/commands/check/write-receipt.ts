import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { WriteOutcome, WriteOutcomeReason, WriteOutcomeStatus } from '../../types'
import { summarizeWriteOutcomes } from '../../types'
import { sanitizeTerminalText } from '../../utils/format'
import type { LegacyWriteDiagnostic } from '../apply/legacy'

export type WriteReceiptVerdict = 'complete' | 'partial' | 'safety-block' | 'failed' | 'unknown'
export type WriteReceiptExitCode = 0 | 1 | 2

export interface WriteReceiptInput {
  outcomes: WriteOutcome[]
  diagnostics: LegacyWriteDiagnostic[]
  cwd: string
}

export interface WriteReceiptDetail {
  name: string
  path: string[]
  status: WriteOutcomeStatus
  reason: WriteOutcomeReason
}

export interface WriteReceiptGroup {
  file: string
  status: WriteOutcomeStatus
  reason: WriteOutcomeReason
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
  const operations = summarizeWriteOutcomes(input.outcomes)
  const diagnostics = groupDiagnostics(input.diagnostics, input.cwd)
  const groupedOutcomes = new Map<string, WriteReceiptGroup>()
  const outcomesByFile = new Map<string, WriteOutcome[]>()

  for (const outcome of input.outcomes) {
    const target = normalizeTarget(outcome.occurrence.file, input.cwd)
    const fileOutcomes = outcomesByFile.get(target.identity) ?? []
    fileOutcomes.push(outcome)
    outcomesByFile.set(target.identity, fileOutcomes)

    if (outcome.status === 'applied') continue

    const key = `${target.identity}\u0000${outcome.status}\u0000${outcome.reason}`
    const detail = sanitizeDetail(outcome)
    const existing = groupedOutcomes.get(key)
    if (existing) {
      existing.occurrences += 1
      existing.details.push(detail)
      continue
    }

    groupedOutcomes.set(key, {
      file: target.display,
      status: outcome.status,
      reason: sanitizeTerminalText(outcome.reason) as WriteOutcomeReason,
      ...(diagnostics.get(target.identity) ? { diagnostic: diagnostics.get(target.identity) } : {}),
      occurrences: 1,
      replacementAttempted: replacementAttempted(outcome),
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
    blockingGroups.every((group) => group.replacementAttempted === false)

  return {
    verdict: receiptVerdict(operations, noFilesChanged),
    operations,
    files,
    groups,
    noFilesChanged,
  }
}

export function formatWriteReceipt(
  receipt: WriteReceipt,
  exitCode: WriteReceiptExitCode,
): string[] {
  const lines = [formatHeadline(receipt)]
  for (const group of receipt.groups) {
    lines.push(formatGroup(group), formatReason(group))
  }
  lines.push(formatExit(receipt, exitCode))
  return lines
}

function groupDiagnostics(diagnostics: LegacyWriteDiagnostic[], cwd: string): Map<string, string> {
  const grouped = new Map<string, string>()
  for (const diagnostic of diagnostics) {
    const target = normalizeTarget(diagnostic.path, cwd)
    if (!grouped.has(target.identity)) {
      grouped.set(target.identity, sanitizeTerminalText(diagnostic.code))
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

function sanitizeDetail(outcome: WriteOutcome): WriteReceiptDetail {
  return {
    name: sanitizeTerminalText(outcome.name),
    path: outcome.occurrence.path.map((part) => sanitizeTerminalText(part)),
    status: sanitizeTerminalText(outcome.status) as WriteOutcomeStatus,
    reason: sanitizeTerminalText(outcome.reason) as WriteOutcomeReason,
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

function formatExit(receipt: WriteReceipt, exitCode: WriteReceiptExitCode): string {
  if (exitCode === 0) return 'Exit 0'
  if (receipt.verdict === 'partial') {
    return `Exit ${exitCode} · inspect the changed files before rerunning`
  }
  if (receipt.verdict === 'safety-block') {
    return `Exit ${exitCode} · fix the preflight evidence, then rerun`
  }
  if (receipt.verdict === 'complete') {
    return `Exit ${exitCode} · inspect the errors above before rerunning`
  }
  return `Exit ${exitCode} · inspect the target files before rerunning`
}

function count(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`
}
