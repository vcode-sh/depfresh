import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import { join } from 'pathe'
import type { CatalogSource, RawDep, UpgrOptions } from '../../types'
import { isLocked } from '../../utils/versions'
import { detectLineEnding } from '../write'
import type { CatalogLoader } from './index'

function parseCatalogDeps(
  catalog: Record<string, string>,
  parentPath: string,
  options: UpgrOptions,
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
    const pkgPath = join(cwd, 'package.json')
    if (!existsSync(pkgPath)) return false

    try {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      return !!raw.workspaces?.catalog || !!raw.workspaces?.catalogs
    } catch {
      return false
    }
  },

  async load(cwd: string, options: UpgrOptions): Promise<CatalogSource[]> {
    const filepath = join(cwd, 'package.json')
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
