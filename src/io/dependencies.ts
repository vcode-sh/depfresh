import type { BumpOptions, DepFieldType, RawDep } from '../types'
import { isLocked } from '../utils/versions'

const DEP_FIELDS: DepFieldType[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

const OVERRIDE_FIELDS: DepFieldType[] = [
  'overrides',
  'resolutions',
  'pnpm.overrides',
]

export function isDepFieldEnabled(field: DepFieldType, options: BumpOptions): boolean {
  if (options.depFields?.[field] === false) return false
  if (field === 'peerDependencies' && !options.peer) return false
  return true
}

export function parseDependencies(
  raw: Record<string, unknown>,
  options: BumpOptions,
): RawDep[] {
  const deps: RawDep[] = []

  // Standard dependency fields
  for (const field of DEP_FIELDS) {
    if (!isDepFieldEnabled(field, options)) continue

    const section = raw[field]
    if (!section || typeof section !== 'object') continue

    for (const [name, version] of Object.entries(section as Record<string, string>)) {
      if (shouldSkipDependency(name, version, options)) continue

      deps.push({
        name,
        currentVersion: version,
        source: field,
        update: !isLocked(version) || options.includeLocked,
        parents: [],
        ...parseProtocol(version),
      })
    }
  }

  // Override fields
  for (const field of OVERRIDE_FIELDS) {
    if (!isDepFieldEnabled(field, options)) continue

    const section = getNestedField(raw, field)
    if (!section || typeof section !== 'object') continue

    flattenOverrides(section as Record<string, unknown>, field, deps, options, [])
  }

  return deps
}

function shouldSkipDependency(
  name: string,
  version: string,
  options: BumpOptions,
): boolean {
  // Skip workspace: protocol
  if (version.startsWith('workspace:') && !options.includeWorkspace) return false

  // Skip catalog: protocol
  if (version.startsWith('catalog:')) return false

  // Skip link/file/git protocols
  if (/^(link|file|git|github|https?):/.test(version)) return true

  // Include/exclude filters
  if (options.include?.length && !options.include.some((p) => new RegExp(p).test(name))) {
    return true
  }
  if (options.exclude?.length && options.exclude.some((p) => new RegExp(p).test(name))) {
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

function flattenOverrides(
  obj: Record<string, unknown>,
  source: DepFieldType,
  deps: RawDep[],
  options: BumpOptions,
  parents: string[],
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      if (shouldSkipDependency(key, value, options)) continue
      deps.push({
        name: key,
        currentVersion: value,
        source,
        update: !isLocked(value) || options.includeLocked,
        parents,
        ...parseProtocol(value),
      })
    } else if (typeof value === 'object' && value !== null) {
      flattenOverrides(value as Record<string, unknown>, source, deps, options, [...parents, key])
    }
  }
}
