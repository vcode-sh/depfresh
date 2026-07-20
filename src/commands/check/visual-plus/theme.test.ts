import { describe, expect, it } from 'vitest'
import type { VisualPlusCapabilities } from './capabilities'
import { createVisualPlusTheme } from './theme'

function capabilities(color: boolean): VisualPlusCapabilities {
  return {
    interactive: true,
    color,
    unicode: true,
    motion: false,
    cursorControl: false,
    width: 80,
    layout: 'medium',
  }
}

describe('Visual+ severity theme', () => {
  it('renders redundant severity labels with semantic ANSI colors', () => {
    const theme = createVisualPlusTheme(capabilities(true))

    expect([theme.severity('major'), theme.severity('minor'), theme.severity('patch')]).toEqual([
      '\u001B[31mMajor\u001B[39m',
      '\u001B[33mMinor\u001B[39m',
      '\u001B[32mPatch\u001B[39m',
    ])
    expect(theme.styleSeverity('minor', '^5.9.0')).toBe('\u001B[33m^5.9.0\u001B[39m')
  })

  it('lets NO_COLOR remove only styling', () => {
    const theme = createVisualPlusTheme(capabilities(false))

    expect([theme.severity('major'), theme.severity('minor'), theme.severity('patch')]).toEqual([
      'Major',
      'Minor',
      'Patch',
    ])
    expect(theme.styleSeverity('minor', '^5.9.0')).toBe('^5.9.0')
  })
})
