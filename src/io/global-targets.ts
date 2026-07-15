import * as semver from 'semver'
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
  versionsByDependency?: Record<string, Partial<Record<PackageManagerName, string>>>
}

function isPackageManagerName(value: string): value is PackageManagerName {
  return value === 'npm' || value === 'pnpm' || value === 'bun' || value === 'yarn'
}

export function dedupeGlobalPackageRecords(records: GlobalPackageRecord[]): {
  packages: DedupedPackage[]
  managersByDependency: Record<string, PackageManagerName[]>
  versionsByDependency: Record<string, Partial<Record<PackageManagerName, string>>>
} {
  const byName = new Map<
    string,
    {
      version: string
      managers: Set<PackageManagerName>
      versions: Partial<Record<PackageManagerName, string>>
    }
  >()

  for (const record of records) {
    const existing = byName.get(record.name)
    if (!existing) {
      byName.set(record.name, {
        version: record.version,
        managers: new Set([record.manager]),
        versions: { [record.manager]: record.version },
      })
      continue
    }
    existing.managers.add(record.manager)
    existing.versions[record.manager] = record.version
    if (semver.valid(record.version) && semver.valid(existing.version)) {
      if (semver.gt(record.version, existing.version)) {
        existing.version = record.version
      }
      continue
    }

    if (semver.valid(record.version) && !semver.valid(existing.version)) {
      existing.version = record.version
    }
  }

  const sortedEntries = [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))
  const packages = sortedEntries.map(([name, value]) => ({
    name,
    version: value.version,
  }))

  const managersByDependency = Object.fromEntries(
    sortedEntries.map(([name, value]) => [name, [...value.managers]]),
  ) as Record<string, PackageManagerName[]>

  const versionsByDependency = Object.fromEntries(
    sortedEntries.map(([name, value]) => [name, value.versions]),
  ) as Record<string, Partial<Record<PackageManagerName, string>>>

  return { packages, managersByDependency, versionsByDependency }
}

export function getGlobalExpectedVersion(
  pkg: PackageMeta,
  depName: string,
  manager: PackageManagerName,
): string | undefined {
  const raw = pkg.raw as GlobalPackageRaw
  return raw.versionsByDependency?.[depName]?.[manager]
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
