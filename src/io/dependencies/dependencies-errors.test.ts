import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../errors'
import type { UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { parseDependencies } from './index'

const baseOptions = { ...DEFAULT_OPTIONS } as UpgrOptions

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
