import * as semver from 'semver'
import type { depfreshOptions, PackageData, RangeMode, RawDep } from '../../types'
import { getMaxVersion, getSpecShape, isLocked, normalizeVersion } from '../../utils/versions'

export type VersionSelectionReason =
  | 'SELECTED'
  | 'CURRENT_VERSION_SELECTED'
  | 'CURRENT_VERSION_INVALID'
  | 'NO_VALID_VERSIONS'
  | 'PRERELEASE_CHANNEL_BLOCKED'
  | 'DIST_TAG_MISSING'
  | 'DIST_TAG_NOT_ELIGIBLE'
  | 'MODE_NO_MATCH'
  | 'DEPRECATED_CANDIDATE_BLOCKED'
  | 'MISSING_PUBLISH_TIME'
  | 'MATURITY_CANDIDATE_BLOCKED'
  | 'DOWNGRADE_BLOCKED'

export interface VersionCandidateInput {
  currentVersion: string
  pkgData: PackageData
  mode: RangeMode
  includeLocked: boolean
  cooldown: number
  now?: number
}

export interface VersionCandidateSelection {
  targetVersion: string | null
  eligibleVersions: string[]
  reason: VersionSelectionReason
}

interface CandidateStage {
  versions: string[]
  reason?: VersionSelectionReason
  blockingReason?: VersionSelectionReason
}

export function selectVersionCandidate(input: VersionCandidateInput): VersionCandidateSelection {
  const current = normalizeVersion(input.currentVersion)
  if (!current) {
    return selection(null, [], 'CURRENT_VERSION_INVALID')
  }

  const normalized = normalizeCandidates(input.pkgData.versions)
  if (normalized.length === 0) {
    return selection(null, [], 'NO_VALID_VERSIONS')
  }

  const channelCandidates = filterByChannel(normalized, current)
  if (channelCandidates.length === 0) {
    return selection(null, [], 'PRERELEASE_CHANNEL_BLOCKED')
  }
  let blockingReason: VersionSelectionReason | undefined = hasRemovedUpgrade(
    normalized,
    channelCandidates,
    current,
  )
    ? 'PRERELEASE_CHANNEL_BLOCKED'
    : undefined

  const modeStage = filterByMode(input, channelCandidates, current)
  if (modeStage.versions.length === 0) {
    if (wasDistTagBlockedByChannel(input, normalized, channelCandidates)) {
      return selection(null, [], 'PRERELEASE_CHANNEL_BLOCKED')
    }
    return selection(null, [], modeStage.reason ?? 'MODE_NO_MATCH')
  }

  const currentDeprecated = Boolean(input.pkgData.deprecated?.[current])
  const deprecationCandidates = currentDeprecated
    ? modeStage.versions
    : modeStage.versions.filter((version) => !input.pkgData.deprecated?.[version])
  if (deprecationCandidates.length === 0) {
    return selection(null, [], 'DEPRECATED_CANDIDATE_BLOCKED')
  }
  if (hasRemovedUpgrade(modeStage.versions, deprecationCandidates, current)) {
    blockingReason = 'DEPRECATED_CANDIDATE_BLOCKED'
  }

  const maturityStage = filterByMaturity(
    deprecationCandidates,
    input.pkgData.time,
    input.cooldown,
    input.now ?? Date.now(),
    current,
  )
  if (maturityStage.versions.length === 0) {
    return selection(null, [], maturityStage.reason ?? 'MATURITY_CANDIDATE_BLOCKED')
  }
  blockingReason = maturityStage.blockingReason ?? blockingReason

  const eligibleVersions = maturityStage.versions.filter((version) => semver.gte(version, current))
  if (eligibleVersions.length === 0) {
    return selection(null, [], 'DOWNGRADE_BLOCKED')
  }

  const targetVersion = getMaxVersion(eligibleVersions)
  if (!targetVersion || semver.eq(targetVersion, current)) {
    return selection(null, eligibleVersions, blockingReason ?? 'CURRENT_VERSION_SELECTED')
  }

  return selection(targetVersion, eligibleVersions, 'SELECTED')
}

export function filterVersions(
  pkgData: PackageData,
  dep: RawDep,
  options?: depfreshOptions,
): string[] {
  const current = normalizeVersion(dep.currentVersion)
  if (!current) return []

  const channelCandidates = filterByChannel(normalizeCandidates(pkgData.versions), current)
  const currentDeprecated = Boolean(pkgData.deprecated?.[current])
  const deprecationCandidates = currentDeprecated
    ? channelCandidates
    : channelCandidates.filter((version) => !pkgData.deprecated?.[version])

  if (!options?.cooldown || options.cooldown <= 0) {
    return deprecationCandidates
  }

  return filterVersionsByMaturityPeriod(deprecationCandidates, pkgData.time, options.cooldown)
}

export function filterVersionsByMaturityPeriod(
  versions: string[],
  time: Record<string, string> | undefined,
  days: number,
  now = Date.now(),
): string[] {
  if (days <= 0) return versions
  if (!time) return []

  const cutoff = now - days * 86_400_000
  return versions.filter((version) => {
    const publishedAt = getPublishedAt(time, version)
    return publishedAt !== null && publishedAt <= cutoff
  })
}

function normalizeCandidates(versions: string[]): string[] {
  const normalized = new Set<string>()
  for (const version of versions) {
    const valid = semver.valid(version)
    if (valid) normalized.add(valid)
  }
  return [...normalized].sort(semver.compare)
}

