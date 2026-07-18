import { Ansis } from 'ansis'
import { sanitizeTerminalText, visualLength } from '../../../utils/format'
import type { CheckRunPhaseStatus } from '../run-model'
import type { VisualPlusCapabilities } from './capabilities'
import type { VisualPlusSectionInput } from './input'
import { validateVisualPlusSectionInput } from './input'

export type VisualPlusSemanticStatus =
  | CheckRunPhaseStatus
  | 'applied'
  | 'reverted'
  | 'not attempted'

export interface VisualPlusTheme {
  readonly capabilities: VisualPlusCapabilities
  readonly heading: (value: string) => string
  readonly emphasis: (value: string) => string
  readonly muted: (value: string) => string
  readonly status: (status: VisualPlusSemanticStatus) => string
  readonly styleStatus: (status: VisualPlusSemanticStatus, fragment: string) => string
  readonly arrow: string
  readonly bullet: string
  readonly encodeWideGrapheme: (value: string) => string
}

export interface VisualPlusMapLine {
  readonly value: string
  readonly style?: 'heading' | 'emphasis' | 'muted'
}

export interface VisualPlusMapSymbols {
  readonly arrow: string
  readonly barFilled: string
  readonly barEmpty: string
  readonly connector: string
  readonly separator: string
}

const STATUS_LABELS: Readonly<Record<VisualPlusSemanticStatus, string>> = {
  pending: 'pending',
  active: 'active',
  passed: 'passed',
  skipped: 'skipped',
  blocked: 'blocked',
  failed: 'failed',
  unknown: 'unknown',
  applied: 'applied',
  reverted: 'reverted',
  'not attempted': 'not attempted',
}

export function createVisualPlusTheme(capabilities: VisualPlusCapabilities): VisualPlusTheme {
  const ansi = new Ansis(capabilities.color ? 1 : 0)
  const symbol = (status: VisualPlusSemanticStatus): string => {
    if (!capabilities.unicode) return `[${asciiSymbol(status)}]`
    return unicodeSymbol(status)
  }
  const colorStatus = (status: VisualPlusSemanticStatus, value: string): string => {
    if (['passed', 'applied'].includes(status)) return ansi.green(value)
    if (['blocked', 'failed'].includes(status)) return ansi.red(value)
    if (['active', 'unknown'].includes(status)) return ansi.yellow(value)
    return ansi.gray(value)
  }

  return {
    capabilities,
    heading: (value) => ansi.bold(sanitizeTerminalText(value)),
    emphasis: (value) => ansi.cyan(sanitizeTerminalText(value)),
    muted: (value) => ansi.gray(sanitizeTerminalText(value)),
    status: (status) => `${symbol(status)} ${STATUS_LABELS[status]}`,
    styleStatus: (status, fragment) => colorStatus(status, sanitizeTerminalText(fragment)),
    arrow: capabilities.unicode ? ' → ' : ' -> ',
    bullet: capabilities.unicode ? '•' : '-',
    encodeWideGrapheme: encodeWideGrapheme,
  }
}

export function wrapVisualPlusText(
  value: string,
  width: number,
  theme: VisualPlusTheme,
): readonly string[] {
  return wrapSanitizedText(sanitizeTerminalText(value), width, theme)
}

export function wrapVisualPlusStyledText(
  value: string,
  width: number,
  theme: VisualPlusTheme,
  style: (fragment: string) => string,
): readonly string[] {
  return wrapSanitizedText(sanitizeTerminalText(value), width, theme).map((fragment) =>
    style(fragment),
  )
}

export function visualPlusSectionLines(
  input: VisualPlusSectionInput,
  logicalLines: readonly string[],
): readonly string[] {
  validateVisualPlusSectionInput(input)
  const theme = createVisualPlusTheme(input.capabilities)
  return logicalLines.flatMap((line) => wrapVisualPlusText(line, input.capabilities.width, theme))
}

export function visualPlusMapLines(
  capabilities: VisualPlusCapabilities,
  logicalLines: readonly VisualPlusMapLine[],
): readonly string[] {
  const theme = createVisualPlusTheme(capabilities)
  return logicalLines.flatMap((line) => {
    const style = line.style === undefined ? undefined : theme[line.style]
    return style
      ? wrapVisualPlusStyledText(line.value, capabilities.width, theme, style)
      : wrapVisualPlusText(line.value, capabilities.width, theme)
  })
}

export function visualPlusMapSymbols(capabilities: VisualPlusCapabilities): VisualPlusMapSymbols {
  const ascii = capabilities.layout === 'plain' || !capabilities.unicode
  return {
    arrow: ascii ? ' -> ' : ' → ',
    barFilled: ascii ? '#' : '█',
    barEmpty: ascii ? '.' : '░',
    connector: capabilities.width < 16 ? '' : ascii ? '-' : '├',
    separator: ascii ? ' | ' : ' · ',
  }
}

export function formatVisualPlusAge(ageMs: number | null): string {
  if (ageMs === null) return 'unknown'
  const days = ageMs / 86_400_000
  if (days < 1) return '~0d'
  if (days < 90) return `~${Math.round(days)}d`
  if (days < 365) return `~${Math.round(days / 30)}mo`
  const years = days / 365
  return years >= 10 ? `~${Math.round(years)}y` : `~${years.toFixed(1)}y`
}

export function pluralVisualPlus(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`
}

export function visualPlusSeparator(capabilities: VisualPlusCapabilities): string {
  return capabilities.unicode ? ' · ' : ' - '
}

function wrapSanitizedText(
  value: string,
  requestedWidth: number,
  theme: VisualPlusTheme,
): readonly string[] {
  const width = Math.max(1, Math.floor(requestedWidth))
  const graphemes = splitGraphemes(value).flatMap((grapheme) => {
    if (width === 1 && visualLength(grapheme) === 2) {
      return [...theme.encodeWideGrapheme(grapheme)]
    }
    return [grapheme]
  })
  if (graphemes.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  let lineWidth = 0
  for (const grapheme of graphemes) {
    const graphemeWidth = visualLength(grapheme)
    if (line.length > 0 && lineWidth + graphemeWidth > width) {
      lines.push(line)
      line = ''
      lineWidth = 0
    }
    line += grapheme
    lineWidth += graphemeWidth
  }
  if (line.length > 0) lines.push(line)
  return lines
}

function splitGraphemes(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
      ({ segment }) => segment,
    )
  }
  return [...value]
}

function encodeWideGrapheme(value: string): string {
  const codePoints = [...value].map((character) =>
    character.codePointAt(0)!.toString(16).toUpperCase(),
  )
  return `U+{${codePoints.join('+')}}`
}

function unicodeSymbol(status: VisualPlusSemanticStatus): string {
  if (status === 'active') return '◆'
  if (status === 'passed' || status === 'applied') return '✓'
  if (status === 'blocked' || status === 'failed') return '✗'
  if (status === 'unknown') return '?'
  if (status === 'reverted') return '↩'
  return '·'
}

function asciiSymbol(status: VisualPlusSemanticStatus): string {
  if (status === 'passed' || status === 'applied') return '+'
  if (status === 'blocked' || status === 'failed') return '!'
  if (status === 'active') return '*'
  if (status === 'unknown') return '?'
  if (status === 'reverted') return '<'
  if (status === 'not attempted') return '-'
  return '.'
}
