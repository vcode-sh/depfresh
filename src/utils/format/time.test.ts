import { describe, expect, it } from 'vitest'
import { formatMs, timeDifference } from './time'

describe('formatMs', () => {
  it('formats milliseconds', () => {
    expect(formatMs(500)).toBe('500ms')
  })

  it('formats seconds', () => {
    expect(formatMs(2500)).toBe('2.5s')
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
