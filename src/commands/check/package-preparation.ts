import { resolvePackage } from '../../io/resolve'
import type {
  depfreshOptions,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
} from '../../types'
import { selectInteractiveUpdates } from './post-write-actions'
import type { ProcessPackageHooks } from './process-package'
import type { PackageWriteResult } from './write-flow'

export interface PreparedPackage {
  pkg: PackageMeta
  updates: ResolvedDepChange[]
  selected: ResolvedDepChange[]
  writeApproved: boolean
  kind: 'local' | 'global' | 'none'
}

const completedPackages = new WeakSet<PreparedPackage>()

export async function preparePackage(
  pkg: PackageMeta,
  options: depfreshOptions,
  authority: InvocationAuthority,
  hooks: ProcessPackageHooks,
  preResolved?: Promise<ResolvedDepChange[]> | ResolvedDepChange[],
  skipBeforePackageStart = false,
): Promise<PreparedPackage> {
  if (!skipBeforePackageStart) {
    await hooks.beforePackageStart(pkg)
  }

  try {
    pkg.resolved = preResolved
      ? await preResolved
      : await resolvePackage(
          pkg,
          options,
          hooks.cache,
          hooks.npmrc,
          hooks.workspacePackageNames,
          hooks.onDependencyProcessed,
        )

    const errorDeps = pkg.resolved.filter((dependency) => dependency.diff === 'error')
    if (errorDeps.length > 0) {
      hooks.onErrorDeps(errorDeps)
    }

    const updates = pkg.resolved.filter(
      (dependency) => dependency.diff !== 'none' && dependency.diff !== 'error',
    )
    if (updates.length === 0) {
      if (errorDeps.length === 0) {
        hooks.onAllModeNoUpdates()
      }
      return emptyPreparation(pkg, updates)
    }

    hooks.onHasUpdates(updates)

    const selected = options.interactive
      ? await selectInteractiveUpdates(updates, options.explain)
      : updates

    if (!(options.write && authority.write) || selected.length === 0) {
      return emptyPreparation(pkg, updates, selected)
    }

    const writeApproved = await hooks.beforePackageWrite(pkg, selected)
    if (!writeApproved) {
      return emptyPreparation(pkg, updates, selected)
    }

    return {
      pkg,
      updates,
      selected,
      writeApproved: true,
      kind: pkg.type === 'global' ? 'global' : 'local',
    }
  } catch (error) {
    await hooks.afterPackageEnd(pkg)
    throw error
  }
}

export async function completePreparedPackage(
  prepared: PreparedPackage,
  result: PackageWriteResult | undefined,
  hooks: ProcessPackageHooks,
): Promise<void> {
  if (completedPackages.has(prepared)) return
  completedPackages.add(prepared)

  try {
    if (!prepared.writeApproved && result) {
      throw new Error('A write result cannot complete a package that was not approved for writing.')
    }

    // An approved preparation with no result represents a writer that threw before returning.
    // Legacy semantics end the package without reporting a result or calling afterPackageWrite.
    if (prepared.writeApproved && result) {
      hooks.onPlannedUpdates(result.planned)
      hooks.onWriteResult(result)

      if (result.didWrite) {
        hooks.onDidWrite()
      }
      await hooks.afterPackageWrite(prepared.pkg, prepared.selected)
    }
  } finally {
    await hooks.afterPackageEnd(prepared.pkg)
  }
}

function emptyPreparation(
  pkg: PackageMeta,
  updates: ResolvedDepChange[],
  selected: ResolvedDepChange[] = [],
): PreparedPackage {
  return {
    pkg,
    updates,
    selected,
    writeApproved: false,
    kind: 'none',
  }
}
