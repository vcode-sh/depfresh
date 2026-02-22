import type { RangeMode } from '../types'
import { patternToRegex } from '../utils/patterns'

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
      const regex = patternToRegex(pattern)
      if (regex.test(packageName)) {
        return mode
      }
    } catch {
      // Skip invalid patterns.
    }
  }

  return defaultMode
}
