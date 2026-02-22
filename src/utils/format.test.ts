import { describe, expect, it } from 'vitest'
import {
  colorDiff,
  colorizeVersionDiff,
  formatMs,
  stripAnsi,
  timeDifference,
  truncate,
} from './format'

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

describe('colorizeVersionDiff', () => {
  it('colors only the major segment for major diff (1.0.0 -> 2.0.0)', () => {
    const result = stripAnsi(colorizeVersionDiff('^1.0.0', '^2.0.0', 'major'))
    expect(result).toBe('^2.0.0')
  })

  it('colors from the minor segment onward for minor diff (1.0.0 -> 1.1.0)', () => {
    const result = colorizeVersionDiff('^1.0.0', '^1.1.0', 'minor')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('^1.1.0')
    // The unchanged portion should not have color codes — verify by checking prefix
    expect(result.startsWith('^1.')).toBe(true)
  })

  it('colors only the patch segment for patch diff (1.0.0 -> 1.0.1)', () => {
    const result = colorizeVersionDiff('^1.0.0', '^1.0.1', 'patch')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('^1.0.1')
    expect(result.startsWith('^1.0.')).toBe(true)
  })

  it('colors multiple segments when major changes (1.0.0 -> 2.1.3)', () => {
    const result = colorizeVersionDiff('^1.0.0', '^2.1.3', 'major')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('^2.1.3')
    // Prefix ^ should be unchanged, everything from 2 onward colored
    expect(result.startsWith('^')).toBe(true)
  })

  it('falls back to full color for none diff', () => {
    const result = colorizeVersionDiff('^1.0.0', '^1.0.0', 'none')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('^1.0.0')
  })

  it('falls back to full color for error diff', () => {
    const result = colorizeVersionDiff('^1.0.0', '^1.0.0', 'error')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('^1.0.0')
  })

  it('handles versions without prefix', () => {
    const result = colorizeVersionDiff('1.0.0', '1.2.0', 'minor')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('1.2.0')
    expect(result.startsWith('1.')).toBe(true)
  })

  it('handles tilde prefix', () => {
    const result = colorizeVersionDiff('~1.0.0', '~1.0.5', 'patch')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('~1.0.5')
    expect(result.startsWith('~1.0.')).toBe(true)
  })

  it('handles >= prefix', () => {
    const result = colorizeVersionDiff('>=1.0.0', '>=2.0.0', 'major')
    const stripped = stripAnsi(result)
    expect(stripped).toBe('>=2.0.0')
  })
})

describe('timeDifference', () => {
  it('returns undefined for undefined input', () => {
    expect(timeDifference(undefined)).toBeUndefined()
  })

  it('returns undefined for invalid date', () => {
    expect(timeDifference('not-a-date')).toBeUndefined()
  })

  it('returns green for recent dates (< 90 days)', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
    const result = timeDifference(twoDaysAgo)
    expect(result).toBeDefined()
    expect(result!.color).toBe('green')
    expect(result!.text).toMatch(/^~\d+d$/)
  })

  it('returns green for a few weeks old', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const result = timeDifference(thirtyDaysAgo)
    expect(result).toBeDefined()
    expect(result!.color).toBe('green')
    expect(result!.text).toMatch(/^~\d+d$/)
  })

  it('returns yellow for months old (90-365 days)', () => {
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString()
    const result = timeDifference(sixMonthsAgo)
    expect(result).toBeDefined()
    expect(result!.color).toBe('yellow')
    expect(result!.text).toMatch(/^~\d+mo$/)
  })

  it('returns red for years old (>= 365 days)', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString()
    const result = timeDifference(twoYearsAgo)
    expect(result).toBeDefined()
    expect(result!.color).toBe('red')
    expect(result!.text).toMatch(/^~[\d.]+y$/)
  })

  it('handles future dates gracefully', () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    const result = timeDifference(future)
    expect(result).toBeDefined()
    expect(result!.text).toBe('~0d')
    expect(result!.color).toBe('green')
  })

  it('returns at least 1 day for very recent dates', () => {
    const justNow = new Date().toISOString()
    const result = timeDifference(justNow)
    expect(result).toBeDefined()
    expect(result!.text).toBe('~1d')
  })
})
