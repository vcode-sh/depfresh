export type WriteOutcomeStatus =
  | 'applied'
  | 'skipped'
  | 'conflicted'
  | 'reverted'
  | 'failed'
  | 'unknown'

export type WriteOutcomeReason =
  | 'APPLIED'
  | 'NO_CHANGE'
  | 'EXPECTED_VALUE_MISMATCH'
  | 'OCCURRENCE_NOT_FOUND'
  | 'AMBIGUOUS_OCCURRENCE'
  | 'READ_FAILED'
  | 'PARSE_FAILED'
  | 'WRITE_FAILED'
  | 'OBSERVATION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'RESTORE_FAILED'
  | 'DOWNGRADE_BLOCKED'
  | 'GLOBAL_TARGET_MISSING'
  | 'GLOBAL_OBSERVATION_FAILED'
  | 'UNSUPPORTED_WRITE_SOURCE'

export interface CanonicalOccurrencePath {
  file: string
  path: string[]
}

export interface WriteOutcome {
  name: string
  occurrence: CanonicalOccurrencePath
  expectedValue: string
  requestedValue: string
  observedValue?: string
  status: WriteOutcomeStatus
  reason: WriteOutcomeReason
}

export interface WriteOutcomeSummary {
  planned: number
  applied: number
  skipped: number
  conflicted: number
  reverted: number
  failed: number
  unknown: number
}

export function summarizeWriteOutcomes(outcomes: WriteOutcome[]): WriteOutcomeSummary {
  const count = (status: WriteOutcomeStatus) =>
    outcomes.filter((outcome) => outcome.status === status).length

  return {
    planned: outcomes.length,
    applied: count('applied'),
    skipped: count('skipped'),
    conflicted: count('conflicted'),
    reverted: count('reverted'),
    failed: count('failed'),
    unknown: count('unknown'),
  }
}
