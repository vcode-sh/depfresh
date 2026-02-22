import type { PackageMeta, ResolvedDepChange } from '../types'

/**
 * Syncs engines.vscode with @types/vscode version in settings.json
 */
export function addonVSCode(pkg: PackageMeta, changes: ResolvedDepChange[]): void {
  const vscodeChange = changes.find((c) => c.name === '@types/vscode')
  if (!vscodeChange) return

  const raw = pkg.raw as Record<string, unknown>
  if (raw.engines && typeof raw.engines === 'object') {
    const engines = raw.engines as Record<string, string>
    if (engines.vscode) {
      engines.vscode = `^${vscodeChange.targetVersion}`
    }
  }
}
