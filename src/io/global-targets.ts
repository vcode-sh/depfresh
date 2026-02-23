import type { PackageManagerName, PackageMeta } from '../types'

export const GLOBAL_ALL_PACKAGE_MANAGERS: PackageManagerName[] = ['npm', 'pnpm', 'bun']

export interface GlobalPackageRecord {
  manager: PackageManagerName
  name: string
  version: string
}

interface DedupedPackage {
  name: string
  version: string
}

interface GlobalPackageRaw {
  managersByDependency?: Record<string, PackageManagerName[]>
}

function isPackageManagerName(value: string): value is PackageManagerName {
  return value === 'npm' || value === 'pnpm' || value === 'bun' || value === 'yarn'
}

export function dedupeGlobalPackageRecords(records: GlobalPackageRecord[]): {
  packages: DedupedPackage[]
  managersByDependency: Record<string, PackageManagerName[]>
} {
  const byName = new Map<string, { version: string; managers: Set<PackageManagerName> }>()

  for (const record of records) {
    const existing = byName.get(record.name)
    if (!existing) {
      byName.set(record.name, {
        version: record.version,
        managers: new Set([record.manager]),
      })
      continue
    }
    existing.managers.add(record.manager)
  }

  const sortedEntries = [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))
  const packages = sortedEntries.map(([name, value]) => ({
    name,
    version: value.version,
  }))

  const managersByDependency = Object.fromEntries(
    sortedEntries.map(([name, value]) => [name, [...value.managers]]),
  ) as Record<string, PackageManagerName[]>

  return { packages, managersByDependency }
}

export function getGlobalWriteTargets(pkg: PackageMeta, depName: string): PackageManagerName[] {
  const raw = pkg.raw as GlobalPackageRaw
  const mappedTargets = raw.managersByDependency?.[depName]
  if (mappedTargets && mappedTargets.length > 0) {
    return [...new Set(mappedTargets)]
  }

  if (!pkg.filepath.startsWith('global:')) {
    return []
  }

  const suffix = pkg.filepath.slice('global:'.length)
  if (!suffix) {
    return []
  }

  const parsedTargets = suffix
    .split('+')
    .map((name) => name.trim())
    .filter((name): name is PackageManagerName => name.length > 0 && isPackageManagerName(name))

  return [...new Set(parsedTargets)]
}
