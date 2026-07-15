import type { CatalogSource, depfreshOptions } from '../../types'
import { resolveCatalogCandidate, resolveCatalogSearchContext } from './catalog-path'

/**
 * Unified catalog interface.
 * All workspace catalog formats (pnpm, bun, yarn) go through this abstraction.
 */
export interface CatalogLoader {
  detect(cwd: string, options?: depfreshOptions): Promise<boolean>
  load(cwd: string, options: depfreshOptions): Promise<CatalogSource[]>
  write(catalog: CatalogSource, changes: Map<string, string>): void
}

export async function loadCatalogs(
  cwd: string,
  options: depfreshOptions,
): Promise<CatalogSource[]> {
  const catalogs: CatalogSource[] = []

  // Load all catalogs in parallel
  const loaders = await Promise.all([
    import('./pnpm').then((m) => m.pnpmCatalogLoader),
    import('./bun').then((m) => m.bunCatalogLoader),
    import('./yarn').then((m) => m.yarnCatalogLoader),
  ])

  const detected = await Promise.all(
    loaders.map(async (loader) => {
      if (await loader.detect(cwd, options)) {
        return loader.load(cwd, options)
      }
      return []
    }),
  )

  for (const result of detected) {
    catalogs.push(...result)
  }

  const context = resolveCatalogSearchContext(cwd, options)
  if (!context) return []

  const containedCatalogs: CatalogSource[] = []
  const seen = new Set<string>()
  for (const catalog of catalogs) {
    const contained = resolveCatalogCandidate(context.root, catalog.filepath, options)
    if (!contained) continue
    const identity = `${catalog.type}\u0000${catalog.name}\u0000${contained.path}`
    if (seen.has(identity)) continue
    seen.add(identity)
    containedCatalogs.push({ ...catalog, filepath: contained.path })
  }

  return containedCatalogs
}
