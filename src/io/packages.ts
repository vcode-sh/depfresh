import { readFileSync } from 'node:fs'
import { join, dirname } from 'pathe'
import { glob } from 'tinyglobby'
import detectIndent from 'detect-indent'
import type { BumpOptions, PackageMeta, RawDep } from '../types'
import { parseDependencies } from './dependencies'
import { createLogger } from '../utils/logger'

export async function loadPackages(options: BumpOptions): Promise<PackageMeta[]> {
  const logger = createLogger(options.loglevel)
  const packages: PackageMeta[] = []

  // Find all package files in parallel
  const [jsonFiles, yamlFiles] = await Promise.all([
    glob(['**/package.json'], {
      cwd: options.cwd,
      ignore: options.ignorePaths,
      absolute: true,
    }),
    glob(['**/package.yaml'], {
      cwd: options.cwd,
      ignore: options.ignorePaths,
      absolute: true,
    }),
  ])

  for (const filepath of jsonFiles) {
    try {
      const content = readFileSync(filepath, 'utf-8')
      const raw = JSON.parse(content)
      const indent = detectIndent(content).indent || '  '

      const deps = parseDependencies(raw, options)
      const meta: PackageMeta = {
        name: raw.name ?? dirname(filepath),
        type: 'package.json',
        filepath,
        deps,
        resolved: [],
        raw,
        indent,
      }

      // Parse packageManager field
      if (raw.packageManager && typeof raw.packageManager === 'string') {
        meta.packageManager = parsePackageManagerField(raw.packageManager)
      }

      packages.push(meta)
      logger.debug(`Loaded ${filepath} (${deps.length} deps)`)
    } catch (error) {
      logger.warn(`Failed to load ${filepath}:`, error)
    }
  }

  // TODO: yaml packages, workspace catalogs
  // These will be added as we port the catalog loaders

  logger.info(`Found ${packages.length} packages with ${packages.reduce((sum, p) => sum + p.deps.length, 0)} dependencies`)
  return packages
}

function parsePackageManagerField(raw: string): PackageMeta['packageManager'] {
  // Format: name@version or name@version+hash
  const match = raw.match(/^(npm|pnpm|yarn|bun)@([^+]+)(?:\+(.+))?$/)
  if (!match) return undefined

  return {
    name: match[1] as PackageMeta['packageManager'] & { name: string }['name'],
    version: match[2]!,
    hash: match[3],
    raw,
  }
}
