import { ConfigError } from '../errors'
import type { BumpOptions, DepFieldType, RawDep } from '../types'
import { isLocked } from '../utils/versions'

const DEP_FIELDS: DepFieldType[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

const OVERRIDE_FIELDS: DepFieldType[] = ['overrides', 'resolutions', 'pnpm.overrides']

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

function compilePatternsStrict(patterns: string[]): RegExp[] {
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

function isGlob(pattern: string): boolean {
  // A glob contains * but not regex metacharacters like ^ $ [ ] ( ) | + ?
  return pattern.includes('*') && !/[\^$[\]()\\|+?]/.test(pattern)
}

function patternToRegex(pattern: string): RegExp {
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

export function isDepFieldEnabled(field: DepFieldType, options: BumpOptions): boolean {
  if (options.depFields?.[field] === false) return false
  if (field === 'peerDependencies' && !options.peer) return false
  return true
}

export function parseDependencies(raw: Record<string, unknown>, options: BumpOptions): RawDep[] {
  const deps: RawDep[] = []
  const includePatterns = options.include?.length ? compilePatternsStrict(options.include) : []
  const excludePatterns = options.exclude?.length ? compilePatternsStrict(options.exclude) : []

  // Standard dependency fields
  for (const field of DEP_FIELDS) {
    if (!isDepFieldEnabled(field, options)) continue

    const section = raw[field]
    if (!section || typeof section !== 'object') continue

    for (const [name, version] of Object.entries(section as Record<string, string>)) {
      if (shouldSkipDependency(name, version, options, includePatterns, excludePatterns)) continue

      const protocol = parseProtocol(version)
      deps.push({
        name,
        currentVersion: protocol.currentVersion,
        source: field,
        update: !isLocked(protocol.currentVersion) || options.includeLocked,
        parents: [],
        protocol: protocol.protocol,
      })
    }
  }

  // Override fields
  for (const field of OVERRIDE_FIELDS) {
    if (!isDepFieldEnabled(field, options)) continue

    const section = getNestedField(raw, field)
    if (!section || typeof section !== 'object') continue

    flattenOverrides(
      section as Record<string, unknown>,
      field,
      deps,
      options,
      [],
      includePatterns,
      excludePatterns,
    )
  }

  return deps
}

export function shouldSkipDependency(
  name: string,
  version: string,
  options: BumpOptions,
  includePatterns: RegExp[] = [],
  excludePatterns: RegExp[] = [],
): boolean {
  // Skip workspace: protocol
  if (version.startsWith('workspace:') && !options.includeWorkspace) return true

  // Skip catalog: protocol
  if (version.startsWith('catalog:')) return true

  // Skip link/file/git protocols
  if (/^(link|file|git|github|https?):/.test(version)) return true

  // Include/exclude filters (use pre-compiled patterns)
  if (includePatterns.length && !includePatterns.some((re) => re.test(name))) {
    return true
  }
  if (excludePatterns.length && excludePatterns.some((re) => re.test(name))) {
    return true
  }

  return false
}

function parseProtocol(version: string): { protocol?: string; currentVersion: string } {
  // npm:@scope/name@version or npm:name@version
  const npmMatch = version.match(/^npm:(.+)@(.+)$/)
  if (npmMatch) {
    return { protocol: 'npm', currentVersion: npmMatch[2]! }
  }

  // jsr:@scope/name@version
  const jsrMatch = version.match(/^jsr:(.+)@(.+)$/)
  if (jsrMatch) {
    return { protocol: 'jsr', currentVersion: jsrMatch[2]! }
  }

  return { currentVersion: version }
}

function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

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

function flattenOverrides(
  obj: Record<string, unknown>,
  source: DepFieldType,
  deps: RawDep[],
  options: BumpOptions,
  parents: string[],
  includePatterns: RegExp[],
  excludePatterns: RegExp[],
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const name = parseOverrideKey(key)
      if (shouldSkipDependency(name, value, options, includePatterns, excludePatterns)) continue
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
      )
    }
  }
}
