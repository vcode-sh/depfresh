import type { ApplyResult, PlanResult } from '../../contracts/schemas'
import type { InvocationAuthority } from '../../types'

export interface ApplyOptions {
  cwd: string
}

export type ApplyOperation = PlanResult['operations'][number]
export type ApplyOperationResult = ApplyResult['operations'][number]
export type ApplyPhase = ApplyResult['phases'][number]

export type ApplyCheckpoint =
  | 'after-lock'
  | 'after-stage-write'
  | 'after-stage-fsync'
  | 'after-stage-validation'
  | 'after-backup-fsync'
  | 'after-journal-prepared'
  | 'before-precommit'
  | 'after-precommit'
  | 'before-replace'
  | 'after-replace'
  | 'after-directory-fsync'
  | 'after-journal-replaced'
  | 'before-recover'
  | 'after-recover-rename'
  | 'before-final-observation'

export interface ApplyCheckpointContext {
  file?: string
  index?: number
  source?: string
  target?: string
}

export interface ApplyRuntime {
  checkpoint(name: ApplyCheckpoint, context: ApplyCheckpointContext): void
  rename(source: string, target: string): void
  isProcessAlive(pid: number): 'live' | 'dead' | 'unknown'
  now(): number
  pid: number
  hostname(): string
  randomToken(): string
}

export interface ApplyInvocation {
  plan: PlanResult
  options: ApplyOptions
  authority: InvocationAuthority
}
