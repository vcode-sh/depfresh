import { readFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import { dirname, resolve } from 'pathe'
import { glob } from 'tinyglobby'
import type { BumpOptions, PackageMeta } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadCatalogs } from '../catalogs/index'
import { parseDependencies } from '../dependencies'
import { parsePackageManagerField } from './package-manager-field'
import { belongsToNestedWorkspace } from './workspace-boundary'

export async function loadPackages(options: BumpOptions): Promise<PackageMeta[]> {
  const logger = createLogger(options.loglevel)

  // Global packages mode — skip filesystem scan
  if (options.global) {
    const { loadGlobalPackages } = await import('../global')
    const packages = loadGlobalPackages()
    logger.info(
      `Found ${packages.length} packages with ${packages.reduce((sum, p) => sum + p.deps.length, 0)} dependencies`,
    )
    return packages
  }

  const packages: PackageMeta[] = []

  // Find all package files
  // TODO: Add yaml package support in the future
  let jsonFiles = await glob(['**/package.json'], {
    cwd: options.cwd,
    ignore: options.ignorePaths,
    absolute: true,
  })

  // Filter out packages belonging to nested/separate workspaces
  if (options.ignoreOtherWorkspaces) {
    const rootDir = resolve(options.cwd)
    const before = jsonFiles.length
    jsonFiles = jsonFiles.filter((f) => !belongsToNestedWorkspace(f, rootDir))
    const skipped = before - jsonFiles.length
    if (skipped > 0) {
      logger.debug(`Skipped ${skipped} package(s) from nested workspaces`)
    }
  }

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
