export const REPOSITORY_MODEL_SCHEMA_VERSION = 1 as const

export type RepositoryModelSchemaVersion = typeof REPOSITORY_MODEL_SCHEMA_VERSION

export interface InspectRepositoryOptions {
  cwd: string
  recursive?: boolean
  ignorePaths?: string[]
  ignoreOtherWorkspaces?: boolean
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

export interface RepositoryDiagnostic {
  code: RepositoryDiagnosticCode
  path: string
  detail?: string
}

export interface RepositoryModel {
  schemaVersion: RepositoryModelSchemaVersion
  rootId: string
  sourceFiles: RepositorySourceFile[]
  packages: RepositoryPackageManifest[]
  catalogs: RepositoryCatalog[]
  occurrences: RepositoryDependencyOccurrence[]
  relationships: {
    workspaceMembers: RepositoryWorkspaceRelationship[]
    catalogConsumers: RepositoryCatalogConsumerRelationship[]
  }
  diagnostics: RepositoryDiagnostic[]
  evidenceRefs: string[]
}
