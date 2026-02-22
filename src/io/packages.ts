import { readFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import { findUpSync } from 'find-up-simple'
import { dirname, resolve } from 'pathe'
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

/**
 * Check if a package.json belongs to a nested workspace (not our root workspace).
 * Walks up from the package's parent looking for workspace root markers.
 * If one is found before reaching rootDir, the package is in a nested workspace.
 */
export function belongsToNestedWorkspace(filepath: string, rootDir: string): boolean {
  const pkgDir = dirname(filepath)
  const normalizedRoot = resolve(rootDir)

  // If the package is at the root, it never belongs to a nested workspace
  if (resolve(pkgDir) === normalizedRoot) return false

  // Look for workspace root markers between the package's dir and our root.
  // findUpSync with stopAt still checks the stopAt directory itself,
  // so we filter results to only those NOT at our root.

  // Check for pnpm-workspace.yaml
  const pnpmWs = findUpSync('pnpm-workspace.yaml', { cwd: pkgDir, stopAt: normalizedRoot })
  if (pnpmWs && resolve(dirname(pnpmWs)) !== normalizedRoot) return true

  // Check for .yarnrc.yml
  const yarnRc = findUpSync('.yarnrc.yml', { cwd: pkgDir, stopAt: normalizedRoot })
  if (yarnRc && resolve(dirname(yarnRc)) !== normalizedRoot) return true

  // Check if this package.json itself is a nested workspace root
  try {
    const content = JSON.parse(readFileSync(filepath, 'utf-8'))
    if (content.workspaces) return true
  } catch {
    // Ignore parse errors
  }

  // Check for a parent package.json with workspaces field
  // Start from the parent of pkgDir to avoid matching the file itself
  const parentDir = dirname(pkgDir)
  if (resolve(parentDir) !== normalizedRoot) {
    const nestedPkg = findUpSync('package.json', { cwd: parentDir, stopAt: normalizedRoot })
    if (nestedPkg && resolve(dirname(nestedPkg)) !== normalizedRoot) {
      try {
        const content = JSON.parse(readFileSync(nestedPkg, 'utf-8'))
        if (content.workspaces) return true
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Check for .git directory (indicates a separate repo boundary)
  const gitDir = findUpSync('.git', {
    cwd: pkgDir,
    stopAt: normalizedRoot,
    type: 'directory',
  })
  if (gitDir && resolve(dirname(gitDir)) !== normalizedRoot) return true

  return false
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
