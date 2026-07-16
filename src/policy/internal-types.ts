import type { CompiledPolicyRule } from '../types/policy'

export type CompatibilityAction =
  | 'global-ignore'
  | 'package-ignore'
  | 'clear-global-ignore'
  | 'clear-any-ignore'
  | 'include-default'
  | 'include-match'
  | 'include-reset'
  | 'exclude-filter'
  | 'exclude-reset'

export interface InternalCompiledPolicyRule extends CompiledPolicyRule {
  compatibilityAction?: CompatibilityAction
}
