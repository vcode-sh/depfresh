import type { RangeMode } from '../types'

export function getPackageMode(
  packageName: string,
  packageMode: Record<string, RangeMode> | undefined,
  defaultMode: RangeMode,
): RangeMode {
  if (!packageMode) return defaultMode

  if (packageMode[packageName]) {
    return packageMode[packageName]
  }

  for (const [pattern, mode] of Object.entries(packageMode)) {
    if (pattern === packageName) continue

    try {
      const regex = patternToMatchRegex(pattern)
      if (regex.test(packageName)) {
        return mode
      }
    } catch {
      // Skip invalid patterns.
    }
  }

  return defaultMode
}

function patternToMatchRegex(pattern: string): RegExp {
  if (pattern.includes('*') && !/[\^$[\]()\\|+?]/.test(pattern)) {
    const escaped = pattern.replace(/[.@/]/g, '\\$&').replace(/\*/g, '[^/]*')
    return new RegExp(`^${escaped}$`)
  }
  return new RegExp(pattern)
}
