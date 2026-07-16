import type { CatalogSource, depfreshOptions } from '../../types'
import {
  recordBlockedCatalogPath,
  resolveCatalogCandidate,
  resolveCatalogSearchContext,
} from './catalog-path'

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

  const canonicalCatalogs: CatalogSource[] = []
  const managerTypesByPath = new Map<string, Set<CatalogSource['type']>>()
  for (const catalog of catalogs) {
    const contained = resolveCatalogCandidate(context.root, catalog.filepath, options)
    if (!contained) continue
    canonicalCatalogs.push({ ...catalog, filepath: contained.path })
    const managerTypes = managerTypesByPath.get(contained.path) ?? new Set()
    managerTypes.add(catalog.type)
    managerTypesByPath.set(contained.path, managerTypes)
  }

  const ambiguousPaths = new Set<string>()
  for (const [path, managerTypes] of managerTypesByPath) {
    if (managerTypes.size < 2) continue
    ambiguousPaths.add(path)
    recordBlockedCatalogPath(options, path, 'DUPLICATE_IDENTITY')
  }

  const containedCatalogs: CatalogSource[] = []
  const seen = new Set<string>()
  for (const catalog of canonicalCatalogs) {
    if (ambiguousPaths.has(catalog.filepath)) continue
    const identity = `${catalog.type}\u0000${catalog.name}\u0000${catalog.filepath}`
    if (seen.has(identity)) continue
    seen.add(identity)
    containedCatalogs.push(catalog)
  }

  return containedCatalogs
}
