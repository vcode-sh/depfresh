import type {
  CompiledPolicy,
  CompiledPolicyRule,
  PolicyAction,
  PolicyCandidateReason,
  PolicyDecision,
  PolicyMode,
  PolicyOccurrenceContext,
} from '../types/policy'
import { patternToRegex } from '../utils/patterns'
import {
  type CompatibilityAction,
  type InternalCompiledPolicyRule,
  type InternalPolicyOccurrenceContext,
  internalCatalogId,
} from './internal-types'

interface PendingIndeterminate {
  ruleId: string
  ruleIndex: number
  action: boolean
  mode: boolean
}

interface ActionCandidate {
  action: PolicyAction
  ruleId?: string
  ruleIndex: number
}

type ExclusionCause = 'global-ignore' | 'package-ignore' | 'include-default' | 'exclude-filter'

export function evaluatePolicy(
  policy: CompiledPolicy,
  context: PolicyOccurrenceContext,
): PolicyDecision {
  let normalAction: ActionCandidate = { action: 'include', ruleIndex: -1 }
  let compatibilityInclude: ActionCandidate | undefined
  const exclusions = new Map<ExclusionCause, ActionCandidate>()
  let mode: PolicyMode = 'default'
  let winningModeRuleId: string | undefined
  let winningModeRuleIndex = -1
  const matchedRuleIds: string[] = []
  const pending: PendingIndeterminate[] = []

  for (const [ruleIndex, rule] of policy.rules.entries()) {
    const match = matchRule(rule, context)
    if (match === 'no-match') continue
    if (match === 'manager-unknown') {
      pending.push({
        ruleId: rule.id,
        ruleIndex,
        action: rule.action !== undefined,
        mode: rule.mode !== undefined,
      })
      continue
    }
    matchedRuleIds.push(rule.id)
    if (rule.action !== undefined) {
      const compatibilityAction = (rule as InternalCompiledPolicyRule).compatibilityAction
      if (compatibilityAction) {
        compatibilityInclude = applyCompatibilityAction(
          compatibilityAction,
          rule,
          ruleIndex,
          exclusions,
          compatibilityInclude,
        )
      } else {
        normalAction = { action: rule.action, ruleId: rule.id, ruleIndex }
      }
    }
    if (rule.mode !== undefined) {
      mode = rule.mode
      winningModeRuleId = rule.id
      winningModeRuleIndex = ruleIndex
    }
  }

  const actionDecision = resolveAction(normalAction, exclusions, compatibilityInclude)
  const indeterminateRuleIds = pending
    .filter(
      (entry) =>
        (entry.action && actionDecision.ruleIndex <= entry.ruleIndex) ||
        (entry.mode && winningModeRuleIndex <= entry.ruleIndex),
    )
    .map((entry) => entry.ruleId)
  const uniqueIndeterminateRuleIds = [...new Set(indeterminateRuleIds)]
  if (uniqueIndeterminateRuleIds.length > 0) {
    return createDecision(context, {
      status: 'blocked',
      reason: 'POLICY_MANAGER_UNKNOWN',
      action: actionDecision.action,
      mode,
      matchedRuleIds,
      indeterminateRuleIds: uniqueIndeterminateRuleIds,
      winningActionRuleId: actionDecision.ruleId,
      winningModeRuleId,
    })
  }
  if (actionDecision.action === 'exclude') {
    return createDecision(context, {
      status: 'skipped',
      reason: 'POLICY_RULE_EXCLUDED',
      action: actionDecision.action,
      mode,
      matchedRuleIds,
      indeterminateRuleIds: uniqueIndeterminateRuleIds,
      winningActionRuleId: actionDecision.ruleId,
      winningModeRuleId,
    })
  }
  return createDecision(context, {
    status: 'selected',
    reason: actionDecision.ruleId ? 'POLICY_RULE_INCLUDED' : 'POLICY_DEFAULT_INCLUDED',
    action: actionDecision.action,
    mode,
    matchedRuleIds,
    indeterminateRuleIds: uniqueIndeterminateRuleIds,
    winningActionRuleId: actionDecision.ruleId,
    winningModeRuleId,
  })
}

