import type { PackageManagerName } from './package'

export type {
  GlobalApplyPlan,
  GlobalApplyResult,
  GlobalApplyStatus,
  GlobalApplySummary,
  GlobalCommandResult,
  GlobalItemReason,
  GlobalItemResult,
  GlobalItemStatus,
  GlobalManagerEvidence,
  GlobalPlanOperation,
} from '../contracts/global-schemas'

export type GlobalManagerName = Extract<PackageManagerName, 'npm' | 'pnpm' | 'bun'>

export type GlobalInventoryStatus =
  | 'confirmed'
  | 'unavailable'
  | 'malformed'
  | 'timeout'
  | 'unknown'
  | 'unsupported'

export interface GlobalInventoryPackage {
  name: string
  version: string
}

export interface GlobalUpdateRequest {
  manager: GlobalManagerName
  name: string
  expectedVersion: string
  targetVersion: string
}

export interface GlobalInvocationAuthority {
  globalWrite: boolean
  processExecute: boolean
  managers: GlobalManagerName[]
}
