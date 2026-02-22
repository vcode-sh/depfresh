import type { DepFieldType, RangeMode, ResolvedDepChange, SortOption } from './dependencies'
import type { OutputFormat, PackageMeta } from './package'

export interface UpgrOptions {
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
  ignoreOtherWorkspaces: boolean

  // Display options
  all: boolean
  group: boolean
  sort: SortOption
  timediff: boolean
  cooldown: number
  nodecompat: boolean
  long: boolean
  explain: boolean

  // Exit behavior
  failOnOutdated: boolean

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

export const DEFAULT_OPTIONS: Partial<UpgrOptions> = {
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
  ignoreOtherWorkspaces: true,
  all: false,
  group: true,
  sort: 'diff-asc',
  timediff: true,
  cooldown: 0,
  nodecompat: true,
  long: false,
  explain: false,
  failOnOutdated: false,
  install: false,
  update: false,
}
