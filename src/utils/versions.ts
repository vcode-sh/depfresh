import * as semver from 'semver'
import type { DiffType } from '../types'

export type SpecShape = 'simple' | 'x-range' | 'complex'

const PREFIX_RE = /^(\^|~|=)?/
const X_RANGE_RE = /^(\d+)(\.(\d+))?\.(x|X|\*)$/

export function getVersionPrefix(version: string): string {
  const match = version.match(PREFIX_RE)
  const prefix = match?.[1] ?? ''
  if (!prefix) return ''

  const remainder = version.slice(prefix.length).trim()
  if (remainder.includes(' ') || remainder.includes('||')) {
    return ''
  }

  return prefix
}

export function getSpecShape(version: string): SpecShape {
  if (version === '*' || version === 'x' || version === 'X') return 'complex'
  if (X_RANGE_RE.test(version)) return 'x-range'
  const prefix = version.match(/^(\^|~|=)/)?.[1] ?? ''
  const bare = version.slice(prefix.length)
  return semver.valid(bare) ? 'simple' : 'complex'
}

export function rebuildXRange(original: string, target: string): string | null {
  const match = original.match(X_RANGE_RE)
  const parsed = semver.coerce(target)
  if (!(match && parsed)) return null
  return match[3] !== undefined ? `${parsed.major}.${parsed.minor}.x` : `${parsed.major}.x`
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

export function normalizeVersion(version: string): string | null {
  const range = semver.validRange(version)
  return range ? (semver.minVersion(range)?.version ?? null) : null
}

export function getDiff(current: string, target: string): DiffType {
  const normalizedCurrent = normalizeVersion(current)
  const normalizedTarget = normalizeVersion(target)
  if (!(normalizedCurrent && normalizedTarget)) return 'error'

  const c = semver.parse(normalizedCurrent)
  const t = semver.parse(normalizedTarget)
  if (!(c && t)) return 'error'

  if (semver.eq(c, t)) return 'none'
  if (c.major !== t.major) return 'major'
  if (c.minor !== t.minor) return 'minor'
  return 'patch'
}

export function applyVersionPrefix(version: string, prefix: string): string {
  if (!prefix) return version
  return `${prefix}${version}`
}
