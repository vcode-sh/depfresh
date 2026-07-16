import { describe, expect, it } from 'vitest'
import {
  getDiff,
  getMaxSatisfying,
  getMaxVersion,
  getSpecShape,
  getVersionPrefix,
  isLocked,
  isRange,
  normalizeVersion,
  rebuildXRange,
} from './versions'

describe('getVersionPrefix', () => {
  it('extracts ^ prefix', () => {
    expect(getVersionPrefix('^1.2.3')).toBe('^')
  })

  it('extracts ~ prefix', () => {
    expect(getVersionPrefix('~1.2.3')).toBe('~')
  })

  it('does not extract comparator prefixes', () => {
    expect(getVersionPrefix('>=1.2.3')).toBe('')
  })

  it('does not treat compound ranges as a single prefix', () => {
    expect(getVersionPrefix('>=1.0.0 <2.0.0')).toBe('')
    expect(getVersionPrefix('^1.0.0 || ^2.0.0')).toBe('')
  })

  it('returns empty for exact version', () => {
    expect(getVersionPrefix('1.2.3')).toBe('')
  })
})

describe('getSpecShape', () => {
  it('classifies exact and single-prefix full versions as simple', () => {
    expect(getSpecShape('1.2.3')).toBe('simple')
    expect(getSpecShape('^1.2.3')).toBe('simple')
    expect(getSpecShape('~1.2.3')).toBe('simple')
    expect(getSpecShape('=1.2.3')).toBe('simple')
  })

  it('classifies preservable x-ranges', () => {
    expect(getSpecShape('1.x')).toBe('x-range')
    expect(getSpecShape('1.2.x')).toBe('x-range')
    expect(getSpecShape('2.X')).toBe('x-range')
  })

  it('classifies complex ranges and bare wildcards as complex', () => {
    expect(getSpecShape('*')).toBe('complex')
    expect(getSpecShape('>=1.2.0')).toBe('complex')
    expect(getSpecShape('<2.0.0')).toBe('complex')
    expect(getSpecShape('>=1.0.0 <2.0.0')).toBe('complex')
    expect(getSpecShape('^1 || ^2')).toBe('complex')
    expect(getSpecShape('1.2 - 1.5')).toBe('complex')
  })
})

describe('rebuildXRange', () => {
  it('preserves major-only x-range shape', () => {
    expect(rebuildXRange('1.x', '2.4.1')).toBe('2.x')
  })

  it('preserves major-minor x-range shape', () => {
    expect(rebuildXRange('1.2.x', '1.9.3')).toBe('1.9.x')
  })

  it('returns null for non-x-range inputs or invalid targets', () => {
    expect(rebuildXRange('^1.2.3', '2.4.1')).toBe(null)
    expect(rebuildXRange('1.x', 'latest')).toBe(null)
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

  it('does not mistake exact prerelease identifiers for ranges', () => {
    expect(isRange('1.0.0-next.1')).toBe(false)
  })
})

describe('isLocked', () => {
  it.each(['1.2.3', '=1.2.3', '1.0.0-next.1'])('detects exact locked version %s', (version) => {
    expect(isLocked(version)).toBe(true)
  })

  it.each(['^1.2.3', '~1.2.3', '>=1.2.3', '1.x'])(
    'rejects range %s as a locked version',
    (version) => {
      expect(isLocked(version)).toBe(false)
    },
  )

  it('rejects malformed versions', () => {
    expect(isLocked('not-semver')).toBe(false)
  })
})

describe('getMaxSatisfying', () => {
  it('finds max satisfying from unsorted array', () => {
    // Critical: never assume sorted arrays (taze PR #217 bug)
    const versions = ['1.0.0', '1.2.0', '1.1.0', '1.3.0', '1.0.5']
    expect(getMaxSatisfying(versions, '^1.0.0')).toBe('1.3.0')
  })

  it('finds max satisfying from deliberately unsorted array', () => {
    // Verifies explicit semver.gt() comparison, not array order (credit: leny-mi)
    const versions = ['2.0.0', '1.0.0', '3.0.0', '1.5.0']
    expect(getMaxSatisfying(versions, '^1.0.0')).toBe('1.5.0')
  })

  it('respects semver range', () => {
    const versions = ['1.0.0', '1.1.0', '2.0.0', '2.1.0']
    expect(getMaxSatisfying(versions, '^1.0.0')).toBe('1.1.0')
  })

  it('returns null when no version satisfies', () => {
    expect(getMaxSatisfying(['2.0.0', '3.0.0'], '^1.0.0')).toBe(null)
  })

  it('returns null for empty array', () => {
    expect(getMaxSatisfying([], '^1.0.0')).toBe(null)
  })

  it('handles single version', () => {
    expect(getMaxSatisfying(['1.0.0'], '^1.0.0')).toBe('1.0.0')
  })

  it('handles prerelease versions with range', () => {
    const versions = ['1.0.0', '1.1.0', '2.0.0-alpha.1', '2.0.0-beta.1']
    expect(getMaxSatisfying(versions, '^1.0.0')).toBe('1.1.0')
  })
})

describe('getMaxVersion', () => {
  it('finds max from unsorted array', () => {
    const versions = ['2.0.0', '1.0.0', '3.0.0', '2.5.0']
    expect(getMaxVersion(versions)).toBe('3.0.0')
  })

  it('finds max from reverse-sorted array', () => {
    const versions = ['5.0.0', '4.0.0', '3.0.0', '2.0.0', '1.0.0']
    expect(getMaxVersion(versions)).toBe('5.0.0')
  })

  it('includes prerelease versions', () => {
    const versions = ['1.0.0', '2.0.0', '3.0.0-beta.1']
    expect(getMaxVersion(versions)).toBe('3.0.0-beta.1')
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

  it('detects identical versions return none', () => {
    expect(getDiff('3.5.2', '3.5.2')).toBe('none')
  })

  it('handles prerelease diff as patch', () => {
    expect(getDiff('1.0.0-beta.1', '1.0.0-beta.2')).toBe('patch')
  })

  it('handles prerelease to release as patch', () => {
    expect(getDiff('1.0.0-beta.1', '1.0.1')).toBe('patch')
  })

  it('handles prerelease to stable at the same core version as patch', () => {
    expect(getDiff('1.0.0-rc.1', '1.0.0')).toBe('patch')
  })

  it('handles invalid versions', () => {
    expect(getDiff('invalid', '1.0.0')).toBe('error')
  })

  it('handles both invalid versions', () => {
    expect(getDiff('invalid', 'also-invalid')).toBe('error')
  })
})

describe('normalizeVersion', () => {
  it('normalizes exact versions and ranges without erasing prerelease identity', () => {
    expect(normalizeVersion('^1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3-rc.1')).toBe('1.2.3-rc.1')
    expect(normalizeVersion('invalid')).toBe(null)
  })
})
