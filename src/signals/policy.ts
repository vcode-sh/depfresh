import type { PlanSignal, SignalPolicyEffect, SignalPolicySource, SignalRuleInput } from '../types'

export function applySignalPolicy(
  signal: Omit<PlanSignal, 'id' | 'effect' | 'matchedRuleIds' | 'winningRuleId' | 'override'>,
  rules: readonly SignalRuleInput[],
  source: SignalPolicySource,
  explicitCohort: boolean,
  inferred: boolean,
): Omit<PlanSignal, 'id'> {
  const defaultEffect: SignalPolicyEffect = inferred
    ? 'warn'
    : explicitCohort && (signal.state === 'fail' || signal.state === 'unknown')
      ? 'block'
      : signal.state === 'pass' || signal.state === 'not-applicable'
        ? 'none'
        : 'warn'
  if (inferred) return { ...signal, effect: 'warn', matchedRuleIds: [] }
  const matched = rules.filter((rule) => matches(rule, signal))
  const winning = matched.at(-1)
  if (!winning) return { ...signal, effect: defaultEffect, matchedRuleIds: [] }
  return {
    ...signal,
    effect: winning.effect,
    matchedRuleIds: matched.map((rule) => rule.id),
    winningRuleId: winning.id,
    ...(winning.effect === defaultEffect
      ? {}
      : {
          override: {
            ruleId: winning.id,
            source,
            from: defaultEffect,
            to: winning.effect,
          },
        }),
  }
}

function matches(
  rule: SignalRuleInput,
  signal: Omit<PlanSignal, 'id' | 'effect' | 'matchedRuleIds' | 'winningRuleId' | 'override'>,
): boolean {
  const selectors = rule.selectors
  return (
    (selectors.family === undefined || selectors.family === signal.family) &&
    (selectors.state === undefined || selectors.state === signal.state) &&
    (selectors.reason === undefined || selectors.reason === signal.reason) &&
    (selectors.dependencyName === undefined ||
      selectors.dependencyName === signal.subject.dependencyName) &&
    (selectors.workspacePath === undefined ||
      selectors.workspacePath === signal.subject.workspacePath) &&
    (selectors.cohortId === undefined || selectors.cohortId === signal.subject.cohortId)
  )
}
