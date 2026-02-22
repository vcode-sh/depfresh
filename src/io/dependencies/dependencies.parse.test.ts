import { describe, expect, it } from 'vitest'
import type { UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { isDepFieldEnabled, parseDependencies } from './index'

const baseOptions = { ...DEFAULT_OPTIONS } as UpgrOptions

describe('parseDependencies', () => {
  it('parses standard dependency fields', () => {
    const raw = {
      dependencies: { lodash: '^4.17.21' },
      devDependencies: { vitest: '^3.0.0' },
    }

    const deps = parseDependencies(raw, baseOptions)
    expect(deps).toHaveLength(2)
    expect(deps[0]?.name).toBe('lodash')
    expect(deps[0]?.source).toBe('dependencies')
    expect(deps[1]?.name).toBe('vitest')
    expect(deps[1]?.source).toBe('devDependencies')
  })

  it('skips file: and link: protocols', () => {
    const raw = {
      dependencies: {
        local: 'file:../local',
        linked: 'link:../linked',
        real: '^1.0.0',
      },
    }

    const deps = parseDependencies(raw, baseOptions)
    expect(deps).toHaveLength(1)
    expect(deps[0]?.name).toBe('real')
  })

  it('parses npm: protocol aliases', () => {
    const raw = {
      dependencies: { 'my-lodash': 'npm:lodash@^4.0.0' },
    }

    const deps = parseDependencies(raw, baseOptions)
    expect(deps).toHaveLength(1)
    expect(deps[0]?.protocol).toBe('npm')
    expect(deps[0]?.currentVersion).toBe('^4.0.0')
  })

  it('respects include filter', () => {
    const raw = {
      dependencies: { lodash: '^4.0.0', react: '^18.0.0' },
    }

    const deps = parseDependencies(raw, { ...baseOptions, include: ['lodash'] })
    expect(deps).toHaveLength(1)
    expect(deps[0]?.name).toBe('lodash')
  })

  it('respects exclude filter', () => {
    const raw = {
      dependencies: { lodash: '^4.0.0', react: '^18.0.0' },
    }

    const deps = parseDependencies(raw, { ...baseOptions, exclude: ['lodash'] })
    expect(deps).toHaveLength(1)
    expect(deps[0]?.name).toBe('react')
  })

  it('parses overrides', () => {
    const raw = {
      overrides: { sharp: '0.33.0' },
    }

    const deps = parseDependencies(raw, baseOptions)
    expect(deps).toHaveLength(1)
    expect(deps[0]?.source).toBe('overrides')
  })
})

describe('isDepFieldEnabled', () => {
  it('returns true for enabled fields', () => {
    expect(isDepFieldEnabled('dependencies', baseOptions)).toBe(true)
  })

  it('returns false for explicitly disabled fields', () => {
    const opts = { ...baseOptions, depFields: { devDependencies: false } }
    expect(isDepFieldEnabled('devDependencies', opts)).toBe(false)
  })

  it('disables peer deps by default', () => {
    expect(isDepFieldEnabled('peerDependencies', baseOptions)).toBe(false)
  })

  it('enables peer deps when option set', () => {
    expect(isDepFieldEnabled('peerDependencies', { ...baseOptions, peer: true })).toBe(true)
  })
})
