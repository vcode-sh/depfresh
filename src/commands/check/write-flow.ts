import { execSync } from 'node:child_process'
import { posix, win32 } from 'node:path'
import { backupPackageFiles, restorePackageFiles, writePackage } from '../../io/write'
import type { depfreshOptions, PackageMeta, ResolvedDepChange } from '../../types'
import type { Logger } from '../../utils/logger'

export interface PackageWriteResult {
  planned: number
  applied: number
  reverted: number
  didWrite: boolean
}

function getPackageDirectory(filepath: string): string {
  return filepath.includes('\\') ? win32.dirname(filepath) : posix.dirname(filepath)
}

export async function verifyAndWrite(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  verifyCommand: string,
  logger: Logger,
): Promise<{ applied: number; reverted: number }> {
  let applied = 0
  let reverted = 0

  for (const change of changes) {
    const backups = backupPackageFiles(pkg)

    try {
      writePackage(pkg, [change], 'silent')
    } catch (error) {
      restorePackageFiles(backups)
      throw error
    }

    try {
      execSync(verifyCommand, { cwd: getPackageDirectory(pkg.filepath), stdio: 'pipe' })
      applied++
      logger.success(`  ${change.name} ${change.currentVersion} → ${change.targetVersion} ✓`)
    } catch {
      restorePackageFiles(backups)
      reverted++
      logger.warn(
        `  ${change.name} ${change.currentVersion} → ${change.targetVersion} ✗ (reverted)`,
      )
    }
  }

  return { applied, reverted }
}

export async function applyPackageWrite(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  options: depfreshOptions,
  logger: Logger,
): Promise<PackageWriteResult> {
  if (changes.length === 0) {
    return {
      planned: 0,
      applied: 0,
      reverted: 0,
      didWrite: false,
    }
  }

  if (options.verifyCommand) {
    const result = await verifyAndWrite(pkg, changes, options.verifyCommand, logger)
    logger.info(`  Verify: ${result.applied} applied, ${result.reverted} reverted`)
    return {
      planned: changes.length,
      applied: result.applied,
      reverted: result.reverted,
      didWrite: result.applied > 0,
    }
  }

  if (pkg.type === 'global') {
    const { getGlobalWriteTargets, writeGlobalPackage } = await import('../../io/global')
    let applied = 0
    for (const change of changes) {
      const targets = getGlobalWriteTargets(pkg, change.name)
      if (targets.length === 0) {
        logger.warn(`Skipped global update for ${change.name}: no package manager target found`)
        continue
      }
      for (const pmName of targets) {
        writeGlobalPackage(pmName, change.name, change.targetVersion)
      }
      applied++
    }
    return {
      planned: changes.length,
      applied,
      reverted: 0,
      didWrite: applied > 0,
    }
  }

  writePackage(pkg, changes, options.loglevel)
  return {
    planned: changes.length,
    applied: changes.length,
    reverted: 0,
    didWrite: true,
  }
}
