import * as semver from 'semver'
import {
  applyVersionPrefix,
  getSpecShape,
  getVersionPrefix,
  rebuildXRange,
} from '../utils/versions'

interface ManagerOccurrence {
  role: string
  protocol: string
  declaredValue: string
}

interface ManagerOperation {
  expectedValue: string
  requestedValue: string
}

export function isSupportedManagerOccurrence(
  occurrence: ManagerOccurrence | undefined,
  operation: ManagerOperation,
  targetVersion: string | undefined,
): boolean {
  if (
    occurrence?.role !== 'dependency' ||
    !(occurrence.protocol === 'semver' || occurrence.protocol === 'npm') ||
    occurrence.declaredValue !== operation.expectedValue ||
    !targetVersion ||
    !semver.valid(targetVersion)
  ) {
    return false
  }

  let current = operation.expectedValue
  let prefix = ''
  if (occurrence.protocol === 'npm') {
    const alias = operation.expectedValue.match(/^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/u)
    if (!alias) return false
    prefix = `npm:${alias[1]}@`
    current = alias[2] ?? ''
  }

  const shape = getSpecShape(current)
  const requestedVersion =
    shape === 'x-range'
      ? rebuildXRange(current, targetVersion)
      : shape === 'simple'
        ? applyVersionPrefix(targetVersion, getVersionPrefix(current))
        : undefined
  return (
    requestedVersion !== undefined && operation.requestedValue === `${prefix}${requestedVersion}`
  )
}
