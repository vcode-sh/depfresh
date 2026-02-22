import type { PackageData, ProvenanceLevel } from './registry'

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

export interface RawDep {
  name: string
  currentVersion: string
  source: DepFieldType
  update: boolean
  parents: string[]
  aliasName?: string
  protocol?: string
}

export interface UpdateScore {
  confidence: number
  maturity: number
  adoption: number
  breaking: boolean
}

export interface ResolvedDepChange extends RawDep {
  targetVersion: string
  diff: DiffType
  pkgData: PackageData
  resolvedUrl?: string
  deprecated?: string | boolean
  latestVersion?: string
  publishedAt?: string
  currentVersionTime?: string
  score?: UpdateScore
  provenance?: ProvenanceLevel
  currentProvenance?: ProvenanceLevel
  nodeCompat?: string
  nodeCompatible?: boolean
}
