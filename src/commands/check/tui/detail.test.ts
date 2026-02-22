import { describe, expect, it } from 'vitest'
import type { ResolvedDepChange } from '../../../types'
import { applyVersionSelection, getExplanation, prepareDetailVersions } from './detail'

function makeDep(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'test-pkg',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: {
      name: 'test-pkg',
      versions: ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0'],
      distTags: { latest: '2.1.0' },
    },
    ...overrides,
  }
}

describe('prepareDetailVersions', () => {
  it('returns versions newer than current, sorted descending', () => {
    const dep = makeDep()
    const versions = prepareDetailVersions(dep, false)

    expect(versions.length).toBe(4) // 1.1.0, 1.2.0, 2.0.0, 2.1.0
    expect(versions[0]!.version).toBe('2.1.0')
    expect(versions[3]!.version).toBe('1.1.0')
  })

  it('limits to 20 versions', () => {
    const manyVersions = Array.from({ length: 30 }, (_, i) => `1.${i + 1}.0`)
    const dep = makeDep({
      currentVersion: '^1.0.0',
      pkgData: {
        name: 'test-pkg',
        versions: ['1.0.0', ...manyVersions],
        distTags: { latest: '1.30.0' },
      },
    })

    const versions = prepareDetailVersions(dep, false)
    expect(versions.length).toBe(20)
  })

  it('computes diff for each version', () => {
    const dep = makeDep()
    const versions = prepareDetailVersions(dep, false)

    const major = versions.find((v) => v.version === '2.0.0')
    const minor = versions.find((v) => v.version === '1.1.0')
    expect(major?.diff).toBe('major')
    expect(minor?.diff).toBe('minor')
  })

  it('attaches distTag when version matches', () => {
    const dep = makeDep({
      pkgData: {
        name: 'test-pkg',
        versions: ['1.0.0', '2.0.0', '3.0.0-beta.1'],
        distTags: { latest: '2.0.0', next: '3.0.0-beta.1' },
      },
    })

    const versions = prepareDetailVersions(dep, false)
    const latest = versions.find((v) => v.version === '2.0.0')
    expect(latest?.distTag).toBe('latest')
  })

  it('attaches age from time data', () => {
    const dep = makeDep({
      pkgData: {
        name: 'test-pkg',
        versions: ['1.0.0', '2.0.0'],
        distTags: { latest: '2.0.0' },
        time: { '2.0.0': new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
      },
    })

    const versions = prepareDetailVersions(dep, false)
    expect(versions[0]!.age).toBeDefined()
    expect(versions[0]!.age!.text).toMatch(/~\d+d/)
  })

  it('attaches deprecated info', () => {
    const dep = makeDep({
      pkgData: {
        name: 'test-pkg',
        versions: ['1.0.0', '2.0.0'],
        distTags: { latest: '2.0.0' },
        deprecated: { '2.0.0': 'Use v3 instead' },
      },
    })

    const versions = prepareDetailVersions(dep, false)
    expect(versions[0]!.deprecated).toBe('Use v3 instead')
  })

  it('adds explanation text when explain is true', () => {
    const dep = makeDep()
    const versions = prepareDetailVersions(dep, true)

    const major = versions.find((v) => v.version === '2.0.0')
    expect(major?.explain).toContain('Breaking change')

    const minor = versions.find((v) => v.version === '1.1.0')
    expect(minor?.explain).toContain('Backwards compatible')
  })

  it('omits explanation text when explain is false', () => {
    const dep = makeDep()
    const versions = prepareDetailVersions(dep, false)
    expect(versions[0]!.explain).toBeUndefined()
  })

  it('returns empty array for invalid current version', () => {
    const dep = makeDep({ currentVersion: 'not-a-version' })
    const versions = prepareDetailVersions(dep, false)
    expect(versions).toEqual([])
  })
})

describe('getExplanation', () => {
  it('returns major explanation', () => {
    expect(getExplanation('major')).toBe('Breaking change. Check migration guide.')
  })

  it('returns minor explanation', () => {
    expect(getExplanation('minor')).toBe('New features. Backwards compatible.')
  })

  it('returns patch explanation', () => {
    expect(getExplanation('patch')).toBe('Bug fixes only. Safe to update.')
  })

  it('appends deprecated warning', () => {
    const result = getExplanation('major', 'old')
    expect(result).toContain('Deprecated.')
  })

  it('appends provenance downgrade warning', () => {
    const result = getExplanation('minor', undefined, true)
    expect(result).toContain('Provenance downgrade.')
  })

  it('returns empty string for none diff', () => {
    expect(getExplanation('none')).toBe('')
  })
})

describe('applyVersionSelection', () => {
  it('updates targetVersion with original prefix', () => {
    const dep = makeDep({ currentVersion: '^1.0.0' })
    applyVersionSelection(dep, '2.1.0')

    expect(dep.targetVersion).toBe('^2.1.0')
    expect(dep.diff).toBe('major')
  })

  it('handles tilde prefix', () => {
    const dep = makeDep({ currentVersion: '~1.0.0' })
    applyVersionSelection(dep, '1.2.0')

    expect(dep.targetVersion).toBe('~1.2.0')
    expect(dep.diff).toBe('minor')
  })

  it('handles no prefix (pinned version)', () => {
    const dep = makeDep({ currentVersion: '1.0.0' })
    applyVersionSelection(dep, '1.0.5')

    expect(dep.targetVersion).toBe('1.0.5')
    expect(dep.diff).toBe('patch')
  })
})
