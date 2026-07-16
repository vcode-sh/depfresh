import { describe, expect, it } from 'vitest'
import { sanitizeTerminalText, stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('strips ANSI codes', () => {
    expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red')
  })

  it('returns plain text unchanged', () => {
    expect(stripAnsi('plain')).toBe('plain')
  })
})

describe('sanitizeTerminalText', () => {
  it('removes CSI, OSC, control, bidi, and zero-width terminal payloads', () => {
    const hostile =
      'safe\u001B[2J\u001B]0;owned\u0007\r\n\u009B31m\u061C\u202Ehidden\u2066\u200Btext'

    expect(sanitizeTerminalText(hostile)).toBe('safe  hiddentext')
  })
})
