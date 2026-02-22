import { describe, expect, it } from 'vitest'
import type { BumpOptions } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import {
  compilePatterns,
  isDepFieldEnabled,
  parseDependencies,
  shouldSkipDependency,
} from './dependencies'

const baseOptions = { ...DEFAULT_OPTIONS } as BumpOptions

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

describe('shouldSkipDependency', () => {
  it('skips workspace: protocol when includeWorkspace is false', () => {
    const opts = { ...baseOptions, includeWorkspace: false }
    expect(shouldSkipDependency('pkg', 'workspace:^1.0.0', opts)).toBe(true)
  })

  it('does not skip workspace: protocol when includeWorkspace is true', () => {
    expect(
      shouldSkipDependency('pkg', 'workspace:^1.0.0', { ...baseOptions, includeWorkspace: true }),
    ).toBe(false)
  })

  it('always skips catalog: protocol', () => {
    expect(shouldSkipDependency('pkg', 'catalog:default', baseOptions)).toBe(true)
    expect(
      shouldSkipDependency('pkg', 'catalog:default', { ...baseOptions, includeWorkspace: true }),
    ).toBe(true)
  })

  it('skips link: protocol', () => {
    expect(shouldSkipDependency('pkg', 'link:../local', baseOptions)).toBe(true)
  })

  it('skips file: protocol', () => {
    expect(shouldSkipDependency('pkg', 'file:../local', baseOptions)).toBe(true)
  })

  it('skips git: protocol', () => {
    expect(shouldSkipDependency('pkg', 'git:https://github.com/user/repo', baseOptions)).toBe(true)
  })

  it('skips github: protocol', () => {
    expect(shouldSkipDependency('pkg', 'github:user/repo', baseOptions)).toBe(true)
  })

  it('skips http:// URLs', () => {
    expect(shouldSkipDependency('pkg', 'http://example.com/pkg.tgz', baseOptions)).toBe(true)
  })

  it('skips https:// URLs', () => {
    expect(shouldSkipDependency('pkg', 'https://example.com/pkg.tgz', baseOptions)).toBe(true)
  })

  it('does not skip npm: protocol aliases', () => {
    expect(shouldSkipDependency('my-lodash', 'npm:lodash@^4.0.0', baseOptions)).toBe(false)
  })

  it('does not skip jsr: protocol aliases', () => {
    expect(shouldSkipDependency('pkg', 'jsr:@scope/pkg@^1.0.0', baseOptions)).toBe(false)
  })

  it('does not skip normal semver versions', () => {
    expect(shouldSkipDependency('lodash', '^4.17.21', baseOptions)).toBe(false)
    expect(shouldSkipDependency('lodash', '~4.17.21', baseOptions)).toBe(false)
    expect(shouldSkipDependency('lodash', '4.17.21', baseOptions)).toBe(false)
  })

  it('filters by include pattern (regex)', () => {
    const include = compilePatterns(['^react'])
    expect(shouldSkipDependency('react', '^18.0.0', baseOptions, include, [])).toBe(false)
    expect(shouldSkipDependency('react-dom', '^18.0.0', baseOptions, include, [])).toBe(false)
    expect(shouldSkipDependency('lodash', '^4.0.0', baseOptions, include, [])).toBe(true)
  })

  it('filters by exclude pattern (regex)', () => {
    const exclude = compilePatterns(['^react'])
    expect(shouldSkipDependency('react', '^18.0.0', baseOptions, [], exclude)).toBe(true)
    expect(shouldSkipDependency('lodash', '^4.0.0', baseOptions, [], exclude)).toBe(false)
  })

  it('handles invalid regex in patterns gracefully', () => {
    const compiled = compilePatterns(['[invalid', 'valid'])
    expect(compiled).toHaveLength(1)
    expect(compiled[0]!.source).toBe('valid')
  })
})

describe('compilePatterns', () => {
  it('compiles valid patterns', () => {
    const patterns = compilePatterns(['^react', 'lodash$'])
    expect(patterns).toHaveLength(2)
    expect(patterns[0]!.test('react-dom')).toBe(true)
    expect(patterns[1]!.test('lodash')).toBe(true)
  })

  it('skips invalid regex patterns', () => {
    const patterns = compilePatterns(['[invalid', '(unclosed', 'valid'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.source).toBe('valid')
  })

  it('returns empty array for empty input', () => {
    expect(compilePatterns([])).toEqual([])
  })
})
