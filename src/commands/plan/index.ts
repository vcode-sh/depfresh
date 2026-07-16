import { version } from '../../../package.json' with { type: 'json' }
import { createMemoryCache } from '../../cache'
import { resolveDataConfigForSource } from '../../config'
import { canonicalJson } from '../../contracts/canonical-json'
import { createPlanFingerprint, hashExactBytes } from '../../contracts/fingerprint'
import { assertPlainDataInput } from '../../contracts/input'
import {
  compareCanonical,
  compareDiagnostics,
  projectDiagnostic,
  projectEvidence,
  projectLockfiles,
  projectOccurrences,
  projectRepository,
  projectRepositoryRisks,
  projectVcs,
} from '../../contracts/repository-projection'
import { isContractSafeText } from '../../contracts/sanitize'
import type { PlanResult } from '../../contracts/schemas'
import { assertPlanResult } from '../../contracts/validate'
import { ConfigError } from '../../errors'
import { createResolveContext, resolvePackage } from '../../io/resolve'
import { resolvePhysicalValues } from '../../io/write/occurrence'
import { inspectRepositoryWithProjection } from '../../repository/inspect'
import type {
  depfreshOptions,
  PolicyDecision,
  PolicyRuleInput,
  RangeMode,
  ResolvedDepChange,
  SortOption,
} from '../../types'
import type { PolicyRuleSource } from '../../types/policy'
import { redactSensitiveText } from '../../utils/redact'

export interface PlanOptions {
  cwd: string
  recursive?: boolean
  mode?: RangeMode
  include?: string[]
  exclude?: string[]
  packageMode?: Record<string, RangeMode>
  policyRules?: PolicyRuleInput[]
  force?: boolean
  includeLocked?: boolean
  peer?: boolean
  includeWorkspace?: boolean
  depFields?: depfreshOptions['depFields']
  concurrency?: number
  timeout?: number
  retries?: number
  cooldown?: number
  ignorePaths?: string[]
  ignoreOtherWorkspaces?: boolean
  sort?: SortOption
  asOf?: string
}

function policyProjection(decision: PolicyDecision) {
  return {
    status: decision.status,
    reason: decision.reason,
    action: decision.action,
    mode: decision.mode,
    matchedRuleIds: decision.matchedRuleIds,
    indeterminateRuleIds: decision.indeterminateRuleIds,
    ...(decision.winningActionRuleId ? { winningActionRuleId: decision.winningActionRuleId } : {}),
    ...(decision.winningModeRuleId ? { winningModeRuleId: decision.winningModeRuleId } : {}),
    ...(decision.candidateReason ? { candidateReason: decision.candidateReason } : {}),
  }
}

function semanticAsOf(
  options: PlanOptions,
  runtimeOptions: depfreshOptions,
): {
  iso: string
  milliseconds: number
} {
  if (!options.asOf) {
    if (runtimeOptions.cooldown > 0) {
      throw new ConfigError('Planning with cooldown requires an explicit --as-of timestamp.', {
        reason: 'INVALID_OPTION_VALUE',
      })
    }
    return { iso: '1970-01-01T00:00:00.000Z', milliseconds: 0 }
  }
  const milliseconds = Date.parse(options.asOf)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== options.asOf) {
    throw new ConfigError('--as-of must be a canonical UTC ISO 8601 timestamp.', {
      reason: 'INVALID_OPTION_VALUE',
    })
  }
  return { iso: options.asOf, milliseconds }
}

