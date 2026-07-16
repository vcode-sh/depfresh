import { dirname } from 'node:path'
import * as semver from 'semver'
import { parseProtocol } from '../io/dependencies/protocols'
import type {
  PolicyCatalogRole,
  PolicyOccurrenceContext,
  PolicySpecifierStatus,
  RepositoryCatalog,
  RepositoryDependencyOccurrence,
  RepositoryEvidenceConclusion,
  RepositoryEvidenceStatus,
  RepositoryLockfileManager,
  RepositoryModel,
  RepositoryPackageManifest,
} from '../types'
import { isLocked, isRange, normalizeVersion } from '../utils/versions'

const MANAGERS = new Set<RepositoryLockfileManager>(['npm', 'pnpm', 'yarn', 'bun'])
const DYNAMIC_PROTOCOLS = new Set(['catalog', 'file', 'link', 'git', 'http'])
const DYNAMIC_TAG = /^[a-z][a-z0-9._-]*$/u

interface SpecifierContext {
  currentVersion?: string
  currentChannel?: string
  specifierStatus: PolicySpecifierStatus
}

interface ManagerContext {
  manager?: RepositoryLockfileManager
  managerEvidenceStatus: RepositoryEvidenceStatus
}

export function createPolicyContexts(model: RepositoryModel): PolicyOccurrenceContext[] {
  const packages = new Map(model.packages.map((pkg) => [pkg.id, pkg]))
  const catalogs = new Map(model.catalogs.map((catalog) => [catalog.id, catalog]))
  const sources = new Map(model.sourceFiles.map((source) => [source.id, source]))
  return model.occurrences.map((occurrence) => {
    const pkg = packages.get(occurrence.ownerId)
    const catalog = occurrence.catalogId
      ? catalogs.get(occurrence.catalogId)
      : catalogs.get(occurrence.ownerId)
    const source = sources.get(occurrence.sourceFileId)
    const manager =
      occurrence.role === 'catalog-consumer' && !catalog
        ? unresolvedCatalogManager(model, occurrence, source?.path)
        : deriveManagerContext(model, pkg, catalog)
    const specifier = classifySpecifier(occurrence)
    return {
      occurrenceId: occurrence.id,
      dependencyName: occurrence.name,
      ...resolutionName(occurrence),
      ...(pkg ? { workspacePath: pkg.workspacePath, packageName: pkg.name } : {}),
      ...(!pkg && source ? { workspacePath: normalizeDirectory(dirname(source.path)) } : {}),
      ...(catalog ? { catalogName: catalog.name } : unresolvedCatalogName(occurrence)),
      catalogRole: catalogRole(occurrence),
      field: occurrence.field,
      role: occurrence.role,
      protocol: occurrence.protocol,
      ...specifier,
      ...manager,
    }
  })
}

function unresolvedCatalogManager(
  model: RepositoryModel,
  occurrence: RepositoryDependencyOccurrence,
  sourcePath: string | undefined,
): ManagerContext {
  const detail = `${occurrence.field}.${occurrence.name}`
  const ambiguous = model.diagnostics.some(
    (diagnostic) =>
      diagnostic.code === 'CATALOG_REFERENCE_AMBIGUOUS' &&
      diagnostic.path === sourcePath &&
      diagnostic.detail === detail,
  )
  return { managerEvidenceStatus: ambiguous ? 'ambiguous' : 'missing' }
}

function resolutionName(
  occurrence: RepositoryDependencyOccurrence,
): Pick<PolicyOccurrenceContext, 'resolutionName'> | Record<string, never> {
  const aliasName = parseProtocol(occurrence.declaredText).aliasName
  return aliasName ? { resolutionName: aliasName } : {}
}

