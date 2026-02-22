export type {
  BumpOptions,
  CatalogSource,
  DepFieldType,
  DiffType,
  NpmrcConfig,
  OutputFormat,
  PackageData,
  PackageManagerField,
  PackageManagerName,
  PackageMeta,
  PackageType,
  RangeMode,
  RawDep,
  RegistryConfig,
  ResolvedDepChange,
  UpdateScore,
} from './types'

export { DEFAULT_OPTIONS } from './types'
export { resolveConfig } from './config'
export { check } from './commands/check/index'
