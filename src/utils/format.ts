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
