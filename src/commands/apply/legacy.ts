import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import type {
  CatalogSource,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
  WriteOutcome,
} from '../../types'
import { applyLegacyCommandWrite, type LegacyWriteDiagnostic } from './legacy-plan'

export type { LegacyWriteDiagnostic } from './legacy-plan'

export interface LegacyPackageApplyResult {
  outcomes: WriteOutcome[]
  diagnostics: LegacyWriteDiagnostic[]
}

export async function applyLegacyPackageWrite(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  _loglevel: 'silent' | 'info' | 'debug',
  authority: InvocationAuthority,
): Promise<LegacyPackageApplyResult> {
  const root = commonRoot(physicalSourcePaths(pkg, changes))
  const result = await applyLegacyCommandWrite(root, [{ packageIndex: 0, pkg, changes }], authority)
  return {
    outcomes: result.packages[0]?.outcomes ?? [],
    diagnostics: result.diagnostics,
  }
}

function physicalSourcePaths(pkg: PackageMeta, changes: readonly ResolvedDepChange[]): string[] {
  if (pkg.type === 'package.json' || pkg.type === 'package.yaml') return [pkg.filepath]
  const paths = changes.flatMap((change) =>
    findCatalogMatches(pkg.catalogs ?? [], change).map((catalog) => catalog.filepath),
  )
  return paths.length > 0 ? paths : [pkg.filepath]
}

function commonRoot(paths: readonly string[]): string {
  const canonical = paths.map((path) => realpathSync.native(path))
  let root = dirname(canonical[0]!)
  while (canonical.some((path) => !inside(root, path))) {
    const parent = dirname(root)
    if (parent === root) break
    root = parent
  }
  return root
}

function inside(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || !(value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value))
}

function findCatalogMatches(catalogs: CatalogSource[], change: ResolvedDepChange): CatalogSource[] {
  return catalogs.filter((catalog) =>
    catalog.deps.some(
      (dependency) =>
        dependency.name === change.name &&
        (change.parents.length === 0 ||
          (dependency.parents.length === change.parents.length &&
            dependency.parents.every((parent, index) => parent === change.parents[index]))),
    ),
  )
}
