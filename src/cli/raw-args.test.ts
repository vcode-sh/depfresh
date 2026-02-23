import { describe, expect, it } from 'vitest'
import { normalizeCliRawArgs } from './raw-args'

describe('normalizeCliRawArgs', () => {
  it('keeps non-help args unchanged', () => {
    expect(normalizeCliRawArgs(['major', '-w'])).toEqual(['major', '-w'])
  })

  it('maps `help` to `--help`', () => {
    expect(normalizeCliRawArgs(['help'])).toEqual(['--help'])
  })

  it('maps `help` to `--help` and preserves trailing args', () => {
    expect(normalizeCliRawArgs(['help', '--help-json'])).toEqual(['--help', '--help-json'])
  })
})
