import c from 'ansis'
import type { DiffType } from '../../types'

const DIFF_COLORS: Record<DiffType, (s: string) => string> = {
  major: c.red,
  minor: c.yellow,
  patch: c.green,
  none: c.gray,
  error: c.red,
}

export function colorDiff(diff: DiffType): string {
  const color = DIFF_COLORS[diff]
  return color(diff)
}

export function colorVersion(version: string, diff: DiffType): string {
  const color = DIFF_COLORS[diff]
  return color(version)
}

export function colorizeVersionDiff(from: string, to: string, diff: DiffType): string {
  if (diff === 'none' || diff === 'error') return colorVersion(to, diff)

  const color = DIFF_COLORS[diff]

  // Strip leading range prefixes (^, ~, >=, etc.) for comparison.
  const prefixMatch = to.match(/^([^\d]*)(.*)$/)
  const prefix = prefixMatch?.[1] ?? ''
  const toVersion = prefixMatch?.[2] ?? to

  const fromPrefixMatch = from.match(/^([^\d]*)(.*)$/)
  const fromVersion = fromPrefixMatch?.[2] ?? from

  const fromParts = fromVersion.split('.')
  const toParts = toVersion.split('.')

  let diffIdx = -1
  for (let i = 0; i < toParts.length; i++) {
    if (fromParts[i] !== toParts[i]) {
      diffIdx = i
      break
    }
  }

  if (diffIdx === -1) return colorVersion(to, diff)

  const unchanged = toParts.slice(0, diffIdx).join('.')
  const changed = toParts.slice(diffIdx).join('.')
  const separator = diffIdx > 0 ? '.' : ''

  return prefix + unchanged + separator + color(changed)
}

export function arrow(): string {
  return c.gray(' -> ')
}
