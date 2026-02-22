import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import { join } from 'pathe'
import type { BumpOptions, CatalogSource, RawDep } from '../../types'
import { isLocked } from '../../utils/versions'
import type { CatalogLoader } from './index'

export const bunCatalogLoader: CatalogLoader = {
  async detect(cwd: string): Promise<boolean> {
    const pkgPath = join(cwd, 'package.json')
    if (!existsSync(pkgPath)) return false

    try {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      return !!raw.workspaces?.catalog
    } catch {
      return false
    }
  },

  async load(cwd: string, options: BumpOptions): Promise<CatalogSource[]> {
    const filepath = join(cwd, 'package.json')
    const content = readFileSync(filepath, 'utf-8')
    const raw = JSON.parse(content)
    const indent = detectIndent(content).indent || '  '

    if (!raw.workspaces?.catalog) return []

    const deps: RawDep[] = []
    const catalog = raw.workspaces.catalog as Record<string, string>

    for (const [name, version] of Object.entries(catalog)) {
      deps.push({
        name,
        currentVersion: version,
        source: 'catalog',
        update: !isLocked(version) || options.includeLocked,
        parents: ['workspaces.catalog'],
      })
    }

    return [
      {
        type: 'bun',
        name: 'default',
        filepath,
        deps,
        raw,
        indent,
      },
    ]
  },

  write(catalog: CatalogSource, changes: Map<string, string>): void {
    // Read fresh to get latest content
    const content = readFileSync(catalog.filepath, 'utf-8')
    const raw = JSON.parse(content)
    const indent = detectIndent(content).indent || catalog.indent

    const section = raw.workspaces?.catalog as Record<string, string> | undefined
    if (!section) return

    for (const [name, version] of changes) {
      if (name in section) {
        section[name] = version
      }
    }

    const newContent = JSON.stringify(raw, null, indent)
    const final = content.endsWith('\n') ? `${newContent}\n` : newContent
    writeFileSync(catalog.filepath, final, 'utf-8')
  },
}
