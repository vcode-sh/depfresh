import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { findUpSync } from 'find-up-simple'
import { ConfigError } from '../../errors'
import { resolveContainedPath } from '../../io/packages/containment'
import { parsePackageManagerField } from '../../io/packages/package-manager-field'
import type { PackageManagerName, PackageMeta } from '../../types'
import type { Logger } from '../../utils/logger'

export function detectPackageManager(
  cwd: string,
  packages: PackageMeta[],
  rootDir?: string,
): PackageManagerName {
  const boundary = resolveSearchBoundary(cwd, rootDir)
  const manifestPm = boundary
    ? detectPackageManagerFromManifest(boundary.start, boundary.root)
    : undefined
  if (manifestPm) return manifestPm

  if (
    boundary &&
    (findContainedMarker('bun.lock', boundary) || findContainedMarker('bun.lockb', boundary))
  ) {
    return 'bun'
  }
  if (boundary && findContainedMarker('pnpm-lock.yaml', boundary)) return 'pnpm'
  if (boundary && findContainedMarker('yarn.lock', boundary)) return 'yarn'

  const packageManagers = new Set<PackageManagerName>()
  for (const pkg of packages) {
    if (pkg.packageManager?.name) {
      packageManagers.add(pkg.packageManager.name)
    }
  }

  if (packageManagers.size === 1) {
    return packageManagers.values().next().value as PackageManagerName
  }

  return 'npm'
}

export async function runInstall(
  cwd: string,
  packages: PackageMeta[],
  logger: Logger,
): Promise<boolean> {
  void cwd
  void packages
  void logger
  throw retiredManagerPhaseError('--install')
}

export async function runUpdate(
  cwd: string,
  packages: PackageMeta[],
  logger: Logger,
): Promise<boolean> {
  void cwd
  void packages
  void logger
  throw retiredManagerPhaseError('--update')
}

function retiredManagerPhaseError(flag: string): ConfigError {
  return new ConfigError(`${flag} requires the explicit plan/apply phase workflow.`, {
    reason: 'UNSUPPORTED_COMBINATION',
  })
}

interface SearchBoundary {
  root?: string
  start: string
}

function detectPackageManagerFromManifest(
  cwd: string,
  rootDir?: string,
): PackageManagerName | undefined {
  let current = cwd

  while (true) {
    const packageJsonPath = join(current, 'package.json')

    const contained = rootDir ? resolveContainedPath(rootDir, packageJsonPath) : undefined
    if (!rootDir || contained?.allowed) {
      try {
        const filepath = contained?.allowed ? contained.path : packageJsonPath
        const raw = JSON.parse(readFileSync(filepath, 'utf-8')) as Record<string, unknown>
        if (typeof raw.packageManager === 'string') {
          return parsePackageManagerField(raw.packageManager)?.name
        }
      } catch {
        // Ignore missing or malformed manifests and keep walking upward.
      }
    }

    if (rootDir && current === rootDir) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return undefined
}

function resolveSearchBoundary(cwd: string, rootDir: string | undefined): SearchBoundary | null {
  if (!rootDir) return { start: resolve(cwd) }

  const root = resolveContainedPath(rootDir, rootDir)
  if (!root.allowed) return null
  const start = resolveContainedPath(rootDir, cwd)
  if (!start.allowed) return null
  return { root: root.path, start: start.path }
}

function findContainedMarker(filename: string, boundary: SearchBoundary): string | undefined {
  const candidate = findUpSync(filename, {
    cwd: boundary.start,
    stopAt: boundary.root,
  })
  if (!candidate) return undefined
  if (!boundary.root) return candidate

  const contained = resolveContainedPath(boundary.root, candidate)
  return contained.allowed ? contained.path : undefined
}
