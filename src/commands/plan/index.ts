import * as semver from 'semver'
import { version } from '../../../package.json' with { type: 'json' }
import { createMemoryCache } from '../../cache'
import type { InvocationScopeExclusions } from '../../cli/scope-exclusions'
import { resolveDataConfigForSource } from '../../config'
import {
  EXACT_SHA512_INTEGRITY_REGEX,
  NPM_ARTIFACT_VERIFIER_SUPPORT,
} from '../../contracts/artifact-verifier'
import { canonicalJson } from '../../contracts/canonical-json'
import { createPlanFingerprint, hashExactBytes } from '../../contracts/fingerprint'
import { assertPlainDataInput } from '../../contracts/input'
import { isSupportedManagerOccurrence } from '../../contracts/manager-occurrence'
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
import { isContractSafeArgv, isContractSafeText } from '../../contracts/sanitize'
import type { PlanResult, PlanResultV2 } from '../../contracts/schemas'
import { assertPlanResult } from '../../contracts/validate'
import { ConfigError } from '../../errors'
import { createResolveContext, resolvePackage } from '../../io/resolve'
import { resolvePhysicalValues } from '../../io/write/occurrence'
import { inspectRepositoryWithProjection } from '../../repository/inspect'
import { createSelectionReceipt } from '../../selection'
import { evaluatePlanSignals, validateSignalConfiguration } from '../../signals'
import type {
  depfreshOptions,
  PackageData,
  PlanSignal,
  PolicyDecision,
  PolicyRuleInput,
  RangeMode,
  ResolvedDepChange,
  SignalEvidence,
  SignalSummary,
  SortOption,
} from '../../types'
import type { PolicyRuleSource } from '../../types/policy'
import { redactSensitiveText } from '../../utils/redact'
import { resolveManagerAdapter } from '../apply/manager-adapters'

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
  syncLockfile?: boolean
  install?: boolean
  verifyArtifacts?: boolean
  verifyArgv?: string[]
  phaseTimeout?: number
  cohorts?: depfreshOptions['cohorts']
  signalRules?: depfreshOptions['signalRules']
}

type PlanExecution = PlanResult['execution']

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
    ...(options.cohorts === undefined ? {} : { cohorts: structuredClone(options.cohorts) }),
    ...(options.signalRules === undefined
      ? {}
      : { signalRules: structuredClone(options.signalRules) }),
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

export async function plan(options: PlanOptions): Promise<PlanResultV2> {
  return planForInvocation(options, 'library')
}

