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
export type {
  AddonContext,
  AddonHookName,
  CatalogSource,
  DepFieldType,
  DiffType,
  DiscoveryReport,
  depfreshAddon,
  depfreshOptions,
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
  ResolvedDepChange,
  SignaturePresence,
  SortOption,
  UpdateScore,
} from './types'
export { DEFAULT_OPTIONS } from './types'

export function defineConfig(options: Partial<import('./types').depfreshOptions>) {
  return options
}
