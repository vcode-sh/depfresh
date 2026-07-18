import type { depfreshOptions } from '../../../types'
import { sanitizeTerminalText } from '../../../utils/format'
import type { LegacySelectionEvidence } from '../../apply/legacy-plan'
import type { CheckRunChange, CheckRunTarget } from '../run-model'
import type { VisualPlusChangeMetadata } from './input'

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
): VisualPlusSelectionProjection {
  if (!(Number.isFinite(wallClockMs) && Number.isInteger(wallClockMs) && wallClockMs >= 0)) {
    throw new VisualPlusIntegrationError('wall clock must be a finite nonnegative integer')
  }
  validateEvidenceMembership(evidence)

  const changes: CheckRunChange[] = []
  const metadata: VisualPlusChangeMetadata[] = []
  for (const operation of evidence.operations) {
    const ageMs = releaseAge(operation.publishedAt, wallClockMs)
    changes.push({
      id: sanitizeTerminalText(operation.operationId),
      name: sanitizeTerminalText(operation.name),
      owner: operation.physicalTarget,
      current: sanitizeTerminalText(operation.current),
      target: sanitizeTerminalText(operation.target),
      diff: operation.diff,
      ...(ageMs === null ? {} : { ageMs }),
    })
    const detail =
      operation.nodeCompat === undefined ? undefined : sanitizeTerminalText(operation.nodeCompat)
    metadata.push({
      operationId: sanitizeTerminalText(operation.operationId),
      ownerGroup: {
        id: `package:${operation.packageIndex}`,
        order: operation.packageIndex,
        label: operation.ownerLabel,
        physicalTarget: operation.physicalTarget,
      },
      ageMs,
      compatibility: {
        status:
          operation.nodeCompatible === true
            ? 'compatible'
            : operation.nodeCompatible === false
              ? 'incompatible'
              : 'unknown',
        ...(detail === undefined ? {} : { detail }),
      },
      ...(operation.catalog === undefined
        ? {}
        : {
            catalog: {
              name: operation.catalog.name,
              sourcePath: operation.catalog.sourcePath,
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

function validateEvidenceMembership(evidence: LegacySelectionEvidence): void {
  const operationIds = evidence.operations.map((operation) => operation.operationId)
  if (
    operationIds.some(
      (operationId) =>
        operationId.trim().length === 0 || sanitizeTerminalText(operationId) !== operationId,
    )
  ) {
    throw new VisualPlusIntegrationError('operation ID is unsafe')
  }
  if (new Set(operationIds).size !== operationIds.length) {
    throw new VisualPlusIntegrationError('operation IDs must be unique')
  }
  const selectedIds = new Set(operationIds)
  const assignedIds = new Set<string>()
  const targetPathByOperation = new Map<string, string>()
  const paths = new Set<string>()
  for (const target of evidence.targets) {
    if (paths.has(target.path) || target.operationIds.length === 0) {
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
    if (operation.catalog && operation.catalog.sourcePath !== operation.physicalTarget) {
      throw new VisualPlusIntegrationError('catalog physical target is inconsistent')
    }
  }
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
