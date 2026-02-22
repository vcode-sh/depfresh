import * as semver from 'semver'
import type { DiffType, ProvenanceLevel, ResolvedDepChange } from '../../../types'
import { timeDifference } from '../../../utils/format'
import { applyVersionPrefix, getDiff, getVersionPrefix } from '../../../utils/versions'

const MAX_VERSIONS = 20

export interface DetailVersion {
  version: string
  diff: DiffType
  age?: { text: string; color: 'green' | 'yellow' | 'red' }
  distTag?: string
  deprecated?: string
  nodeEngines?: string
  provenance?: ProvenanceLevel
  explain?: string
}

export function prepareDetailVersions(dep: ResolvedDepChange, explain: boolean): DetailVersion[] {
  const { pkgData, currentVersion } = dep
  const current = semver.coerce(currentVersion)
  if (!current) return []

  const newer = pkgData.versions
    .filter((v) => {
      const parsed = semver.valid(v)
      return parsed && semver.gt(v, current)
    })
    .sort((a, b) => (semver.gt(a, b) ? -1 : 1))
    .slice(0, MAX_VERSIONS)

  // Invert distTags: version -> tag name
  const tagsByVersion = new Map<string, string>()
  for (const [tag, ver] of Object.entries(pkgData.distTags)) {
    tagsByVersion.set(ver, tag)
  }

  return newer.map((version) => {
    const diff = getDiff(currentVersion, version)
    const publishedAt = pkgData.time?.[version]
    const age = timeDifference(publishedAt)
    const distTag = tagsByVersion.get(version)
    const deprecated = pkgData.deprecated?.[version]
    const nodeEngines = pkgData.engines?.[version]
    const provenance = pkgData.provenance?.[version]

    const result: DetailVersion = { version, diff }
    if (age) result.age = age
    if (distTag) result.distTag = distTag
    if (deprecated) result.deprecated = deprecated
    if (nodeEngines) result.nodeEngines = nodeEngines
    if (provenance) result.provenance = provenance

    if (explain) {
      result.explain = getExplanation(diff, deprecated, provenance === 'none', false)
    }

    return result
  })
}

export function getExplanation(
  diff: DiffType,
  deprecated?: string,
  provenanceDowngrade?: boolean,
  nodeIncompat?: boolean,
): string {
  const parts: string[] = []

  switch (diff) {
    case 'major':
      parts.push('Breaking change. Check migration guide.')
      break
    case 'minor':
      parts.push('New features. Backwards compatible.')
      break
    case 'patch':
      parts.push('Bug fixes only. Safe to update.')
      break
  }

  if (deprecated) parts.push('Deprecated.')
  if (provenanceDowngrade) parts.push('Provenance downgrade.')
  if (nodeIncompat) parts.push('Node incompatible.')

  return parts.join(' ')
}

export function applyVersionSelection(dep: ResolvedDepChange, selectedVersion: string): void {
  const prefix = getVersionPrefix(dep.currentVersion)
  dep.targetVersion = applyVersionPrefix(selectedVersion, prefix)
  dep.diff = getDiff(dep.currentVersion, selectedVersion)
}
