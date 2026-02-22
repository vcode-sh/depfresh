import type { BumpOptions, CatalogSource } from '../../types'

/**
 * Unified catalog interface.
 * All workspace catalog formats (pnpm, bun, yarn) go through this abstraction.
 */
export interface CatalogLoader {
  detect(cwd: string): Promise<boolean>
  load(cwd: string, options: BumpOptions): Promise<CatalogSource[]>
  write(catalog: CatalogSource, changes: Map<string, string>): void
}

export async function loadCatalogs(cwd: string, options: BumpOptions): Promise<CatalogSource[]> {
  const catalogs: CatalogSource[] = []

  // Load all catalogs in parallel
  const loaders = await Promise.all([
    import('./pnpm').then((m) => m.pnpmCatalogLoader),
    import('./bun').then((m) => m.bunCatalogLoader),
    import('./yarn').then((m) => m.yarnCatalogLoader),
  ])

  const detected = await Promise.all(
    loaders.map(async (loader) => {
      if (await loader.detect(cwd)) {
        return loader.load(cwd, options)
      }
      return []
    }),
  )

  for (const result of detected) {
    catalogs.push(...result)
  }

  return catalogs
}
