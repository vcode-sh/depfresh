import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import { dirname, join } from 'pathe'
import type { CatalogSource, depfreshOptions, RawDep } from '../../types'
import { isLocked } from '../../utils/versions'
import { detectLineEnding } from '../write/text'
import type { CatalogLoader } from './index'

function isPeerScopedCatalog(name: string): boolean {
  return name.trim().toLowerCase() === 'peers'
}

function parseCatalogDeps(
  catalog: Record<string, string>,
  parentPath: string,
  options: depfreshOptions,
): RawDep[] {
  const deps: RawDep[] = []
  for (const [name, version] of Object.entries(catalog)) {
    deps.push({
      name,
      currentVersion: version,
      source: 'catalog',
      update: !isLocked(version) || options.includeLocked,
      parents: [parentPath],
    })
  }
  return deps
}

export const bunCatalogLoader: CatalogLoader = {
  async detect(cwd: string): Promise<boolean> {
    const pkgPath = findBunCatalogManifest(cwd)
    if (!existsSync(pkgPath)) return false

    try {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      return !!raw.workspaces?.catalog || !!raw.workspaces?.catalogs
    } catch {
      return false
    }
  },

  async load(cwd: string, options: depfreshOptions): Promise<CatalogSource[]> {
    const filepath = findBunCatalogManifest(cwd)
    if (!existsSync(filepath)) return []
    const content = readFileSync(filepath, 'utf-8')
    const raw = JSON.parse(content)
    const indent = detectIndent(content).indent || '  '

    const sources: CatalogSource[] = []

    // Default catalog (singular): workspaces.catalog
    if (raw.workspaces?.catalog) {
      const catalog = raw.workspaces.catalog as Record<string, string>
      sources.push({
        type: 'bun',
        name: 'default',
        filepath,
        deps: parseCatalogDeps(catalog, 'workspaces.catalog', options),
        raw,
        indent,
      })
    }

    // Named catalogs (plural): workspaces.catalogs
    if (raw.workspaces?.catalogs) {
      const catalogs = raw.workspaces.catalogs as Record<string, Record<string, string>>
      for (const [catalogName, catalog] of Object.entries(catalogs)) {
        if (!options.peer && isPeerScopedCatalog(catalogName)) {
          continue
        }
        sources.push({
          type: 'bun',
          name: catalogName,
          filepath,
          deps: parseCatalogDeps(catalog, `workspaces.catalogs.${catalogName}`, options),
          raw,
          indent,
        })
      }
    }

    return sources
  },

  write(catalog: CatalogSource, changes: Map<string, string>): void {
    // Read fresh to get latest content
    const content = readFileSync(catalog.filepath, 'utf-8')
    const raw = JSON.parse(content)
    const indent = detectIndent(content).indent || catalog.indent

    let section: Record<string, string> | undefined

    if (catalog.name === 'default') {
      section = raw.workspaces?.catalog as Record<string, string> | undefined
    } else {
      section = raw.workspaces?.catalogs?.[catalog.name] as Record<string, string> | undefined
    }

    if (!section) return

    for (const [name, version] of changes) {
      if (name in section) {
        section[name] = version
      }
    }

    const lineEnding = detectLineEnding(content)
    const newContent = JSON.stringify(raw, null, indent)
    const withTrailing = content.endsWith('\n') ? `${newContent}\n` : newContent
    const final = lineEnding === '\r\n' ? withTrailing.replace(/\n/g, '\r\n') : withTrailing
    writeFileSync(catalog.filepath, final, 'utf-8')
  },
}

function findBunCatalogManifest(startDir: string): string {
  let current = startDir

  while (true) {
    const candidate = join(current, 'package.json')
    if (existsSync(candidate) && manifestHasCatalog(candidate)) {
      return candidate
    }

    const parent = dirname(current)
    if (parent === current) {
      return candidate
    }
    current = parent
  }
}

function manifestHasCatalog(filepath: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(filepath, 'utf-8'))
    return !!raw.workspaces?.catalog || !!raw.workspaces?.catalogs
  } catch {
    return false
  }
}
