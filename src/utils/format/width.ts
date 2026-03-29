import { stripAnsi } from './ansi'

const ANSI_SEQUENCE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')
const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export function visualLength(str: string): number {
  const plain = stripAnsi(str)
  let width = 0

  for (const segment of splitGraphemes(plain)) {
    const codePoint = segment.codePointAt(0)
    if (codePoint === undefined) continue
    if (isZeroWidthGrapheme(segment)) continue
    width += isWideGrapheme(segment) ? 2 : 1
  }

  return width
}

export function visualPadEnd(str: string, len: number): string {
  const diff = len - visualLength(str)
  return diff > 0 ? str + ' '.repeat(diff) : str
}

export function visualPadStart(str: string, len: number): string {
  const diff = len - visualLength(str)
  return diff > 0 ? ' '.repeat(diff) + str : str
}

export function visualTruncate(str: string, maxLen: number): string {
  if (maxLen <= 0) return ''

  if (visualLength(str) <= maxLen) return str
  if (maxLen === 1) return '…'

  let out = ''
  let used = 0
  const target = maxLen - 1
  let sawAnsi = false

  for (const token of splitTokens(str)) {
    if (token.type === 'ansi') {
      out += token.value
      sawAnsi = true
      continue
    }

    for (const segment of splitGraphemes(token.value)) {
      const codePoint = segment.codePointAt(0)
      if (codePoint === undefined) continue
      const segmentWidth = isZeroWidthGrapheme(segment) ? 0 : isWideGrapheme(segment) ? 2 : 1
      if (used + segmentWidth > target) {
        return sawAnsi ? `${out}…\u001B[0m` : `${out}…`
      }
      out += segment
      used += segmentWidth
    }
  }

  return sawAnsi ? `${out}…\u001B[0m` : `${out}…`
}

export function padEnd(str: string, len: number): string {
  return visualPadEnd(str, len)
}

export function truncate(str: string, maxLen: number): string {
  return visualTruncate(str, maxLen)
}

function isZeroWidthChar(char: string, codePoint: number): boolean {
  if (codePoint === 0) return true

  // C0/C1 control characters + DEL.
  if ((codePoint >= 0 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159)) {
    return true
  }

  // Common zero-width formatting characters.
  if (codePoint === 0x200c || codePoint === 0x200d || codePoint === 0x00ad) {
    return true
  }

  // Combining marks and variation selectors.
  if (/\p{Mark}/u.test(char)) {
    return true
  }

  return codePoint >= 0xfe00 && codePoint <= 0xfe0f
}

function isZeroWidthGrapheme(segment: string): boolean {
  for (const char of segment) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined) continue
    if (!isZeroWidthChar(char, codePoint)) return false
  }

  return true
}

function isWideGrapheme(segment: string): boolean {
  if (/\p{Extended_Pictographic}/u.test(segment)) return true

  const codePoints = Array.from(segment, (char) => char.codePointAt(0) ?? 0)
  if (isRegionalIndicatorSequence(codePoints)) return true

  return codePoints.some((codePoint) => isWideCodePoint(codePoint))
}

function isWideCodePoint(codePoint: number): boolean {
  if (codePoint < 0x1100) return false

  return (
    codePoint <= 0x115f || // Hangul Jamo
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth Forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) || // Emoji
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK Extension blocks
  )
}

function isRegionalIndicatorSequence(codePoints: number[]): boolean {
  return (
    codePoints.length >= 2 &&
    codePoints.every((codePoint) => codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff)
  )
}

function splitGraphemes(str: string): string[] {
  if (!graphemeSegmenter) return Array.from(str)
  return Array.from(graphemeSegmenter.segment(str), (part) => part.segment)
}

function splitTokens(str: string): Array<{ type: 'ansi' | 'text'; value: string }> {
  const tokens: Array<{ type: 'ansi' | 'text'; value: string }> = []
  let lastIndex = 0
  ANSI_SEQUENCE_PATTERN.lastIndex = 0

  for (
    let match = ANSI_SEQUENCE_PATTERN.exec(str);
    match;
    match = ANSI_SEQUENCE_PATTERN.exec(str)
  ) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: str.slice(lastIndex, match.index) })
    }
    tokens.push({ type: 'ansi', value: match[0] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < str.length) {
    tokens.push({ type: 'text', value: str.slice(lastIndex) })
  }

  return tokens
}
