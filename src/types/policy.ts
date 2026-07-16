import type { DepFieldType, RangeMode } from './dependencies'
import type {
  RepositoryDependencyProtocol,
  RepositoryEvidenceStatus,
  RepositoryLockfileManager,
  RepositoryOccurrenceRole,
} from './repository'

export type PolicyAction = 'include' | 'exclude'
export type PolicyMode = Exclude<RangeMode, 'ignore'>
export type PolicyStatus = 'selected' | 'skipped' | 'blocked' | 'unchanged'
export type PolicyCatalogRole = 'direct' | 'owner' | 'consumer'
export type PolicySpecifierStatus = 'locked' | 'range' | 'dynamic' | 'invalid'
export type PolicyCurrentChannel = 'stable' | string
export type PolicyRuleSource = 'defaults' | 'config' | 'library' | 'cli'

export type PolicyReason =
  | 'POLICY_DEFAULT_INCLUDED'
  | 'POLICY_RULE_INCLUDED'
  | 'POLICY_RULE_EXCLUDED'
  | 'POLICY_MANAGER_UNKNOWN'
  | 'POLICY_CANDIDATE_UNCHANGED'

export type PolicyCandidateReason =
  | 'SELECTED'
  | 'CURRENT_VERSION_SELECTED'
  | 'CURRENT_VERSION_INVALID'
  | 'NO_VALID_VERSIONS'
  | 'PRERELEASE_CHANNEL_BLOCKED'
  | 'DIST_TAG_MISSING'
  | 'DIST_TAG_NOT_ELIGIBLE'
  | 'MODE_NO_MATCH'
  | 'DEPRECATED_CANDIDATE_BLOCKED'
  | 'MISSING_PUBLISH_TIME'
  | 'MATURITY_CANDIDATE_BLOCKED'
  | 'DOWNGRADE_BLOCKED'

export interface PolicySelectors {
  dependencyName?: string
  workspacePath?: string
  packageName?: string
  catalogName?: string
  catalogRole?: PolicyCatalogRole
  field?: DepFieldType
  role?: RepositoryOccurrenceRole
  manager?: RepositoryLockfileManager
  protocol?: RepositoryDependencyProtocol
  currentChannel?: string
  specifierStatus?: PolicySpecifierStatus
}

export interface PolicyRuleInput {
  id: string
  selectors: PolicySelectors
  action?: PolicyAction
  mode?: PolicyMode
}

export interface PolicyRuleProvenance {
  source: PolicyRuleSource
  kind: 'default' | 'compatibility' | 'explicit'
  index: number
}

export interface CompiledPolicyRule extends PolicyRuleInput {
  provenance: PolicyRuleProvenance
  dependencyNameSource?: 'occurrence' | 'resolution'
}

export interface CompiledPolicy {
  rules: CompiledPolicyRule[]
}

export interface PolicyInputLayer {
  source: PolicyRuleSource
  mode?: RangeMode
  packageMode?: Record<string, RangeMode>
  include?: string[]
  exclude?: string[]
  policyRules?: PolicyRuleInput[]
}

export interface PolicyOccurrenceContext {
  occurrenceId: string
  dependencyName: string
  resolutionName?: string
  workspacePath?: string
  packageName?: string
  catalogName?: string
  catalogRole: PolicyCatalogRole
  field: string
  role: RepositoryOccurrenceRole
  protocol: RepositoryDependencyProtocol
  currentVersion?: string
  currentChannel?: PolicyCurrentChannel
  specifierStatus: PolicySpecifierStatus
  manager?: RepositoryLockfileManager
  managerEvidenceStatus: RepositoryEvidenceStatus
}

export interface PolicyDecision {
  occurrenceId: string
  status: PolicyStatus
  reason: PolicyReason
  action: PolicyAction
  mode: PolicyMode
  matchedRuleIds: string[]
  indeterminateRuleIds: string[]
  winningActionRuleId?: string
  winningModeRuleId?: string
  candidateReason?: PolicyCandidateReason
}
