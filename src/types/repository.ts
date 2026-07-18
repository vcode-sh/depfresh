export const REPOSITORY_MODEL_SCHEMA_VERSION = 1 as const

export type RepositoryModelSchemaVersion = typeof REPOSITORY_MODEL_SCHEMA_VERSION

export interface InspectRepositoryOptions {
  cwd: string
  recursive?: boolean
  ignorePaths?: string[]
  ignoreOtherWorkspaces?: boolean
  vcs?: 'probe' | 'disabled'
}

export type RepositoryEvidenceStatus =
  | 'confirmed'
  | 'ambiguous'
  | 'missing'
  | 'unsupported'
  | 'unavailable'

export type RepositoryEvidenceKind =
  | 'root'
  | 'workspace'
  | 'package-manager'
  | 'lockfile-selection'
  | 'runtime'
  | 'vcs'

export interface RepositoryEvidenceSource {
  id: string
  kind: 'file' | 'field' | 'probe'
  path: string
  field?: string[]
  probe?: 'discovery' | 'git'
  byteHash?: string
}

export interface RepositoryEvidenceDiagnostic {
  id: string
  code: RepositoryDiagnosticCode
  path: string
  detail?: string
}

export interface RepositoryEvidenceConclusion<T = unknown> {
  id: string
  kind: RepositoryEvidenceKind
  boundaryId?: string
  status: RepositoryEvidenceStatus
  value: T[]
  sources: RepositoryEvidenceSource[]
  diagnostics: RepositoryEvidenceDiagnostic[]
}

export interface RepositoryRootEvidence {
  id: string
  path: '.'
  discoveryMode: 'direct-root' | 'inside-project' | 'parent-folder'
  evidenceId: string
}

export interface RepositoryBoundaryMarker {
  id: string
  kind: 'pnpm-workspace' | 'yarn-workspace' | 'manifest-workspaces' | 'git-repo'
  path: string
}

export interface RepositoryBoundary {
  id: string
  path: string
  classification: 'effective-root' | 'nested-workspace' | 'nested-git'
  markers: RepositoryBoundaryMarker[]
}

export type RepositoryLockfileManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type RepositoryLockfileParseState = 'parsed' | 'error' | 'unsupported' | 'unavailable'

export interface RepositoryLockfile {
  id: string
  boundaryId: string
  manager: RepositoryLockfileManager
  path: string
  byteHash?: string
  parseState: RepositoryLockfileParseState
  formatVersion?: string
}

export type RepositoryRuntimeDeclarationKind =
  | 'engines-node'
  | 'nvmrc'
  | 'node-version'
  | 'tool-versions-nodejs'

export interface RepositoryRuntimeDeclaration {
  id: string
  boundaryId: string
  kind: RepositoryRuntimeDeclarationKind
  path: string
  field?: string
  declaredText: string
  byteHash?: string
}

export type RepositoryVcsTargetStateName =
  | 'clean'
  | 'staged'
  | 'unstaged'
  | 'staged-plus-unstaged'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'conflicted'
  | 'untracked'
  | 'ignored'

export interface RepositoryVcsTargetState {
  path: string
  state: RepositoryVcsTargetStateName
  originalPath?: string
}

export interface RepositoryVcsBoundaryEvidence {
  boundaryId: string
  path: string
  status: 'confirmed' | 'unavailable'
  shallow?: boolean
  diagnostics: RepositoryEvidenceDiagnostic[]
}

export interface RepositoryVcsEvidence {
  status: 'confirmed' | 'unavailable'
  shallow?: boolean
  targetFiles: RepositoryVcsTargetState[]
  unrelatedDirtyPaths: string[]
  diagnostics: RepositoryEvidenceDiagnostic[]
  repositories?: RepositoryVcsBoundaryEvidence[]
}

export type RepositorySourceFormat = 'json' | 'yaml'
export type RepositoryParseState = 'parsed' | 'error'

export interface RepositorySourceFile {
  id: string
  path: string
  format: RepositorySourceFormat
  byteHash: string
  parseState: RepositoryParseState
  indent: string
  newline: 'lf' | 'crlf' | 'mixed' | 'none'
  trailingNewline: boolean
}

