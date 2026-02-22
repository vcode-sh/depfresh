import type { PackageMeta, ResolvedDepChange } from '../../types'
import { createLogger } from '../../utils/logger'
import { writeCatalogPackage } from './catalog'
import { writePackageJson } from './package-json'

export type { FileBackup } from './backup'
export { backupPackageFiles, restorePackageFiles } from './backup'
export { detectLineEnding } from './text'

/**
 * Single-writer architecture: reads once, applies all mutations, writes once.
 * Never allow independent writers to clobber each other.
 */
export function writePackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  loglevel: 'silent' | 'info' | 'debug' = 'info',
): void {
  const logger = createLogger(loglevel)

  if (changes.length === 0) return

  if (pkg.type === 'package.json') {
    writePackageJson(pkg, changes, logger)
  } else if (pkg.catalogs?.length) {
    writeCatalogPackage(pkg, changes, logger)
  }
}