function createRuntimeOverrides(options: PlanOptions): Partial<depfreshOptions> {
  return {
    cwd: options.cwd,
    ...(options.recursive === undefined ? {} : { recursive: options.recursive }),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.include === undefined ? {} : { include: [...options.include] }),
    ...(options.exclude === undefined ? {} : { exclude: [...options.exclude] }),
    ...(options.packageMode === undefined ? {} : { packageMode: { ...options.packageMode } }),
    ...(options.policyRules === undefined
      ? {}
      : { policyRules: structuredClone(options.policyRules) }),
    ...(options.force === undefined ? {} : { force: options.force }),
    ...(options.includeLocked === undefined ? {} : { includeLocked: options.includeLocked }),
    ...(options.peer === undefined ? {} : { peer: options.peer }),
    ...(options.includeWorkspace === undefined
      ? {}
      : { includeWorkspace: options.includeWorkspace }),
    ...(options.depFields === undefined ? {} : { depFields: { ...options.depFields } }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    ...(options.cooldown === undefined ? {} : { cooldown: options.cooldown }),
    ...(options.ignorePaths === undefined ? {} : { ignorePaths: [...options.ignorePaths] }),
    ...(options.ignoreOtherWorkspaces === undefined
      ? {}
      : { ignoreOtherWorkspaces: options.ignoreOtherWorkspaces }),
    ...(options.sort === undefined ? {} : { sort: options.sort }),
    write: false,
    interactive: false,
    install: false,
    update: false,
    global: false,
    globalAll: false,
    output: 'json',
    loglevel: 'silent',
  }
}

export async function plan(options: PlanOptions): Promise<PlanResult> {
  return planForInvocation(options, 'library')
}

