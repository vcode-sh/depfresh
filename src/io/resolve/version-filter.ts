import * as semver from 'semver'
import type { depfreshOptions, PackageData, RawDep } from '../../types'

export function filterVersions(
  pkgData: PackageData,
  dep: RawDep,
  options?: depfreshOptions,
): string[] {
  const currentPrerelease = semver.prerelease(dep.currentVersion)
  const currentChannel = currentPrerelease?.[0]

  let filtered = pkgData.versions.filter((v) => {
    // Skip deprecated unless current version is also deprecated
    if (pkgData.deprecated?.[v] && !pkgData.deprecated?.[dep.currentVersion]) {
      return false
    }

    const vPrerelease = semver.prerelease(v)

    // If current is not prerelease, skip all prereleases
    if (vPrerelease?.length && !currentPrerelease?.length) {
      return false
    }

    // If current IS prerelease and candidate is also prerelease,
    // only allow same channel (e.g., rc → rc, beta → beta)
    if (vPrerelease?.length && currentPrerelease?.length) {
      const vChannel = vPrerelease[0]
      if (typeof currentChannel === 'string' && typeof vChannel === 'string') {
        if (vChannel !== currentChannel) {
          return false
        }
      }
    }

    return true
  })

  // Apply cooldown / maturity period filter
  if (options?.cooldown && options.cooldown > 0) {
    filtered = filterVersionsByMaturityPeriod(filtered, pkgData.time, options.cooldown)
  }

  return filtered
}

export function filterVersionsByMaturityPeriod(
  versions: string[],
  time: Record<string, string> | undefined,
  days: number,
): string[] {
  if (!time || days <= 0) return versions

  const cutoff = Date.now() - days * 86_400_000

  const filtered = versions.filter((v) => {
    const published = time[v]
    // If no time data for this version, keep it (don't filter what we can't verify)
    if (!published) return true
    return new Date(published).getTime() <= cutoff
  })

  // If all versions were filtered out, return the original list as fallback
  return filtered.length > 0 ? filtered : versions
}
