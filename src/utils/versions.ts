import * as semver from 'semver'
import type { DiffType, RangeMode } from '../types'

const PREFIX_RE = /^(\^|~|>=?|<=?|=)?/

export function getVersionPrefix(version: string): string {
  const match = version.match(PREFIX_RE)
  return match?.[1] ?? ''
}

export function isRange(version: string): boolean {
  return /[~^>=<|*x ]/.test(version)
}

export function isLocked(version: string): boolean {
  return !isRange(version) && !!semver.valid(version)
}

export function getMaxSatisfying(versions: string[], range: string): string | null {
  // Never rely on array ordering — explicitly find the maximum
  const valid = versions.filter((v) => semver.satisfies(v, range))
  if (valid.length === 0) return null

  return valid.reduce((max, v) => (semver.gt(v, max) ? v : max), valid[0]!)
}

export function getMaxVersion(versions: string[]): string | null {
  if (versions.length === 0) return null
  return versions.reduce((max, v) => (semver.gt(v, max) ? v : max), versions[0]!)
}

export function getDiff(current: string, target: string): DiffType {
  const c = semver.coerce(current)
  const t = semver.coerce(target)
  if (!c || !t) return 'error'

  if (semver.eq(c, t)) return 'none'

  const diff = semver.diff(c, t)
  if (!diff) return 'none'

  if (diff.startsWith('major') || diff === 'premajor') return 'major'
  if (diff.startsWith('minor') || diff === 'preminor') return 'minor'
  if (diff.startsWith('patch') || diff === 'prepatch' || diff === 'prerelease') return 'patch'

  return 'patch'
}

export function applyVersionPrefix(version: string, prefix: string): string {
  if (!prefix) return version
  return `${prefix}${version}`
}

export function resolveTargetVersion(
  currentVersion: string,
  versions: string[],
  distTags: Record<string, string>,
  mode: RangeMode,
): string | null {
  const prefix = getVersionPrefix(currentVersion)

  switch (mode) {
    case 'latest':
      return distTags.latest ?? null

    case 'newest': {
      return getMaxVersion(versions)
    }

    case 'next':
      return distTags.next ?? distTags.latest ?? null

    case 'major':
      return getMaxVersion(versions)

    case 'minor': {
      const current = semver.coerce(currentVersion)
      if (!current) return null
      const minor = versions.filter((v) => {
        const parsed = semver.parse(v)
        return parsed && parsed.major === current.major
      })
      return getMaxVersion(minor)
    }

    case 'patch': {
      const current = semver.coerce(currentVersion)
      if (!current) return null
      const patch = versions.filter((v) => {
        const parsed = semver.parse(v)
        return parsed && parsed.major === current.major && parsed.minor === current.minor
      })
      return getMaxVersion(patch)
    }

    case 'default':
    default:
      return getMaxSatisfying(versions, currentVersion) ?? distTags.latest ?? null
  }
}
