import { readFileSync } from 'node:fs'
import { findUpSync } from 'find-up-simple'
import { dirname, resolve } from 'pathe'

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
