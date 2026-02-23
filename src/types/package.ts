import type { RawDep, ResolvedDepChange } from './dependencies'

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type OutputFormat = 'table' | 'json'

export interface PackageManagerField {
  name: PackageManagerName
  version: string
  hash?: string
  raw: string
}

export interface CatalogSource {
  type: 'pnpm' | 'bun' | 'yarn'
  name: string
  filepath: string
  deps: RawDep[]
  raw: unknown
  indent: string
}

export type PackageType =
  | 'package.json'
  | 'package.yaml'
  | 'pnpm-workspace'
  | 'bun-workspace'
  | 'yarn-workspace'
  | 'global'

export interface PackageMeta {
  name: string
  type: PackageType
  filepath: string
  deps: RawDep[]
  resolved: ResolvedDepChange[]
  raw: unknown
  indent: string
  catalogs?: CatalogSource[]
  packageManager?: PackageManagerField
}
