import { resolve } from 'pathe'
import { glob } from 'tinyglobby'
import type { depfreshOptions, PackageMeta } from '../../types'
import { createLogger } from '../../utils/logger'
import { loadCatalogs } from '../catalogs/index'
import { resolveContainedPath } from './containment'
import { loadPackage } from './load-package'
import { sortManifestsByPriority } from './manifest-priority'
import { resolveDiscoveryContext } from './root-detection'
import { classifyWorkspaceBoundary } from './workspace-boundary'
import { getWorkspaceManifestPatterns } from './workspace-discovery'

export async function loadPackages(options: depfreshOptions): Promise<PackageMeta[]> {
  if (options.global || options.globalAll) return discoverPackages(options)
  const { inspectRepositoryWithProjection } = await import('../../repository/inspect')
  return (await inspectRepositoryWithProjection(options)).packages
}

export async function discoverPackages(options: depfreshOptions): Promise<PackageMeta[]> {
  const logger = createLogger(options.loglevel)
  const discoveryContext = resolveDiscoveryContext(options.cwd)
  const requestedRoot = options.effectiveRoot ?? discoveryContext.effectiveRoot
  const rootResolution = resolveContainedPath(requestedRoot, requestedRoot)
  const discoveryRoot = rootResolution.allowed ? rootResolution.path : resolve(requestedRoot)
  const report = options.discoveryReport ?? {
    inputCwd: options.inputCwd ?? options.cwd,
    effectiveRoot: discoveryRoot,
    discoveryMode: options.discoveryMode ?? discoveryContext.discoveryMode,
    matchedManifests: [],
    loadedPackages: [],
    skippedManifests: [],
    loadedCatalogs: [],
  }
  options.discoveryReport = report
  options.effectiveRoot = discoveryRoot
  report.effectiveRoot = discoveryRoot

  // Global packages mode — skip filesystem scan
  if (options.global || options.globalAll) {
    const { loadGlobalPackagesObserved, loadGlobalPackagesAllObserved } = await import('../global')
    const loadOptions = {
      cwd: discoveryRoot,
      timeoutMs: options.phaseTimeout ?? options.timeout,
      compiledPolicy: options.compiledPolicy,
    }
    const packages = options.globalAll
      ? await loadGlobalPackagesAllObserved(loadOptions)
      : await loadGlobalPackagesObserved(undefined, loadOptions)
    logger.info(
      `Found ${packages.length} packages with ${packages.reduce((sum, p) => sum + p.deps.length, 0)} dependencies`,
    )
    return packages
  }

  if (!rootResolution.allowed) {
    report.skippedManifests.push({
      path: rootResolution.path,
      reason: `containment:${rootResolution.reason}`,
    })
    return []
  }

  const packages: PackageMeta[] = []

  const workspaceDiscovery = getWorkspaceManifestPatterns(discoveryRoot)
  for (const blocked of workspaceDiscovery.blockedPatterns) {
    report.skippedManifests.push({
      path: blocked.pattern,
      reason: `workspace-pattern:${blocked.reason}`,
    })
  }
  for (const blocked of workspaceDiscovery.blockedPaths) {
    report.skippedManifests.push({
      path: blocked.path,
      reason: `containment:${blocked.reason}`,
    })
  }

  const packagePatterns = options.recursive
    ? workspaceDiscovery.patterns.length > 0
      ? workspaceDiscovery.patterns
      : ['**/package.json', '**/package.yaml']
    : ['package.json', 'package.yaml']

  let packageFiles = await glob(packagePatterns, {
    cwd: discoveryRoot,
    ignore: options.ignorePaths,
    absolute: true,
  })
  packageFiles.sort((a, b) => a.localeCompare(b))
  report.matchedManifests = [...packageFiles]

  const canonicalFiles: string[] = []
  const seenPhysicalFiles = new Set<string>()
  for (const filepath of packageFiles) {
    const contained = resolveContainedPath(discoveryRoot, filepath)
    if (!contained.allowed) {
      report.skippedManifests.push({
        path: filepath,
        reason: `containment:${contained.reason}`,
      })
      continue
    }
    if (seenPhysicalFiles.has(contained.path)) {
      report.skippedManifests.push({
        path: filepath,
        reason: 'containment:DUPLICATE_IDENTITY',
      })
      continue
    }
    seenPhysicalFiles.add(contained.path)
    canonicalFiles.push(contained.path)
  }
  packageFiles = canonicalFiles

  // Filter out packages belonging to nested/separate workspaces
  if (options.ignoreOtherWorkspaces || options.write) {
    const rootDir = resolve(discoveryRoot)
    const keptFiles: string[] = []
    for (const filepath of packageFiles) {
      const boundary = classifyWorkspaceBoundary(filepath, rootDir)
      if (
        boundary.classification === 'nested-descendant' ||
        (options.write && boundary.classification === 'nested-root')
      ) {
        report.skippedManifests.push({
          path: filepath,
          reason: boundary.marker
            ? `${boundary.classification}:${boundary.marker}`
            : boundary.classification,
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

  const packageGroups = groupManifestsByDirectory(packageFiles)

  for (const group of packageGroups) {
    let loaded = false

    for (const filepath of group) {
      try {
        const meta = loadPackage(filepath, options)
        packages.push(meta)
        report.loadedPackages.push(meta.filepath)
        logger.debug(`Loaded ${filepath} (${meta.deps.length} deps)`)
        loaded = true
        break
      } catch (error) {
        logger.warn(`Failed to load ${filepath}:`, error)
      }
    }

    if (!loaded) {
      const primary = group[0]
      if (primary) {
        report.skippedManifests.push({
          path: primary,
          reason: 'load-failed',
        })
      }
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

function groupManifestsByDirectory(filepaths: string[]): string[][] {
  const byDirectory = new Map<string, string[]>()

  for (const filepath of filepaths) {
    const directory = resolve(filepath, '..')
    const group = byDirectory.get(directory) ?? []
    group.push(filepath)
    byDirectory.set(directory, group)
  }

  return [...byDirectory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([_directory, manifests]) => sortManifestsByPriority(manifests))
}
