import { execSync } from 'node:child_process'
import { posix, win32 } from 'node:path'
import * as semver from 'semver'
import { ConfigError } from '../../errors'
import {
  backupPackageFiles,
  type FileBackup,
  restorePackageFiles,
  writePackage,
} from '../../io/write'
import {
  canonicalizeFilepath,
  createCatalogWriteRequest,
  createPackageWriteRequest,
  createWriteOutcome,
  observeFileOccurrence,
  resolvePhysicalValues,
} from '../../io/write/occurrence'
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

function getPackageDirectory(filepath: string): string {
  return filepath.includes('\\') ? win32.dirname(filepath) : posix.dirname(filepath)
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
  const outcomes: WriteOutcome[] = []

  for (const change of changes) {
    let backups: FileBackup[]
    try {
      backups = backupPackageFiles(pkg)
    } catch {
      outcomes.push(createBackupFailureOutcome(pkg, change))
      continue
    }

    let written: WriteOutcome[]
    try {
      written = writePackage(pkg, [change], 'silent')
    } catch (error) {
      restorePackageFiles(backups)
      throw error
    }
    const [outcome] = written
    if (!outcome) continue
    if (outcome.status !== 'applied') {
      outcomes.push(outcome)
      continue
    }

    try {
      execSync(verifyCommand, { cwd: getPackageDirectory(pkg.filepath), stdio: 'pipe' })
      outcomes.push(outcome)
      logger.success(`  ${change.name} ${change.currentVersion} → ${change.targetVersion} ✓`)
    } catch {
      try {
        restorePackageFiles(backups)
      } catch {
        outcomes.push({ ...outcome, status: 'unknown', reason: 'RESTORE_FAILED' })
        logger.warn(`  ${change.name} ${change.currentVersion} → ${change.targetVersion} ✗`)
        continue
      }

      const observation = observeFileOccurrence(outcome.occurrence)
      if (observation.known && observation.value === outcome.expectedValue) {
        outcomes.push({
          ...outcome,
          status: 'reverted',
          reason: 'VERIFICATION_FAILED',
          observedValue: observation.value,
        })
        logger.warn(
          `  ${change.name} ${change.currentVersion} → ${change.targetVersion} ✗ (reverted)`,
        )
      } else {
        outcomes.push({
          ...outcome,
          status: 'unknown',
          reason: 'RESTORE_FAILED',
          ...(observation.value === undefined ? {} : { observedValue: observation.value }),
        })
      }
    }
  }

  return resultFromOutcomes(outcomes)
}

function createBackupFailureOutcome(pkg: PackageMeta, change: ResolvedDepChange): WriteOutcome {
  const matchingCatalogs = (pkg.catalogs ?? []).filter((catalog) =>
    catalog.deps.some(
      (dependency) =>
        dependency.name === change.name &&
        dependency.parents.length === change.parents.length &&
        dependency.parents.every((parent, index) => parent === change.parents[index]),
    ),
  )
  const catalog = matchingCatalogs.length === 1 ? matchingCatalogs[0] : undefined
  const request = catalog
    ? createCatalogWriteRequest(catalog, change)
    : pkg.type === 'package.json' || pkg.type === 'package.yaml'
      ? createPackageWriteRequest(pkg, change)
      : {
          change,
          occurrence: {
            file: canonicalizeFilepath(pkg.filepath),
            path: [change.source, ...change.parents, change.name],
          },
          exactExpectedValue: change.rawVersion,
        }
  const values = resolvePhysicalValues(request, undefined)
  return createWriteOutcome(
    request,
    'failed',
    'READ_FAILED',
    values.expectedValue,
    values.requestedValue,
  )
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
