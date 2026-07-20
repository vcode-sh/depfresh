const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')
const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export function visualLength(value) {
  let width = 0
  for (const segment of splitGraphemes(value.replace(ANSI_PATTERN, ''))) {
    const codePoint = segment.codePointAt(0)
    if (codePoint === undefined || isZeroWidthGrapheme(segment)) continue
    width += isWideGrapheme(segment) ? 2 : 1
  }
  return width
}

function isZeroWidthCharacter(character, codePoint) {
  if (codePoint === 0) return true
  if ((codePoint >= 0 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159)) return true
  if (codePoint === 0x200c || codePoint === 0x200d || codePoint === 0x00ad) return true
  if (/\p{Mark}/u.test(character)) return true
  return codePoint >= 0xfe00 && codePoint <= 0xfe0f
}

function isZeroWidthGrapheme(segment) {
  for (const character of segment) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && !isZeroWidthCharacter(character, codePoint)) return false
  }
  return true
}

function isWideGrapheme(segment) {
  if (/\p{Extended_Pictographic}/u.test(segment)) return true
  const codePoints = Array.from(segment, (character) => character.codePointAt(0) ?? 0)
  if (
    codePoints.length >= 2 &&
    codePoints.every((codePoint) => codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff)
  ) {
    return true
  }
  return codePoints.some((codePoint) => isWideCodePoint(codePoint))
}

function isWideCodePoint(codePoint) {
  if (codePoint < 0x1100) return false
  return (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

function splitGraphemes(value) {
  if (!graphemeSegmenter) return Array.from(value)
  return Array.from(graphemeSegmenter.segment(value), (part) => part.segment)
}
