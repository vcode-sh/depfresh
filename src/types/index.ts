export type { AddonContext, AddonHookName, depfreshAddon } from '../addons/types'
export type {
  DepFieldType,
  DiffType,
  RangeMode,
  RawDep,
  ResolvedDepChange,
  SortOption,
  UpdateScore,
} from './dependencies'
export type {
  DiscoveryReport,
  depfreshOptions,
  InvocationAuthority,
  ProfileReport,
} from './options'
export { DEFAULT_OPTIONS } from './options'
export type {
  CatalogSource,
  OutputFormat,
  PackageManagerField,
  PackageManagerName,
  PackageMeta,
  PackageType,
} from './package'
export type {
  NpmrcConfig,
  PackageData,
  ProvenanceLevel,
  RegistryConfig,
  SignaturePresence,
} from './registry'
export {
  type InspectRepositoryOptions,
  REPOSITORY_MODEL_SCHEMA_VERSION,
  type RepositoryBoundary,
  type RepositoryBoundaryMarker,
  type RepositoryCatalog,
  type RepositoryCatalogConsumerRelationship,
  type RepositoryCatalogEntry,
  type RepositoryDependencyOccurrence,
  type RepositoryDependencyProtocol,
  type RepositoryDiagnostic,
  type RepositoryDiagnosticCode,
  type RepositoryEvidenceConclusion,
  type RepositoryEvidenceDiagnostic,
  type RepositoryEvidenceKind,
  type RepositoryEvidenceSource,
  type RepositoryEvidenceStatus,
  type RepositoryLockfile,
  type RepositoryLockfileManager,
  type RepositoryLockfileParseState,
  type RepositoryModel,
  type RepositoryModelSchemaVersion,
  type RepositoryOccurrenceRole,
  type RepositoryPackageManifest,
  type RepositoryParseState,
  type RepositoryRootEvidence,
  type RepositoryRuntimeDeclaration,
  type RepositoryRuntimeDeclarationKind,
  type RepositorySourceFile,
  type RepositorySourceFormat,
  type RepositoryVcsBoundaryEvidence,
  type RepositoryVcsEvidence,
  type RepositoryVcsTargetState,
  type RepositoryVcsTargetStateName,
  type RepositoryWorkspaceRelationship,
} from './repository'
export type {
  CanonicalOccurrencePath,
  WriteOutcome,
  WriteOutcomeReason,
  WriteOutcomeStatus,
  WriteOutcomeSummary,
} from './write'
export { summarizeWriteOutcomes } from './write'
