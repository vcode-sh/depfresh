import { describe, expect, it } from 'vitest'
import { colorDiff, formatMs, stripAnsi, truncate } from '../src/utils/format'

describe('stripAnsi', () => {
  it('strips ANSI codes', () => {
    expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red')
  })

  it('returns plain text unchanged', () => {
    expect(stripAnsi('plain')).toBe('plain')
  })
})

describe('truncate', () => {
  it('truncates long strings', () => {
    expect(truncate('hello world', 6)).toHaveLength(6)
  })

  it('returns short strings unchanged', () => {
    expect(truncate('hi', 10)).toBe('hi')
  })
})

describe('formatMs', () => {
  it('formats milliseconds', () => {
    expect(formatMs(500)).toBe('500ms')
  })

  it('formats seconds', () => {
    expect(formatMs(2500)).toBe('2.5s')
  })
})

describe('colorDiff', () => {
  it('returns string for all diff types', () => {
    expect(stripAnsi(colorDiff('major'))).toBe('major')
    expect(stripAnsi(colorDiff('minor'))).toBe('minor')
    expect(stripAnsi(colorDiff('patch'))).toBe('patch')
    expect(stripAnsi(colorDiff('none'))).toBe('none')
    expect(stripAnsi(colorDiff('error'))).toBe('error')
  })
})