function applyCompatibilityAction(
  effect: CompatibilityAction,
  rule: CompiledPolicyRule,
  ruleIndex: number,
  exclusions: Map<ExclusionCause, ActionCandidate>,
  compatibilityInclude: ActionCandidate | undefined,
): ActionCandidate | undefined {
  const exclusion = { action: 'exclude' as const, ruleId: rule.id, ruleIndex }
  const inclusion = { action: 'include' as const, ruleId: rule.id, ruleIndex }
  if (effect === 'global-ignore' || effect === 'package-ignore') {
    exclusions.set(effect, exclusion)
    return compatibilityInclude
  }
  if (effect === 'include-default' || effect === 'exclude-filter') {
    exclusions.set(effect, exclusion)
    return effect === 'include-default' ? undefined : compatibilityInclude
  }
  if (effect === 'clear-global-ignore') {
    return exclusions.delete('global-ignore') ? inclusion : compatibilityInclude
  }
  if (effect === 'clear-any-ignore') {
    const clearedGlobal = exclusions.delete('global-ignore')
    const clearedPackage = exclusions.delete('package-ignore')
    return clearedGlobal || clearedPackage ? inclusion : compatibilityInclude
  }
  if (effect === 'include-match') {
    exclusions.delete('include-default')
    return inclusion
  }
  if (effect === 'include-reset') {
    exclusions.delete('include-default')
    return inclusion
  }
  exclusions.delete('exclude-filter')
  return inclusion
}

function resolveAction(
  normalAction: ActionCandidate,
  exclusions: Map<ExclusionCause, ActionCandidate>,
  compatibilityInclude: ActionCandidate | undefined,
): ActionCandidate {
  let decision = normalAction
  for (const exclusion of exclusions.values()) {
    if (exclusion.ruleIndex > decision.ruleIndex) decision = exclusion
  }
  if (decision.ruleIndex === -1 && compatibilityInclude) return compatibilityInclude
  return decision
}

export function finalizePolicyDecision(
  decision: PolicyDecision,
  candidateReason: PolicyCandidateReason,
): PolicyDecision {
  if (decision.status !== 'selected') return decision
  return {
    ...decision,
    status: 'unchanged',
    reason: 'POLICY_CANDIDATE_UNCHANGED',
    candidateReason,
  }
}

function matchRule(
  rule: CompiledPolicyRule,
  context: PolicyOccurrenceContext,
): 'match' | 'no-match' | 'manager-unknown' {
  if (!matchSelectorsWithoutManager(rule, context)) return 'no-match'
  if (rule.selectors.manager === undefined) return 'match'
  if (context.managerEvidenceStatus !== 'confirmed' || context.manager === undefined) {
    return 'manager-unknown'
  }
  return context.manager === rule.selectors.manager ? 'match' : 'no-match'
}

function matchSelectorsWithoutManager(
  rule: CompiledPolicyRule,
  context: PolicyOccurrenceContext,
): boolean {
  const selectors = rule.selectors
  const internalRule = rule as InternalCompiledPolicyRule
  const internalContext = context as InternalPolicyOccurrenceContext
  return (
    (internalRule[internalCatalogId] === undefined ||
      internalRule[internalCatalogId] === internalContext[internalCatalogId]) &&
    matchPattern(
      selectors.dependencyName,
      rule.dependencyNameSource === 'resolution'
        ? (context.resolutionName ?? context.dependencyName)
        : context.dependencyName,
    ) &&
    matchPattern(selectors.workspacePath, context.workspacePath) &&
    matchPattern(selectors.packageName, context.packageName) &&
    matchPattern(selectors.catalogName, context.catalogName) &&
    matchExact(selectors.catalogRole, context.catalogRole) &&
    matchExact(selectors.field, context.field) &&
    matchExact(selectors.role, context.role) &&
    matchExact(selectors.protocol, context.protocol) &&
    matchExact(selectors.currentChannel, context.currentChannel) &&
    matchExact(selectors.specifierStatus, context.specifierStatus)
  )
}

function matchPattern(expected: string | undefined, actual: string | undefined): boolean {
  if (expected === undefined) return true
  if (actual === undefined) return false
  const regex = patternToRegex(expected)
  regex.lastIndex = 0
  return regex.test(actual)
}

function matchExact(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || expected === actual
}

function createDecision(
  context: PolicyOccurrenceContext,
  value: Omit<PolicyDecision, 'occurrenceId'>,
): PolicyDecision {
  return { occurrenceId: context.occurrenceId, ...value }
}