function deriveManagerContext(
  model: RepositoryModel,
  pkg: RepositoryPackageManifest | undefined,
  catalog: RepositoryCatalog | undefined,
): ManagerContext {
  if (catalog) return { manager: catalog.manager, managerEvidenceStatus: 'confirmed' }
  if (!pkg) return { managerEvidenceStatus: 'missing' }
  const boundary = model.relationships.boundaryPackages?.find(
    (relationship) => relationship.packageId === pkg.id,
  )
  if (!boundary) return { managerEvidenceStatus: 'missing' }
  const evidence = model.evidence?.find(
    (conclusion) =>
      conclusion.kind === 'package-manager' && conclusion.boundaryId === boundary.boundaryId,
  )
  if (!evidence) return { managerEvidenceStatus: 'missing' }
  const managers = extractManagers(evidence)
  if (evidence.status !== 'confirmed' || managers.length !== 1) {
    return { managerEvidenceStatus: evidence.status }
  }
  return { manager: managers[0], managerEvidenceStatus: 'confirmed' }
}

function extractManagers(evidence: RepositoryEvidenceConclusion): RepositoryLockfileManager[] {
  const managers = new Set<RepositoryLockfileManager>()
  for (const value of evidence.value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const name = (value as Record<string, unknown>).name
    if (typeof name === 'string' && MANAGERS.has(name as RepositoryLockfileManager)) {
      managers.add(name as RepositoryLockfileManager)
    }
  }
  return [...managers].sort()
}

function classifySpecifier(occurrence: RepositoryDependencyOccurrence): SpecifierContext {
  if (occurrence.role === 'catalog-consumer') return { specifierStatus: 'dynamic' }
  if (DYNAMIC_PROTOCOLS.has(occurrence.protocol)) return { specifierStatus: 'dynamic' }

  let candidate = occurrence.declaredText.trim()
  if (occurrence.role === 'package-manager') {
    const separator = candidate.lastIndexOf('@')
    candidate = separator === -1 ? '' : candidate.slice(separator + 1).split('+')[0]!
  } else if (
    occurrence.protocol === 'npm' ||
    occurrence.protocol === 'jsr' ||
    occurrence.protocol === 'workspace' ||
    occurrence.protocol === 'github'
  ) {
    candidate = parseProtocol(candidate).currentVersion.trim()
  }

  if (
    occurrence.protocol === 'workspace' &&
    (candidate === '' || candidate === '*' || candidate === '^' || candidate === '~')
  ) {
    return { specifierStatus: 'dynamic' }
  }
  const status = classifySemver(candidate)
  if (status === 'dynamic' || status === 'invalid') return { specifierStatus: status }
  const currentVersion = normalizeExactOrRange(candidate)
  if (!currentVersion) return { specifierStatus: 'invalid' }
  const prerelease = semver.prerelease(currentVersion)
  return {
    currentVersion,
    currentChannel: prerelease?.[0] === undefined ? 'stable' : String(prerelease[0]),
    specifierStatus: status,
  }
}

function classifySemver(value: string): PolicySpecifierStatus {
  if (isLocked(value)) return 'locked'
  if (isRange(value)) return 'range'
  if (DYNAMIC_TAG.test(value)) return 'dynamic'
  return 'invalid'
}

function normalizeExactOrRange(value: string): string | undefined {
  const trimmed = value.trim()
  if (isLocked(trimmed)) {
    return semver.valid(trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed) ?? undefined
  }
  return normalizeVersion(trimmed) ?? undefined
}

function catalogRole(occurrence: RepositoryDependencyOccurrence): PolicyCatalogRole {
  if (occurrence.role === 'catalog-owner') return 'owner'
  if (occurrence.role === 'catalog-consumer') return 'consumer'
  return 'direct'
}

function unresolvedCatalogName(
  occurrence: RepositoryDependencyOccurrence,
): Pick<PolicyOccurrenceContext, 'catalogName'> | Record<string, never> {
  if (occurrence.role !== 'catalog-consumer') return {}
  const name = occurrence.declaredText.slice('catalog:'.length) || 'default'
  return { catalogName: name }
}

function normalizeDirectory(value: string): string {
  return value === '' ? '.' : value.split('\\').join('/')
}
