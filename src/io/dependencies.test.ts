import { describe, expect, it } from 'vitest'
import type { BumpOptions } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import {
  compilePatterns,
  isDepFieldEnabled,
  parseDependencies,
  parseOverrideKey,
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

  // Glob pattern support (Task 1.9)

  it('converts @types/* glob to regex that matches scoped packages', () => {
    const patterns = compilePatterns(['@types/*'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.test('@types/node')).toBe(true)
    expect(patterns[0]!.test('@types/react')).toBe(true)
    expect(patterns[0]!.test('@types/lodash')).toBe(true)
    expect(patterns[0]!.test('react')).toBe(false)
    expect(patterns[0]!.test('@scope/types')).toBe(false)
  })

  it('converts eslint-* glob to regex', () => {
    const patterns = compilePatterns(['eslint-*'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.test('eslint-plugin-foo')).toBe(true)
    expect(patterns[0]!.test('eslint-config-bar')).toBe(true)
    expect(patterns[0]!.test('eslint')).toBe(false)
    expect(patterns[0]!.test('prettier')).toBe(false)
  })

  it('converts @scope/* glob to regex', () => {
    const patterns = compilePatterns(['@vue/*'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.test('@vue/compiler-core')).toBe(true)
    expect(patterns[0]!.test('@vue/reactivity')).toBe(true)
    expect(patterns[0]!.test('@react/core')).toBe(false)
  })

  it('treats exact package names as regex (no glob)', () => {
    const patterns = compilePatterns(['react'])
    expect(patterns).toHaveLength(1)
    // regex 'react' matches anything containing 'react'
    expect(patterns[0]!.test('react')).toBe(true)
    expect(patterns[0]!.test('react-dom')).toBe(true)
  })

  it('supports /regex/flags syntax', () => {
    const patterns = compilePatterns(['/^react$/i'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.test('react')).toBe(true)
    expect(patterns[0]!.test('React')).toBe(true)
    expect(patterns[0]!.test('react-dom')).toBe(false)
  })

  it('supports /regex/ without flags', () => {
    const patterns = compilePatterns(['/^lodash$/'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.test('lodash')).toBe(true)
    expect(patterns[0]!.test('lodash-es')).toBe(false)
  })

  it('distinguishes regex metacharacters from globs', () => {
    // Pattern with ^ and $ is clearly regex, not glob even if it contains *
    const regexPatterns = compilePatterns(['^react'])
    expect(regexPatterns).toHaveLength(1)
    expect(regexPatterns[0]!.test('react-dom')).toBe(true)
    expect(regexPatterns[0]!.test('lodash')).toBe(false)
  })

  it('handles glob with dots (escapes . to literal)', () => {
    // Dots in globs are escaped so they match literal dots, not any char
    const patterns = compilePatterns(['@babel/plugin.*'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.test('@babel/plugin.transform')).toBe(true)
    // Dot is literal, not regex wildcard — won't match arbitrary chars in place of dot
    expect(patterns[0]!.test('@babel/pluginXtransform')).toBe(false)
  })

  it('mixes globs and regex in the same array', () => {
    const patterns = compilePatterns(['@types/*', '^react', '/^vue$/i'])
    expect(patterns).toHaveLength(3)

    // Glob: @types/*
    expect(patterns[0]!.test('@types/node')).toBe(true)
    expect(patterns[0]!.test('react')).toBe(false)

    // Regex: ^react
    expect(patterns[1]!.test('react')).toBe(true)
    expect(patterns[1]!.test('react-dom')).toBe(true)

    // /regex/flags: /^vue$/i
    expect(patterns[2]!.test('vue')).toBe(true)
    expect(patterns[2]!.test('Vue')).toBe(true)
    expect(patterns[2]!.test('vue-router')).toBe(false)
  })
})

describe('glob patterns in include/exclude', () => {
  it('include with glob @types/* filters correctly', () => {
    const raw = {
      dependencies: {
        '@types/node': '^20.0.0',
        '@types/react': '^18.0.0',
        lodash: '^4.17.21',
        react: '^18.0.0',
      },
    }

    const deps = parseDependencies(raw, { ...baseOptions, include: ['@types/*'] })
    expect(deps).toHaveLength(2)
    expect(deps.map((d) => d.name).sort()).toEqual(['@types/node', '@types/react'])
  })

  it('exclude with glob eslint-* filters correctly', () => {
    const raw = {
      devDependencies: {
        'eslint-plugin-foo': '^1.0.0',
        'eslint-config-bar': '^2.0.0',
        vitest: '^3.0.0',
        prettier: '^3.0.0',
      },
    }

    const deps = parseDependencies(raw, { ...baseOptions, exclude: ['eslint-*'] })
    expect(deps).toHaveLength(2)
    expect(deps.map((d) => d.name).sort()).toEqual(['prettier', 'vitest'])
  })

  it('include with /regex/i flag syntax works', () => {
    const raw = {
      dependencies: { React: '^18.0.0', react: '^18.0.0', lodash: '^4.0.0' },
    }

    const deps = parseDependencies(raw, { ...baseOptions, include: ['/^react$/i'] })
    expect(deps).toHaveLength(2)
    expect(deps.map((d) => d.name).sort()).toEqual(['React', 'react'])
  })
})

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
