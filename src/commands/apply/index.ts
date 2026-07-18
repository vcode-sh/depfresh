import type { ApplyResult, PlanResult } from '../../contracts/schemas'
import type { InvocationAuthority, RepositoryVcsEvidence } from '../../types'
import { type ApplyExecutionEvidence, applyPlanWithRuntime } from './engine'
import type { ApplyOptions } from './types'

export type { ApplyOptions } from './types'

export async function applyWithExecutionEvidence(
  plan: PlanResult,
  options: ApplyOptions,
  authority: InvocationAuthority,
): Promise<{
  applyResult: ApplyResult
  evidence: ApplyExecutionEvidence[]
  vcsEvidence?: RepositoryVcsEvidence
}> {
  const evidenceByTarget = new Map<string, ApplyExecutionEvidence>()
  let vcsEvidence: RepositoryVcsEvidence | undefined
  const applyResult = await applyPlanWithRuntime(
    plan,
    options,
    authority,
    {},
    (evidence) => {
      evidenceByTarget.set(evidence.targetPath, {
        targetPath: evidence.targetPath,
        operationIds: [...evidence.operationIds],
        replacementAttempted: evidence.replacementAttempted,
      })
    },
    (evidence) => {
      vcsEvidence = evidence
    },
  )
  return {
    applyResult,
    evidence: [...evidenceByTarget.values()],
    ...(vcsEvidence === undefined ? {} : { vcsEvidence }),
  }
}

export async function apply(
  plan: PlanResult,
  options: ApplyOptions,
  authority: InvocationAuthority,
) {
  return applyPlanWithRuntime(plan, options, authority)
}
