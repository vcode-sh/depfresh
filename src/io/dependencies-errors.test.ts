import { describe, expect, it } from 'vitest'
import { ConfigError } from '../errors'
import type { BumpOptions } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import { parseDependencies } from './dependencies'

const baseOptions = { ...DEFAULT_OPTIONS } as BumpOptions

describe('parseDependencies pattern errors', () => {
  it('throws ConfigError for invalid include patterns', () => {
    const raw = { dependencies: { react: '^18.0.0' } }
    expect(() => parseDependencies(raw, { ...baseOptions, include: ['[invalid'] })).toThrow(
      ConfigError,
    )
  })

  it('throws ConfigError for invalid exclude patterns', () => {
    const raw = { dependencies: { react: '^18.0.0' } }
    expect(() => parseDependencies(raw, { ...baseOptions, exclude: ['[invalid'] })).toThrow(
      ConfigError,
    )
  })
})
