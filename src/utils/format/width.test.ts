import { describe, expect, it } from 'vitest'
import { truncate } from './width'

describe('truncate', () => {
  it('truncates long strings', () => {
    expect(truncate('hello world', 6)).toHaveLength(6)
  })

  it('returns short strings unchanged', () => {
    expect(truncate('hi', 10)).toBe('hi')
  })
})
