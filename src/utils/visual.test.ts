import { describe, expect, it } from 'vitest'
import { stripAnsi, visualLength, visualPadEnd, visualPadStart, visualTruncate } from './format'

describe('visualLength', () => {
  it('treats CJK characters as width 2', () => {
    expect(visualLength('abc')).toBe(3)
    expect(visualLength('你好')).toBe(4)
    expect(visualLength('a你b')).toBe(4)
  })

  it('ignores combining marks', () => {
    const combining = 'e\u0301'
    expect(visualLength(combining)).toBe(1)
  })

  it('ignores ANSI sequences', () => {
    const colored = '\u001B[31mhello\u001B[0m'
    expect(stripAnsi(colored)).toBe('hello')
    expect(visualLength(colored)).toBe(5)
  })
})

describe('visual padding', () => {
  it('pads end by visible width', () => {
    const value = visualPadEnd('你', 4)
    expect(value).toBe('你  ')
    expect(visualLength(value)).toBe(4)
  })

  it('pads start by visible width', () => {
    const value = visualPadStart('你', 4)
    expect(value).toBe('  你')
    expect(visualLength(value)).toBe(4)
  })
})

describe('visualTruncate', () => {
  it('truncates by visible width', () => {
    expect(visualTruncate('abcdefgh', 5)).toBe('abcd…')
    expect(visualLength(visualTruncate('abcdefgh', 5))).toBe(5)
  })

  it('truncates CJK text safely', () => {
    const result = visualTruncate('你好世界', 5)
    expect(result.endsWith('…')).toBe(true)
    expect(visualLength(result)).toBeLessThanOrEqual(5)
  })

  it('returns unchanged when already short enough', () => {
    expect(visualTruncate('short', 10)).toBe('short')
  })
})
