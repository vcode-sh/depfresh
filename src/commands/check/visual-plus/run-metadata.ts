import {
  type BigIntStats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { isDocument } from 'yaml'
import { type ContainedPathResult, resolveContainedPath } from '../../../io/packages/containment'
import type { PackageManagerName, PackageMeta } from '../../../types'
import type { VisualPlusPackageManagerMetadata, VisualPlusRunMetadata } from './input'

type VisualPlusPresentation = Pick<VisualPlusRunMetadata, 'detailLevel' | 'display'>

const MANAGER_MARKERS = [
  { source: 'bun.lock', name: 'bun' },
  { source: 'bun.lockb', name: 'bun' },
  { source: 'npm-shrinkwrap.json', name: 'npm' },
  { source: 'package-lock.json', name: 'npm' },
  { source: 'pnpm-lock.yaml', name: 'pnpm' },
  { source: 'yarn.lock', name: 'yarn' },
] as const satisfies readonly { source: string; name: PackageManagerName }[]

interface ManagerCandidate {
  name: PackageManagerName
  version?: string
  source: string
}

interface ContainedPackage {
  pkg: PackageMeta
  directory: string
  source: string
}

export function deriveVisualPlusRunMetadata(
  root: string,
  packages: readonly PackageMeta[],
  presentation: VisualPlusPresentation,
): VisualPlusRunMetadata {
  const detail =
    presentation.detailLevel === undefined ? {} : { detailLevel: presentation.detailLevel }
  const display = Object.freeze({ ...presentation.display })
  const rootResolution = resolveContainedPath(root, root)
  if (!rootResolution.allowed) {
    return {
      ...detail,
      display,
      repository: { relativePath: '.' },
      workspaceScope: 'unknown',
      packageManager: { status: 'unavailable', sources: [] },
    }
  }

  const containedPackages = packages.flatMap((pkg) => {
    if (!(pkg.type === 'package.json' || pkg.type === 'package.yaml')) return []
    const contained = resolvePackagePath(root, pkg.filepath)
    if (!contained.allowed) return []
    return [
      {
        pkg,
        directory: dirname(contained.path),
        source: repositoryPath(rootResolution.path, contained.path),
      },
    ] satisfies ContainedPackage[]
  })
  const packageDirectories = new Set(containedPackages.map((entry) => entry.directory))
  const rootPackages = containedPackages.filter((entry) => entry.directory === rootResolution.path)
  const repositoryPackages =
    rootPackages.length > 0 ? rootPackages : packageDirectories.size === 1 ? containedPackages : []
  const repositoryDirectory = repositoryPackages[0]?.directory ?? rootResolution.path
  const repositoryNames = [
    ...new Set(repositoryPackages.flatMap((entry) => explicitManifestName(entry.pkg) ?? [])),
  ].sort()
  const repositoryName =
    repositoryNames.length === 1
      ? repositoryNames[0]
      : repositoryPackages.length > 0
        ? basename(rootResolution.path)
        : undefined
  const hasWorkspaceProjection = packages.some(
    (pkg) =>
      ['pnpm-workspace', 'bun-workspace', 'yarn-workspace'].includes(pkg.type) &&
      resolvePackagePath(root, pkg.filepath).allowed,
  )
  const workspaceScope =
    packageDirectories.size === 0
      ? hasWorkspaceProjection
        ? 'workspace'
        : 'unknown'
      : packageDirectories.size === 1 && !hasWorkspaceProjection
        ? 'single-package'
        : 'workspace'

  return {
    ...detail,
    display,
    repository: {
      ...(repositoryName ? { name: repositoryName } : {}),
      relativePath: repositoryPath(rootResolution.path, repositoryDirectory),
    },
    workspaceScope,
    packageManager: derivePackageManager(rootResolution.path, rootPackages),
  }
}

function explicitManifestName(pkg: PackageMeta): string | undefined {
  let name: unknown
  if (pkg.type === 'package.json' && isRecord(pkg.raw)) name = pkg.raw.name
  else if (pkg.type === 'package.yaml' && isDocument(pkg.raw)) name = pkg.raw.get('name')
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolvePackagePath(root: string, candidate: string): ContainedPathResult {
  const direct = resolveContainedPath(root, candidate)
  if (direct.allowed) return direct
  if (direct.reason !== 'OUTSIDE_ROOT') return direct
  try {
    const canonicalCandidate = realpathSync.native(
      isAbsolute(candidate) ? candidate : join(root, candidate),
    )
    return resolveContainedPath(root, canonicalCandidate)
  } catch {
    return direct
  }
}

function derivePackageManager(
  root: string,
  rootPackages: readonly ContainedPackage[],
): VisualPlusPackageManagerMetadata {
  const candidates: ManagerCandidate[] = rootPackages.flatMap(({ pkg, source }) =>
    pkg.packageManager
      ? [
          {
            name: pkg.packageManager.name,
            version: pkg.packageManager.version,
            source,
          },
        ]
      : [],
  )
  const unavailable: string[] = []
  for (const marker of MANAGER_MARKERS) {
    const state = inspectMarker(root, marker.source)
    if (state === 'absent') continue
    if (state === 'unavailable') unavailable.push(marker.source)
    else candidates.push({ name: marker.name, source: marker.source })
  }
  unavailable.sort()
  if (unavailable.length > 0) return { status: 'unavailable', sources: unavailable }
  candidates.sort((left, right) => left.source.localeCompare(right.source))
  if (candidates.length === 0) return { status: 'unknown', sources: [] }

  const names = new Set(candidates.map((candidate) => candidate.name))
  const declaredVersions = new Set(
    candidates.flatMap((candidate) => (candidate.version === undefined ? [] : [candidate.version])),
  )
  if (names.size === 1 && declaredVersions.size <= 1) {
    return {
      status: 'observed',
      name: candidates[0]!.name,
      ...(declaredVersions.size === 1 ? { version: [...declaredVersions][0] } : {}),
      sources: candidates.map((candidate) => candidate.source) as [string, ...string[]],
    }
  }
  return {
    status: 'ambiguous',
    candidates: candidates.map((candidate) => ({
      name: candidate.name,
      ...(candidate.version === undefined ? {} : { version: candidate.version }),
      source: candidate.source,
    })),
  }
}

function inspectMarker(root: string, source: string): 'absent' | 'observed' | 'unavailable' {
  const lexicalPath = join(root, source)
  let lexical: BigIntStats
  try {
    lexical = lstatSync(lexicalPath, { bigint: true })
  } catch (error) {
    return isMissingPath(error) ? 'absent' : 'unavailable'
  }
  if (!lexical.isFile() || lexical.isSymbolicLink()) return 'unavailable'

  let descriptor: number | undefined
  try {
    const contained = resolveContainedPath(root, lexicalPath)
    if (!contained.allowed) return 'unavailable'
    descriptor = openSync(lexicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor, { bigint: true })
    const fileTypeMask = BigInt(constants.S_IFMT)
    if (
      !opened.isFile() ||
      opened.dev !== lexical.dev ||
      opened.ino !== lexical.ino ||
      (opened.mode & fileTypeMask) !== (lexical.mode & fileTypeMask)
    ) {
      return 'unavailable'
    }
    return 'observed'
  } catch {
    return 'unavailable'
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {}
    }
  }
}

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: unknown }).code === 'ENOENT'
  )
}

function repositoryPath(root: string, path: string): string {
  const value = relative(root, path)
  if (value.length === 0) return '.'
  return value.split(sep).join('/') || basename(path)
}
