import { readFileSync, writeFileSync } from 'node:fs'
import detectIndent from 'detect-indent'
import type { PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import type { createLogger } from '../../utils/logger'
import {
  createPackageWriteRequest,
  createWriteOutcome,
  getStringAtPath,
  observeFileOccurrence,
  resolvePhysicalValues,
  setStringAtPath,
} from './occurrence'
import { detectLineEnding } from './text'

export function writePackageJson(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  logger: ReturnType<typeof createLogger>,
): WriteOutcome[] {
  const requests = changes.map((change) => createPackageWriteRequest(pkg, change))
  let content: string

  try {
    content = readFileSync(pkg.filepath, 'utf-8')
  } catch {
    return requests.map((request) => {
      const values = resolvePhysicalValues(request, undefined)
      return createWriteOutcome(
        request,
        'failed',
        'READ_FAILED',
        values.expectedValue,
        values.requestedValue,
      )
    })
  }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(content) as Record<string, unknown>
  } catch {
    return requests.map((request) => {
      const values = resolvePhysicalValues(request, undefined)
      return createWriteOutcome(
        request,
        'failed',
        'PARSE_FAILED',
        values.expectedValue,
        values.requestedValue,
      )
    })
  }

  const outcomes: WriteOutcome[] = []
  const pending: Array<{
    request: (typeof requests)[number]
    expectedValue: string
    requestedValue: string
  }> = []

  for (const request of requests) {
    const observedValue = getStringAtPath(raw, request.occurrence.path)
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
      continue
    }
    if (observedValue !== expectedValue) {
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
      continue
    }
    if (observedValue === requestedValue) {
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
      continue
    }
    if (!setStringAtPath(raw, request.occurrence.path, requestedValue)) {
      outcomes.push(
        createWriteOutcome(
          request,
          'failed',
          'OCCURRENCE_NOT_FOUND',
          expectedValue,
          requestedValue,
          observedValue,
        ),
      )
      continue
    }
    pending.push({ request, expectedValue, requestedValue })
  }

  if (pending.length === 0) return outcomes

  const indent = detectIndent(content).indent || pkg.indent
  const lineEnding = detectLineEnding(content)
  const serialized = JSON.stringify(raw, null, indent)
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
    if (!observation.known) {
      outcomes.push(
        createWriteOutcome(request, 'unknown', 'OBSERVATION_FAILED', expectedValue, requestedValue),
      )
    } else if (observation.value === requestedValue) {
      outcomes.push(
        createWriteOutcome(
          request,
          'applied',
          'APPLIED',
          expectedValue,
          requestedValue,
          observation.value,
        ),
      )
      logger.debug(`  ${request.change.name}: ${expectedValue} -> ${requestedValue}`)
    } else {
      outcomes.push(
        createWriteOutcome(
          request,
          'failed',
          'WRITE_FAILED',
          expectedValue,
          requestedValue,
          observation.value,
        ),
      )
    }
  }

  const applied = outcomes.filter((outcome) => outcome.status === 'applied').length
  if (applied > 0) logger.success(`Updated ${pkg.filepath} (${applied} changes)`)
  return orderOutcomes(requests, outcomes)
}

function orderOutcomes(
  requests: ReturnType<typeof createPackageWriteRequest>[],
  outcomes: WriteOutcome[],
): WriteOutcome[] {
  return requests.flatMap((request) => {
    const outcome = outcomes.find(
      (candidate) =>
        candidate.name === request.change.name &&
        candidate.occurrence.file === request.occurrence.file &&
        candidate.occurrence.path.join('\0') === request.occurrence.path.join('\0'),
    )
    return outcome ? [outcome] : []
  })
}
