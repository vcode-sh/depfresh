import type { PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import { createLogger } from '../../utils/logger'
import { writeCatalogPackage } from './catalog'
import { writePackageJson } from './package-json'
import { writePackageYaml } from './package-yaml'

export type { FileBackup } from './backup'
export { backupPackageFiles, restorePackageFiles } from './backup'
export { detectLineEnding } from './text'

/**
 * Single-writer architecture: reads once, applies all mutations, writes once.
 * Never allow independent writers to clobber each other.
 *
 * @deprecated Use the immutable `plan()` and explicitly authorized `apply()` workflow. This direct
 * compatibility writer does not provide the run-level stale, lock, journal, or recovery contract.
 */
export function writePackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  loglevel: 'silent' | 'info' | 'debug' = 'info',
): WriteOutcome[] {
  const logger = createLogger(loglevel)

  if (changes.length === 0) return []

  if (pkg.type === 'package.json') {
    return writePackageJson(pkg, changes, logger)
  } else if (pkg.type === 'package.yaml') {
    return writePackageYaml(pkg, changes, logger)
  } else if (pkg.catalogs?.length) {
    return writeCatalogPackage(pkg, changes, logger)
  }

  return changes.map((change) => ({
    name: change.name,
    occurrence: { file: pkg.filepath, path: [change.source, ...change.parents, change.name] },
    expectedValue: change.rawVersion ?? change.currentVersion,
    requestedValue: change.targetVersion,
    status: 'failed',
    reason: 'UNSUPPORTED_WRITE_SOURCE',
  }))
}
