import { WriteError } from '../../errors'
import type { PackageMeta, ResolvedDepChange } from '../../types'
import type { createLogger } from '../../utils/logger'
import { bunCatalogLoader } from '../catalogs/bun'
import { pnpmCatalogLoader } from '../catalogs/pnpm'
import { yarnCatalogLoader } from '../catalogs/yarn'

const catalogWriters = {
  pnpm: pnpmCatalogLoader,
  bun: bunCatalogLoader,
  yarn: yarnCatalogLoader,
}

export function writeCatalogPackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  logger: ReturnType<typeof createLogger>,
): void {
  if (!pkg.catalogs?.length) return

  for (const catalog of pkg.catalogs) {
    // Build a map of name → new version for this catalog's changes
    const changeMap = new Map<string, string>()
    for (const change of changes) {
      // Only include changes for deps that exist in this catalog
      if (catalog.deps.some((d) => d.name === change.name)) {
        changeMap.set(change.name, change.targetVersion)
      }
    }

    if (changeMap.size === 0) continue

    const writer = catalogWriters[catalog.type]
    if (writer) {
      try {
        writer.write(catalog, changeMap)
      } catch (error) {
        throw new WriteError(
          `Failed to write ${catalog.type} catalog "${catalog.name}" (${catalog.filepath})`,
          { cause: error },
        )
      }
      logger.success(
        `Updated ${catalog.type} catalog "${catalog.name}" (${changeMap.size} changes)`,
      )
    }
  }
}
