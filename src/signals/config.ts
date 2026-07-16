import { isContractSafeText } from '../contracts/sanitize'
import { ConfigError } from '../errors'
import type { CohortInput, SignalRuleInput } from '../types'
import { SIGNAL_FAMILIES, SIGNAL_REASONS, SIGNAL_STATES } from '../types'
import { isValidPackageName } from '../utils/package-name'

const COHORT_KEYS = new Set(['id', 'members', 'strategy'])
const RULE_KEYS = new Set(['id', 'selectors', 'effect'])
const SELECTOR_KEYS = new Set([
  'family',
  'state',
  'reason',
  'dependencyName',
  'workspacePath',
  'cohortId',
])
const RELATIVE_WORKSPACE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u

export function validateSignalConfiguration(
  cohorts: CohortInput[] | undefined,
  rules: SignalRuleInput[] | undefined,
): void {
  if (cohorts !== undefined) validateCohorts(cohorts)
  if (rules !== undefined) validateRules(rules, new Set((cohorts ?? []).map((cohort) => cohort.id)))
}

function validateCohorts(cohorts: CohortInput[]): void {
  if (!Array.isArray(cohorts)) invalid('cohorts must be an array')
  const ids = new Set<string>()
  for (const cohort of cohorts) {
    if (!isRecord(cohort) || Object.keys(cohort).some((key) => !COHORT_KEYS.has(key))) {
      invalid('cohorts contain an unknown field')
    }
    if (!safeId(cohort.id) || ids.has(cohort.id)) invalid('cohort ids must be unique public text')
    ids.add(cohort.id)
    if (
      !Array.isArray(cohort.members) ||
      cohort.members.length < 2 ||
      cohort.members.some((member) => !(safeId(member) && isValidPackageName(member))) ||
      new Set(cohort.members).size !== cohort.members.length
    ) {
      invalid('cohort members must contain at least two unique public package names')
    }
    if (!['update-together', 'same-major', 'same-version'].includes(cohort.strategy)) {
      invalid('cohort strategy is invalid')
    }
  }
}

function validateRules(rules: SignalRuleInput[], cohortIds: Set<string>): void {
  if (!Array.isArray(rules)) invalid('signalRules must be an array')
  const ids = new Set<string>()
  for (const rule of rules) {
    if (!isRecord(rule) || Object.keys(rule).some((key) => !RULE_KEYS.has(key))) {
      invalid('signalRules contain an unknown field')
    }
    if (!safeId(rule.id) || ids.has(rule.id)) invalid('signal rule ids must be unique public text')
    ids.add(rule.id)
    if (!isRecord(rule.selectors)) invalid('signal rule selectors must be an object')
    if (Object.keys(rule.selectors).some((key) => !SELECTOR_KEYS.has(key))) {
      invalid('signal rule selectors contain an unknown field')
    }
    if (Object.keys(rule.selectors).length === 0) invalid('signal rule selectors cannot be empty')
    if (rule.effect !== 'warn' && rule.effect !== 'block') invalid('signal rule effect is invalid')
    const selectors = rule.selectors
    if (selectors.family && !SIGNAL_FAMILIES.includes(selectors.family))
      invalid('signal family is invalid')
    if (selectors.state && !SIGNAL_STATES.includes(selectors.state))
      invalid('signal state is invalid')
    if (selectors.reason && !SIGNAL_REASONS.includes(selectors.reason))
      invalid('signal reason is invalid')
    if (selectors.dependencyName !== undefined && !isValidPackageName(selectors.dependencyName)) {
      invalid('signal dependency selector must be a public package name')
    }
    if (
      selectors.workspacePath !== undefined &&
      !RELATIVE_WORKSPACE_PATH.test(selectors.workspacePath)
    ) {
      invalid('signal workspace selector must be repository-relative')
    }
    for (const value of [selectors.dependencyName, selectors.workspacePath, selectors.cohortId]) {
      if (value !== undefined && !safeId(value)) invalid('signal selector text must be public')
    }
    if (selectors.cohortId && !cohortIds.has(selectors.cohortId)) {
      invalid('signal rule references an unknown explicit cohort')
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && isContractSafeText(value)
}

function invalid(detail: string): never {
  throw new ConfigError(`Invalid compatibility signal configuration: ${detail}.`, {
    reason: 'INVALID_CONFIG',
  })
}
