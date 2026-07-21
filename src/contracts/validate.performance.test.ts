import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json'
import { createPlanFingerprint, createRepositoryFingerprint, hashExactBytes } from './fingerprint'
import type { PlanResultV1 } from './schemas'
import { validatePlanResult } from './validate'

type PlanOccurrence = PlanResultV1['occurrences'][number]
type PlanDecision = PlanResultV1['decisions'][number]

function createIndexedPlan(size: number, cohortCount = 1): PlanResultV1 {
  const sourceByteHash = 'b'.repeat(64)
  const occurrences: PlanOccurrence[] = []
  const decisions: PlanDecision[] = []
  const operations: PlanResultV1['operations'] = []

  for (let index = 0; index < size; index += 1) {
    const suffix = String(index).padStart(6, '0')
    const occurrence: PlanOccurrence = {
      id: `occurrence-${suffix}`,
      ownerId: 'package-root',
      sourceFileId: 'source-root',
      file: 'package.json',
      name: `dependency-${suffix}`,
      path: ['dependencies', `dependency-${suffix}`],
      field: 'dependencies',
      role: 'dependency',
      protocol: 'semver',
      declaredValue: '1.0.0',
      writeable: true,
    }
    const operationBase = {
      occurrenceId: occurrence.id,
      sourceFileId: occurrence.sourceFileId,
      file: occurrence.file,
      path: occurrence.path,
      name: occurrence.name,
      sourceByteHash,
      expectedValue: occurrence.declaredValue,
      requestedValue: '2.0.0',
    }
    const operation = {
      id: `operation-${hashExactBytes(canonicalJson(operationBase)).slice(0, 24)}`,
      ...operationBase,
    }
    occurrences.push(occurrence)
    operations.push(operation)
    decisions.push({
      occurrenceId: occurrence.id,
      status: 'operation',
      reason: 'SELECTED',
      operationId: operation.id,
      candidate: {
        reason: 'SELECTED',
        eligibleVersions: ['2.0.0'],
        targetVersion: '2.0.0',
      },
      policy: {
        status: 'selected',
        reason: 'POLICY_DEFAULT_INCLUDED',
        action: 'include',
        mode: 'default',
        matchedRuleIds: ['$defaults:mode'],
        indeterminateRuleIds: [],
      },
    })
  }

  const signalEvidence: NonNullable<PlanResultV1['signalEvidence']> = []
  const signals: NonNullable<PlanResultV1['signals']> = []
  for (let cohortIndex = 0; cohortIndex < cohortCount; cohortIndex += 1) {
    const cohortId = `cohort-${String(cohortIndex).padStart(6, '0')}`
    const facts: Record<string, string> = {
      strategy: 'update-together',
      source: 'library',
    }
    for (const [index, occurrence] of occurrences.entries()) {
      facts[`configuredMember.${String(index).padStart(6, '0')}`] = occurrence.name
      facts[`proposedVersion.${occurrence.id}`] = '2.0.0'
      facts[`candidateOperation.${occurrence.id}`] = 'yes'
    }
    const evidenceBase = {
      kind: 'explicit-cohort' as const,
      status: 'observed' as const,
      subject: cohortId,
      sourceRefs: occurrences.map((occurrence) => occurrence.id),
      facts,
    }
    const evidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(evidenceBase)).slice(0, 24)}`,
      ...evidenceBase,
    }
    const signalBase = {
      family: 'cohort' as const,
      state: 'pass' as const,
      reason: 'COHORT_ALIGNED' as const,
      subject: {
        occurrenceIds: occurrences.map((occurrence) => occurrence.id),
        cohortId,
      },
      evidenceRefs: [evidence.id],
      effect: 'none' as const,
      matchedRuleIds: [],
    }
    signalEvidence.push(evidence)
    signals.push({
      id: `signal-${hashExactBytes(canonicalJson(signalBase)).slice(0, 24)}`,
      ...signalBase,
    })
  }
  signalEvidence.sort((left, right) => left.id.localeCompare(right.id))
  signals.sort((left, right) => left.id.localeCompare(right.id))

  const repositorySources = [{ path: 'package.json', byteHash: sourceByteHash }]
  const semantic = {
    contract: 'depfresh.plan' as const,
    schemaVersion: 1 as const,
    toolVersion: '2.1.1',
    repository: {
      identity: 'repository:validation-scale',
      fingerprint: createRepositoryFingerprint({
        schemaVersion: 1,
        rootIdentity: 'repository:validation-scale',
        sources: repositorySources,
      }),
      modelSchemaVersion: 1 as const,
      sources: repositorySources,
      boundaries: [],
      sourceFiles: [
        {
          id: 'source-root',
          path: 'package.json',
          format: 'json' as const,
          byteHash: sourceByteHash,
          parseState: 'parsed' as const,
          indent: '  ',
          newline: 'lf' as const,
          trailingNewline: true,
        },
      ],
      packages: [
        {
          id: 'package-root',
          sourceFileId: 'source-root',
          path: 'package.json',
          workspacePath: '.',
          name: 'validation-scale',
          private: true,
        },
      ],
      catalogs: [],
      runtimeDeclarations: [],
      relationships: {
        workspaceMembers: [],
        catalogConsumers: [],
        boundaryPackages: [],
        lockfileBoundaries: [],
      },
    },
    asOf: '2026-07-20T00:00:00.000Z',
    occurrences,
    decisions,
    operations,
    execution: {
      mode: 'file-only' as const,
      status: 'ready' as const,
      timeoutMs: 120_000,
      targets: [],
    },
    evidence: [],
    lockfiles: [],
    vcs: {
      status: 'unavailable' as const,
      targetFiles: [],
      unrelatedDirtyPaths: [],
      diagnostics: [],
    },
    diagnostics: [],
    risks: [],
    errors: [],
    requiredCapabilities: [
      'filesystem-read' as const,
      'registry-read' as const,
      'file-write' as const,
    ],
    signals,
    signalEvidence,
    summary: {
      total: size,
      operations: size,
      unchanged: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      errors: 0,
      signals: {
        total: cohortCount,
        pass: cohortCount,
        warn: 0,
        fail: 0,
        unknown: 0,
        notApplicable: 0,
        blocking: 0,
      },
    },
  }

  return { ...semantic, planFingerprint: createPlanFingerprint(semantic) }
}

function withFingerprint(plan: PlanResultV1): PlanResultV1 {
  return { ...plan, planFingerprint: createPlanFingerprint(plan) }
}

function validateWithLookupCount(plan: PlanResultV1): { comparisons: number; valid: boolean } {
  let comparisons = 0
  const tracked = new Set<unknown>([
    plan.occurrences,
    plan.decisions,
    plan.repository.relationships.boundaryPackages,
  ])
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'find')
  const originalFind = Array.prototype.find
  Object.defineProperty(Array.prototype, 'find', {
    ...descriptor,
    value: function <T>(
      this: T[],
      predicate: (value: T, index: number, array: T[]) => unknown,
      thisArg?: unknown,
    ): T | undefined {
      if (!tracked.has(this)) {
        return Reflect.apply(originalFind, this, [predicate, thisArg]) as T | undefined
      }
      return Reflect.apply(originalFind, this, [
        (value: T, index: number, array: T[]) => {
          comparisons += 1
          return predicate.call(thisArg, value, index, array)
        },
      ]) as T | undefined
    },
  })
  try {
    const valid = validatePlanResult(plan)
    return { comparisons, valid }
  } finally {
    if (descriptor) Object.defineProperty(Array.prototype, 'find', descriptor)
  }
}

describe('plan semantic validation indexes', () => {
  it('keeps exact-id lookup growth linear for equivalent valid plans', () => {
    const small = validateWithLookupCount(createIndexedPlan(8))
    const large = validateWithLookupCount(createIndexedPlan(128))

    expect(small.valid).toBe(true)
    expect(large.valid).toBe(true)
    expect(large.comparisons).toBeLessThanOrEqual(small.comparisons + (128 - 8) * 12)
    expect(large.comparisons).toBeLessThanOrEqual(128 * 12)
  })

  it('rejects duplicate entity IDs before indexed lookup', () => {
    const plan = createIndexedPlan(2)
    const duplicate = withFingerprint({
      ...plan,
      occurrences: [...plan.occurrences, { ...plan.occurrences[0]! }],
    })

    expect(validatePlanResult(duplicate)).toBe(false)
  })

  it('rejects ambiguous package ownership across repository boundaries', () => {
    const plan = createIndexedPlan(2)
    const ambiguous = withFingerprint({
      ...plan,
      repository: {
        ...plan.repository,
        boundaries: [
          { id: 'boundary-root', path: '.', classification: 'effective-root', markers: [] },
          {
            id: 'boundary-nested',
            path: 'nested',
            classification: 'nested-workspace',
            markers: [],
          },
        ],
        relationships: {
          ...plan.repository.relationships,
          boundaryPackages: [
            { boundaryId: 'boundary-root', packageId: 'package-root' },
            { boundaryId: 'boundary-nested', packageId: 'package-root' },
          ],
        },
      },
    })

    expect(validatePlanResult(ambiguous)).toBe(false)
  })

  it('retains canonical ordering checks for signal and evidence arrays', () => {
    const plan = createIndexedPlan(2, 2)
    expect(validatePlanResult(plan)).toBe(true)

    const reorderedSignals = withFingerprint({ ...plan, signals: [...plan.signals!].reverse() })
    const reorderedEvidence = withFingerprint({
      ...plan,
      signalEvidence: [...plan.signalEvidence!].reverse(),
    })

    expect(validatePlanResult(reorderedSignals)).toBe(false)
    expect(validatePlanResult(reorderedEvidence)).toBe(false)
  })
})
