import type { createSqliteCache } from '../../cache/index'
import { resolvePackage } from '../../io/resolve'
import type { depfreshOptions, PackageMeta, ResolvedDepChange } from '../../types'
import type { Logger } from '../../utils/logger'
import type { loadNpmrc } from '../../utils/npmrc'
import { selectInteractiveUpdates } from './post-write-actions'
import { applyPackageWrite, type PackageWriteResult } from './write-flow'

export interface ProcessPackageHooks {
  cache: ReturnType<typeof createSqliteCache>
  npmrc: ReturnType<typeof loadNpmrc>
  workspacePackageNames: Set<string>
  onDependencyProcessed: () => void
  onHasUpdates: (updates: ResolvedDepChange[]) => void
  onErrorDeps: (errors: ResolvedDepChange[]) => void
  onAllModeNoUpdates: () => void
  onPlannedUpdates: (count: number) => void
  onWriteResult: (result: PackageWriteResult) => void
  onDidWrite: () => void
  logger: Logger
}

export async function processPackage(
  pkg: PackageMeta,
  options: depfreshOptions,
  hooks: ProcessPackageHooks,
): Promise<void> {
  await options.beforePackageStart?.(pkg)
  try {
    pkg.resolved = await resolvePackage(
      pkg,
      options,
      hooks.cache,
      hooks.npmrc,
      hooks.workspacePackageNames,
      hooks.onDependencyProcessed,
    )

    const errorDeps = pkg.resolved.filter((d) => d.diff === 'error')
    if (errorDeps.length > 0) {
      hooks.onErrorDeps(errorDeps)
    }

    const updates = pkg.resolved.filter((d) => d.diff !== 'none' && d.diff !== 'error')
    if (updates.length === 0) {
      hooks.onAllModeNoUpdates()
      return
    }

    hooks.onHasUpdates(updates)

    const selected = options.interactive
      ? await selectInteractiveUpdates(updates, options.explain)
      : updates

    if (!options.write || selected.length === 0) return

    const shouldWrite = (await options.beforePackageWrite?.(pkg)) ?? true
    if (!shouldWrite) return

    hooks.onPlannedUpdates(selected.length)

    const writeResult = await applyPackageWrite(pkg, selected, options, hooks.logger)
    hooks.onWriteResult(writeResult)

    if (writeResult.didWrite) {
      hooks.onDidWrite()
    }
    await options.afterPackageWrite?.(pkg)
  } finally {
    await options.afterPackageEnd?.(pkg)
  }
}
