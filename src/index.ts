export { addonVSCode, createVSCodeAddon } from './addons'
export { check } from './commands/check/index'
export { resolveConfig } from './config'
export type { depfreshErrorReason } from './errors'
export {
  AddonError,
  CacheError,
  ConfigError,
  DEPFRESH_ERROR_REASONS,
  depfreshError,
  RegistryError,
  ResolveError,
  WriteError,
} from './errors'
export { createInvocationAuthority } from './invocation-authority'
export { parseDependencies } from './io/dependencies'
export { loadGlobalPackages, loadGlobalPackagesAll, writeGlobalPackage } from './io/global'
export { loadPackages } from './io/packages'
export { resolvePackage } from './io/resolve'
export { writePackage } from './io/write'
export { inspectRepository } from './repository/inspect'
export type {
  AddonContext,
  AddonHookName,
  CanonicalOccurrencePath,
  CatalogSource,
  DepFieldType,
  DiffType,
  DiscoveryReport,
  depfreshAddon,
  depfreshOptions,
  InspectRepositoryOptions,
  InvocationAuthority,
  NpmrcConfig,
  OutputFormat,
  PackageData,
  PackageManagerField,
  PackageManagerName,
  PackageMeta,
  PackageType,
  ProfileReport,
  ProvenanceLevel,
  RangeMode,
  RawDep,
  RegistryConfig,
  RepositoryBoundary,
  RepositoryBoundaryMarker,
  RepositoryCatalog,
  RepositoryCatalogConsumerRelationship,
  RepositoryCatalogEntry,
  RepositoryDependencyOccurrence,
  RepositoryDependencyProtocol,
  RepositoryDiagnostic,
  RepositoryDiagnosticCode,
  RepositoryEvidenceConclusion,
  RepositoryEvidenceDiagnostic,
  RepositoryEvidenceKind,
  RepositoryEvidenceSource,
  RepositoryEvidenceStatus,
  RepositoryLockfile,
  RepositoryLockfileManager,
  RepositoryLockfileParseState,
  RepositoryModel,
  RepositoryModelSchemaVersion,
  RepositoryOccurrenceRole,
  RepositoryPackageManifest,
  RepositoryParseState,
  RepositoryRootEvidence,
  RepositoryRuntimeDeclaration,
  RepositoryRuntimeDeclarationKind,
  RepositorySourceFile,
  RepositorySourceFormat,
  RepositoryVcsBoundaryEvidence,
  RepositoryVcsEvidence,
  RepositoryVcsTargetState,
  RepositoryVcsTargetStateName,
  RepositoryWorkspaceRelationship,
  ResolvedDepChange,
  SignaturePresence,
  SortOption,
  UpdateScore,
  WriteOutcome,
  WriteOutcomeReason,
  WriteOutcomeStatus,
  WriteOutcomeSummary,
} from './types'
export {
  DEFAULT_OPTIONS,
  REPOSITORY_MODEL_SCHEMA_VERSION,
  summarizeWriteOutcomes,
} from './types'

export function defineConfig(options: Partial<import('./types').depfreshOptions>) {
  return options
}
