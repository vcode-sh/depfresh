import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import YAML from 'yaml'
import type {
  CanonicalOccurrencePath,
  CatalogSource,
  PackageMeta,
  ResolvedDepChange,
  WriteOutcome,
  WriteOutcomeReason,
  WriteOutcomeStatus,
} from '../../types'
import { rebuildVersion } from './version-utils'

export interface PhysicalWriteRequest {
  change: ResolvedDepChange
  occurrence: CanonicalOccurrencePath
  exactExpectedValue?: string
}

export interface ObservedOccurrence {
  known: boolean
  value?: string
}

export function canonicalizeFilepath(filepath: string): string {
  if (filepath.startsWith('global:')) return filepath
  try {
    return realpathSync(filepath)
  } catch {
    return resolve(filepath)
  }
}

export function createPackageWriteRequest(
  pkg: PackageMeta,
  change: ResolvedDepChange,
): PhysicalWriteRequest {
  return {
    change,
    occurrence: {
      file: canonicalizeFilepath(pkg.filepath),
      path: getPackageOccurrencePath(change),
    },
    exactExpectedValue: change.rawVersion,
  }
}

export function createCatalogWriteRequest(
  catalog: CatalogSource,
  change: ResolvedDepChange,
): PhysicalWriteRequest {
  return {
    change,
    occurrence: {
      file: canonicalizeFilepath(catalog.filepath),
      path: getCatalogOccurrencePath(catalog, change.name),
    },
    exactExpectedValue: change.rawVersion,
  }
}

export function resolvePhysicalValues(
  request: PhysicalWriteRequest,
  observedValue: string | undefined,
): { expectedValue: string; requestedValue: string } {
  const expectedValue = request.exactExpectedValue ?? observedValue ?? request.change.currentVersion
  return {
    expectedValue,
    requestedValue: rebuildStoredValue(request.change, expectedValue, request.change.targetVersion),
  }
}

export function createWriteOutcome(
  request: PhysicalWriteRequest,
  status: WriteOutcomeStatus,
  reason: WriteOutcomeReason,
  expectedValue: string,
  requestedValue: string,
  observedValue?: string,
): WriteOutcome {
  return {
    name: request.change.name,
    occurrence: request.occurrence,
    expectedValue,
    requestedValue,
    ...(observedValue === undefined ? {} : { observedValue }),
    status,
    reason,
  }
}

export function observeFileOccurrence(occurrence: CanonicalOccurrencePath): ObservedOccurrence {
  try {
    const content = readFileSync(occurrence.file, 'utf-8')
    const raw = occurrence.file.endsWith('.json') ? JSON.parse(content) : YAML.parse(content)
    return { known: true, value: getStringAtPath(raw, occurrence.path) }
  } catch {
    return { known: false }
  }
}

export function getStringAtPath(raw: unknown, path: string[]): string | undefined {
  let current = raw
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' ? current : undefined
}

export function setStringAtPath(raw: unknown, path: string[], value: string): boolean {
  if (path.length === 0) return false
  let current = raw
  for (const segment of path.slice(0, -1)) {
    if (!current || typeof current !== 'object') return false
    current = (current as Record<string, unknown>)[segment]
  }
  const key = path.at(-1)
  if (!(key && current) || typeof current !== 'object') return false
  ;(current as Record<string, unknown>)[key] = value
  return true
}

function getPackageOccurrencePath(change: ResolvedDepChange): string[] {
  if (change.source === 'packageManager') return ['packageManager']
  const sourcePath = change.source.split('.')
  if (
    change.source === 'overrides' ||
    change.source === 'resolutions' ||
    change.source === 'pnpm.overrides'
  ) {
    return [...sourcePath, ...(change.parents.length > 0 ? change.parents : [change.name])]
  }
  return [...sourcePath, change.name]
}

function getCatalogOccurrencePath(catalog: CatalogSource, name: string): string[] {
  if (catalog.type === 'bun') {
    return catalog.name === 'default'
      ? ['workspaces', 'catalog', name]
      : ['workspaces', 'catalogs', catalog.name, name]
  }
  if (catalog.type === 'pnpm') {
    return catalog.name === 'default' ? ['catalog', name] : ['catalogs', catalog.name, name]
  }
  return ['catalog', name]
}

function rebuildStoredValue(change: ResolvedDepChange, original: string, version: string): string {
  if (change.source !== 'packageManager') return rebuildVersion(original, version)

  const match = original.match(/^([^@]+)@([^+]+)(\+.+)?$/)
  if (!match) return version
  return `${match[1]}@${version}${match[3] ?? ''}`
}
