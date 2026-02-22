import { stripAnsi } from './ansi'

export function visualLength(str: string): number {
  const plain = stripAnsi(str)
  let width = 0

  for (const char of plain) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined) continue
    if (isZeroWidthChar(char, codePoint)) continue
    width += isWideCodePoint(codePoint) ? 2 : 1
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

  const plain = stripAnsi(str)
  if (visualLength(plain) <= maxLen) return plain
  if (maxLen === 1) return '…'

  let out = ''
  let used = 0
  const target = maxLen - 1

  for (const char of plain) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined) continue
    const charWidth = isZeroWidthChar(char, codePoint) ? 0 : isWideCodePoint(codePoint) ? 2 : 1
    if (used + charWidth > target) break
    out += char
    used += charWidth
  }

  return `${out}…`
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