export async function planForInvocation(
  options: PlanOptions,
  invocationSource: Extract<PolicyRuleSource, 'library' | 'cli'>,
  invocationSelection?: InvocationScopeExclusions,
): Promise<PlanResultV2> {
  try {
    assertPlainDataInput(options)
  } catch {
    throw new ConfigError('Plan options must be plain JSON data.', {
      reason: 'INVALID_CONFIG',
    })
  }
  validatePhaseOptions(options)
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
  validateSignalConfiguration(runtimeOptions.cohorts, runtimeOptions.signalRules)
  const inspection = await inspectRepositoryWithProjection(
    runtimeOptions,
    undefined,
    invocationSelection,
  )
  const { model } = inspection
  const repository = projectRepository(model)
  const occurrences = projectOccurrences(model)
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
  let decisions = model.occurrences.map((occurrence) => {
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

  const candidateOccurrenceIds = operations.map((operation) => operation.occurrenceId)
  const runtimeSignalEvidence = (model.evidence ?? [])
    .filter((item) => item.kind === 'runtime')
    .map((item) => ({
      id: item.id,
      kind: 'runtime' as const,
      ...(item.boundaryId ? { boundaryId: item.boundaryId } : {}),
      status: item.status,
    }))
  let signalResult = evaluatePlanSignals({
    repository,
    occurrences,
    operations,
    candidateOccurrenceIds,
    traces: resolveContext.traces,
    metadata: resolveContext.metadata,
    cohorts: runtimeOptions.cohorts ?? [],
    rules: runtimeOptions.signalRules ?? [],
    policySource: options.signalRules !== undefined ? invocationSource : 'config',
    cohortSource: options.cohorts !== undefined ? invocationSource : 'config',
    runtimeEvidence: runtimeSignalEvidence,
    asOf: asOf.iso,
    cooldownDays: runtimeOptions.cooldown,
  })
  const blockedBySignals = new Set<string>()
  const causalSignals = new Map<string, PlanSignal>()
  const causalEvidence = new Map<string, SignalEvidence>()
  for (;;) {
    const newlyBlocked = signalResult.blockedOccurrenceIds.filter(
      (id) =>
        !blockedBySignals.has(id) &&
        decisions.some(
          (decision) => decision.occurrenceId === id && decision.status === 'operation',
        ),
    )
    if (newlyBlocked.length === 0) break
    const newlyBlockedSet = new Set(newlyBlocked)
    const evidenceById = new Map(signalResult.evidence.map((item) => [item.id, item]))
    for (const signal of signalResult.signals) {
      if (
        signal.effect !== 'block' ||
        !signal.subject.occurrenceIds.some((id) => newlyBlockedSet.has(id))
      ) {
        continue
      }
      causalSignals.set(signal.id, signal)
      for (const evidenceRef of signal.evidenceRefs) {
        const item = evidenceById.get(evidenceRef)
        if (item) causalEvidence.set(item.id, item)
      }
    }
    for (const id of newlyBlocked) blockedBySignals.add(id)
    for (let index = operations.length - 1; index >= 0; index -= 1) {
      const operation = operations[index]
      if (operation && blockedBySignals.has(operation.occurrenceId)) operations.splice(index, 1)
    }
    decisions = decisions.map((decision) => {
      if (!(blockedBySignals.has(decision.occurrenceId) && decision.status === 'operation')) {
        return decision
      }
      const { operationId: _operationId, ...rest } = decision
      return { ...rest, status: 'blocked' as const, reason: 'SIGNAL_POLICY_BLOCKED' }
    })
    signalResult = evaluatePlanSignals({
      repository,
      occurrences,
      operations,
      candidateOccurrenceIds,
      traces: resolveContext.traces,
      metadata: resolveContext.metadata,
      cohorts: runtimeOptions.cohorts ?? [],
      rules: runtimeOptions.signalRules ?? [],
      policySource: options.signalRules !== undefined ? invocationSource : 'config',
      cohortSource: options.cohorts !== undefined ? invocationSource : 'config',
      runtimeEvidence: runtimeSignalEvidence,
      asOf: asOf.iso,
      cooldownDays: runtimeOptions.cooldown,
    })
  }
  if (causalSignals.size > 0) {
    const signals = [
      ...new Map(
        [...signalResult.signals, ...causalSignals.values()].map((signal) => [signal.id, signal]),
      ).values(),
    ].sort((left, right) => compareText(left.id, right.id))
    const signalEvidence = [
      ...new Map(
        [...signalResult.evidence, ...causalEvidence.values()].map((item) => [item.id, item]),
      ).values(),
    ].sort((left, right) => compareText(left.id, right.id))
    signalResult = {
      ...signalResult,
      signals,
      evidence: signalEvidence,
      summary: summarizePlanSignals(signals),
    }
  }

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
  const evidence = projectEvidence(model) as PlanResult['evidence']
  const lockfiles = projectLockfiles(model)
  const execution = buildPlanExecution(
    options,
    operations,
    decisions,
    occurrences,
    repository,
    evidence,
    lockfiles,
    resolveContext.metadata,
    runtimeOptions.signalRules ?? [],
    options.signalRules !== undefined ? invocationSource : 'config',
  )
  if (execution.artifactVerification) {
    const artifactEvidence = artifactVerificationEvidence(execution.artifactVerification)
    signalResult = {
      ...signalResult,
      evidence: [...signalResult.evidence, ...artifactEvidence].sort((left, right) =>
        compareText(left.id, right.id),
      ),
    }
  }
  const risks = [
    ...projectRepositoryRisks(model),
    ...[...blockedDecisions, ...unknownDecisions, ...errorDecisions].map((decision) => ({
      code: decision.reason,
      severity: 'blocking' as const,
      message: `Occurrence ${decision.occurrenceId} is ${decision.status}.`,
      occurrenceId: decision.occurrenceId,
      evidenceRefs: [],
    })),
    ...(execution.status === 'blocked'
      ? [
          {
            code: execution.reason ?? 'EXECUTION_BLOCKED',
            severity: 'blocking' as const,
            message: 'The requested manager phase lacks exact supported execution evidence.',
            evidenceRefs: [],
          },
        ]
      : []),
    ...signalResult.signals
      .filter(
        (signal) =>
          signal.state === 'fail' || signal.state === 'unknown' || signal.effect === 'block',
      )
      .map((signal) => ({
        code: signal.reason,
        severity: signal.effect === 'block' ? ('blocking' as const) : ('warning' as const),
        message: `Compatibility signal ${signal.id} is ${signal.state}.`,
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
    signals: signalResult.summary,
  }
  const semanticResult = {
    contract: 'depfresh.plan' as const,
    schemaVersion: 2 as const,
    toolVersion: version,
    repository,
    asOf: asOf.iso,
    occurrences,
    decisions,
    operations,
    signals: signalResult.signals,
    signalEvidence: signalResult.evidence,
    execution,
    evidence,
    lockfiles,
    vcs: projectVcs(model),
    diagnostics: model.diagnostics.map(projectDiagnostic).sort(compareDiagnostics),
    risks,
    errors,
    requiredCapabilities: requiredPlanCapabilities(operations.length, execution),
    summary,
    selection:
      inspection.selection ?? createSelectionReceipt(undefined, model, inspection.decisions),
  }
  const result = { ...semanticResult, planFingerprint: createPlanFingerprint(semanticResult) }
  assertPlanResult(result)
  return result
}

function summarizePlanSignals(signals: PlanSignal[]): SignalSummary {
  return {
    total: signals.length,
    pass: signals.filter((signal) => signal.state === 'pass').length,
    warn: signals.filter((signal) => signal.state === 'warn').length,
    fail: signals.filter((signal) => signal.state === 'fail').length,
    unknown: signals.filter((signal) => signal.state === 'unknown').length,
    notApplicable: signals.filter((signal) => signal.state === 'not-applicable').length,
    blocking: signals.filter((signal) => signal.effect === 'block').length,
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function validatePhaseOptions(options: PlanOptions): void {
  if (options.syncLockfile && options.install) {
    throw new ConfigError('--sync-lockfile cannot be combined with --install.', {
      reason: 'INVALID_OPTION_VALUE',
    })
  }
  if (options.verifyArgv !== undefined) {
    if (!(options.syncLockfile || options.install)) {
      throw new ConfigError('--verify-argv requires --sync-lockfile or --install.', {
        reason: 'INVALID_OPTION_VALUE',
      })
    }
    if (
      options.verifyArgv.length === 0 ||
      options.verifyArgv.some((value) => typeof value !== 'string') ||
      !isContractSafeArgv(options.verifyArgv)
    ) {
      throw new ConfigError('--verify-argv must be a non-empty public JSON string array.', {
        reason: 'INVALID_OPTION_VALUE',
      })
    }
  }
  if (options.verifyArtifacts && !options.install) {
    throw new ConfigError('--verify-artifacts requires --install.', {
      reason: 'INVALID_OPTION_VALUE',
    })
  }
  if (
    options.phaseTimeout !== undefined &&
    (!Number.isSafeInteger(options.phaseTimeout) ||
      options.phaseTimeout < 1 ||
      options.phaseTimeout > 600_000)
  ) {
    throw new ConfigError('--phase-timeout must be an integer between 1 and 600000.', {
      reason: 'INVALID_OPTION_VALUE',
    })
  }
}

function buildPlanExecution(
  options: PlanOptions,
  operations: PlanResult['operations'],
  decisions: PlanResult['decisions'],
  occurrences: PlanResult['occurrences'],
  repository: PlanResult['repository'],
  evidence: PlanResult['evidence'],
  lockfiles: PlanResult['lockfiles'],
  metadata: ReadonlyMap<string, { packageName: string; currentVersion: string; data: PackageData }>,
  signalRules: readonly NonNullable<depfreshOptions['signalRules']>[number][],
  signalPolicySource: Extract<PolicyRuleSource, 'config' | 'library' | 'cli'>,
): PlanExecution {
  const mode: PlanExecution['mode'] = options.install
    ? 'install'
    : options.syncLockfile
      ? 'sync-lockfile'
      : 'file-only'
  const timeoutMs = options.phaseTimeout ?? 120_000
  if (mode === 'file-only') return { mode, status: 'ready', timeoutMs, targets: [] }
  if (operations.length === 0) return { mode, status: 'not-needed', timeoutMs, targets: [] }

  const decisionsByOperation = new Map(
    decisions.map((decision) => [decision.operationId, decision]),
  )
  const occurrencesById = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]))
  for (const operation of operations) {
    if (
      operation.path.length !== 2 ||
      operation.path[1] !== operation.name ||
      !LOCKFILE_PHASE_FIELDS.has(operation.path[0] ?? '')
    ) {
      return blockedExecution(mode, timeoutMs, 'LOCKFILE_OCCURRENCE_UNSUPPORTED')
    }
    const targetVersion = decisionsByOperation.get(operation.id)?.candidate?.targetVersion
    if (!targetVersion) {
      return blockedExecution(mode, timeoutMs, 'LOCKFILE_TARGET_UNAVAILABLE')
    }
    if (
      !isSupportedManagerOccurrence(
        occurrencesById.get(operation.occurrenceId),
        operation,
        targetVersion,
      )
    ) {
      return blockedExecution(mode, timeoutMs, 'LOCKFILE_PROTOCOL_UNSUPPORTED')
    }
  }

  const boundaries = affectedBoundaries(operations, repository.boundaries)
  const targets: PlanExecution['targets'] = []
  for (const boundary of boundaries) {
    const managerEvidence = evidence.find(
      (entry) => entry.kind === 'package-manager' && entry.boundaryId === boundary.id,
    )
    if (managerEvidence?.status !== 'confirmed') {
      return blockedExecution(mode, timeoutMs, evidenceReason('MANAGER', managerEvidence?.status))
    }
    if (managerEvidence.values.length !== 1) {
      return blockedExecution(mode, timeoutMs, 'MANAGER_EVIDENCE_AMBIGUOUS')
    }
    const managerValue = managerEvidence.values[0]
    if (!managerValue || typeof managerValue !== 'object' || Array.isArray(managerValue)) {
      return blockedExecution(mode, timeoutMs, 'MANAGER_EVIDENCE_UNSUPPORTED')
    }
    const managerName = managerValue.name
    const managerVersion = managerValue.version
    if (typeof managerName !== 'string') {
      return blockedExecution(mode, timeoutMs, 'MANAGER_EVIDENCE_MISSING')
    }
    if (typeof managerVersion !== 'string') {
      return blockedExecution(mode, timeoutMs, 'MANAGER_VERSION_MISSING')
    }

    const lockfileEvidence = evidence.find(
      (entry) => entry.kind === 'lockfile-selection' && entry.boundaryId === boundary.id,
    )
    if (lockfileEvidence?.status !== 'confirmed') {
      return blockedExecution(mode, timeoutMs, evidenceReason('LOCKFILE', lockfileEvidence?.status))
    }
    if (lockfileEvidence.values.length !== 1 || typeof lockfileEvidence.values[0] !== 'string') {
      return blockedExecution(mode, timeoutMs, 'LOCKFILE_EVIDENCE_AMBIGUOUS')
    }
    const lockfile = lockfiles.find((entry) => entry.id === lockfileEvidence.values[0])
    if (!lockfile) return blockedExecution(mode, timeoutMs, 'LOCKFILE_EVIDENCE_MISSING')
    if (lockfile.parseState !== 'parsed' || !lockfile.byteHash) {
      return blockedExecution(mode, timeoutMs, 'LOCKFILE_UNSUPPORTED')
    }
    if (lockfile.manager !== managerName) {
      return blockedExecution(mode, timeoutMs, 'MANAGER_LOCKFILE_MISMATCH')
    }
    const adapter = resolveManagerAdapter({
      manager: managerName,
      version: managerVersion,
      lockfilePath: lockfile.path,
      mode,
      boundaryPath: boundary.path,
    })
    if ('unsupported' in adapter) return blockedExecution(mode, timeoutMs, adapter.unsupported)
    targets.push({
      boundaryId: boundary.id,
      boundaryPath: boundary.path,
      manager: { name: adapter.executable, version: managerVersion },
      lockfile: { id: lockfile.id, path: lockfile.path, byteHash: lockfile.byteHash },
      adapter,
    })
  }

  let artifactVerification: PlanExecution['artifactVerification']
  if (options.verifyArtifacts) {
    const result = buildArtifactVerification(
      operations,
      decisions,
      targets,
      metadata,
      options.phaseTimeout ?? 120_000,
      signalRules,
      signalPolicySource,
    )
    if ('reason' in result) return blockedExecution(mode, timeoutMs, result.reason)
    artifactVerification = result
  }

  const verifyArgv = options.verifyArgv
  return {
    mode,
    status: 'ready',
    timeoutMs,
    targets,
    ...(artifactVerification ? { artifactVerification } : {}),
    ...(verifyArgv
      ? {
          verification: {
            executable: verifyArgv[0]!,
            args: verifyArgv.slice(1),
            cwd: '.',
            timeoutMs: options.phaseTimeout ?? 120_000,
            permittedPaths: [],
          },
        }
      : {}),
  }
}

function buildArtifactVerification(
  operations: PlanResult['operations'],
  decisions: PlanResult['decisions'],
  targets: PlanExecution['targets'],
  metadata: ReadonlyMap<string, { packageName: string; currentVersion: string; data: PackageData }>,
  timeoutMs: number,
  signalRules: readonly NonNullable<depfreshOptions['signalRules']>[number][],
  signalPolicySource: Extract<PolicyRuleSource, 'config' | 'library' | 'cli'>,
): NonNullable<PlanExecution['artifactVerification']> | { reason: string } {
  const decisionsByOperation = new Map(
    decisions.map((decision) => [decision.operationId, decision]),
  )
  type VerificationTarget = NonNullable<PlanExecution['artifactVerification']>['targets'][number]
  type Artifact = VerificationTarget['artifacts'][number]
  const groups = new Map<
    string,
    {
      target: PlanExecution['targets'][number]
      artifacts: Map<string, Omit<Artifact, 'id' | 'evidenceRef'>>
    }
  >()

  for (const operation of operations) {
    const target = executionTargetForFile(operation.file, targets)
    if (target?.manager.name !== NPM_ARTIFACT_VERIFIER_SUPPORT.manager) {
      return { reason: 'ARTIFACT_VERIFIER_UNSUPPORTED' }
    }
    if (!semver.satisfies(target.manager.version, NPM_ARTIFACT_VERIFIER_SUPPORT.versionRange)) {
      return { reason: 'ARTIFACT_VERIFIER_UNSUPPORTED' }
    }
    const resolution = metadata.get(operation.occurrenceId)
    const targetVersion = decisionsByOperation.get(operation.id)?.candidate?.targetVersion
    if (!(resolution && targetVersion)) return { reason: 'ARTIFACT_IDENTITY_UNAVAILABLE' }
    const observedRegistry = resolution.data.registry
    const integrity = resolution.data.artifactIntegrity?.[targetVersion]
    if (
      observedRegistry !== NPM_ARTIFACT_VERIFIER_SUPPORT.registry ||
      !isExactSha512Integrity(integrity)
    ) {
      return { reason: 'ARTIFACT_INTEGRITY_UNAVAILABLE' }
    }
    const registry = NPM_ARTIFACT_VERIFIER_SUPPORT.registry
    const base: Omit<Artifact, 'id' | 'evidenceRef'> = {
      occurrenceIds: [operation.occurrenceId],
      packageName: resolution.packageName,
      version: targetVersion,
      registry,
      integrity,
      signaturePresence: resolution.data.signaturePresence?.[targetVersion] ?? 'unknown',
      provenancePresence: resolution.data.provenancePresence?.[targetVersion] ?? 'unknown',
    }
    const key = canonicalJson({
      packageName: base.packageName,
      version: base.version,
      registry: base.registry,
      integrity: base.integrity,
    })
    const targetGroup = groups.get(target.boundaryId) ?? {
      target,
      artifacts: new Map<string, Omit<Artifact, 'id' | 'evidenceRef'>>(),
    }
    groups.set(target.boundaryId, targetGroup)
    const existing = targetGroup.artifacts.get(key)
    if (existing) {
      existing.occurrenceIds.push(operation.occurrenceId)
      existing.occurrenceIds.sort(compareText)
    } else {
      targetGroup.artifacts.set(key, base)
    }
  }

  const verificationTargets = [...groups.values()]
    .map(({ target, artifacts }) => {
      const projected = [...artifacts.values()]
        .map((artifact) => {
          const identity = artifactIdentity(artifact)
          const id = `artifact-${hashExactBytes(canonicalJson(identity)).slice(0, 24)}`
          const evidence = artifactEvidenceBase(id, artifact)
          return {
            id,
            ...artifact,
            evidenceRef: `signal-evidence-${hashExactBytes(canonicalJson(evidence)).slice(0, 24)}`,
          }
        })
        .sort((left, right) => compareText(left.id, right.id))
      return {
        boundaryId: target.boundaryId,
        cwd: target.boundaryPath,
        verifier: { name: 'npm' as const, version: target.manager.version },
        executable: 'npm' as const,
        args: [
          'audit',
          'signatures',
          '--json',
          '--include-attestations',
          '--ignore-scripts',
        ] as VerificationTarget['args'],
        artifacts: projected,
      }
    })
    .sort((left, right) => compareText(left.boundaryId, right.boundaryId))
  return {
    kind: 'npm-audit-signatures-v1',
    timeoutMs,
    isolatedHome: true,
    policySource: signalPolicySource,
    rules: signalRules.map((rule) => structuredClone(rule)),
    targets: verificationTargets,
  }
}

function artifactIdentity(artifact: {
  packageName: string
  version: string
  registry: string
  integrity: string
}) {
  return {
    packageName: artifact.packageName,
    version: artifact.version,
    registry: artifact.registry,
    integrity: artifact.integrity,
  }
}

function artifactEvidenceBase(
  artifactId: string,
  artifact: {
    occurrenceIds: string[]
    packageName: string
    version: string
    registry: string
    integrity: string
    signaturePresence: string
    provenancePresence: string
  },
): Omit<SignalEvidence, 'id'> {
  return {
    kind: 'registry-artifact',
    status: 'observed',
    subject: artifactId,
    sourceRefs: [...artifact.occurrenceIds],
    facts: {
      packageName: artifact.packageName,
      targetVersion: artifact.version,
      registry: artifact.registry,
      integrity: artifact.integrity,
      signaturePresence: artifact.signaturePresence,
      provenancePresence: artifact.provenancePresence,
    },
  }
}

function artifactVerificationEvidence(
  verification: NonNullable<PlanExecution['artifactVerification']>,
): SignalEvidence[] {
  return verification.targets.flatMap((target) =>
    target.artifacts.map((artifact) => ({
      id: artifact.evidenceRef,
      ...artifactEvidenceBase(artifact.id, artifact),
    })),
  )
}

function executionTargetForFile(
  file: string,
  targets: PlanExecution['targets'],
): PlanExecution['targets'][number] | undefined {
  return [...targets]
    .sort(
      (left, right) =>
        right.boundaryPath.length - left.boundaryPath.length ||
        compareText(left.boundaryId, right.boundaryId),
    )
    .find(
      (target) =>
        target.boundaryPath === '.' ||
        file === target.boundaryPath ||
        file.startsWith(`${target.boundaryPath}/`),
    )
}

function isExactSha512Integrity(value: string | undefined): value is string {
  if (!value) return false
  const match = EXACT_SHA512_INTEGRITY_REGEX.exec(value)
  if (!match?.[1]) return false
  const bytes = Buffer.from(match[1], 'base64')
  return bytes.length === 64 && bytes.toString('base64') === match[1]
}

const LOCKFILE_PHASE_FIELDS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
])

function affectedBoundaries(
  operations: Array<{ file: string }>,
  boundaries: PlanResult['repository']['boundaries'],
): PlanResult['repository']['boundaries'] {
  const selected = new Map<string, (typeof boundaries)[number]>()
  const deepest = [...boundaries].sort(
    (left, right) => right.path.length - left.path.length || left.path.localeCompare(right.path),
  )
  for (const operation of operations) {
    const boundary = deepest.find(
      (entry) =>
        entry.path === '.' ||
        operation.file === entry.path ||
        operation.file.startsWith(`${entry.path}/`),
    )
    if (boundary) selected.set(boundary.id, boundary)
  }
  return [...selected.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function evidenceReason(
  prefix: 'MANAGER' | 'LOCKFILE',
  status: PlanResult['evidence'][number]['status'] | undefined,
): string {
  if (!status || status === 'missing') return `${prefix}_EVIDENCE_MISSING`
  if (status === 'ambiguous') return `${prefix}_EVIDENCE_AMBIGUOUS`
  if (status === 'unavailable') return `${prefix}_EVIDENCE_UNAVAILABLE`
  return `${prefix}_EVIDENCE_UNSUPPORTED`
}

function blockedExecution(
  mode: Exclude<PlanExecution['mode'], 'file-only'>,
  timeoutMs: number,
  reason: string,
): PlanExecution {
  return { mode, status: 'blocked', timeoutMs, reason, targets: [] }
}

function requiredPlanCapabilities(
  operationCount: number,
  execution: PlanExecution,
): PlanResult['requiredCapabilities'] {
  const capabilities: PlanResult['requiredCapabilities'] = ['filesystem-read', 'registry-read']
  if (operationCount === 0) return capabilities
  capabilities.push('file-write')
  if (execution.mode === 'file-only' || execution.status !== 'ready') return capabilities
  capabilities.push('process-execute', 'lockfile-write')
  if (execution.mode === 'install') capabilities.push('install')
  if (execution.artifactVerification) capabilities.push('artifact-verify', 'network-access')
  if (execution.verification) capabilities.push('verify-command')
  return capabilities
}
