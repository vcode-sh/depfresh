import { readFileSync } from 'node:fs'
import { findUpSync } from 'find-up-simple'
import { basename, dirname, resolve } from 'pathe'
import YAML from 'yaml'

export type WorkspaceBoundaryClassification =
  | 'same-root'
  | 'plain-child'
  | 'nested-root'
  | 'nested-descendant'

export type WorkspaceBoundaryMarker =
  | 'pnpm-workspace'
  | 'yarn-workspace'
  | 'manifest-workspaces'
  | 'git-repo'

export interface WorkspaceBoundaryInfo {
  classification: WorkspaceBoundaryClassification
  marker?: WorkspaceBoundaryMarker
  markerPath?: string
}

export function classifyWorkspaceBoundary(
  filepath: string,
  rootDir: string,
): WorkspaceBoundaryInfo {
  const pkgDir = dirname(filepath)
  const normalizedRoot = resolve(rootDir)
  const parentDir = dirname(pkgDir)

  // If the package is at the root, it never belongs to a nested workspace
  if (resolve(pkgDir) === normalizedRoot) {
    return { classification: 'same-root' }
  }

  const rootMarker = getWorkspaceRootMarker(pkgDir, filepath)
  if (rootMarker) {
    return {
      classification: 'nested-root',
      marker: rootMarker.marker,
      markerPath: rootMarker.path,
    }
  }

  const ancestorMarker = getAncestorWorkspaceMarker(parentDir, normalizedRoot)
  if (ancestorMarker) {
    return {
      classification: 'nested-descendant',
      marker: ancestorMarker.marker,
      markerPath: ancestorMarker.path,
    }
  }

  return { classification: 'plain-child' }
}

/**
 * Check if a package manifest belongs to a nested workspace (not our root workspace).
 * Kept as a convenience wrapper around the richer boundary classification.
 */
export function belongsToNestedWorkspace(filepath: string, rootDir: string): boolean {
  return classifyWorkspaceBoundary(filepath, rootDir).classification === 'nested-descendant'
}

function getWorkspaceRootMarker(
  pkgDir: string,
  filepath: string,
): { marker: WorkspaceBoundaryMarker; path: string } | null {
  const pnpmWorkspace = resolve(pkgDir, 'pnpm-workspace.yaml')
  if (basename(pnpmWorkspace) && existsWorkspaceMarker(pnpmWorkspace)) {
    return { marker: 'pnpm-workspace', path: pnpmWorkspace }
  }

  const yarnWorkspace = resolve(pkgDir, '.yarnrc.yml')
  if (existsWorkspaceMarker(yarnWorkspace)) {
    return { marker: 'yarn-workspace', path: yarnWorkspace }
  }

  if (hasWorkspaceField(filepath)) {
    return { marker: 'manifest-workspaces', path: filepath }
  }

  const gitWorkspace = resolve(pkgDir, '.git')
  const gitMarker =
    findUpSync('.git', { cwd: pkgDir, stopAt: pkgDir, type: 'directory' }) ??
    findUpSync('.git', { cwd: pkgDir, stopAt: pkgDir, type: 'file' })
  if (gitMarker && resolve(gitMarker) === gitWorkspace) {
    return { marker: 'git-repo', path: gitWorkspace }
  }

  return null
}

function getAncestorWorkspaceMarker(
  startDir: string,
  normalizedRoot: string,
): { marker: WorkspaceBoundaryMarker; path: string } | null {
  if (resolve(startDir) === normalizedRoot) {
    return null
  }

  const pnpmWs = findUpSync('pnpm-workspace.yaml', { cwd: startDir, stopAt: normalizedRoot })
  if (pnpmWs && resolve(dirname(pnpmWs)) !== normalizedRoot) {
    return { marker: 'pnpm-workspace', path: pnpmWs }
  }

  const yarnRc = findUpSync('.yarnrc.yml', { cwd: startDir, stopAt: normalizedRoot })
  if (yarnRc && resolve(dirname(yarnRc)) !== normalizedRoot) {
    return { marker: 'yarn-workspace', path: yarnRc }
  }

  const nestedJson = findUpSync('package.json', { cwd: startDir, stopAt: normalizedRoot })
  const nestedYaml = findUpSync('package.yaml', { cwd: startDir, stopAt: normalizedRoot })

  const parentManifests = [nestedJson, nestedYaml]
    .filter((candidate): candidate is string => !!candidate)
    .filter((candidate) => resolve(dirname(candidate)) !== normalizedRoot)
    .sort((a, b) => b.length - a.length)

  for (const manifest of parentManifests) {
    if (hasWorkspaceField(manifest)) {
      return { marker: 'manifest-workspaces', path: manifest }
    }
  }

  const gitDir =
    findUpSync('.git', {
      cwd: startDir,
      stopAt: normalizedRoot,
      type: 'directory',
    }) ??
    findUpSync('.git', {
      cwd: startDir,
      stopAt: normalizedRoot,
      type: 'file',
    })
  if (gitDir && resolve(dirname(gitDir)) !== normalizedRoot) {
    return { marker: 'git-repo', path: gitDir }
  }

  return null
}

function existsWorkspaceMarker(filepath: string): boolean {
  try {
    return readFileSync(filepath, 'utf-8').length >= 0
  } catch {
    return false
  }
}

function hasWorkspaceField(filepath: string): boolean {
  try {
    const content = readFileSync(filepath, 'utf-8')
    if (filepath.endsWith('.yaml')) {
      const doc = YAML.parseDocument(content)
      if (doc.errors.length > 0) return false
      return hasWorkspacesField(doc.toJSON())
    }
    return hasWorkspacesField(JSON.parse(content))
  } catch {
    return false
  }
}

function hasWorkspacesField(raw: unknown): boolean {
  return !!(raw && typeof raw === 'object' && (raw as Record<string, unknown>).workspaces)
}
