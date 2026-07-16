export { addonVSCode, createVSCodeAddon } from './addons'
export type { ApplyOptions } from './commands/apply'
export { apply } from './commands/apply'
export { check } from './commands/check/index'
export type {
  LegacyCheckJsonError,
  LegacyCheckJsonResult,
} from './commands/check/json-output'
export {
  buildLegacyCheckJsonError,
  buildLegacyCheckJsonResult,
} from './commands/check/json-output'
export type { GlobalApplyOptions, GlobalPlanOptions } from './commands/global-apply'
export {
  applyGlobalPlan,
  assertGlobalApplyPlan,
  assertGlobalApplyResult,
  createGlobalApplyPlan,
  createGlobalInvocationAuthority,
  validateGlobalApplyPlan,
  validateGlobalApplyResult,
} from './commands/global-apply'
export type { InspectOptions } from './commands/inspect'
export { inspect } from './commands/inspect'
export type { PlanOptions } from './commands/plan'
export { plan } from './commands/plan'
export { resolveConfig } from './config'
export { canonicalJson } from './contracts/canonical-json'
export {
  CAPABILITIES_SCHEMA_ID,
  capabilitiesSchema,
  validateCapabilities,
} from './contracts/capabilities-schema'
export {
  createPlanFingerprint,
  createRepositoryFingerprint,
  hashExactBytes,
} from './contracts/fingerprint'
export {
  GLOBAL_APPLY_SCHEMA_ID,
  GLOBAL_PLAN_SCHEMA_ID,
  globalApplySchema,
  globalPlanSchema,
} from './contracts/global-schemas'
export type {
  ApplyResult,
  InspectResult,
  MachineCommandError,
  PlanResult,
} from './contracts/schemas'
export {
  APPLY_SCHEMA_ID,
  applyResultSchema,
  COMMAND_ERROR_SCHEMA_ID,
  commandErrorSchema,
  INSPECT_SCHEMA_ID,
  inspectResultSchema,
  PLAN_SCHEMA_ID,
  planResultSchema,
} from './contracts/schemas'
export {
  assertApplyResult,
  assertInspectResult,
  assertMachineCommandError,
  assertPlanResult,
  ContractValidationError,
  validateApplyResult,
  validateInspectResult,
  validateMachineCommandError,
  validatePlanResult,
} from './contracts/validate'
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
export type { GlobalLoadOptions } from './io/global'
export {
  loadGlobalPackagesAllObserved as loadGlobalPackagesAll,
  loadGlobalPackagesAllObserved,
  loadGlobalPackagesObserved as loadGlobalPackages,
  loadGlobalPackagesObserved,
} from './io/global'
export { loadPackages } from './io/packages'
export { resolvePackage } from './io/resolve'
export { writePackage } from './io/write'
export {
  compilePolicy,
  createPolicyContexts,
  evaluatePolicy,
  evaluateRepositoryPolicy,
  finalizePolicyDecision,
  validatePolicyRules,
} from './policy'
export { inspectRepository } from './repository/inspect'
export {
  type EvaluatePlanSignalsInput,
  type EvaluatePlanSignalsResult,
  evaluatePlanSignals,
  validateSignalConfiguration,
} from './signals'
export type {
  AddonContext,
  AddonHookName,
  CanonicalOccurrencePath,
  CatalogSource,
  CohortInput,
  CompiledPolicy,
  CompiledPolicyRule,
  DepFieldType,
  DiffType,
  DiscoveryReport,
  depfreshAddon,
  depfreshOptions,
  GlobalApplyPlan,
  GlobalApplyResult,
  GlobalApplyStatus,
  GlobalApplySummary,
  GlobalCommandResult,
  GlobalInventoryPackage,
  GlobalInventoryStatus,
  GlobalInvocationAuthority,
  GlobalItemReason,
  GlobalItemResult,
  GlobalItemStatus,
  GlobalManagerEvidence,
  GlobalManagerName,
  GlobalPlanOperation,
  GlobalUpdateRequest,
  InspectRepositoryOptions,
  InvocationAuthority,
  NpmrcConfig,
  OutputFormat,
  PackageData,
  PackageManagerField,
  PackageManagerName,
  PackageMeta,
  PackageType,
  PassivePresence,
  PlanSignal,
  PolicyAction,
  PolicyCandidateReason,
  PolicyCatalogRole,
  PolicyCurrentChannel,
  PolicyDecision,
  PolicyInputLayer,
  PolicyMode,
  PolicyOccurrenceContext,
  PolicyReason,
  PolicyRuleInput,
  PolicyRuleProvenance,
  PolicyRuleSource,
  PolicySelectors,
  PolicySpecifierStatus,
  PolicyStatus,
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
  SignalEvidence,
  SignalFamily,
  SignalPolicyEffect,
  SignalPolicySource,
  SignalReason,
  SignalRuleEffect,
  SignalRuleInput,
  SignalState,
  SignalSummary,
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
  SIGNAL_FAMILIES,
  SIGNAL_POLICY_EFFECTS,
  SIGNAL_REASONS,
  SIGNAL_STATES,
  summarizeWriteOutcomes,
} from './types'

export function defineConfig(options: Partial<import('./types').depfreshOptions>) {
  return options
}
