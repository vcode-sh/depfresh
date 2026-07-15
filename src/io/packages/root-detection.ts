import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'pathe'
import YAML from 'yaml'
import { resolveContainedPath } from './containment'

export type DiscoveryMode = 'direct-root' | 'inside-project' | 'parent-folder'

export interface DiscoveryContext {
  inputCwd: string
  effectiveRoot: string
  discoveryMode: DiscoveryMode
}

export function resolveDiscoveryContext(inputCwd: string): DiscoveryContext {
  const normalizedInput = canonicalizeExistingPath(inputCwd)
  const nearestWorkspaceRoot = findNearestAncestor(normalizedInput, isWorkspaceRoot)
  const nearestPackageRoot = findNearestAncestor(normalizedInput, hasManifest)

  if (nearestWorkspaceRoot) {
    return {
      inputCwd,
      effectiveRoot: nearestWorkspaceRoot,
      discoveryMode: nearestWorkspaceRoot === normalizedInput ? 'direct-root' : 'inside-project',
    }
  }

  if (nearestPackageRoot) {
    return {
      inputCwd,
      effectiveRoot: nearestPackageRoot,
      discoveryMode: nearestPackageRoot === normalizedInput ? 'direct-root' : 'inside-project',
    }
  }

  return {
    inputCwd,
    effectiveRoot: normalizedInput,
    discoveryMode: 'parent-folder',
  }
}

function findNearestAncestor(
  startDir: string,
  predicate: (dir: string) => boolean,
): string | undefined {
  let current = startDir

  while (true) {
    if (predicate(current)) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

function hasManifest(dir: string): boolean {
  return (
    hasContainedPath(dir, join(dir, 'package.json')) ||
    hasContainedPath(dir, join(dir, 'package.yaml'))
  )
}

function isWorkspaceRoot(dir: string): boolean {
  return (
    hasContainedPath(dir, join(dir, 'pnpm-workspace.yaml')) ||
    hasContainedPath(dir, join(dir, '.yarnrc.yml')) ||
    manifestHasWorkspaces(join(dir, 'package.json')) ||
    manifestHasWorkspaces(join(dir, 'package.yaml'))
  )
}

function manifestHasWorkspaces(filepath: string): boolean {
  if (!existsSync(filepath)) {
    return false
  }

  const contained = resolveContainedPath(dirname(filepath), filepath)
  if (!contained.allowed) return false

  try {
    const content = readFileSync(contained.path, 'utf-8')
    if (contained.path.endsWith('.yaml')) {
      const doc = YAML.parseDocument(content)
      if (doc.errors.length > 0) return false
      return hasWorkspacesField(doc.toJSON())
    }

    return hasWorkspacesField(JSON.parse(content))
  } catch {
    return false
  }
}

function hasContainedPath(root: string, filepath: string): boolean {
  return existsSync(filepath) && resolveContainedPath(root, filepath).allowed
}

function canonicalizeExistingPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function hasWorkspacesField(raw: unknown): boolean {
  return !!(raw && typeof raw === 'object' && (raw as Record<string, unknown>).workspaces)
}
