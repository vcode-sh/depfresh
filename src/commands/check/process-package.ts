import type { createSqliteCache } from '../../cache/index'
import type {
  depfreshOptions,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
} from '../../types'
import type { Logger } from '../../utils/logger'
import type { loadNpmrc } from '../../utils/npmrc'
import { completePreparedPackage, preparePackage } from './package-preparation'
import { applyPackageWrite, type PackageWriteResult } from './write-flow'

export interface ProcessPackageHooks {
  cache: ReturnType<typeof createSqliteCache>
  npmrc: ReturnType<typeof loadNpmrc>
  workspacePackageNames: Set<string>
  beforePackageStart: (pkg: PackageMeta) => void | Promise<void>
  beforePackageWrite: (pkg: PackageMeta, changes: ResolvedDepChange[]) => boolean | Promise<boolean>
  afterPackageWrite: (pkg: PackageMeta, changes: ResolvedDepChange[]) => void | Promise<void>
  afterPackageEnd: (pkg: PackageMeta) => void | Promise<void>
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
  authority: InvocationAuthority,
  hooks: ProcessPackageHooks,
  preResolved?: Promise<ResolvedDepChange[]> | ResolvedDepChange[],
  skipBeforePackageStart = false,
): Promise<void> {
  const prepared = await preparePackage(
    pkg,
    options,
    authority,
    hooks,
    preResolved,
    skipBeforePackageStart,
  )

  let writeResult: PackageWriteResult | undefined
  try {
    if (prepared.writeApproved) {
      writeResult = await applyPackageWrite(
        prepared.pkg,
        prepared.selected,
        options,
        authority,
        hooks.logger,
      )
    }
  } catch (error) {
    await completePreparedPackage(prepared, undefined, hooks)
    throw error
  }

  await completePreparedPackage(prepared, writeResult, hooks)
}
