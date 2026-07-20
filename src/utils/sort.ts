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

export interface DependencySortFacts {
  readonly name: string
  readonly diff: DiffType
  readonly publishedAt?: string
}

export function compareDependencySortFacts(
  left: DependencySortFacts,
  right: DependencySortFacts,
  sort: SortOption,
): number {
  const diff = () => (DIFF_ORDER[left.diff] ?? 4) - (DIFF_ORDER[right.diff] ?? 4)
  const time = () =>
    (left.publishedAt ? new Date(left.publishedAt).getTime() : 0) -
    (right.publishedAt ? new Date(right.publishedAt).getTime() : 0)
  if (sort === 'diff-asc') return diff()
  if (sort === 'diff-desc') return -diff()
  if (sort === 'time-asc') return time()
  if (sort === 'time-desc') return -time()
  const name = left.name.localeCompare(right.name)
  return sort === 'name-desc' ? -name : name
}

export function sortDeps(deps: ResolvedDepChange[], sort: SortOption): ResolvedDepChange[] {
  if (deps.length === 0) return deps

  return [...deps].sort((left, right) => compareDependencySortFacts(left, right, sort))
}
