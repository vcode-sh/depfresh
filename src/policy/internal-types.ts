import type { CompiledPolicyRule, PolicyOccurrenceContext } from '../types/policy'

export const internalCatalogId = Symbol('depfresh.internalCatalogId')

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
  [internalCatalogId]?: string
}

export interface InternalPolicyOccurrenceContext extends PolicyOccurrenceContext {
  [internalCatalogId]?: string
}
