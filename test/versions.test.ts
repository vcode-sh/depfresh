import { describe, expect, it } from 'vitest'
import {
  getDiff,
  getMaxSatisfying,
  getMaxVersion,
  getVersionPrefix,
  isLocked,
  isRange,
  resolveTargetVersion,
} from '../src/utils/versions'

describe('getVersionPrefix', () => {
  it('extracts ^ prefix', () => {
    expect(getVersionPrefix('^1.2.3')).toBe('^')
  })

  it('extracts ~ prefix', () => {
    expect(getVersionPrefix('~1.2.3')).toBe('~')
  })

  it('extracts >= prefix', () => {
    expect(getVersionPrefix('>=1.2.3')).toBe('>=')
  })

  it('returns empty for exact version', () => {
    expect(getVersionPrefix('1.2.3')).toBe('')
  })
})

describe('isRange', () => {
  it('detects ^ range', () => {
    expect(isRange('^1.0.0')).toBe(true)
  })

  it('detects ~ range', () => {
    expect(isRange('~1.0.0')).toBe(true)
  })

  it('detects * wildcard', () => {
    expect(isRange('*')).toBe(true)
  })

  it('rejects exact version', () => {
    expect(isRange('1.2.3')).toBe(false)
  })
})

describe('isLocked', () => {
  it('detects locked version', () => {
    expect(isLocked('1.2.3')).toBe(true)
  })

  it('rejects ranges', () => {
    expect(isLocked('^1.2.3')).toBe(false)
  })
})

describe('getMaxSatisfying', () => {
  it('finds max satisfying from unsorted array', () => {
    // Critical: never assume sorted arrays (taze PR #217 bug)
    const versions = ['1.0.0', '1.2.0', '1.1.0', '1.3.0', '1.0.5']
    expect(getMaxSatisfying(versions, '^1.0.0')).toBe('1.3.0')
  })

  it('respects semver range', () => {
    const versions = ['1.0.0', '1.1.0', '2.0.0', '2.1.0']
    expect(getMaxSatisfying(versions, '^1.0.0')).toBe('1.1.0')
  })

  it('returns null when no version satisfies', () => {
    expect(getMaxSatisfying(['2.0.0', '3.0.0'], '^1.0.0')).toBe(null)
  })

  it('handles single version', () => {
    expect(getMaxSatisfying(['1.0.0'], '^1.0.0')).toBe('1.0.0')
  })
})

describe('getMaxVersion', () => {
  it('finds max from unsorted array', () => {
    const versions = ['2.0.0', '1.0.0', '3.0.0', '2.5.0']
    expect(getMaxVersion(versions)).toBe('3.0.0')
  })

  it('returns null for empty array', () => {
    expect(getMaxVersion([])).toBe(null)
  })
})

describe('getDiff', () => {
  it('detects major diff', () => {
    expect(getDiff('1.0.0', '2.0.0')).toBe('major')
  })

  it('detects minor diff', () => {
    expect(getDiff('1.0.0', '1.1.0')).toBe('minor')
  })

  it('detects patch diff', () => {
    expect(getDiff('1.0.0', '1.0.1')).toBe('patch')
  })

  it('detects no diff', () => {
    expect(getDiff('1.0.0', '1.0.0')).toBe('none')
  })

  it('handles invalid versions', () => {
    expect(getDiff('invalid', '1.0.0')).toBe('error')
  })
})

describe('resolveTargetVersion', () => {
  const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0', '3.0.0-beta.1']
  const distTags = { latest: '2.1.0', next: '3.0.0-beta.1' }

  it('resolves latest mode', () => {
    expect(resolveTargetVersion('^1.0.0', versions, distTags, 'latest')).toBe('2.1.0')
  })

  it('resolves newest mode', () => {
    expect(resolveTargetVersion('^1.0.0', versions, distTags, 'newest')).toBe('3.0.0-beta.1')
  })

  it('resolves next mode', () => {
    expect(resolveTargetVersion('^1.0.0', versions, distTags, 'next')).toBe('3.0.0-beta.1')
  })

  it('resolves minor mode — stays within major', () => {
    expect(resolveTargetVersion('^1.0.0', versions, distTags, 'minor')).toBe('1.2.0')
  })

  it('resolves patch mode — stays within minor', () => {
    expect(resolveTargetVersion('^1.0.0', versions, distTags, 'patch')).toBe('1.0.0')
  })

  it('resolves default mode using semver range', () => {
    expect(resolveTargetVersion('^1.0.0', versions, distTags, 'default')).toBe('1.2.0')
  })
})
