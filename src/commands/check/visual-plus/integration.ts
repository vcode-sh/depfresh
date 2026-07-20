import { isAbsolute, win32 } from 'node:path'
import type { depfreshOptions } from '../../../types'
import { sanitizeTerminalText } from '../../../utils/format'
import { compareDependencySortFacts } from '../../../utils/sort'
import type { LegacySelectionEvidence } from '../../apply/legacy-plan'
import {
  normalizeRelationshipCompatibilityDetail,
  RelationshipEvidenceError,
  reconcileRelationshipEvidence,
} from '../relationship-evidence'
import type { CheckRunChange, CheckRunInsightEvidence, CheckRunTarget } from '../run-model'
import type { VisualPlusChangeMetadata, VisualPlusDisplayOptions } from './input'

export interface VisualPlusSelectionProjection {
  readonly changes: readonly CheckRunChange[]
  readonly targets: readonly CheckRunTarget[]
  readonly metadata: readonly VisualPlusChangeMetadata[]
}

export class VisualPlusIntegrationError extends Error {
  constructor(message: string) {
    super(`Visual+ integration: ${message}`)
  }
}

export function isVisualPlusEligible(options: depfreshOptions, renderProgress: boolean): boolean {
  return (
    renderProgress &&
    options.output === 'table' &&
    options.loglevel !== 'silent' &&
    !options.interactive &&
    !options.global &&
    !options.globalAll &&
    !options.beforePackageWrite &&
    !options.addons?.some((addon) => addon.beforePackageWrite !== undefined)
  )
}

export function createVisualPlusSelectionProjection(
  evidence: LegacySelectionEvidence,
  wallClockMs: number,
  display: VisualPlusDisplayOptions,
): VisualPlusSelectionProjection {
  if (!(Number.isFinite(wallClockMs) && Number.isInteger(wallClockMs) && wallClockMs >= 0)) {
    throw new VisualPlusIntegrationError('wall clock must be a finite nonnegative integer')
  }
  const ordered = [...evidence.operations].sort(
    (left, right) =>
      compareDependencySortFacts(left, right, display.sort) ||
      left.packageIndex - right.packageIndex ||
      left.changeIndex - right.changeIndex ||
      compareText(left.operationId, right.operationId),
  )
  const displayOrderById = new Map(
    ordered.map((operation, displayOrder) => [operation.operationId, displayOrder]),
  )
  const candidates = evidence.operations.map((operation) => {
    const ageMs = releaseAge(operation.publishedAt, wallClockMs)
    const detail = normalizeRelationshipCompatibilityDetail(operation.nodeCompat)
    return {
      operationId: operation.operationId,
      displayName: sanitizeTerminalText(operation.name),
      rawDisplayName: operation.name,
      physicalTarget: operation.physicalTarget,
      ...(ageMs === null ? {} : { displayedAgeMs: ageMs }),
      dependencyId: operation.dependencyId,
      rawName: operation.rawName,
      sourceFileId: operation.sourceFileId,
      sourcePath: operation.sourcePath,
      occurrencePath: operation.occurrencePath,
      owner: operation.owner,
      catalog: operation.catalog,
      ageMs,
      compatibility: {
        status:
          operation.nodeCompatible === true
            ? ('compatible' as const)
            : operation.nodeCompatible === false
              ? ('incompatible' as const)
              : ('unknown' as const),
        ...(detail === undefined ? {} : { detail }),
      },
    }
  })
  let insights: readonly CheckRunInsightEvidence[]
  try {
    insights = reconcileRelationshipEvidence(candidates, { suppliedOwnerOrder: false })
  } catch (error) {
    if (error instanceof RelationshipEvidenceError) {
      throw new VisualPlusIntegrationError(error.message)
    }
    throw error
  }
  validateEvidenceMembership(evidence)

  const changes: CheckRunChange[] = []
  const metadata: VisualPlusChangeMetadata[] = []
  for (let index = 0; index < evidence.operations.length; index += 1) {
    const operation = evidence.operations[index]!
    const insight = insights[index]!
    const owner = insight.owner
    changes.push({
      id: sanitizeTerminalText(operation.operationId),
      name: sanitizeTerminalText(operation.name),
      owner: operation.physicalTarget,
      current: sanitizeTerminalText(operation.current),
      target: sanitizeTerminalText(operation.target),
      diff: operation.diff,
      ...(insight.ageMs === null ? {} : { ageMs: insight.ageMs }),
      insight,
    })
    metadata.push({
      operationId: sanitizeTerminalText(operation.operationId),
      source: operation.source,
      displayOrder: displayOrderById.get(operation.operationId)!,
      ownerGroup: {
        id: owner.id,
        order: owner.order,
        label: owner.label,
        physicalTarget: owner.physicalTarget,
      },
      ageMs: insight.ageMs,
      compatibility: { ...insight.compatibility },
      ...(insight.catalog.role === 'direct'
        ? {}
        : {
            catalog: {
              name: insight.catalog.name,
              sourcePath: insight.catalog.sourcePath,
            },
          }),
    })
  }

  return deepFreezeProjection({
    changes,
    targets: evidence.targets.map((target) => ({
      path: target.path,
      operationIds: [...target.operationIds],
    })),
    metadata,
  })
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right)
}

function validateEvidenceMembership(evidence: LegacySelectionEvidence): void {
  const operationIds = evidence.operations.map((operation) => operation.operationId)
  const selectedIds = new Set(operationIds)
  const assignedIds = new Set<string>()
  const targetPathByOperation = new Map<string, string>()
  const paths = new Set<string>()
  for (const target of evidence.targets) {
    if (
      !safeRepositoryPath(target.path) ||
      paths.has(target.path) ||
      target.operationIds.length === 0
    ) {
      throw new VisualPlusIntegrationError('target inventory is inconsistent')
    }
    paths.add(target.path)
    for (const operationId of target.operationIds) {
      if (!selectedIds.has(operationId) || assignedIds.has(operationId)) {
        throw new VisualPlusIntegrationError('target membership is inconsistent')
      }
      assignedIds.add(operationId)
      targetPathByOperation.set(operationId, target.path)
    }
  }
  if (assignedIds.size !== selectedIds.size) {
    throw new VisualPlusIntegrationError('target membership is incomplete')
  }
  for (const operation of evidence.operations) {
    if (targetPathByOperation.get(operation.operationId) !== operation.physicalTarget) {
      throw new VisualPlusIntegrationError('operation physical target is inconsistent')
    }
  }
}

function safeRepositoryPath(value: string): boolean {
  if (
    value.length === 0 ||
    sanitizeTerminalText(value) !== value ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\\')
  ) {
    return false
  }
  return !value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
}

function releaseAge(publishedAt: string | undefined, wallClockMs: number): number | null {
  if (publishedAt === undefined) return null
  const publishedMs = parseStrictIsoTimestamp(publishedAt)
  if (publishedMs === undefined || publishedMs > wallClockMs) return null
  return wallClockMs - publishedMs
}

const STRICT_ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u

function parseStrictIsoTimestamp(value: string): number | undefined {
  const match = STRICT_ISO_TIMESTAMP.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function deepFreezeProjection<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreezeProjection(nested)
  return Object.freeze(value)
}
