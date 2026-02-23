import { describe, expect, it } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { compilePatterns, parseDependencies, shouldSkipDependency } from './index'

const baseOptions = { ...DEFAULT_OPTIONS } as depfreshOptions

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

  it('skips github: refs that are not semver tags', () => {
    expect(shouldSkipDependency('pkg', 'github:user/repo', baseOptions)).toBe(true)
    expect(shouldSkipDependency('pkg', 'github:user/repo#main', baseOptions)).toBe(true)
    expect(shouldSkipDependency('pkg', 'github:user/repo#a1b2c3d', baseOptions)).toBe(true)
  })

  it('does not skip github: semver tags', () => {
    expect(shouldSkipDependency('pkg', 'github:user/repo#v1.2.3', baseOptions)).toBe(false)
    expect(shouldSkipDependency('pkg', 'github:user/repo#1.2.3', baseOptions)).toBe(false)
    expect(shouldSkipDependency('pkg', 'github:user/repo#refs/tags/v1.2.3', baseOptions)).toBe(
      false,
    )
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
    const regexPatterns = compilePatterns(['^react'])
    expect(regexPatterns).toHaveLength(1)
    expect(regexPatterns[0]!.test('react-dom')).toBe(true)
    expect(regexPatterns[0]!.test('lodash')).toBe(false)
  })

  it('handles glob with dots (escapes . to literal)', () => {
    const patterns = compilePatterns(['@babel/plugin.*'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0]!.test('@babel/plugin.transform')).toBe(true)
    expect(patterns[0]!.test('@babel/pluginXtransform')).toBe(false)
  })

  it('mixes globs and regex in the same array', () => {
    const patterns = compilePatterns(['@types/*', '^react', '/^vue$/i'])
    expect(patterns).toHaveLength(3)

    expect(patterns[0]!.test('@types/node')).toBe(true)
    expect(patterns[0]!.test('react')).toBe(false)

    expect(patterns[1]!.test('react')).toBe(true)
    expect(patterns[1]!.test('react-dom')).toBe(true)

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
