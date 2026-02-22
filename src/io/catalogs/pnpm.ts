import { readFileSync, writeFileSync } from 'node:fs'
import { findUpSync } from 'find-up-simple'
import { parsePnpmWorkspaceYaml } from 'pnpm-workspace-yaml'
import type { BumpOptions, CatalogSource, RawDep } from '../../types'
import { isLocked } from '../../utils/versions'
import type { CatalogLoader } from './index'

export const pnpmCatalogLoader: CatalogLoader = {
  async detect(cwd: string): Promise<boolean> {
    return !!findUpSync('pnpm-workspace.yaml', { cwd })
  },

  async load(cwd: string, options: BumpOptions): Promise<CatalogSource[]> {
    const filepath = findUpSync('pnpm-workspace.yaml', { cwd })
    if (!filepath) return []

    const content = readFileSync(filepath, 'utf-8')
    const workspace = parsePnpmWorkspaceYaml(content)
    const schema = workspace.toJSON()
    const catalogs: CatalogSource[] = []

    // Default catalog
    if (schema.catalog && typeof schema.catalog === 'object') {
      catalogs.push(parseCatalogSection(schema.catalog, 'default', filepath, options, content))
    }

    // Named catalogs
    if (schema.catalogs && typeof schema.catalogs === 'object') {
      for (const [name, deps] of Object.entries(schema.catalogs)) {
        catalogs.push(parseCatalogSection(deps, name, filepath, options, content))
      }
    }

    return catalogs
  },

  write(catalog: CatalogSource, changes: Map<string, string>): void {
    // Re-read and re-parse to preserve formatting/comments
    const content = readFileSync(catalog.filepath, 'utf-8')
    const workspace = parsePnpmWorkspaceYaml(content)

    for (const [name, version] of changes) {
      workspace.setPackage(catalog.name === 'default' ? 'default' : catalog.name, name, version)
    }

    writeFileSync(catalog.filepath, workspace.toString(), 'utf-8')
  },
}

function parseCatalogSection(
  deps: Record<string, string>,
  name: string,
  filepath: string,
  options: BumpOptions,
  rawContent: string,
): CatalogSource {
  const parsed: RawDep[] = []

  for (const [depName, version] of Object.entries(deps)) {
    parsed.push({
      name: depName,
      currentVersion: version,
      source: 'catalog',
      update: !isLocked(version) || options.includeLocked,
      parents: [name === 'default' ? 'catalog' : `catalogs.${name}`],
    })
  }

  return {
    type: 'pnpm',
    name,
    filepath,
    deps: parsed,
    raw: rawContent,
    indent: '  ',
  }
}
