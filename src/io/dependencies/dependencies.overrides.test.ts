import { describe, expect, it } from 'vitest'
import type { UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { parseDependencies, parseOverrideKey } from './index'

const baseOptions = { ...DEFAULT_OPTIONS } as UpgrOptions

describe('parseOverrideKey', () => {
  it('returns plain name as-is', () => {
    expect(parseOverrideKey('tar-fs')).toBe('tar-fs')
  })

  it('extracts name from name@version', () => {
    expect(parseOverrideKey('esbuild@<=0.24.2')).toBe('esbuild')
  })

  it('extracts name from name@version-range', () => {
    expect(parseOverrideKey('tar-fs@>=2.0.0 <2.1.2')).toBe('tar-fs')
  })

  it('extracts scoped name from @scope/name@version', () => {
    expect(parseOverrideKey('@babel/core@^7.0.0')).toBe('@babel/core')
  })

  it('extracts scoped name from @scope/name@version-range with spaces', () => {
    expect(parseOverrideKey('@scope/pkg@>=1.0.0 <2.0.0')).toBe('@scope/pkg')
  })

  it('returns scoped name without version as-is', () => {
    expect(parseOverrideKey('@scope/name')).toBe('@scope/name')
  })

  it('handles scoped package with complex range', () => {
    expect(parseOverrideKey('@types/node@>=18.0.0 <20.0.0 || >=22.0.0')).toBe('@types/node')
  })
})

describe('parseDependencies with pnpm override keys', () => {
  it('parses name@range override keys correctly', () => {
    const raw = {
      overrides: {
        'tar-fs@>=2.0.0 <2.1.2': '>=2.1.2',
        'esbuild@<=0.24.2': '>=0.25.0',
      },
    }

    const deps = parseDependencies(raw, baseOptions)
    expect(deps).toHaveLength(2)
    expect(deps[0]?.name).toBe('tar-fs')
    expect(deps[0]?.currentVersion).toBe('>=2.1.2')
    expect(deps[1]?.name).toBe('esbuild')
    expect(deps[1]?.currentVersion).toBe('>=0.25.0')
  })

  it('parses scoped @scope/name@range override keys correctly', () => {
    const raw = {
      overrides: {
        '@babel/core@^7.0.0': '^7.24.0',
      },
    }

    const deps = parseDependencies(raw, baseOptions)
    expect(deps).toHaveLength(1)
    expect(deps[0]?.name).toBe('@babel/core')
    expect(deps[0]?.currentVersion).toBe('^7.24.0')
  })

  it('preserves original key in parents for write-back', () => {
    const raw = {
      overrides: {
        'tar-fs@>=2.0.0 <2.1.2': '>=2.1.2',
      },
    }

    const deps = parseDependencies(raw, baseOptions)
    expect(deps[0]?.parents).toEqual(['tar-fs@>=2.0.0 <2.1.2'])
  })

  it('respects include/exclude with parsed override names', () => {
    const raw = {
      overrides: {
        'tar-fs@>=2.0.0 <2.1.2': '>=2.1.2',
        'esbuild@<=0.24.2': '>=0.25.0',
      },
    }

    const deps = parseDependencies(raw, { ...baseOptions, include: ['tar-fs'] })
    expect(deps).toHaveLength(1)
    expect(deps[0]?.name).toBe('tar-fs')
  })
})
