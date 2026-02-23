import { readFileSync } from 'node:fs'
import { findUpSync } from 'find-up-simple'
import { dirname, resolve } from 'pathe'
import YAML from 'yaml'

/**
 * Check if a package manifest belongs to a nested workspace (not our root workspace).
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

  // Check if this manifest itself is a nested workspace root
  if (hasWorkspaceField(filepath)) return true

  // Check for parent manifests with workspaces field.
  // Start from the parent of pkgDir to avoid matching the file itself.
  const parentDir = dirname(pkgDir)
  if (resolve(parentDir) !== normalizedRoot) {
    const nestedJson = findUpSync('package.json', { cwd: parentDir, stopAt: normalizedRoot })
    const nestedYaml = findUpSync('package.yaml', { cwd: parentDir, stopAt: normalizedRoot })

    const parentManifests = [nestedJson, nestedYaml]
      .filter((candidate): candidate is string => !!candidate)
      .filter((candidate) => resolve(dirname(candidate)) !== normalizedRoot)
      .sort((a, b) => b.length - a.length)

    for (const manifest of parentManifests) {
      if (hasWorkspaceField(manifest)) return true
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
