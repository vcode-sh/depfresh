export { check } from './commands/check/index'
export { resolveConfig } from './config'
export {
  CacheError,
  ConfigError,
  depfreshError,
  RegistryError,
  ResolveError,
  WriteError,
} from './errors'
export { parseDependencies } from './io/dependencies'
export { loadGlobalPackages, writeGlobalPackage } from './io/global'
export { loadPackages } from './io/packages'
export { resolvePackage } from './io/resolve'
export { writePackage } from './io/write'
export type {
  CatalogSource,
  DepFieldType,
  DiffType,
  depfreshOptions,
  NpmrcConfig,
  OutputFormat,
  PackageData,
  PackageManagerField,
  PackageManagerName,
  PackageMeta,
  PackageType,
  ProvenanceLevel,
  RangeMode,
  RawDep,
  RegistryConfig,
  ResolvedDepChange,
  SortOption,
  UpdateScore,
} from './types'
export { DEFAULT_OPTIONS } from './types'

export function defineConfig(options: Partial<import('./types').depfreshOptions>) {
  return options
}
