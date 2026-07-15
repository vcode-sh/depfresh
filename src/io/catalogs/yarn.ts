import { readFileSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import type { CatalogSource, depfreshOptions, RawDep } from '../../types'
import { isLocked } from '../../utils/versions'
import { findContainedCatalogFile } from './catalog-path'
import type { CatalogLoader } from './index'

export const yarnCatalogLoader: CatalogLoader = {
  async detect(cwd: string, options?: depfreshOptions): Promise<boolean> {
    return !!findContainedCatalogFile('.yarnrc.yml', cwd, options)
  },

  async load(cwd: string, options: depfreshOptions): Promise<CatalogSource[]> {
    const filepath = findContainedCatalogFile('.yarnrc.yml', cwd, options)
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
    const content = readFileSync(catalog.filepath, 'utf-8')
    const doc = YAML.parseDocument(content)
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