export async function planForInvocation(
  options: PlanOptions,
  invocationSource: Extract<PolicyRuleSource, 'library' | 'cli'>,
): Promise<PlanResult> {
  try {
    assertPlainDataInput(options)
  } catch {
    throw new ConfigError('Plan options must be plain JSON data.', {
      reason: 'INVALID_CONFIG',
    })
  }
  const runtimeOptions = await resolveDataConfigForSource(
    createRuntimeOverrides(options),
    invocationSource,
  )
  if (
    runtimeOptions.compiledPolicy?.rules.some(
      (rule) => rule.provenance.kind === 'explicit' && !isContractSafeText(rule.id),
    )
  ) {
    throw new ConfigError('Plan policy rule identifiers must be public and path-neutral.', {
      reason: 'INVALID_CONFIG',
    })
  }
  const asOf = semanticAsOf(options, runtimeOptions)
  const inspection = await inspectRepositoryWithProjection(runtimeOptions)
  const { model } = inspection
  const repository = projectRepository(model)
  const sourcesById = new Map(model.sourceFiles.map((source) => [source.id, source]))
  const preliminaryDecisions = new Map(
    inspection.decisions.map((decision) => [decision.occurrenceId, decision]),
  )
  const sensitiveIds = new Set(
    model.occurrences
      .filter((occurrence) =>
        [occurrence.name, occurrence.declaredText, ...occurrence.path].some(
          (value) => !isContractSafeText(value),
        ),
      )
      .map((occurrence) => occurrence.id),
  )
  const projectedDependencyIds = new Set<string>()
  const nonUpdatingIds = new Set<string>()
  for (const pkg of inspection.packages) {
    for (const dependency of pkg.deps) {
      if (!dependency.occurrenceId) continue
      projectedDependencyIds.add(dependency.occurrenceId)
      if (!dependency.update) nonUpdatingIds.add(dependency.occurrenceId)
    }
    pkg.deps = pkg.deps.filter((dependency) => !sensitiveIds.has(dependency.occurrenceId ?? ''))
  }

  const memoryCache = createMemoryCache(() => asOf.milliseconds)
  const resolveContext = createResolveContext(runtimeOptions, { now: asOf.milliseconds })
  const workspacePackageNames = new Set(inspection.packages.map((pkg) => pkg.name).filter(Boolean))
  const resolved = (
    await Promise.all(
      inspection.packages.map((pkg) =>
        resolvePackage(
          pkg,
          runtimeOptions,
          memoryCache,
          undefined,
          workspacePackageNames,
          undefined,
          resolveContext,
        ),
      ),
    )
  ).flat()
  memoryCache.close()
  const changes = new Map(
    resolved
      .filter((change) => change.occurrenceId)
      .map((change) => [change.occurrenceId!, change]),
  )
  const finalizedPolicies = new Map(
    inspection.packages.flatMap((pkg) =>
      pkg.deps.flatMap((dependency) =>
        dependency.occurrenceId && dependency.policyDecision
          ? [[dependency.occurrenceId, dependency.policyDecision] as const]
          : [],
      ),
    ),
  )

  const operations: Array<{
    id: string
    occurrenceId: string
    sourceFileId: string
    file: string
    path: string[]
    name: string
    sourceByteHash: string
    expectedValue: string
    requestedValue: string
  }> = []
  const decisions = model.occurrences.map((occurrence) => {
    const trace = resolveContext.traces.get(occurrence.id)
    const policy =
      (trace?.status === 'unchanged' ? finalizedPolicies.get(occurrence.id) : undefined) ??
      preliminaryDecisions.get(occurrence.id)
    if (!policy) {
      throw new ConfigError(`Missing policy decision for occurrence ${occurrence.id}`, {
        reason: 'INVALID_CONFIG',
      })
    }
    const policyValue = policyProjection(policy)
    if (sensitiveIds.has(occurrence.id)) {
      return {
        occurrenceId: occurrence.id,
        status: 'blocked' as const,
        reason: 'SENSITIVE_VALUE_REDACTED',
        policy: policyValue,
      }
    }
    if (policy.status === 'blocked') {
      return {
        occurrenceId: occurrence.id,
        status: 'blocked' as const,
        reason: policy.reason,
        policy: policyValue,
      }
    }
    if (policy.status === 'skipped') {
      return {
        occurrenceId: occurrence.id,
        status: 'skipped' as const,
        reason: policy.reason,
        policy: policyValue,
      }
    }
    if (occurrence.role === 'catalog-consumer') {
      return {
        occurrenceId: occurrence.id,
        status: 'skipped' as const,
        reason: 'CATALOG_CONSUMER_EXPLANATORY',
        policy: policyValue,
      }
    }
    if (!occurrence.writeable) {
      return {
        occurrenceId: occurrence.id,
        status: 'skipped' as const,
        reason: 'OCCURRENCE_NOT_WRITEABLE',
        policy: policyValue,
      }
    }
    if (nonUpdatingIds.has(occurrence.id)) {
      return {
        occurrenceId: occurrence.id,
        status: 'skipped' as const,
        reason: 'LOCKED_DECLARATION_EXCLUDED',
        policy: policyValue,
      }
    }
    if (!projectedDependencyIds.has(occurrence.id)) {
      return {
        occurrenceId: occurrence.id,
        status: 'skipped' as const,
        reason: 'RESOLUTION_SCOPE_EXCLUDED',
        policy: policyValue,
      }
    }
    const candidate = trace
      ? {
          reason: trace.reason,
          eligibleVersions: trace.eligibleVersions,
          ...(trace.targetVersion ? { targetVersion: trace.targetVersion } : {}),
        }
      : undefined
    if (!trace) {
      return {
        occurrenceId: occurrence.id,
        status: 'unknown' as const,
        reason: 'RESOLUTION_TRACE_MISSING',
        policy: policyValue,
      }
    }
    if (trace.status === 'unknown') {
      return {
        occurrenceId: occurrence.id,
        status: 'unknown' as const,
        reason: trace.reason,
        candidate,
        policy: policyValue,
      }
    }
    if (trace.status === 'blocked') {
      return {
        occurrenceId: occurrence.id,
        status: 'blocked' as const,
        reason: trace.reason,
        candidate,
        policy: policyValue,
      }
    }
    if (trace.status === 'skipped') {
      return {
        occurrenceId: occurrence.id,
        status: 'skipped' as const,
        reason: trace.reason,
        candidate,
        policy: policyValue,
      }
    }
    const change = changes.get(occurrence.id)
    if (trace.status === 'unchanged' || !change) {
      return {
        occurrenceId: occurrence.id,
        status: 'unchanged' as const,
        reason: trace.reason,
        candidate,
        policy: policyValue,
      }
    }
    const source = sourcesById.get(occurrence.sourceFileId)
    if (!source) {
      return {
        occurrenceId: occurrence.id,
        status: 'error' as const,
        reason: 'SOURCE_FILE_MISSING',
        candidate,
        policy: policyValue,
      }
    }
    const physical = resolvePhysicalValues(
      {
        change: change as ResolvedDepChange,
        occurrence: { file: source.path, path: occurrence.path },
        exactExpectedValue: occurrence.declaredText,
      },
      occurrence.declaredText,
    )
    if (
      redactSensitiveText(physical.expectedValue) !== physical.expectedValue ||
      redactSensitiveText(physical.requestedValue) !== physical.requestedValue
    ) {
      return {
        occurrenceId: occurrence.id,
        status: 'blocked' as const,
        reason: 'SENSITIVE_VALUE_REDACTED',
        candidate,
        policy: policyValue,
      }
    }
    const operationBase = {
      occurrenceId: occurrence.id,
      sourceFileId: occurrence.sourceFileId,
      file: source.path,
      path: occurrence.path,
      name: occurrence.name,
      sourceByteHash: source.byteHash,
      expectedValue: physical.expectedValue,
      requestedValue: physical.requestedValue,
    }
    const operation = {
      id: `operation-${hashExactBytes(canonicalJson(operationBase)).slice(0, 24)}`,
      ...operationBase,
    }
    operations.push(operation)
    return {
      occurrenceId: occurrence.id,
      status: 'operation' as const,
      reason: trace.reason,
      operationId: operation.id,
      candidate,
      policy: policyValue,
    }
  })

  const unknownDecisions = decisions.filter((decision) => decision.status === 'unknown')
  const errorDecisions = decisions.filter((decision) => decision.status === 'error')
  const errors = [...unknownDecisions, ...errorDecisions].map((decision) => ({
    code: decision.status === 'unknown' ? 'ERR_RESOLVE' : 'ERR_CONTRACT',
    reason: decision.reason,
    message:
      decision.status === 'unknown'
        ? 'Registry resolution did not produce authoritative candidate evidence.'
        : 'The repository occurrence could not be mapped to an exact source operation.',
    retryable: decision.status === 'unknown',
    fatal: false,
    occurrenceId: decision.occurrenceId,
  }))
  const blockedDecisions = decisions.filter((decision) => decision.status === 'blocked')
  const risks = [
    ...projectRepositoryRisks(model),
    ...[...blockedDecisions, ...unknownDecisions, ...errorDecisions].map((decision) => ({
      code: decision.reason,
      severity: 'blocking' as const,
      message: `Occurrence ${decision.occurrenceId} is ${decision.status}.`,
      occurrenceId: decision.occurrenceId,
      evidenceRefs: [],
    })),
  ].sort(compareCanonical)
  const summary = {
    total: decisions.length,
    operations: operations.length,
    unchanged: decisions.filter((decision) => decision.status === 'unchanged').length,
    skipped: decisions.filter((decision) => decision.status === 'skipped').length,
    blocked: blockedDecisions.length,
    unknown: unknownDecisions.length,
    errors: errorDecisions.length,
  }
  const semanticResult = {
    contract: 'depfresh.plan',
    schemaVersion: 1,
    toolVersion: version,
    repository,
    asOf: asOf.iso,
    occurrences: projectOccurrences(model),
    decisions,
    operations,
    evidence: projectEvidence(model),
    lockfiles: projectLockfiles(model),
    vcs: projectVcs(model),
    diagnostics: model.diagnostics.map(projectDiagnostic).sort(compareDiagnostics),
    risks,
    errors,
    requiredCapabilities: [
      'filesystem-read' as const,
      'registry-read' as const,
      ...(operations.length > 0 ? (['file-write'] as const) : []),
    ],
    summary,
  }
  const result = { ...semanticResult, planFingerprint: createPlanFingerprint(semanticResult) }
  assertPlanResult(result)
  return result
}
