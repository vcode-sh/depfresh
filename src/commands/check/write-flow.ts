import { execSync } from 'node:child_process'
import { backupPackageFiles, restorePackageFiles, writePackage } from '../../io/write'
import type { PackageManagerName, PackageMeta, ResolvedDepChange, UpgrOptions } from '../../types'
import type { Logger } from '../../utils/logger'

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
    writePackage(pkg, [change], 'silent')

    try {
      execSync(verifyCommand, { cwd: pkg.filepath.replace(/\/[^/]+$/, ''), stdio: 'pipe' })
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
  options: UpgrOptions,
  logger: Logger,
): Promise<boolean> {
  if (changes.length === 0) return false

  if (options.verifyCommand) {
    const result = await verifyAndWrite(pkg, changes, options.verifyCommand, logger)
    logger.info(`  Verify: ${result.applied} applied, ${result.reverted} reverted`)
    return result.applied > 0
  }

  if (pkg.type === 'global') {
    const { writeGlobalPackage } = await import('../../io/global')
    const pmName = pkg.filepath.replace('global:', '') as PackageManagerName
    for (const change of changes) {
      writeGlobalPackage(pmName, change.name, change.targetVersion)
    }
    return true
  }

  writePackage(pkg, changes, options.loglevel)
  return true
}