function filterByChannel(versions: string[], current: string): string[] {
  const currentPrerelease = semver.prerelease(current)
  const currentChannel = currentPrerelease?.[0]

  return versions.filter((version) => {
    const candidatePrerelease = semver.prerelease(version)
    if (!candidatePrerelease?.length) return true
    if (!currentPrerelease?.length) return false

    return candidatePrerelease[0] === currentChannel
  })
}

function filterByMode(
  input: VersionCandidateInput,
  versions: string[],
  current: string,
): CandidateStage {
  switch (input.mode) {
    case 'latest':
      return filterByDistTag(input.pkgData.distTags.latest, versions)
    case 'next': {
      const nextTag = input.pkgData.distTags.next
      if (typeof nextTag === 'string' && semver.valid(nextTag)) {
        return filterByDistTag(nextTag, versions)
      }
      return filterByDistTag(input.pkgData.distTags.latest, versions)
    }
    case 'newest':
    case 'major':
      return { versions }
    case 'minor': {
      const parsedCurrent = semver.parse(current)
      return {
        versions: parsedCurrent
          ? versions.filter((version) => semver.major(version) === parsedCurrent.major)
          : [],
        reason: 'MODE_NO_MATCH',
      }
    }
    case 'patch': {
      const parsedCurrent = semver.parse(current)
      return {
        versions: parsedCurrent
          ? versions.filter(
              (version) =>
                semver.major(version) === parsedCurrent.major &&
                semver.minor(version) === parsedCurrent.minor,
            )
          : [],
        reason: 'MODE_NO_MATCH',
      }
    }
    case 'ignore':
      return { versions: [], reason: 'MODE_NO_MATCH' }
    default:
      return filterDefaultMode(input, versions, current)
  }
}

function filterDefaultMode(
  input: VersionCandidateInput,
  versions: string[],
  current: string,
): CandidateStage {
  if (isLocked(input.currentVersion)) {
    return {
      versions: input.includeLocked
        ? versions
        : versions.filter((version) => semver.eq(version, current)),
      reason: 'MODE_NO_MATCH',
    }
  }

  const rangeCandidates = versions.filter((version) =>
    semver.satisfies(version, input.currentVersion),
  )
  if (rangeCandidates.length > 0) {
    return { versions: rangeCandidates }
  }

  if (getSpecShape(input.currentVersion) !== 'complex') {
    return filterByDistTag(input.pkgData.distTags.latest, versions)
  }

  return { versions: [], reason: 'MODE_NO_MATCH' }
}

function filterByDistTag(tag: string | undefined, versions: string[]): CandidateStage {
  const normalizedTag = typeof tag === 'string' ? semver.valid(tag) : null
  if (!normalizedTag) {
    return { versions: [], reason: 'DIST_TAG_MISSING' }
  }
  if (!versions.includes(normalizedTag)) {
    return { versions: [], reason: 'DIST_TAG_NOT_ELIGIBLE' }
  }
  return { versions: [normalizedTag] }
}

function wasDistTagBlockedByChannel(
  input: VersionCandidateInput,
  normalized: string[],
  channelCandidates: string[],
): boolean {
  let tag: string | undefined
  if (input.mode === 'latest') {
    tag = input.pkgData.distTags.latest
  } else if (input.mode === 'next') {
    const nextTag = input.pkgData.distTags.next
    tag =
      typeof nextTag === 'string' && semver.valid(nextTag) ? nextTag : input.pkgData.distTags.latest
  }

  const normalizedTag = typeof tag === 'string' ? semver.valid(tag) : null
  return Boolean(
    normalizedTag &&
      normalized.includes(normalizedTag) &&
      !channelCandidates.includes(normalizedTag),
  )
}

function filterByMaturity(
  versions: string[],
  time: Record<string, string> | undefined,
  days: number,
  now: number,
  current: string,
): CandidateStage {
  if (days <= 0) return { versions }

  let missingPublishTime = false
  let missingUpgradeTime = false
  let recentUpgrade = false
  const cutoff = now - days * 86_400_000
  const matureVersions = versions.filter((version) => {
    const publishedAt = getPublishedAt(time, version)
    if (publishedAt === null) {
      missingPublishTime = true
      if (semver.gt(version, current)) missingUpgradeTime = true
      return false
    }
    const mature = publishedAt <= cutoff
    if (!mature && semver.gt(version, current)) recentUpgrade = true
    return mature
  })

  return {
    versions: matureVersions,
    reason: missingPublishTime ? 'MISSING_PUBLISH_TIME' : 'MATURITY_CANDIDATE_BLOCKED',
    blockingReason: missingUpgradeTime
      ? 'MISSING_PUBLISH_TIME'
      : recentUpgrade
        ? 'MATURITY_CANDIDATE_BLOCKED'
        : undefined,
  }
}

function hasRemovedUpgrade(before: string[], after: string[], current: string): boolean {
  const retained = new Set(after)
  return before.some((version) => semver.gt(version, current) && !retained.has(version))
}

function getPublishedAt(time: Record<string, string> | undefined, version: string): number | null {
  const value = time?.[version]
  if (typeof value !== 'string' || !isRfc3339Timestamp(value)) return null
  const publishedAt = Date.parse(value)
  return Number.isFinite(publishedAt) ? publishedAt : null
}

function isRfc3339Timestamp(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  if (!match) return false

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth
}

function selection(
  targetVersion: string | null,
  eligibleVersions: string[],
  reason: VersionSelectionReason,
): VersionCandidateSelection {
  return { targetVersion, eligibleVersions, reason }
}