export interface RepositoryPackageManifest {
  id: string
  sourceFileId: string
  path: string
  workspacePath: string
  name: string
  private: boolean
}

export type RepositoryOccurrenceRole =
  | 'dependency'
  | 'override'
  | 'package-manager'
  | 'catalog-owner'
  | 'catalog-consumer'
  | 'global'

export type RepositoryDependencyProtocol =
  | 'semver'
  | 'npm'
  | 'jsr'
  | 'github'
  | 'workspace'
  | 'catalog'
  | 'file'
  | 'link'
  | 'git'
  | 'http'
  | 'unknown'

export interface RepositoryDependencyOccurrence {
  id: string
  ownerId: string
  sourceFileId: string
  name: string
  path: string[]
  field: string
  role: RepositoryOccurrenceRole
  protocol: RepositoryDependencyProtocol
  declaredText: string
  catalogId?: string
  writeable: boolean
}

export interface RepositoryCatalogEntry {
  name: string
  occurrenceId: string
}

export interface RepositoryCatalog {
  id: string
  sourceFileId: string
  manager: 'pnpm' | 'bun' | 'yarn'
  format: RepositorySourceFormat
  name: string
  entries: RepositoryCatalogEntry[]
}

export interface RepositoryWorkspaceRelationship {
  workspaceId: string
  packageId: string
}

export interface RepositoryCatalogConsumerRelationship {
  catalogId: string
  occurrenceId: string
}

export type RepositoryDiagnosticCode =
  | 'ROOT_NOT_FOUND'
  | 'SOURCE_PARSE_FAILED'
  | 'SOURCE_OUTSIDE_ROOT'
  | 'CATALOG_REFERENCE_UNRESOLVED'
  | 'CATALOG_REFERENCE_AMBIGUOUS'
  | 'ID_COLLISION'
  | 'WORKSPACE_DECLARATION_CONFLICT'
  | 'PACKAGE_MANAGER_INVALID'
  | 'PACKAGE_MANAGER_LOCKFILE_MISMATCH'
  | 'LOCKFILE_PARSE_FAILED'
  | 'LOCKFILE_UNSUPPORTED'
  | 'LOCKFILE_OUTSIDE_ROOT'
  | 'LOCKFILE_DUPLICATE_IDENTITY'
  | 'LOCKFILE_UNAVAILABLE'
  | 'RUNTIME_DECLARATION_UNSUPPORTED'
  | 'RUNTIME_DECLARATION_UNAVAILABLE'
  | 'WORKSPACE_DECLARATION_UNAVAILABLE'
  | 'WORKSPACE_DECLARATION_UNSUPPORTED'
  | 'REPOSITORY_DIRECTORY_UNAVAILABLE'
  | 'VCS_EXECUTABLE_MISSING'
  | 'VCS_NOT_REPOSITORY'
  | 'VCS_OUTPUT_LIMIT_EXCEEDED'
  | 'VCS_PROBE_FAILED'
  | 'VCS_PROBE_DISABLED'

export interface RepositoryDiagnostic {
  code: RepositoryDiagnosticCode
  path: string
  detail?: string
}

export interface RepositoryModel {
  schemaVersion: RepositoryModelSchemaVersion
  rootId: string
  root?: RepositoryRootEvidence
  boundaries?: RepositoryBoundary[]
  sourceFiles: RepositorySourceFile[]
  packages: RepositoryPackageManifest[]
  catalogs: RepositoryCatalog[]
  lockfiles?: RepositoryLockfile[]
  runtimeDeclarations?: RepositoryRuntimeDeclaration[]
  vcs?: RepositoryVcsEvidence
  evidence?: RepositoryEvidenceConclusion[]
  occurrences: RepositoryDependencyOccurrence[]
  relationships: {
    workspaceMembers: RepositoryWorkspaceRelationship[]
    catalogConsumers: RepositoryCatalogConsumerRelationship[]
    boundaryPackages?: Array<{ boundaryId: string; packageId: string }>
    lockfileBoundaries?: Array<{ lockfileId: string; boundaryId: string }>
  }
  diagnostics: RepositoryDiagnostic[]
  evidenceRefs: string[]
}
