import { readFileSync, writeFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import YAML from 'yaml'
import type { PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import type { createLogger } from '../../utils/logger'
import {
  createPackageWriteRequest,
  createWriteOutcome,
  observeFileOccurrence,
  resolvePhysicalValues,
} from './occurrence'
import { detectLineEnding } from './text'

export function writePackageYaml(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  logger: ReturnType<typeof createLogger>,
): WriteOutcome[] {
  const requests = changes.map((change) => createPackageWriteRequest(pkg, change))
  let content: string
  try {
    content = readFileSync(pkg.filepath, 'utf-8')
  } catch {
    return failedOutcomes(requests, 'READ_FAILED')
  }

  const doc = YAML.parseDocument(content)
  if (doc.errors.length > 0) return failedOutcomes(requests, 'PARSE_FAILED')

  const outcomes: WriteOutcome[] = []
  const pending: Array<{
    request: (typeof requests)[number]
    expectedValue: string
    requestedValue: string
  }> = []

  for (const request of requests) {
    const value = doc.getIn(request.occurrence.path, true)
    const observedValue = getStringValue(value)
    const { expectedValue, requestedValue } = resolvePhysicalValues(request, observedValue)

    if (observedValue === undefined) {
      outcomes.push(
        createWriteOutcome(
          request,
          'conflicted',
          'OCCURRENCE_NOT_FOUND',
          expectedValue,
          requestedValue,
        ),
      )
    } else if (observedValue !== expectedValue) {
      outcomes.push(
        createWriteOutcome(
          request,
          'conflicted',
          'EXPECTED_VALUE_MISMATCH',
          expectedValue,
          requestedValue,
          observedValue,
        ),
      )
    } else if (observedValue === requestedValue) {
      outcomes.push(
        createWriteOutcome(
          request,
          'skipped',
          'NO_CHANGE',
          expectedValue,
          requestedValue,
          observedValue,
        ),
      )
    } else {
      doc.setIn(request.occurrence.path, requestedValue)
      pending.push({ request, expectedValue, requestedValue })
    }
  }

  if (pending.length === 0) return orderOutcomes(requests, outcomes)

  const indent = detectIndent(content).indent || pkg.indent
  const indentWidth = indent === '\t' ? 2 : Math.max(indent.length, 1)
  const lineEnding = detectLineEnding(content)
  const serialized = doc.toString({ indent: indentWidth }).replace(/\r?\n$/, '')
  const withTrailing = content.endsWith('\n') ? `${serialized}\n` : serialized
  const finalContent = lineEnding === '\r\n' ? withTrailing.replace(/\n/g, '\r\n') : withTrailing

  try {
    writeFileSync(pkg.filepath, finalContent, 'utf-8')
  } catch {
    outcomes.push(
      ...pending.map(({ request, expectedValue, requestedValue }) => {
        const observation = observeFileOccurrence(request.occurrence)
        if (!observation.known) {
          return createWriteOutcome(
            request,
            'unknown',
            'OBSERVATION_FAILED',
            expectedValue,
            requestedValue,
          )
        }
        return createWriteOutcome(
          request,
          observation.value === requestedValue ? 'applied' : 'failed',
          observation.value === requestedValue ? 'APPLIED' : 'WRITE_FAILED',
          expectedValue,
          requestedValue,
          observation.value,
        )
      }),
    )
    return orderOutcomes(requests, outcomes)
  }

  for (const { request, expectedValue, requestedValue } of pending) {
    const observation = observeFileOccurrence(request.occurrence)
    const status = !observation.known
      ? createWriteOutcome(request, 'unknown', 'OBSERVATION_FAILED', expectedValue, requestedValue)
      : observation.value === requestedValue
        ? createWriteOutcome(
            request,
            'applied',
            'APPLIED',
            expectedValue,
            requestedValue,
            observation.value,
          )
        : createWriteOutcome(
            request,
            'failed',
            'WRITE_FAILED',
            expectedValue,
            requestedValue,
            observation.value,
          )
    outcomes.push(status)
  }

  const applied = outcomes.filter((outcome) => outcome.status === 'applied').length
  if (applied > 0) logger.success(`Updated ${pkg.filepath} (${applied} changes)`)
  return orderOutcomes(requests, outcomes)
}

function failedOutcomes(
  requests: ReturnType<typeof createPackageWriteRequest>[],
  reason: 'READ_FAILED' | 'PARSE_FAILED',
): WriteOutcome[] {
  return requests.map((request) => {
    const values = resolvePhysicalValues(request, undefined)
    return createWriteOutcome(
      request,
      'failed',
      reason,
      values.expectedValue,
      values.requestedValue,
    )
  })
}

function orderOutcomes(
  requests: ReturnType<typeof createPackageWriteRequest>[],
  outcomes: WriteOutcome[],
): WriteOutcome[] {
  return requests.flatMap((request) => {
    const outcome = outcomes.find(
      (candidate) =>
        candidate.name === request.change.name &&
        candidate.occurrence.path.join('\0') === request.occurrence.path.join('\0'),
    )
    return outcome ? [outcome] : []
  })
}

function getStringValue(value: unknown): string | undefined {
  if (YAML.isScalar(value)) {
    return typeof value.value === 'string' ? value.value : undefined
  }
  return typeof value === 'string' ? value : undefined
}
