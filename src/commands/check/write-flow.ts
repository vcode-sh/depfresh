import { ConfigError } from '../../errors'
import type {
  depfreshOptions,
  GlobalApplyResult,
  GlobalItemReason,
  GlobalManagerName,
  InvocationAuthority,
  PackageManagerName,
  PackageMeta,
  ResolvedDepChange,
  WriteOutcome,
  WriteOutcomeSummary,
} from '../../types'
import { summarizeWriteOutcomes } from '../../types'
import type { Logger } from '../../utils/logger'

export {
  applyLegacyCommandWrite,
  type LegacyCommandApplyResult,
  type LegacyCommandSelection,
} from '../apply/legacy-plan'

import { applyLegacyPackageWrite, type LegacyWriteDiagnostic } from '../apply/legacy'

export interface PackageWriteResult extends WriteOutcomeSummary {
  outcomes: WriteOutcome[]
  diagnostics: LegacyWriteDiagnostic[]
  didWrite: boolean
  globalResult?: GlobalApplyResult
}

function resultFromOutcomes(
  outcomes: WriteOutcome[],
  diagnostics: LegacyWriteDiagnostic[] = [],
): PackageWriteResult {
  const summary = summarizeWriteOutcomes(outcomes)
  return { ...summary, outcomes, diagnostics, didWrite: summary.applied > 0 }
}

export async function verifyAndWrite(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  verifyCommand: string,
  logger: Logger,
): Promise<PackageWriteResult> {
  void pkg
  void changes
  void verifyCommand
  void logger
  throw new ConfigError('--verify-command requires the explicit plan/apply phase workflow.', {
    reason: 'UNSUPPORTED_COMBINATION',
  })
}

export async function applyPackageWrite(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  options: depfreshOptions,
  authority: InvocationAuthority,
  logger: Logger,
): Promise<PackageWriteResult> {
  if (changes.length === 0) return resultFromOutcomes([])

  if (!(options.write && authority.write)) {
    throw new ConfigError(
      'Writing requires resolved write intent and explicit invocation authority.',
      {
        reason: 'AUTHORITY_REQUIRED',
      },
    )
  }

  if (options.verifyCommand) {
    if (!authority.verifyCommand) {
      throw new ConfigError('Verification requires explicit invocation authority.', {
        reason: 'AUTHORITY_REQUIRED',
      })
    }
    const result = await verifyAndWrite(pkg, changes, options.verifyCommand, logger)
    logger.info(`  Verify: ${result.applied} applied, ${result.reverted} reverted`)
    return result
  }

  if (pkg.type === 'global') {
    if (!(authority.globalWrite && (options.global || options.globalAll))) {
      throw new ConfigError('Global writes require explicit invocation authority.', {
        reason: 'AUTHORITY_REQUIRED',
      })
    }
    return applyGlobalWrites(pkg, changes, options, authority, logger)
  }

  const result = await applyLegacyPackageWrite(pkg, changes, options.loglevel, authority)
  return resultFromOutcomes(result.outcomes, result.diagnostics)
}

