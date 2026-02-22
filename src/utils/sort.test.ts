import { describe, expect, it } from 'vitest'
import type { ResolvedDepChange } from '../types'
import { parseSortOption, sortDeps } from './sort'

function makeDep(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'test-pkg',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: { name: 'test-pkg', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  }
}

describe('parseSortOption', () => {
  it('returns valid sort options as-is', () => {
    expect(parseSortOption('diff-asc')).toBe('diff-asc')
    expect(parseSortOption('diff-desc')).toBe('diff-desc')
    expect(parseSortOption('time-asc')).toBe('time-asc')
    expect(parseSortOption('time-desc')).toBe('time-desc')
    expect(parseSortOption('name-asc')).toBe('name-asc')
    expect(parseSortOption('name-desc')).toBe('name-desc')
  })

  it('defaults to diff-asc for invalid values', () => {
    expect(parseSortOption('invalid')).toBe('diff-asc')
    expect(parseSortOption('')).toBe('diff-asc')
    expect(parseSortOption('ascending')).toBe('diff-asc')
  })
})

describe('sortDeps', () => {
  it('returns empty array unchanged', () => {
    expect(sortDeps([], 'diff-asc')).toEqual([])
  })

  it('sorts by diff ascending (major first)', () => {
    const deps = [
      makeDep({ name: 'c', diff: 'patch' }),
      makeDep({ name: 'a', diff: 'major' }),
      makeDep({ name: 'b', diff: 'minor' }),
    ]

    const sorted = sortDeps(deps, 'diff-asc')
    expect(sorted.map((d) => d.diff)).toEqual(['major', 'minor', 'patch'])
  })

  it('sorts by diff descending (patch first)', () => {
    const deps = [
      makeDep({ name: 'a', diff: 'major' }),
      makeDep({ name: 'b', diff: 'minor' }),
      makeDep({ name: 'c', diff: 'patch' }),
    ]

    const sorted = sortDeps(deps, 'diff-desc')
    expect(sorted.map((d) => d.diff)).toEqual(['patch', 'minor', 'major'])
  })

  it('sorts by time ascending (oldest first)', () => {
    const deps = [
      makeDep({ name: 'new', publishedAt: '2025-06-01T00:00:00Z' }),
      makeDep({ name: 'old', publishedAt: '2024-01-01T00:00:00Z' }),
      makeDep({ name: 'mid', publishedAt: '2024-06-01T00:00:00Z' }),
    ]

    const sorted = sortDeps(deps, 'time-asc')
    expect(sorted.map((d) => d.name)).toEqual(['old', 'mid', 'new'])
  })

  it('sorts by time descending (newest first)', () => {
    const deps = [
      makeDep({ name: 'old', publishedAt: '2024-01-01T00:00:00Z' }),
      makeDep({ name: 'new', publishedAt: '2025-06-01T00:00:00Z' }),
    ]

    const sorted = sortDeps(deps, 'time-desc')
    expect(sorted.map((d) => d.name)).toEqual(['new', 'old'])
  })

  it('sorts by name ascending', () => {
    const deps = [
      makeDep({ name: 'zlib' }),
      makeDep({ name: 'axios' }),
      makeDep({ name: 'lodash' }),
    ]

    const sorted = sortDeps(deps, 'name-asc')
    expect(sorted.map((d) => d.name)).toEqual(['axios', 'lodash', 'zlib'])
  })

  it('sorts by name descending', () => {
    const deps = [
      makeDep({ name: 'axios' }),
      makeDep({ name: 'zlib' }),
      makeDep({ name: 'lodash' }),
    ]

    const sorted = sortDeps(deps, 'name-desc')
    expect(sorted.map((d) => d.name)).toEqual(['zlib', 'lodash', 'axios'])
  })

  it('handles missing publishedAt in time sort', () => {
    const deps = [
      makeDep({ name: 'no-time' }),
      makeDep({ name: 'has-time', publishedAt: '2025-01-01T00:00:00Z' }),
    ]

    const sorted = sortDeps(deps, 'time-asc')
    expect(sorted.map((d) => d.name)).toEqual(['no-time', 'has-time'])
  })

  it('does not mutate the original array', () => {
    const deps = [makeDep({ name: 'b' }), makeDep({ name: 'a' })]
    const original = [...deps]

    sortDeps(deps, 'name-asc')
    expect(deps.map((d) => d.name)).toEqual(original.map((d) => d.name))
  })
})
