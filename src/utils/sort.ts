import type { DiffType, ResolvedDepChange, SortOption } from '../types'

const VALID_SORT_OPTIONS: Set<string> = new Set([
  'diff-asc',
  'diff-desc',
  'time-asc',
  'time-desc',
  'name-asc',
  'name-desc',
])

const DIFF_ORDER: Record<DiffType, number> = {
  major: 0,
  minor: 1,
  patch: 2,
  error: 3,
  none: 4,
}

export function parseSortOption(value: string): SortOption {
  if (VALID_SORT_OPTIONS.has(value)) return value as SortOption
  return 'diff-asc'
}

function byDiff(a: ResolvedDepChange, b: ResolvedDepChange): number {
  return (DIFF_ORDER[a.diff] ?? 4) - (DIFF_ORDER[b.diff] ?? 4)
}

function byTime(a: ResolvedDepChange, b: ResolvedDepChange): number {
  const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
  const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
  return aTime - bTime
}

function byName(a: ResolvedDepChange, b: ResolvedDepChange): number {
  return a.name.localeCompare(b.name)
}

export function sortDeps(deps: ResolvedDepChange[], sort: SortOption): ResolvedDepChange[] {
  if (deps.length === 0) return deps

  const sorted = [...deps]

  switch (sort) {
    case 'diff-asc':
      sorted.sort(byDiff)
      break
    case 'diff-desc':
      sorted.sort((a, b) => byDiff(b, a))
      break
    case 'time-asc':
      sorted.sort(byTime)
      break
    case 'time-desc':
      sorted.sort((a, b) => byTime(b, a))
      break
    case 'name-asc':
      sorted.sort(byName)
      break
    case 'name-desc':
      sorted.sort((a, b) => byName(b, a))
      break
  }

  return sorted
}
