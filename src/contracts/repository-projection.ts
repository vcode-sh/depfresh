import type { RepositoryDiagnostic, RepositoryModel } from '../types'
import { canonicalJson } from './canonical-json'
import { createRepositoryFingerprint, type RepositoryFingerprintSource } from './fingerprint'
import { isContractSafeText, sanitizeContractText } from './sanitize'

export class RepositoryProjectionError extends Error {
  readonly code = 'ERR_CONTRACT'

  constructor(
    readonly reason: 'UNSAFE_PUBLIC_PATH' | 'SOURCE_SNAPSHOT_CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'RepositoryProjectionError'
  }
}

export function collectFingerprintSources(model: RepositoryModel): RepositoryFingerprintSource[] {
  const sources = new Map<string, string>()
  const addSource = (path: string, byteHash: string): void => {
    const existing = sources.get(path)
    if (existing && existing !== byteHash) {
      throw new RepositoryProjectionError(
        'SOURCE_SNAPSHOT_CONFLICT',
        'Repository source hashes changed during inspection.',
      )
    }
    sources.set(path, byteHash)
  }
  for (const source of model.sourceFiles) addSource(source.path, source.byteHash)
  for (const lockfile of model.lockfiles ?? []) {
    if (lockfile.byteHash) addSource(lockfile.path, lockfile.byteHash)
  }
  for (const runtime of model.runtimeDeclarations ?? []) {
    if (runtime.byteHash) addSource(runtime.path, runtime.byteHash)
  }
  return [...sources.entries()]
    .map(([path, byteHash]) => ({ path, byteHash }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

export function projectRepository(model: RepositoryModel) {
  assertPublicRepositoryPaths(model)
  const sources = collectFingerprintSources(model)
  return {
    identity: model.rootId,
    fingerprint: createRepositoryFingerprint({
      schemaVersion: 1,
      rootIdentity: model.rootId,
      sources,
    }),
    modelSchemaVersion: model.schemaVersion,
    sources,
    ...(model.root ? { root: { ...model.root } } : {}),
    boundaries: (model.boundaries ?? [])
      .map((boundary) => ({
        ...boundary,
        markers: boundary.markers
          .map((marker) => ({ ...marker }))
          .sort((left, right) => compareCodeUnits(left.id, right.id)),
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    sourceFiles: model.sourceFiles
      .map((source) => ({ ...source }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    packages: model.packages
      .map((pkg) => ({
        ...pkg,
        name: sanitizeContractText(pkg.name),
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    catalogs: model.catalogs
      .map((catalog) => ({
        ...catalog,
        name: sanitizeContractText(catalog.name),
        entries: catalog.entries
          .map((entry) => ({
            ...entry,
            name: sanitizeContractText(entry.name),
          }))
          .sort((left, right) => compareCodeUnits(left.occurrenceId, right.occurrenceId)),
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    runtimeDeclarations: (model.runtimeDeclarations ?? [])
      .map((runtime) => ({
        ...runtime,
        declaredText: sanitizeContractText(runtime.declaredText),
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    relationships: {
      workspaceMembers: [...model.relationships.workspaceMembers].sort((left, right) =>
        compareCodeUnits(
          `${left.workspaceId}\0${left.packageId}`,
          `${right.workspaceId}\0${right.packageId}`,
        ),
      ),
      catalogConsumers: [...model.relationships.catalogConsumers].sort((left, right) =>
        compareCodeUnits(
          `${left.catalogId}\0${left.occurrenceId}`,
          `${right.catalogId}\0${right.occurrenceId}`,
        ),
      ),
      boundaryPackages: [...(model.relationships.boundaryPackages ?? [])].sort((left, right) =>
        compareCodeUnits(
          `${left.boundaryId}\0${left.packageId}`,
          `${right.boundaryId}\0${right.packageId}`,
        ),
      ),
      lockfileBoundaries: [...(model.relationships.lockfileBoundaries ?? [])].sort((left, right) =>
        compareCodeUnits(
          `${left.lockfileId}\0${left.boundaryId}`,
          `${right.lockfileId}\0${right.boundaryId}`,
        ),
      ),
    },
  } as const
}

export function projectOccurrences(model: RepositoryModel) {
  const sourcePaths = new Map(model.sourceFiles.map((source) => [source.id, source.path]))
  return model.occurrences
    .map((occurrence) => ({
      id: occurrence.id,
      ownerId: occurrence.ownerId,
      sourceFileId: occurrence.sourceFileId,
      file: sourcePaths.get(occurrence.sourceFileId) ?? '.',
      name: sanitizeContractText(occurrence.name),
      path: occurrence.path.map(sanitizeContractText),
      field: occurrence.field,
      role: occurrence.role,
      protocol: occurrence.protocol,
      declaredValue: sanitizeContractText(occurrence.declaredText),
      writeable: occurrence.writeable,
      ...(occurrence.catalogId ? { catalogId: occurrence.catalogId } : {}),
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id))
}

export function projectEvidence(model: RepositoryModel) {
  return (model.evidence ?? [])
    .map((conclusion) => ({
      id: conclusion.id,
      kind: conclusion.kind,
      ...(conclusion.boundaryId ? { boundaryId: conclusion.boundaryId } : {}),
      status: conclusion.status,
      values: evidenceValues(model, conclusion)
        .map(projectJsonValue)
        .sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right))),
      sources: conclusion.sources
        .map((source) => ({
          ...source,
          ...(source.field ? { field: source.field.map(sanitizeContractText) } : {}),
        }))
        .sort((left, right) => compareCodeUnits(left.id, right.id)),
      diagnostics: conclusion.diagnostics.map(projectDiagnostic).sort(compareDiagnostics),
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id))
}

function evidenceValues(
  model: RepositoryModel,
  conclusion: NonNullable<RepositoryModel['evidence']>[number],
): unknown[] {
  if (conclusion.kind !== 'vcs') return conclusion.value
  const vcs = projectVcs(model)
  return [
    {
      ...(vcs.shallow === undefined ? {} : { shallow: vcs.shallow }),
      repositories: (model.vcs?.repositories ?? [])
        .map((repository) => ({
          ...repository,
          diagnostics: repository.diagnostics.map(projectDiagnostic).sort(compareDiagnostics),
        }))
        .sort((left, right) => compareCodeUnits(left.boundaryId, right.boundaryId)),
      targetFiles: vcs.targetFiles,
      unrelatedDirtyPaths: vcs.unrelatedDirtyPaths,
    },
  ]
}

export function projectDiagnostic(diagnostic: RepositoryDiagnostic) {
  return {
    code: diagnostic.code,
    path: diagnostic.path,
    ...(diagnostic.detail ? { detail: sanitizeContractText(diagnostic.detail) } : {}),
  }
}

export function projectVcs(model: RepositoryModel) {
  const vcs = model.vcs ?? {
    status: 'unavailable' as const,
    targetFiles: [],
    unrelatedDirtyPaths: [],
    diagnostics: [],
  }
  return {
    status: vcs.status,
    ...(vcs.shallow === undefined ? {} : { shallow: vcs.shallow }),
    targetFiles: vcs.targetFiles
      .map((target) => ({
        path: target.path,
        state: target.state,
        ...(target.originalPath ? { originalPath: target.originalPath } : {}),
      }))
      .sort((left, right) =>
        compareCodeUnits(
          `${left.path}\0${left.state}\0${left.originalPath ?? ''}`,
          `${right.path}\0${right.state}\0${right.originalPath ?? ''}`,
        ),
      ),
    unrelatedDirtyPaths: [...vcs.unrelatedDirtyPaths].sort(compareCodeUnits),
    diagnostics: vcs.diagnostics.map(projectDiagnostic).sort(compareDiagnostics),
  }
}

export function projectLockfiles(model: RepositoryModel) {
  return (model.lockfiles ?? [])
    .map((lockfile) => ({
      ...lockfile,
      ...(lockfile.formatVersion
        ? { formatVersion: sanitizeContractText(lockfile.formatVersion) }
        : {}),
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id))
}

export function compareDiagnostics(
  left: ReturnType<typeof projectDiagnostic>,
  right: ReturnType<typeof projectDiagnostic>,
): number {
  return compareCodeUnits(
    `${left.path}\0${left.code}\0${left.detail ?? ''}`,
    `${right.path}\0${right.code}\0${right.detail ?? ''}`,
  )
}

export function projectRepositoryRisks(model: RepositoryModel) {
  const occurrenceRisks = model.occurrences.flatMap((occurrence) => {
    if ([occurrence.name, occurrence.declaredText, ...occurrence.path].every(isContractSafeText)) {
      return []
    }
    return [
      {
        code: 'OCCURRENCE_VALUE_REDACTED',
        severity: 'blocking' as const,
        message: 'An occurrence contains a non-public value and exact evidence was withheld.',
        occurrenceId: occurrence.id,
        evidenceRefs: [],
      },
    ]
  })
  const evidenceRisks = (model.evidence ?? []).flatMap((conclusion) => {
    if (conclusion.status === 'confirmed' || conclusion.status === 'missing') return []
    if (
      conclusion.kind === 'vcs' &&
      conclusion.diagnostics.every((diagnostic) => diagnostic.code === 'VCS_PROBE_DISABLED')
    ) {
      return []
    }
    return [
      {
        code: `EVIDENCE_${conclusion.status.toUpperCase()}`,
        severity: conclusion.status === 'ambiguous' ? ('blocking' as const) : ('warning' as const),
        message: `${conclusion.kind} evidence is ${conclusion.status}`,
        evidenceRefs: [conclusion.id],
      },
    ]
  })
  const diagnosticRisks = model.diagnostics.flatMap((diagnostic) => {
    if (diagnostic.code === 'VCS_PROBE_DISABLED') return []
    const evidenceRefs = (model.evidence ?? [])
      .filter((conclusion) =>
        conclusion.diagnostics.some(
          (candidate) => candidate.code === diagnostic.code && candidate.path === diagnostic.path,
        ),
      )
      .map((conclusion) => conclusion.id)
    return [
      {
        code: diagnostic.code,
        severity: 'blocking' as const,
        message: `Repository diagnostic ${diagnostic.code} affects ${diagnostic.path}.`,
        evidenceRefs,
      },
    ]
  })
  const withheldModelRisks = [
    ...model.packages.map((pkg) => pkg.name),
    ...model.catalogs.flatMap((catalog) => [
      catalog.name,
      ...catalog.entries.map((entry) => entry.name),
    ]),
    ...(model.runtimeDeclarations ?? []).map((runtime) => runtime.declaredText),
    ...(model.lockfiles ?? []).flatMap((lockfile) =>
      lockfile.formatVersion ? [lockfile.formatVersion] : [],
    ),
    ...(model.evidence ?? []).flatMap((conclusion) => collectJsonStrings(conclusion.value)),
    ...(model.evidence ?? []).flatMap((conclusion) =>
      conclusion.sources.flatMap((source) => source.field ?? []),
    ),
  ].some((value) => !isContractSafeText(value))
    ? [
        {
          code: 'REPOSITORY_VALUE_REDACTED',
          severity: 'blocking' as const,
          message: 'Repository evidence contains a non-public value and exact text was withheld.',
          evidenceRefs: [],
        },
      ]
    : []
  return [...evidenceRisks, ...diagnosticRisks, ...occurrenceRisks, ...withheldModelRisks].sort(
    compareCanonical,
  )
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareCanonical(left: unknown, right: unknown): number {
  return compareCodeUnits(canonicalJson(left), canonicalJson(right))
}

function projectJsonValue(value: unknown): null | boolean | number | string | object {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sanitizeContractText(value)
  if (Array.isArray(value)) {
    return value.map((entry) => projectJsonValue(entry))
  }
  if (typeof value === 'object') {
    const projected = Object.create(null) as Record<
      string,
      null | boolean | number | string | object
    >
    for (const [key, entry] of Object.entries(value).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    )) {
      if (entry === undefined) continue
      projected[sanitizeContractText(key)] = projectJsonValue(entry)
    }
    return projected
  }
  return null
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectJsonStrings)
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...collectJsonStrings(entry)])
  }
  return []
}

function assertPublicRepositoryPaths(model: RepositoryModel): void {
  const paths = [
    ...model.sourceFiles.map((source) => source.path),
    ...model.packages.flatMap((pkg) => [pkg.path, pkg.workspacePath]),
    ...(model.boundaries ?? []).flatMap((boundary) => [
      boundary.path,
      ...boundary.markers.map((marker) => marker.path),
    ]),
    ...(model.lockfiles ?? []).map((lockfile) => lockfile.path),
    ...(model.runtimeDeclarations ?? []).map((runtime) => runtime.path),
    ...model.diagnostics.map((diagnostic) => diagnostic.path),
    ...(model.vcs?.targetFiles ?? []).flatMap((target) => [
      target.path,
      ...(target.originalPath ? [target.originalPath] : []),
    ]),
    ...(model.vcs?.unrelatedDirtyPaths ?? []),
    ...(model.vcs?.repositories ?? []).flatMap((repository) => [
      repository.path,
      ...repository.diagnostics.map((diagnostic) => diagnostic.path),
    ]),
    ...(model.evidence ?? []).flatMap((conclusion) => [
      ...conclusion.sources.map((source) => source.path),
      ...conclusion.diagnostics.map((diagnostic) => diagnostic.path),
    ]),
  ]
  if (paths.some((path) => !isContractSafeText(path))) {
    throw new RepositoryProjectionError(
      'UNSAFE_PUBLIC_PATH',
      'Repository paths cannot be represented in the public machine contract.',
    )
  }
}
