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
export type {
  CanonicalOccurrencePath,
  WriteOutcome,
  WriteOutcomeReason,
  WriteOutcomeStatus,
  WriteOutcomeSummary,
} from './write'
export { summarizeWriteOutcomes } from './write'
