import type { ApplyResult, PlanResult } from '../../contracts/schemas'
import type { InvocationAuthority, RepositoryVcsEvidence } from '../../types'
import { type ApplyExecutionEvidence, applyPlanWithRuntime, applyWriteWithRuntime } from './engine'
import type { ApplyOptions, ApplyTargetVcsPolicy, ApplyWriteInput } from './types'

export type { ApplyOptions } from './types'

export async function applyWithExecutionEvidence(
  plan: ApplyWriteInput | PlanResult,
  options: ApplyOptions,
  authority: InvocationAuthority,
  targetVcsPolicy: ApplyTargetVcsPolicy = 'clean',
): Promise<{
  applyResult: ApplyResult
  evidence: ApplyExecutionEvidence[]
  vcsEvidence?: RepositoryVcsEvidence
}> {
  const evidenceByTarget = new Map<string, ApplyExecutionEvidence>()
  let vcsEvidence: RepositoryVcsEvidence | undefined
  const executionOptions = [
    options,
    authority,
    {},
    (evidence: ApplyExecutionEvidence) => {
      evidenceByTarget.set(evidence.targetPath, {
        targetPath: evidence.targetPath,
        operationIds: [...evidence.operationIds],
        replacementAttempted: evidence.replacementAttempted,
      })
    },
    (evidence: RepositoryVcsEvidence) => {
      vcsEvidence = evidence
    },
    targetVcsPolicy,
  ] as const
  const applyResult =
    'repositoryIdentity' in plan
      ? await applyWriteWithRuntime(plan, ...executionOptions)
      : await applyPlanWithRuntime(plan, ...executionOptions)
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
