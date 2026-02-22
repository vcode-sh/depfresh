import c from 'ansis'
import type { DiffType } from '../types'

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

  // Strip leading range prefixes (^, ~, >=, etc.) for comparison
  const prefixMatch = to.match(/^([^\d]*)(.*)$/)
  const prefix = prefixMatch?.[1] ?? ''
  const toVersion = prefixMatch?.[2] ?? to

  const fromPrefixMatch = from.match(/^([^\d]*)(.*)$/)
  const fromVersion = fromPrefixMatch?.[2] ?? from

  const fromParts = fromVersion.split('.')
  const toParts = toVersion.split('.')

  // Find first differing segment
  let diffIdx = -1
  for (let i = 0; i < toParts.length; i++) {
    if (fromParts[i] !== toParts[i]) {
      diffIdx = i
      break
    }
  }

  // If no diff found (shouldn't happen when diff !== 'none'), color entire version
  if (diffIdx === -1) return colorVersion(to, diff)

  const unchanged = toParts.slice(0, diffIdx).join('.')
  const changed = toParts.slice(diffIdx).join('.')
  const separator = diffIdx > 0 ? '.' : ''

  return prefix + unchanged + separator + color(changed)
}

export function arrow(): string {
  return c.gray(' -> ')
}

export function padEnd(str: string, len: number): string {
  const visible = stripAnsi(str)
  const diff = len - visible.length
  return diff > 0 ? str + ' '.repeat(diff) : str
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'g')

export function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, '')
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return `${str.slice(0, maxLen - 1)}…`
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function timeDifference(
  dateStr: string | undefined,
): { text: string; color: 'green' | 'yellow' | 'red' } | undefined {
  if (!dateStr) return undefined

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return undefined

  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0) return { text: '~0d', color: 'green' }

  const days = diffMs / (1000 * 60 * 60 * 24)

  if (days < 90) {
    const d = Math.max(1, Math.round(days))
    return { text: `~${d}d`, color: 'green' }
  }

  if (days < 365) {
    const months = Math.round(days / 30)
    return { text: `~${months}mo`, color: 'yellow' }
  }

  const years = days / 365
  const formatted = years >= 10 ? `~${Math.round(years)}y` : `~${years.toFixed(1)}y`
  return { text: formatted, color: 'red' }
}
