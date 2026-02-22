import { readFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import { dirname } from 'pathe'
import { glob } from 'tinyglobby'
import type { BumpOptions, PackageManagerName, PackageMeta } from '../types'
import { createLogger } from '../utils/logger'
import { loadCatalogs } from './catalogs/index'
import { parseDependencies } from './dependencies'

export async function loadPackages(options: BumpOptions): Promise<PackageMeta[]> {
  const logger = createLogger(options.loglevel)

  // Global packages mode — skip filesystem scan
  if (options.global) {
    const { loadGlobalPackages } = await import('./global')
    const packages = loadGlobalPackages()
    logger.info(
      `Found ${packages.length} packages with ${packages.reduce((sum, p) => sum + p.deps.length, 0)} dependencies`,
    )
    return packages
  }

  const packages: PackageMeta[] = []

  // Find all package files
  // TODO: Add yaml package support in the future
  const jsonFiles = await glob(['**/package.json'], {
    cwd: options.cwd,
    ignore: options.ignorePaths,
    absolute: true,
  })

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

  // Load workspace catalogs (pnpm, bun, yarn)
  try {
    const catalogs = await loadCatalogs(options.cwd, options)
    for (const catalog of catalogs) {
      const catalogTypeName =
        catalog.type === 'pnpm'
          ? 'pnpm-workspace'
          : catalog.type === 'bun'
            ? 'bun-workspace'
            : 'yarn-workspace'

      const displayName =
        catalog.name === 'default'
          ? `${catalog.type} catalog`
          : `${catalog.type} catalog:${catalog.name}`

      packages.push({
        name: displayName,
        type: catalogTypeName,
        filepath: catalog.filepath,
        deps: catalog.deps,
        resolved: [],
        raw: catalog.raw,
        indent: catalog.indent,
        catalogs: [catalog],
      })
      logger.debug(`Loaded catalog ${displayName} (${catalog.deps.length} deps)`)
    }
  } catch (error) {
    logger.warn('Failed to load workspace catalogs:', error)
  }

  logger.info(
    `Found ${packages.length} packages with ${packages.reduce((sum, p) => sum + p.deps.length, 0)} dependencies`,
  )
  return packages
}

export function parsePackageManagerField(raw: string): PackageMeta['packageManager'] {
  // Format: name@version or name@version+hash
  const match = raw.match(/^(npm|pnpm|yarn|bun)@([^+]+)(?:\+(.+))?$/)
  if (!match) return undefined

  return {
    name: match[1] as PackageManagerName,
    version: match[2]!,
    hash: match[3],
    raw,
  }
}
