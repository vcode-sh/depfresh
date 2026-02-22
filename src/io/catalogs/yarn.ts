import { readFileSync, writeFileSync } from 'node:fs'
import { findUpSync } from 'find-up-simple'
import YAML from 'yaml'
import type { CatalogSource, depfreshOptions, RawDep } from '../../types'
import { isLocked } from '../../utils/versions'
import type { CatalogLoader } from './index'

export const yarnCatalogLoader: CatalogLoader = {
  async detect(cwd: string): Promise<boolean> {
    const rcFile = findUpSync('.yarnrc.yml', { cwd })
    return !!rcFile
  },

  async load(cwd: string, options: depfreshOptions): Promise<CatalogSource[]> {
    const filepath = findUpSync('.yarnrc.yml', { cwd })
    if (!filepath) return []

    const content = readFileSync(filepath, 'utf-8')
    const doc = YAML.parseDocument(content)
    const raw = doc.toJSON()

    if (!raw?.catalog) return []

    const deps: RawDep[] = []
    const catalog = raw.catalog as Record<string, string>

    for (const [name, version] of Object.entries(catalog)) {
      deps.push({
        name,
        currentVersion: version,
        source: 'catalog',
        update: !isLocked(version) || options.includeLocked,
        parents: ['catalog'],
      })
    }

    return [
      {
        type: 'yarn',
        name: 'default',
        filepath,
        deps,
        raw: doc,
        indent: '  ',
      },
    ]
  },

  write(catalog: CatalogSource, changes: Map<string, string>): void {
    const doc = catalog.raw as YAML.Document
    const catalogNode = doc.get('catalog') as YAML.YAMLMap | undefined
    if (!catalogNode) return

    for (const [name, version] of changes) {
      if (catalogNode.has(name)) {
        catalogNode.set(name, version)
      }
    }

    writeFileSync(catalog.filepath, doc.toString(), 'utf-8')
  },
}
