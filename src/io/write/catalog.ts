import type { CatalogSource, PackageMeta, ResolvedDepChange, WriteOutcome } from '../../types'
import type { createLogger } from '../../utils/logger'
import { bunCatalogLoader } from '../catalogs/bun'
import { pnpmCatalogLoader } from '../catalogs/pnpm'
import { yarnCatalogLoader } from '../catalogs/yarn'
import {
  createCatalogWriteRequest,
  createWriteOutcome,
  observeFileOccurrence,
  resolvePhysicalValues,
} from './occurrence'

const catalogWriters = {
  pnpm: pnpmCatalogLoader,
  bun: bunCatalogLoader,
  yarn: yarnCatalogLoader,
}

export function writeCatalogPackage(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  logger: ReturnType<typeof createLogger>,
): WriteOutcome[] {
  const outcomes: WriteOutcome[] = []

  for (const change of changes) {
    const matches = findCatalogMatches(pkg.catalogs ?? [], change)
    if (matches.length !== 1) {
      outcomes.push(createUnmatchedOutcome(pkg, change, matches.length > 1))
      continue
    }

    const catalog = matches[0]
    if (!catalog) continue
    const request = createCatalogWriteRequest(catalog, change)
    const before = observeFileOccurrence(request.occurrence)
    const { expectedValue, requestedValue } = resolvePhysicalValues(request, before.value)

    if (!before.known) {
      outcomes.push(
        createWriteOutcome(request, 'failed', 'READ_FAILED', expectedValue, requestedValue),
      )
      continue
    }
    if (before.value === undefined) {
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
    if (before.value !== expectedValue) {
      outcomes.push(
        createWriteOutcome(
          request,
          'conflicted',
          'EXPECTED_VALUE_MISMATCH',
          expectedValue,
          requestedValue,
          before.value,
        ),
      )
      continue
    }
    if (before.value === requestedValue) {
      outcomes.push(
        createWriteOutcome(
          request,
          'skipped',
          'NO_CHANGE',
          expectedValue,
          requestedValue,
          before.value,
        ),
      )
      continue
    }

    try {
      catalogWriters[catalog.type].write(catalog, new Map([[change.name, requestedValue]]))
    } catch {
      const afterFailure = observeFileOccurrence(request.occurrence)
      outcomes.push(
        !afterFailure.known
          ? createWriteOutcome(
              request,
              'unknown',
              'OBSERVATION_FAILED',
              expectedValue,
              requestedValue,
            )
          : createWriteOutcome(
              request,
              afterFailure.value === requestedValue ? 'applied' : 'failed',
              afterFailure.value === requestedValue ? 'APPLIED' : 'WRITE_FAILED',
              expectedValue,
              requestedValue,
              afterFailure.value,
            ),
      )
      continue
    }

    const after = observeFileOccurrence(request.occurrence)
    if (!after.known) {
      outcomes.push(
        createWriteOutcome(request, 'unknown', 'OBSERVATION_FAILED', expectedValue, requestedValue),
      )
    } else if (after.value === requestedValue) {
      outcomes.push(
        createWriteOutcome(
          request,
          'applied',
          'APPLIED',
          expectedValue,
          requestedValue,
          after.value,
        ),
      )
      logger.success(`Updated ${catalog.type} catalog "${catalog.name}" (1 change)`)
    } else {
      outcomes.push(
        createWriteOutcome(
          request,
          'failed',
          'WRITE_FAILED',
          expectedValue,
          requestedValue,
          after.value,
        ),
      )
    }
  }

  return outcomes
}

function findCatalogMatches(catalogs: CatalogSource[], change: ResolvedDepChange): CatalogSource[] {
  const nameMatches = catalogs.filter((catalog) =>
    catalog.deps.some((dependency) => dependency.name === change.name),
  )
  if (change.parents.length === 0) return nameMatches.length === 1 ? nameMatches : []

  return nameMatches.filter((catalog) =>
    catalog.deps.some(
      (dependency) =>
        dependency.name === change.name && samePath(dependency.parents, change.parents),
    ),
  )
}

function createUnmatchedOutcome(
  pkg: PackageMeta,
  change: ResolvedDepChange,
  ambiguous: boolean,
): WriteOutcome {
  const request = {
    change,
    occurrence: {
      file: pkg.filepath,
      path: [...change.parents, change.name],
    },
    exactExpectedValue: change.rawVersion,
  }
  const values = resolvePhysicalValues(request, undefined)
  return createWriteOutcome(
    request,
    'failed',
    ambiguous ? 'AMBIGUOUS_OCCURRENCE' : 'OCCURRENCE_NOT_FOUND',
    values.expectedValue,
    values.requestedValue,
  )
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}
