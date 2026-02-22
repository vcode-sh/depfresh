/**
 * Shared glob-to-regex conversion logic used by dependency filters
 * and per-package mode matching.
 */

import { ConfigError } from '../errors'

export function isGlob(pattern: string): boolean {
  // A glob contains * but not regex metacharacters like ^ $ [ ] ( ) | + ?
  return pattern.includes('*') && !/[\^$[\]()\\|+?]/.test(pattern)
}

export function patternToRegex(pattern: string): RegExp {
  // Support /regex/flags syntax
  const slashMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/)
  if (slashMatch) {
    return new RegExp(slashMatch[1]!, slashMatch[2])
  }

  if (isGlob(pattern)) {
    // Convert glob to regex: escape special regex chars, then convert * to [^/]*
    const escaped = pattern.replace(/[.@/]/g, '\\$&').replace(/\*/g, '[^/]*')
    return new RegExp(`^${escaped}$`)
  }

  // Plain regex
  return new RegExp(pattern)
}

export function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = []
  for (const p of patterns) {
    try {
      compiled.push(patternToRegex(p))
    } catch {
      // Skip invalid patterns in public utility mode.
    }
  }
  return compiled
}

export function compilePatternsStrict(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = []
  for (const p of patterns) {
    try {
      compiled.push(patternToRegex(p))
    } catch (error) {
      throw new ConfigError(`Invalid dependency filter pattern: ${p}`, { cause: error })
    }
  }
  return compiled
}
