import type { BumpOptions, DepFieldType, RawDep } from '../../types'
import { isLocked } from '../../utils/versions'
import { parseProtocol } from './protocols'

export function parseOverrideKey(key: string): string {
  // Scoped packages: @scope/name@version-range -> @scope/name
  if (key.startsWith('@')) {
    const secondAt = key.indexOf('@', 1)
    if (secondAt !== -1) {
      return key.slice(0, secondAt)
    }
    // @scope/name with no version suffix
    return key
  }

  // Regular packages: name@version-range -> name
  const atIndex = key.indexOf('@')
  if (atIndex !== -1) {
    return key.slice(0, atIndex)
  }

  // Plain name
  return key
}

export function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

type SkipFn = (
  name: string,
  version: string,
  options: BumpOptions,
  includePatterns: RegExp[],
  excludePatterns: RegExp[],
) => boolean

export function flattenOverrides(
  obj: Record<string, unknown>,
  source: DepFieldType,
  deps: RawDep[],
  options: BumpOptions,
  parents: string[],
  includePatterns: RegExp[],
  excludePatterns: RegExp[],
  skipFn: SkipFn,
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const name = parseOverrideKey(key)
      if (skipFn(name, value, options, includePatterns, excludePatterns)) continue
      const protocol = parseProtocol(value)
      deps.push({
        name,
        currentVersion: protocol.currentVersion,
        source,
        update: !isLocked(protocol.currentVersion) || options.includeLocked,
        parents: [...parents, key],
        protocol: protocol.protocol,
      })
    } else if (typeof value === 'object' && value !== null) {
      flattenOverrides(
        value as Record<string, unknown>,
        source,
        deps,
        options,
        [...parents, key],
        includePatterns,
        excludePatterns,
        skipFn,
      )
    }
  }
}
