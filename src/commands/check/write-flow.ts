import * as semver from 'semver'
import { ConfigError } from '../../errors'
import type {
  depfreshOptions,
  InvocationAuthority,
  PackageManagerName,
  PackageMeta,
  ResolvedDepChange,
  WriteOutcome,
  WriteOutcomeSummary,
} from '../../types'
import { summarizeWriteOutcomes } from '../../types'
import type { Logger } from '../../utils/logger'
import { applyLegacyPackageWrite } from '../apply/legacy'

export interface PackageWriteResult extends WriteOutcomeSummary {
  outcomes: WriteOutcome[]
  didWrite: boolean
}

function resultFromOutcomes(outcomes: WriteOutcome[]): PackageWriteResult {
  const summary = summarizeWriteOutcomes(outcomes)
  return { ...summary, outcomes, didWrite: summary.applied > 0 }
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
    return applyGlobalWrites(pkg, changes, logger)
  }

  return resultFromOutcomes(
    await applyLegacyPackageWrite(pkg, changes, options.loglevel, authority),
  )
}

async function applyGlobalWrites(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  logger: Logger,
): Promise<PackageWriteResult> {
  const { getGlobalWriteTargets, observeGlobalPackageVersion, writeGlobalPackage } = await import(
    '../../io/global'
  )
  const outcomes: WriteOutcome[] = []

  for (const change of changes) {
    const targets = getGlobalWriteTargets(pkg, change.name)
    if (targets.length === 0) {
      outcomes.push(
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
      const expectedValue =
        getExpectedGlobalVersion(pkg, change.name, manager) ??
        change.rawVersion ??
        change.currentVersion
      const before = observeGlobalPackageVersion(manager, change.name)
      if (!before.known) {
        outcomes.push(
          globalOutcome(change, 'unknown', 'GLOBAL_OBSERVATION_FAILED', expectedValue, manager),
        )
        continue
      }
      if (before.version === undefined) {
        outcomes.push(
          globalOutcome(change, 'conflicted', 'EXPECTED_VALUE_MISMATCH', expectedValue, manager),
        )
        continue
      }
      if (before.version !== expectedValue) {
        outcomes.push(
          globalOutcome(
            change,
            'conflicted',
            'EXPECTED_VALUE_MISMATCH',
            expectedValue,
            manager,
            before.version,
          ),
        )
        continue
      }
      if (isDowngrade(before.version, change.targetVersion)) {
        outcomes.push(
          globalOutcome(
            change,
            'skipped',
            'DOWNGRADE_BLOCKED',
            expectedValue,
            manager,
            before.version,
          ),
        )
        continue
      }
      if (before.version === change.targetVersion) {
        outcomes.push(
          globalOutcome(change, 'skipped', 'NO_CHANGE', expectedValue, manager, before.version),
        )
        continue
      }

      try {
        if (writeGlobalPackage(manager, change.name, change.targetVersion) === false) {
          outcomes.push(
            globalOutcome(change, 'failed', 'WRITE_FAILED', expectedValue, manager, before.version),
          )
          continue
        }
      } catch {
        const afterFailure = observeGlobalPackageVersion(manager, change.name)
        outcomes.push(
          !afterFailure.known
            ? globalOutcome(change, 'unknown', 'GLOBAL_OBSERVATION_FAILED', expectedValue, manager)
            : afterFailure.version === change.targetVersion
              ? globalOutcome(
                  change,
                  'applied',
                  'APPLIED',
                  expectedValue,
                  manager,
                  afterFailure.version,
                )
              : globalOutcome(
                  change,
                  'failed',
                  'WRITE_FAILED',
                  expectedValue,
                  manager,
                  afterFailure.version,
                ),
        )
        continue
      }

      const after = observeGlobalPackageVersion(manager, change.name)
      outcomes.push(
        !after.known
          ? globalOutcome(change, 'unknown', 'GLOBAL_OBSERVATION_FAILED', expectedValue, manager)
          : after.version === change.targetVersion
            ? globalOutcome(change, 'applied', 'APPLIED', expectedValue, manager, after.version)
            : globalOutcome(
                change,
                'failed',
                'WRITE_FAILED',
                expectedValue,
                manager,
                after.version,
              ),
      )
    }
  }

  const result = resultFromOutcomes(outcomes)
  logger.info(
    `  Global writes: ${result.applied} applied, ${result.skipped} skipped, ${result.failed} failed, ${result.unknown} unknown`,
  )
  return result
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

function isDowngrade(current: string, target: string): boolean {
  const currentVersion = semver.valid(current.replace(/^[~^]/, ''))
  const targetVersion = semver.valid(target.replace(/^[~^]/, ''))
  return (
    currentVersion !== null && targetVersion !== null && semver.gt(currentVersion, targetVersion)
  )
}
