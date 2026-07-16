import * as semver from 'semver'
import type { DiffType, ResolvedDepChange, SignaturePresence } from '../../../types'
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
  signaturePresence?: SignaturePresence
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
    const signaturePresence = pkgData.signaturePresence?.[version]

    const result: DetailVersion = { version, diff }
    if (age) result.age = age
    if (distTag) result.distTag = distTag
    if (deprecated) result.deprecated = deprecated
    if (nodeEngines) result.nodeEngines = nodeEngines
    if (signaturePresence) result.signaturePresence = signaturePresence

    if (explain) {
      result.explain = getExplanation(
        diff,
        deprecated,
        signaturePresence === 'absent',
        false,
        Boolean(nodeEngines),
      )
    }

    return result
  })
}

export function getExplanation(
  diff: DiffType,
  deprecated?: string,
  signatureMetadataAbsent?: boolean,
  nodeIncompat?: boolean,
  nodeCompatibilityUnknown?: boolean,
): string {
  const parts: string[] = []

  switch (diff) {
    case 'major':
      parts.push('Breaking change. Check migration guide.')
      break
    case 'minor':
      parts.push('Minor release. Review changes.')
      break
    case 'patch':
      parts.push('Patch release. Review changes.')
      break
  }

  if (deprecated) parts.push('Deprecated.')
  if (signatureMetadataAbsent) parts.push('Signature metadata absent.')
  if (nodeIncompat) parts.push('Node incompatible.')
  if (nodeCompatibilityUnknown) parts.push('Repository Node compatibility unknown.')

  return parts.join(' ')
}

export function applyVersionSelection(dep: ResolvedDepChange, selectedVersion: string): void {
  const prefix = getVersionPrefix(dep.currentVersion)
  dep.targetVersion = applyVersionPrefix(selectedVersion, prefix)
  dep.diff = getDiff(dep.currentVersion, selectedVersion)
}
