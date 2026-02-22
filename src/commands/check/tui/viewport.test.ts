import { describe, expect, it } from 'vitest'
import {
  CHROME_LINES,
  calculateScrollOffset,
  getViewportHeight,
  getVisibleRange,
  hasOverflowAbove,
  hasOverflowBelow,
} from './viewport'

describe('getViewportHeight', () => {
  it('subtracts chrome lines from terminal rows', () => {
    expect(getViewportHeight(30)).toBe(30 - CHROME_LINES)
  })

  it('uses custom chrome value', () => {
    expect(getViewportHeight(30, 4)).toBe(26)
  })

  it('returns minimum 1 for tiny terminals', () => {
    expect(getViewportHeight(3)).toBe(1)
    expect(getViewportHeight(1)).toBe(1)
    expect(getViewportHeight(0)).toBe(1)
  })
})

describe('calculateScrollOffset', () => {
  it('keeps offset when cursor is visible', () => {
    expect(calculateScrollOffset(5, 10, 20, 0)).toBe(0)
  })

  it('scrolls down when cursor goes below viewport', () => {
    expect(calculateScrollOffset(12, 10, 20, 0)).toBe(3)
  })

  it('scrolls up when cursor goes above viewport', () => {
    expect(calculateScrollOffset(2, 10, 20, 5)).toBe(2)
  })

  it('clamps to max offset', () => {
    expect(calculateScrollOffset(19, 10, 20, 0)).toBe(10)
  })

  it('handles single item', () => {
    expect(calculateScrollOffset(0, 10, 1, 0)).toBe(0)
  })

  it('handles viewport larger than total items', () => {
    expect(calculateScrollOffset(2, 10, 5, 0)).toBe(0)
  })

  it('handles cursor at viewport boundary', () => {
    // Cursor at last visible position — no scroll
    expect(calculateScrollOffset(9, 10, 20, 0)).toBe(0)
    // Cursor just past viewport
    expect(calculateScrollOffset(10, 10, 20, 0)).toBe(1)
  })
})

describe('getVisibleRange', () => {
  it('returns correct range from offset', () => {
    expect(getVisibleRange(0, 10, 20)).toEqual({ start: 0, end: 10 })
  })

  it('clamps end to total items', () => {
    expect(getVisibleRange(15, 10, 20)).toEqual({ start: 15, end: 20 })
  })

  it('handles viewport larger than items', () => {
    expect(getVisibleRange(0, 10, 3)).toEqual({ start: 0, end: 3 })
  })
})

describe('hasOverflowAbove', () => {
  it('returns false when at top', () => {
    expect(hasOverflowAbove(0)).toBe(false)
  })

  it('returns true when scrolled down', () => {
    expect(hasOverflowAbove(3)).toBe(true)
  })
})

describe('hasOverflowBelow', () => {
  it('returns false when all items visible', () => {
    expect(hasOverflowBelow(0, 10, 10)).toBe(false)
    expect(hasOverflowBelow(0, 10, 5)).toBe(false)
  })

  it('returns true when items below viewport', () => {
    expect(hasOverflowBelow(0, 10, 20)).toBe(true)
  })

  it('returns false when scrolled to bottom', () => {
    expect(hasOverflowBelow(10, 10, 20)).toBe(false)
  })
})
