import type { OutputFormat, RangeMode, SortOption } from '../types'

export const VALID_MODES: readonly RangeMode[] = [
  'default',
  'major',
  'minor',
  'patch',
  'latest',
  'newest',
  'next',
]

export const VALID_OUTPUTS: readonly OutputFormat[] = ['table', 'json']

export const VALID_SORT_OPTIONS: readonly SortOption[] = [
  'diff-asc',
  'diff-desc',
  'time-asc',
  'time-desc',
  'name-asc',
  'name-desc',
]

export const VALID_LOG_LEVELS = ['silent', 'info', 'debug'] as const