async function applyGlobalWrites(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  options: depfreshOptions,
  authority: InvocationAuthority,
  logger: Logger,
): Promise<PackageWriteResult> {
  const { getGlobalWriteTargets } = await import('../../io/global')
  const { applyGlobalPlan, createGlobalApplyPlan, createGlobalInvocationAuthority } = await import(
    '../global-apply'
  )
  const requests: Array<{
    manager: GlobalManagerName
    name: string
    expectedVersion: string
    targetVersion: string
  }> = []
  const incomplete: WriteOutcome[] = []

  for (const change of changes) {
    const targets = change.globalManager
      ? [change.globalManager]
      : getGlobalWriteTargets(pkg, change.name)
    if (targets.length === 0) {
      incomplete.push(
        globalOutcome(
          change,
          'unknown',
          'GLOBAL_TARGET_MISSING',
          change.rawVersion ?? change.currentVersion,
          'unknown',
        ),
      )
      continue
    }

    for (const manager of targets) {
      if (manager === 'yarn') {
        incomplete.push(
          globalOutcome(change, 'unknown', 'GLOBAL_TARGET_MISSING', change.currentVersion, manager),
        )
        continue
      }
      const expectedValue = getExpectedGlobalVersion(pkg, change.name, manager)
      if (!expectedValue) {
        incomplete.push(globalOutcome(change, 'unknown', 'GLOBAL_OBSERVATION_FAILED', '', manager))
        continue
      }
      requests.push({
        manager,
        name: change.name,
        expectedVersion: expectedValue,
        targetVersion: change.targetVersion,
      })
    }
  }

  const managerNames = [...new Set(requests.map((request) => request.manager))]
  const globalResult =
    requests.length === 0
      ? undefined
      : await applyGlobalPlan(
          await createGlobalApplyPlan(requests, {
            cwd: options.cwd,
            timeoutMs: options.phaseTimeout ?? 120_000,
          }),
          { cwd: options.cwd },
          createGlobalInvocationAuthority(managerNames, {
            globalWrite: authority.globalWrite,
            processExecute: authority.processExecute,
          }),
        )
  const outcomes = [
    ...incomplete,
    ...(globalResult?.items.map((entry) => ({
      name: entry.name,
      occurrence: {
        file: `global:${entry.manager}`,
        path: ['dependencies', entry.name],
      },
      expectedValue: entry.expectedVersion,
      requestedValue: entry.targetVersion,
      ...(entry.observedVersion === undefined ? {} : { observedValue: entry.observedVersion }),
      status: entry.status,
      reason: legacyGlobalReason(entry.reason),
    })) ?? []),
  ] satisfies WriteOutcome[]
  const result = { ...resultFromOutcomes(outcomes), ...(globalResult ? { globalResult } : {}) }
  logger.info(
    `  Global writes: ${result.applied} applied, ${result.skipped} skipped, ${result.failed} failed, ${result.unknown} unknown`,
  )
  return result
}

function legacyGlobalReason(reason: GlobalItemReason): WriteOutcome['reason'] {
  if (reason === 'APPLIED') return 'APPLIED'
  if (reason === 'NO_CHANGE') return 'NO_CHANGE'
  if (reason === 'DOWNGRADE_BLOCKED') return 'DOWNGRADE_BLOCKED'
  if (
    reason === 'EXPECTED_VALUE_MISMATCH' ||
    reason === 'PACKAGE_MISSING' ||
    reason === 'POST_STATE_MISMATCH'
  ) {
    return 'EXPECTED_VALUE_MISMATCH'
  }
  if (
    reason === 'MANAGER_UNAVAILABLE' ||
    reason === 'INVENTORY_MALFORMED' ||
    reason === 'INVENTORY_TIMEOUT' ||
    reason === 'INVENTORY_UNKNOWN' ||
    reason === 'EXECUTABLE_CHANGED' ||
    reason === 'COMMAND_UNOBSERVABLE'
  ) {
    return 'GLOBAL_OBSERVATION_FAILED'
  }
  if (reason === 'INVALID_PACKAGE' || reason === 'INVALID_VERSION') {
    return 'UNSUPPORTED_WRITE_SOURCE'
  }
  return 'WRITE_FAILED'
}

function globalOutcome(
  change: ResolvedDepChange,
  status: WriteOutcome['status'],
  reason: WriteOutcome['reason'],
  expectedValue: string,
  manager: PackageManagerName | 'unknown',
  observedValue?: string,
): WriteOutcome {
  return {
    name: change.name,
    occurrence: { file: `global:${manager}`, path: ['dependencies', change.name] },
    expectedValue,
    requestedValue: change.targetVersion,
    ...(observedValue === undefined ? {} : { observedValue }),
    status,
    reason,
  }
}

function getExpectedGlobalVersion(
  pkg: PackageMeta,
  name: string,
  manager: PackageManagerName,
): string | undefined {
  const raw = pkg.raw as {
    versionsByDependency?: Record<string, Partial<Record<PackageManagerName, string>>>
  }
  return raw.versionsByDependency?.[name]?.[manager]
}
