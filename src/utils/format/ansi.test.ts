import { describe, expect, it } from 'vitest'
import { stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('strips ANSI codes', () => {
    expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red')
  })

  it('returns plain text unchanged', () => {
    expect(stripAnsi('plain')).toBe('plain')
  })
})
