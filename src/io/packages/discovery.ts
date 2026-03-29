import { resolve } from 'pathe'
import { glob } from 'tinyglobby'
import type { depfreshOptions, PackageMeta } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadCatalogs } from '../catalogs/index'
import { loadPackage } from './load-package'
import { dedupeManifestsByDirectory } from './manifest-priority'
import { resolveDiscoveryContext } from './root-detection'
import { belongsToNestedWorkspace } from './workspace-boundary'
import { getWorkspaceManifestPatterns } from './workspace-discovery'

export async function loadPackages(options: depfreshOptions): Promise<PackageMeta[]> {
  const logger = createLogger(options.loglevel)
  const discoveryRoot = options.effectiveRoot ?? resolveDiscoveryContext(options.cwd).effectiveRoot
  const report = options.discoveryReport ?? {
    inputCwd: options.inputCwd ?? options.cwd,
    effectiveRoot: discoveryRoot,
    discoveryMode: options.discoveryMode ?? resolveDiscoveryContext(options.cwd).discoveryMode,
    matchedManifests: [],
    loadedPackages: [],
    skippedManifests: [],
    loadedCatalogs: [],
  }
  options.discoveryReport = report

  // Global packages mode — skip filesystem scan
  if (options.global || options.globalAll) {
    const { loadGlobalPackages, loadGlobalPackagesAll } = await import('../global')
    const packages = options.globalAll ? loadGlobalPackagesAll() : loadGlobalPackages()
    logger.info(
      `Found ${packages.length} packages with ${packages.reduce((sum, p) => sum + p.deps.length, 0)} dependencies`,
    )
    return packages
  }

  const packages: PackageMeta[] = []

  const packagePatterns = options.recursive
    ? (getWorkspaceManifestPatterns(discoveryRoot)?.patterns ?? [
        '**/package.json',
        '**/package.yaml',
      ])
    : ['package.json', 'package.yaml']

  let packageFiles = await glob(packagePatterns, {
    cwd: discoveryRoot,
    ignore: options.ignorePaths,
    absolute: true,
  })
  report.matchedManifests = [...packageFiles]

  // Filter out packages belonging to nested/separate workspaces
  if (options.ignoreOtherWorkspaces) {
    const rootDir = resolve(discoveryRoot)
    const keptFiles: string[] = []
    for (const filepath of packageFiles) {
      if (belongsToNestedWorkspace(filepath, rootDir)) {
        report.skippedManifests.push({
          path: filepath,
          reason: 'nested-workspace-descendant',
        })
      } else {
        keptFiles.push(filepath)
      }
    }
    const before = packageFiles.length
    packageFiles = keptFiles
    const skipped = before - packageFiles.length
    if (skipped > 0) {
      logger.debug(`Skipped ${skipped} package(s) from nested workspaces`)
    }
  }

  packageFiles = dedupeManifestsByDirectory(packageFiles)

  for (const filepath of packageFiles) {
    try {
      const meta = loadPackage(filepath, options)
      packages.push(meta)
      report.loadedPackages.push(meta.filepath)
      logger.debug(`Loaded ${filepath} (${meta.deps.length} deps)`)
    } catch (error) {
      report.skippedManifests.push({
        path: filepath,
        reason: 'load-failed',
      })
      logger.warn(`Failed to load ${filepath}:`, error)
    }
  }

  // Load workspace catalogs (pnpm, bun, yarn) only in recursive mode.
  if (options.recursive) {
    try {
      const catalogs = await loadCatalogs(discoveryRoot, options)
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
        report.loadedCatalogs.push(`${catalog.filepath}:${catalog.name}`)
        logger.debug(`Loaded catalog ${displayName} (${catalog.deps.length} deps)`)
      }
    } catch (error) {
      logger.warn('Failed to load workspace catalogs:', error)
    }
  } else {
    logger.debug('Skipping workspace catalogs because recursive mode is disabled')
  }

  logger.info(
    `Found ${packages.length} packages with ${packages.reduce((sum, p) => sum + p.deps.length, 0)} dependencies`,
  )
  return packages
}
