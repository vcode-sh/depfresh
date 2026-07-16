import type { PlanResult } from '../../contracts/schemas'
import type { InvocationAuthority } from '../../types'
import { applyPlanWithRuntime } from './engine'
import type { ApplyOptions } from './types'

export type { ApplyOptions } from './types'

export async function apply(
  plan: PlanResult,
  options: ApplyOptions,
  authority: InvocationAuthority,
) {
  return applyPlanWithRuntime(plan, options, authority)
}
