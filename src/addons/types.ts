import type { ResolvedDepChange } from '../types/dependencies'
import type { depfreshOptions } from '../types/options'
import type { PackageMeta } from '../types/package'

export type AddonHookName =
  | 'setup'
  | 'afterPackagesLoaded'
  | 'beforePackageStart'
  | 'onDependencyResolved'
  | 'beforePackageWrite'
  | 'afterPackageWrite'
  | 'afterPackageEnd'
  | 'afterPackagesEnd'

export interface AddonContext {
  readonly options: depfreshOptions
  readonly runId: string
  readonly startedAt: Date
}

export interface depfreshAddon {
  name: string
  setup?: (ctx: AddonContext) => void | Promise<void>
  afterPackagesLoaded?: (ctx: AddonContext, pkgs: PackageMeta[]) => void | Promise<void>
  beforePackageStart?: (ctx: AddonContext, pkg: PackageMeta) => void | Promise<void>
  onDependencyResolved?: (
    ctx: AddonContext,
    pkg: PackageMeta,
    dep: ResolvedDepChange,
  ) => void | Promise<void>
  beforePackageWrite?: (
    ctx: AddonContext,
    pkg: PackageMeta,
    changes: ResolvedDepChange[],
  ) => boolean | Promise<boolean>
  afterPackageWrite?: (
    ctx: AddonContext,
    pkg: PackageMeta,
    changes: ResolvedDepChange[],
  ) => void | Promise<void>
  afterPackageEnd?: (ctx: AddonContext, pkg: PackageMeta) => void | Promise<void>
  afterPackagesEnd?: (ctx: AddonContext, pkgs: PackageMeta[]) => void | Promise<void>
}
