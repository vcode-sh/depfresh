import { describe, expect, it } from 'vitest'
import { stripAnsi } from './ansi'
import { colorDiff, colorizeVersionDiff } from './colors'

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
