export type RangeMode =
  | 'default'
  | 'major'
  | 'minor'
  | 'patch'
  | 'latest'
  | 'newest'
  | 'next'
  | 'ignore'

export type DiffType = 'major' | 'minor' | 'patch' | 'none' | 'error'

export type SortOption =
  | 'diff-asc'
  | 'diff-desc'
  | 'time-asc'
  | 'time-desc'
  | 'name-asc'
  | 'name-desc'

export type DepFieldType =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies'
  | 'overrides'
  | 'resolutions'
  | 'packageManager'
  | 'pnpm.overrides'
  | 'catalog'

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type OutputFormat = 'table' | 'json' | 'sarif'

export interface PackageManagerField {
  name: PackageManagerName
  version: string
  hash?: string
  raw: string
}

export interface RawDep {
  name: string
  currentVersion: string
  source: DepFieldType
  update: boolean
  parents: string[]
  aliasName?: string
  protocol?: string
}

export type ProvenanceLevel = 'trusted' | 'attested' | 'none'

export interface ResolvedDepChange extends RawDep {
  targetVersion: string
  diff: DiffType
  pkgData: PackageData
  resolvedUrl?: string
  deprecated?: string | boolean
  latestVersion?: string
  publishedAt?: string
  score?: UpdateScore
  provenance?: ProvenanceLevel
  currentProvenance?: ProvenanceLevel
  nodeCompat?: string
  nodeCompatible?: boolean
}

export interface PackageData {
  name: string
  versions: string[]
  distTags: Record<string, string>
  time?: Record<string, string>
  deprecated?: Record<string, string>
  description?: string
  homepage?: string
  repository?: string
  provenance?: Record<string, ProvenanceLevel>
  engines?: Record<string, string>
}

export interface UpdateScore {
  confidence: number
  maturity: number
  adoption: number
  breaking: boolean
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

export interface BumpOptions {
  cwd: string
  recursive: boolean
  mode: RangeMode
  write: boolean
  interactive: boolean
  force: boolean
  includeLocked: boolean
  includeWorkspace: boolean

  include?: string[]
  exclude?: string[]
  depFields?: Partial<Record<DepFieldType, boolean>>

  packageMode?: Record<string, RangeMode>

  concurrency: number
  timeout: number
  retries: number
  cacheTTL: number

  output: OutputFormat
  loglevel: 'silent' | 'info' | 'debug'
  peer: boolean
  global: boolean

  ignorePaths: string[]

  // Display options
  all: boolean
  group: boolean
  sort: SortOption
  timediff: boolean
  cooldown: number
  nodecompat: boolean
  long: boolean

  // Post-write
  install: boolean
  update: boolean
  execute?: string
  verifyCommand?: string

  // Callbacks
  beforePackageStart?: (pkg: PackageMeta) => void | Promise<void>
  onDependencyResolved?: (pkg: PackageMeta, dep: ResolvedDepChange) => void | Promise<void>
  beforePackageWrite?: (pkg: PackageMeta) => boolean | Promise<boolean>
  afterPackageWrite?: (pkg: PackageMeta) => void | Promise<void>
  afterPackagesLoaded?: (pkgs: PackageMeta[]) => void | Promise<void>
  afterPackageEnd?: (pkg: PackageMeta) => void | Promise<void>
  afterPackagesEnd?: (pkgs: PackageMeta[]) => void | Promise<void>
}

export interface RegistryConfig {
  url: string
  token?: string
  authType?: 'bearer' | 'basic'
  scope?: string
}

export interface NpmrcConfig {
  registries: Map<string, RegistryConfig>
  defaultRegistry: string
  proxy?: string
  httpsProxy?: string
  strictSsl: boolean
  cafile?: string
}

export const DEFAULT_OPTIONS: Partial<BumpOptions> = {
  cwd: '.',
  recursive: true,
  mode: 'default',
  write: false,
  interactive: false,
  force: false,
  includeLocked: false,
  includeWorkspace: true,
  concurrency: 16,
  timeout: 10_000,
  retries: 2,
  cacheTTL: 30 * 60 * 1000,
  output: 'table',
  loglevel: 'info',
  peer: false,
  global: false,
  ignorePaths: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**'],
  all: false,
  group: true,
  sort: 'diff-asc',
  timediff: true,
  cooldown: 0,
  nodecompat: true,
  long: false,
  install: false,
  update: false,
}
