export const SIGNAL_STATES = ['pass', 'warn', 'fail', 'unknown', 'not-applicable'] as const
export type SignalState = (typeof SIGNAL_STATES)[number]

export const SIGNAL_FAMILIES = [
  'runtime',
  'peer',
  'cohort',
  'release-channel',
  'maturity',
  'current-deprecation',
  'target-deprecation',
  'signature-presence',
  'provenance-presence',
  'evidence-completeness',
  'evidence-staleness',
] as const
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number]

export type SignalPolicyEffect = 'none' | 'warn' | 'block'
export type SignalRuleEffect = Exclude<SignalPolicyEffect, 'none'>
export type SignalPolicySource = 'config' | 'library' | 'cli'

export const SIGNAL_REASONS = [
  'RUNTIME_COMPATIBLE',
  'RUNTIME_PARTIAL_OVERLAP',
  'RUNTIME_INCOMPATIBLE',
  'RUNTIME_UNCONSTRAINED',
  'RUNTIME_EVIDENCE_UNKNOWN',
  'TARGET_ENGINE_UNKNOWN',
  'PEER_COMPATIBLE',
  'PEER_PARTIAL_OVERLAP',
  'PEER_INCOMPATIBLE',
  'PEER_REQUIRED_MISSING',
  'PEER_OPTIONAL_MISSING',
  'PEER_METADATA_ABSENT',
  'PEER_EVIDENCE_UNKNOWN',
  'COHORT_ALIGNED',
  'COHORT_DIVERGED',
  'COHORT_MEMBER_UNKNOWN',
  'COHORT_INFERRED_SUGGESTION',
  'TARGET_STABLE',
  'TARGET_PRERELEASE',
  'TARGET_VERSION_UNKNOWN',
  'MATURITY_POLICY_DISABLED',
  'TARGET_MATURE',
  'TARGET_TOO_NEW',
  'TARGET_TIME_UNKNOWN',
  'CURRENT_NOT_DEPRECATED',
  'CURRENT_DEPRECATED',
  'CURRENT_VERSION_UNKNOWN',
  'CURRENT_DEPRECATION_UNKNOWN',
  'TARGET_NOT_DEPRECATED',
  'TARGET_DEPRECATED',
  'TARGET_DEPRECATION_UNKNOWN',
  'SIGNATURE_PRESENT_UNVERIFIED',
  'SIGNATURE_METADATA_ABSENT',
  'SIGNATURE_METADATA_UNKNOWN',
  'PROVENANCE_PRESENT_UNVERIFIED',
  'PROVENANCE_METADATA_ABSENT',
  'PROVENANCE_METADATA_UNKNOWN',
  'REGISTRY_EVIDENCE_COMPLETE',
  'REGISTRY_EVIDENCE_UNKNOWN',
  'STALENESS_NOT_OBSERVED',
] as const
export type SignalReason = (typeof SIGNAL_REASONS)[number]

export interface CohortInput {
  id: string
  members: string[]
  strategy: 'update-together' | 'same-major' | 'same-version'
}

export interface SignalRuleInput {
  id: string
  selectors: {
    family?: SignalFamily
    state?: SignalState
    reason?: SignalReason
    dependencyName?: string
    workspacePath?: string
    cohortId?: string
  }
  effect: SignalRuleEffect
}

export interface SignalEvidence {
  id: string
  kind:
    | 'repository-runtime'
    | 'registry-version'
    | 'planned-graph'
    | 'explicit-cohort'
    | 'inferred-cohort'
    | 'clock'
  status: 'observed' | 'absent' | 'unknown' | 'conflicting'
  subject: string
  sourceRefs: string[]
  facts: Record<string, string>
}

export interface PlanSignal {
  id: string
  family: SignalFamily
  state: SignalState
  reason: SignalReason
  subject: {
    occurrenceIds: string[]
    dependencyName?: string
    workspacePath?: string
    cohortId?: string
  }
  evidenceRefs: string[]
  effect: SignalPolicyEffect
  matchedRuleIds: string[]
  winningRuleId?: string
  override?: {
    ruleId: string
    source: SignalPolicySource
    from: SignalPolicyEffect
    to: SignalRuleEffect
  }
}

export interface SignalSummary {
  total: number
  pass: number
  warn: number
  fail: number
  unknown: number
  notApplicable: number
  blocking: number
}
