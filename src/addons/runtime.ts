import { randomUUID } from 'node:crypto'
import { AddonError, ConfigError } from '../errors'
import type { depfreshOptions, PackageMeta, ResolvedDepChange } from '../types'
import type { AddonContext, AddonHookName, depfreshAddon } from './types'

export interface AddonLifecycle {
  setup: () => Promise<void>
  afterPackagesLoaded: (pkgs: PackageMeta[]) => Promise<void>
  beforePackageStart: (pkg: PackageMeta) => Promise<void>
  onDependencyResolved: (pkg: PackageMeta, dep: ResolvedDepChange) => Promise<void>
  beforePackageWrite: (pkg: PackageMeta, changes: ResolvedDepChange[]) => Promise<boolean>
  afterPackageWrite: (pkg: PackageMeta, changes: ResolvedDepChange[]) => Promise<void>
  afterPackageEnd: (pkg: PackageMeta) => Promise<void>
  afterPackagesEnd: (pkgs: PackageMeta[]) => Promise<void>
}

function normalizeAddons(addons: depfreshAddon[] | undefined): depfreshAddon[] {
  if (!addons || addons.length === 0) return []

  const seen = new Set<string>()
  for (const addon of addons) {
    if (!addon.name || addon.name.trim().length === 0) {
      throw new ConfigError('Addon name must be a non-empty string')
    }

    if (seen.has(addon.name)) {
      throw new ConfigError(`Duplicate addon name "${addon.name}"`)
    }
    seen.add(addon.name)
  }

  return addons
}

async function runAddonHook<T>(
  addon: depfreshAddon,
  hook: AddonHookName,
  execute: () => T | Promise<T>,
): Promise<T> {
  try {
    return await execute()
  } catch (error) {
    throw new AddonError(`Addon "${addon.name}" failed during "${hook}" hook`, addon.name, hook, {
      cause: error,
    })
  }
}

export function createAddonLifecycle(options: depfreshOptions): AddonLifecycle {
  const addons = normalizeAddons(options.addons)
  const context: AddonContext = {
    options,
    runId: randomUUID(),
    startedAt: new Date(),
  }

  return {
    async setup() {
      for (const addon of addons) {
        if (!addon.setup) continue
        await runAddonHook(addon, 'setup', () => addon.setup?.(context))
      }
    },

    async afterPackagesLoaded(pkgs: PackageMeta[]) {
      await options.afterPackagesLoaded?.(pkgs)
      for (const addon of addons) {
        if (!addon.afterPackagesLoaded) continue
        await runAddonHook(addon, 'afterPackagesLoaded', () =>
          addon.afterPackagesLoaded?.(context, pkgs),
        )
      }
    },

    async beforePackageStart(pkg: PackageMeta) {
      await options.beforePackageStart?.(pkg)
      for (const addon of addons) {
        if (!addon.beforePackageStart) continue
        await runAddonHook(addon, 'beforePackageStart', () =>
          addon.beforePackageStart?.(context, pkg),
        )
      }
    },

    async onDependencyResolved(pkg: PackageMeta, dep: ResolvedDepChange) {
      await options.onDependencyResolved?.(pkg, dep)
      for (const addon of addons) {
        if (!addon.onDependencyResolved) continue
        await runAddonHook(addon, 'onDependencyResolved', () =>
          addon.onDependencyResolved?.(context, pkg, dep),
        )
      }
    },

    async beforePackageWrite(pkg: PackageMeta, changes: ResolvedDepChange[]) {
      const callbackResult = (await options.beforePackageWrite?.(pkg)) ?? true
      if (!callbackResult) return false

      for (const addon of addons) {
        if (!addon.beforePackageWrite) continue
        const addonResult = await runAddonHook(addon, 'beforePackageWrite', () =>
          addon.beforePackageWrite?.(context, pkg, changes),
        )
        if (addonResult === false) {
          return false
        }
      }

      return true
    },

    async afterPackageWrite(pkg: PackageMeta, changes: ResolvedDepChange[]) {
      await options.afterPackageWrite?.(pkg)
      for (const addon of addons) {
        if (!addon.afterPackageWrite) continue
        await runAddonHook(addon, 'afterPackageWrite', () =>
          addon.afterPackageWrite?.(context, pkg, changes),
        )
      }
    },

    async afterPackageEnd(pkg: PackageMeta) {
      await options.afterPackageEnd?.(pkg)
      for (const addon of addons) {
        if (!addon.afterPackageEnd) continue
        await runAddonHook(addon, 'afterPackageEnd', () => addon.afterPackageEnd?.(context, pkg))
      }
    },

    async afterPackagesEnd(pkgs: PackageMeta[]) {
      await options.afterPackagesEnd?.(pkgs)
      for (const addon of addons) {
        if (!addon.afterPackagesEnd) continue
        await runAddonHook(addon, 'afterPackagesEnd', () => addon.afterPackagesEnd?.(context, pkgs))
      }
    },
  }
}
