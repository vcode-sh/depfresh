import type { DepFieldType, depfreshOptions, RawDep } from '../../types'
import { isLocked } from '../../utils/versions'
import { flattenOverrides, getNestedField } from './overrides'
import { compilePatternsStrict } from './patterns'
import { parseProtocol } from './protocols'

export const DEP_FIELDS: DepFieldType[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

export const OVERRIDE_FIELDS: DepFieldType[] = ['overrides', 'resolutions', 'pnpm.overrides']

export function isDepFieldEnabled(field: DepFieldType, options: depfreshOptions): boolean {
  if (options.depFields?.[field] === false) return false
  if (field === 'peerDependencies' && !options.peer) return false
  return true
}

export function shouldSkipDependency(
  name: string,
  version: string,
  options: depfreshOptions,
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

export function parseDependencies(
  raw: Record<string, unknown>,
  options: depfreshOptions,
): RawDep[] {
  const deps: RawDep[] = []
  const includePatterns = options.include?.length ? compilePatternsStrict(options.include) : []
  const excludePatterns = options.exclude?.length ? compilePatternsStrict(options.exclude) : []

  // Standard dependency fields
  for (const field of DEP_FIELDS) {
    if (!isDepFieldEnabled(field, options)) continue

    const section = raw[field]
    if (!section || typeof section !== 'object') continue

    for (const [name, rawVersion] of Object.entries(section as Record<string, unknown>)) {
      if (typeof rawVersion !== 'string') continue
      const version = rawVersion
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
      shouldSkipDependency,
    )
  }

  return deps
}
