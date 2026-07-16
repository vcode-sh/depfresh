import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import * as semver from 'semver'
import { resolveManagerAdapter } from '../commands/apply/manager-adapters'
import { exactDeclaredVersion } from '../utils/exact-version'
import { canonicalJson } from './canonical-json'
import { createPlanFingerprint, createRepositoryFingerprint, hashExactBytes } from './fingerprint'
import { isSupportedManagerOccurrence } from './manager-occurrence'
import { isContractSafeArgv, isContractSafeText } from './sanitize'
import type { ApplyResult, InspectResult, MachineCommandError, PlanResult } from './schemas'
import {
  applyResultSchema,
  commandErrorSchema,
  inspectResultSchema,
  planResultSchema,
} from './schemas'

const ajv = new Ajv({ allErrors: true, strict: true })
const inspectValidator = ajv.compile(inspectResultSchema) as ValidateFunction<InspectResult>
const planValidator = ajv.compile(planResultSchema) as ValidateFunction<PlanResult>
const applyValidator = ajv.compile(applyResultSchema) as ValidateFunction<ApplyResult>
const errorValidator = ajv.compile(commandErrorSchema) as ValidateFunction<MachineCommandError>

export class ContractValidationError extends Error {
  readonly code = 'ERR_CONTRACT_VALIDATION'
  readonly reason = 'CONTRACT_VALIDATION_FAILED'

  constructor(
    contract: string,
    readonly validationErrors: ErrorObject[],
  ) {
    super(`${contract} failed contract validation`)
    this.name = 'ContractValidationError'
  }
}

function assertValid<T>(
  contract: string,
  validate: ValidateFunction<T>,
  value: unknown,
): asserts value is T {
  if (validate(value)) return
  throw new ContractValidationError(contract, validate.errors ? [...validate.errors] : [])
}

export function assertInspectResult(value: unknown): asserts value is InspectResult {
  assertValid('depfresh.inspect', inspectValidator, value)
  if (!hasValidInspectSemantics(value)) {
    throw new ContractValidationError('depfresh.inspect', [semanticError])
  }
}

export function assertPlanResult(value: unknown): asserts value is PlanResult {
  assertValid('depfresh.plan', planValidator, value)
  if (!hasValidPlanSemantics(value)) {
    throw new ContractValidationError('depfresh.plan', [semanticError])
  }
}

export function assertApplyResult(value: unknown): asserts value is ApplyResult {
  assertValid('depfresh.apply', applyValidator, value)
  if (!hasValidApplySemantics(value)) {
    throw new ContractValidationError('depfresh.apply', [semanticError])
  }
}

export function assertMachineCommandError(value: unknown): asserts value is MachineCommandError {
  assertValid('depfresh.error', errorValidator, value)
}

export function validateInspectResult(value: unknown): value is InspectResult {
  return inspectValidator(value) && hasValidInspectSemantics(value)
}

export function validatePlanResult(value: unknown): value is PlanResult {
  return planValidator(value) && hasValidPlanSemantics(value)
}

export function validateApplyResult(value: unknown): value is ApplyResult {
  return applyValidator(value) && hasValidApplySemantics(value)
}

export function validateMachineCommandError(value: unknown): value is MachineCommandError {
  return errorValidator(value)
}

const semanticError: ErrorObject = {
  instancePath: '',
  schemaPath: '#/semantic',
  keyword: 'semantic',
  params: {},
  message: 'cross-field plan invariants are invalid',
}

function hasValidApplySemantics(result: ApplyResult): boolean {
  const operationIds = new Set(result.operations.map((operation) => operation.operationId))
  if (operationIds.size !== result.operations.length) return false
  if (
    new Set(result.operations.map((operation) => operation.occurrenceId)).size !==
    result.operations.length
  ) {
    return false
  }
  if (new Set(result.phases.map((entry) => entry.name)).size !== result.phases.length) return false
  const phaseOrder = new Map(
    [
      'preflight',
      'lock',
      'manager-preflight',
      'stage',
      'precommit',
      'commit',
      'sync-lockfile',
      'install',
      'artifact-verify',
      'verify',
      'recovery',
      'inspect',
      'cleanup',
    ].map((name, index) => [name, index]),
  )
  if (
    result.phases.some(
      (entry, index) =>
        index > 0 &&
        (phaseOrder.get(entry.name) ?? -1) <
          (phaseOrder.get(result.phases[index - 1]?.name ?? '') ?? -1),
    )
  ) {
    return false
  }
  if (
    !isContractSafeText(result.repositoryIdentity) ||
    result.phases.some((entry) => !isContractSafeText(entry.reason)) ||
    (result.recovery.journalId !== undefined && !isContractSafeText(result.recovery.journalId))
  ) {
    return false
  }
  const counts = {
    planned: result.operations.length,
    applied: result.operations.filter((operation) => operation.status === 'applied').length,
    skipped: result.operations.filter((operation) => operation.status === 'skipped').length,
    conflicted: result.operations.filter((operation) => operation.status === 'conflicted').length,
    reverted: result.operations.filter((operation) => operation.status === 'reverted').length,
    failed: result.operations.filter((operation) => operation.status === 'failed').length,
    unknown: result.operations.filter((operation) => operation.status === 'unknown').length,
  }
  if (
    (Object.keys(counts) as Array<keyof typeof counts>).some(
      (key) => counts[key] !== result.summary[key],
    )
  ) {
    return false
  }
  for (const operation of result.operations) {
    if (
      ![
        operation.file,
        ...operation.path,
        operation.operationId,
        operation.occurrenceId,
        operation.sourceFileId,
        operation.name,
        operation.expectedValue,
        operation.requestedValue,
        operation.reason,
        ...(operation.observedValue === undefined ? [] : [operation.observedValue]),
      ].every(isContractSafeText)
    ) {
      return false
    }
    if (
      (operation.status === 'applied' || operation.status === 'skipped') &&
      (operation.observedValue !== operation.requestedValue ||
        operation.observedByteHash === undefined)
    ) {
      return false
    }
    if (operation.status === 'applied' && operation.expectedValue === operation.requestedValue) {
      return false
    }
    if (operation.status === 'skipped' && operation.expectedValue !== operation.requestedValue) {
      return false
    }
    if (
      operation.status === 'reverted' &&
      (operation.observedValue !== operation.expectedValue ||
        operation.observedByteHash === undefined)
    ) {
      return false
    }
  }
  if (
    (result.status === 'applied' || result.status === 'noop') &&
    (result.recovery.status !== 'not-needed' ||
      result.phases.some((entry) => entry.status === 'failed' || entry.status === 'unknown'))
  ) {
    return false
  }
  if (
    (result.recovery.status === 'partial' || result.recovery.status === 'unknown') &&
    (result.status === 'applied' || result.status === 'noop' || result.status === 'conflicted')
  ) {
    return false
  }
  if (
    result.status === 'unknown' &&
    result.operations.length === 0 &&
    !result.phases.some((entry) => entry.status === 'unknown')
  ) {
    return false
  }
  if (
    result.recovery.status === 'completed' &&
    result.operations.some(
      (operation) =>
        operation.status === 'applied' ||
        operation.status === 'skipped' ||
        operation.status === 'conflicted' ||
        operation.status === 'unknown',
    )
  ) {
    return false
  }
  const recoveryPhase = result.phases.find((entry) => entry.name === 'recovery')
  if (
    recoveryPhase &&
    ((result.recovery.status === 'completed' && recoveryPhase.status !== 'passed') ||
      (result.recovery.status === 'unknown' && recoveryPhase.status !== 'unknown') ||
      (result.recovery.status === 'partial' && recoveryPhase.status !== 'failed'))
  ) {
    return false
  }
  const hasManagerPhase = result.phases.some(
    (entry) =>
      entry.name === 'manager-preflight' ||
      entry.name === 'sync-lockfile' ||
      entry.name === 'install',
  )
  const hasInstallPhase = result.phases.some((entry) => entry.name === 'install')
  const hasVerifyPhase = result.phases.some((entry) => entry.name === 'verify')
  const hasArtifactPhase = result.phases.some((entry) => entry.name === 'artifact-verify')
  const expectedCapabilities: ApplyResult['requiredCapabilities'] = [
    'filesystem-read',
    'file-write',
  ]
  if (hasManagerPhase) expectedCapabilities.push('process-execute', 'lockfile-write')
  if (hasInstallPhase) expectedCapabilities.push('install')
  if (hasArtifactPhase) expectedCapabilities.push('artifact-verify', 'network-access')
  if (hasVerifyPhase) expectedCapabilities.push('verify-command')
  if (canonicalJson(expectedCapabilities) !== canonicalJson(result.requiredCapabilities)) {
    return false
  }
  for (const entry of result.phases) {
    if (
      entry.commands?.some((command) => {
        if (
          ![
            command.boundaryId,
            command.manager,
            command.managerVersion,
            command.cwd,
            command.executable,
            ...command.args,
            command.signal,
            command.lockfile?.path,
            command.lockfile?.byteHash,
            command.lockfile?.occurrences,
            ...command.changedPaths,
            ...command.unexpectedPaths,
            ...command.externalEffects,
          ]
            .filter((value): value is string => value !== undefined)
            .every(isContractSafeText)
        ) {
          return true
        }
        if (
          (command.termination === 'exit') !== (command.exitCode !== undefined) ||
          (command.termination === 'signal') !== (command.signal !== undefined)
        ) {
          return true
        }
        if (command.manager && !command.lockfile) return true
        if (command.lockfile?.parseState === 'parsed' && command.lockfile.byteHash === undefined) {
          return true
        }
        if (entry.status !== 'passed') return false
        if (entry.name === 'artifact-verify') {
          return !command.terminationConfirmed || command.unexpectedPaths.length > 0
        }
        return (
          command.termination !== 'exit' ||
          command.exitCode !== 0 ||
          !command.terminationConfirmed ||
          (command.manager !== undefined && command.lockfile?.parseState !== 'parsed') ||
          ((entry.name === 'sync-lockfile' || entry.name === 'install') &&
            command.lockfile?.occurrences !== 'matched') ||
          command.unexpectedPaths.length > 0
        )
      })
    ) {
      return false
    }
  }
  if (
    ![
      ...(result.recovery.journalId ? [result.recovery.journalId] : []),
      ...(result.recovery.restoredPaths ?? []),
      ...(result.recovery.unrecoveredPaths ?? []),
      ...(result.recovery.externalEffects ?? []),
    ].every(isContractSafeText)
  ) {
    return false
  }
  if (!hasValidApplyArtifactResults(result)) return false
  const expectedStatus =
    result.recovery.status === 'unknown'
      ? 'unknown'
      : counts.unknown > 0
        ? 'unknown'
        : counts.failed > 0
          ? 'failed'
          : counts.reverted > 0
            ? 'reverted'
            : counts.conflicted > 0
              ? 'conflicted'
              : counts.applied > 0
                ? 'applied'
                : 'noop'
  return result.status === expectedStatus
}

function hasValidApplyArtifactResults(result: ApplyResult): boolean {
  const artifactPhases = result.phases.filter((phase) => phase.name === 'artifact-verify')
  if (artifactPhases.length === 0) {
    return result.phases.every((phase) => phase.artifactResults === undefined)
  }
  const phase = artifactPhases[0]!
  if (phase.status === 'skipped') return phase.artifactResults === undefined
  const results = phase.artifactResults
  if (!results || results.length === 0) return phase.status === 'unknown'
  const installPhase = result.phases.find((entry) => entry.name === 'install')
  const commands = phase.commands
  if (
    result.operations.length === 0 ||
    installPhase?.status !== 'passed' ||
    !commands ||
    commands.length === 0
  ) {
    return false
  }
  const commandsByBoundary = new Map<string, (typeof commands)[number]>()
  for (const command of commands) {
    if (
      !command.boundaryId ||
      commandsByBoundary.has(command.boundaryId) ||
      command.manager !== 'npm' ||
      command.executable !== 'npm' ||
      !semver.satisfies(command.managerVersion ?? '', '>=11.12.0 <12.0.0') ||
      canonicalJson(command.args) !==
        canonicalJson([
          'audit',
          'signatures',
          '--json',
          '--include-attestations',
          '--ignore-scripts',
        ]) ||
      !command.lockfile ||
      !isNpmLockfileForCwd(command.lockfile.path, command.cwd) ||
      command.lockfile.parseState !== 'parsed' ||
      command.lockfile.occurrences !== 'matched'
    ) {
      return false
    }
    commandsByBoundary.set(command.boundaryId, command)
  }
  const keys = new Set<string>()
  for (const artifact of results) {
    const key = `${artifact.artifactId}\0${artifact.boundaryId}\0${artifact.location}`
    const command = commandsByBoundary.get(artifact.boundaryId)
    if (
      keys.has(key) ||
      !isCanonicalUtcInstant(artifact.observedAt) ||
      !command ||
      artifact.artifactId !==
        `artifact-${hashExactBytes(canonicalJson(artifactIdentity(artifact))).slice(0, 24)}` ||
      !semver.valid(artifact.version) ||
      !isExactSha512Integrity(artifact.integrity) ||
      artifact.verifier.name !== 'npm' ||
      artifact.verifier.version !== command.managerVersion ||
      artifact.lockfile.path !== command.lockfile?.path ||
      artifact.lockfile.byteHash !== command.lockfile.byteHash ||
      !isNpmInstallLocation(artifact.location)
    ) {
      return false
    }
    keys.add(key)
    if (
      ![
        artifact.artifactId,
        artifact.boundaryId,
        artifact.location,
        artifact.packageName,
        artifact.version,
        artifact.registry,
        artifact.integrity,
        artifact.lockfile.path,
        artifact.lockfile.byteHash,
        artifact.verifier.name,
        artifact.verifier.version,
        artifact.observedAt,
      ].every(isContractSafeText)
    ) {
      return false
    }
    for (const [family, dimension] of [
      ['signature-verification', artifact.signature],
      ['provenance-verification', artifact.provenance],
    ] as const) {
      const truth = SIGNAL_TRUTH[dimension.reason]
      if (
        truth[0] !== family ||
        truth[1] !== dimension.state ||
        new Set(dimension.matchedRuleIds).size !== dimension.matchedRuleIds.length ||
        (dimension.winningRuleId !== undefined &&
          dimension.winningRuleId !== dimension.matchedRuleIds.at(-1)) ||
        (dimension.matchedRuleIds.length === 0 &&
          dimension.effect !==
            (dimension.state === 'pass' || dimension.state === 'not-applicable'
              ? 'none'
              : 'warn')) ||
        (dimension.matchedRuleIds.length > 0 && dimension.winningRuleId === undefined)
      ) {
        return false
      }
    }
    if (!trustReasonsMatchCommand(command, artifact.signature.reason, artifact.provenance.reason)) {
      return false
    }
  }
  const blocked = results.some(
    (artifact) => artifact.signature.effect === 'block' || artifact.provenance.effect === 'block',
  )
  const safetyStatus = {
    ARTIFACT_VERIFIER_CLEANUP_FAILED: 'unknown',
    ARTIFACT_VERIFIER_MUTATED_REPOSITORY: 'failed',
    ARTIFACT_VERIFICATION_STATE_CHANGED: 'unknown',
    ARTIFACT_BINDING_FAILED: 'unknown',
  }[phase.reason]
  return (
    commandsByBoundary.size === new Set(results.map((artifact) => artifact.boundaryId)).size &&
    (safetyStatus
      ? phase.status === safetyStatus
      : blocked
        ? phase.status === 'failed' && phase.reason === 'ARTIFACT_POLICY_BLOCKED'
        : phase.status === 'passed' && phase.reason === 'ARTIFACT_VERIFICATION_RECORDED')
  )
}

function trustReasonsMatchCommand(
  command: NonNullable<ApplyResult['phases'][number]['commands']>[number],
  signatureReason: string,
  provenanceReason: string,
): boolean {
  const signatureFailure = verifierFailureKind(signatureReason)
  const provenanceFailure = verifierFailureKind(provenanceReason)
  const completedOutput =
    command.termination === 'exit' && (command.exitCode === 0 || command.exitCode === 1)
  if (signatureFailure === undefined && provenanceFailure === undefined) return completedOutput
  if (signatureFailure !== provenanceFailure) return false
  if (signatureFailure === 'unavailable') return command.termination === 'unavailable'
  if (signatureFailure === 'offline' || signatureFailure === 'stale') return completedOutput
  return signatureFailure === 'error' && command.termination !== 'unavailable'
}

function verifierFailureKind(
  reason: string,
): 'unavailable' | 'offline' | 'stale' | 'error' | undefined {
  if (reason.endsWith('_VERIFIER_UNAVAILABLE')) return 'unavailable'
  if (reason.endsWith('_VERIFIER_OFFLINE')) return 'offline'
  if (reason.endsWith('_VERIFIER_STALE')) return 'stale'
  if (reason.endsWith('_VERIFIER_ERROR')) return 'error'
  return undefined
}

function isNpmLockfileForCwd(path: string, cwd: string): boolean {
  const prefix = cwd === '.' ? '' : `${cwd}/`
  return path === `${prefix}package-lock.json` || path === `${prefix}npm-shrinkwrap.json`
}

function isNpmInstallLocation(path: string): boolean {
  return /^(?:[^/]+\/)*node_modules\/(?:@[^/]+\/)?[^/]+$/u.test(path)
}

function hasValidPlanSemantics(plan: PlanResult): boolean {
  try {
    const parsedAsOf = Date.parse(plan.asOf)
    if (!Number.isFinite(parsedAsOf) || new Date(parsedAsOf).toISOString() !== plan.asOf) {
      return false
    }
    if (createPlanFingerprint(plan) !== plan.planFingerprint) return false
    if (!hasValidRepositorySemantics(plan.repository)) return false
    if (!hasValidReferences(plan)) return false

    const occurrenceIds = new Set(plan.occurrences.map((occurrence) => occurrence.id))
    if (occurrenceIds.size !== plan.occurrences.length) return false
    const decisionsByOccurrence = new Map(
      plan.decisions.map((decision) => [decision.occurrenceId, decision]),
    )
    if (
      decisionsByOccurrence.size !== plan.decisions.length ||
      decisionsByOccurrence.size !== occurrenceIds.size ||
      [...occurrenceIds].some((id) => !decisionsByOccurrence.has(id))
    ) {
      return false
    }

    const operationIds = new Set<string>()
    const operationsById = new Map<string, (typeof plan.operations)[number]>()
    const operationOccurrences = new Set<string>()
    const repositorySources = new Map(
      plan.repository.sources.map((source) => [source.path, source.byteHash]),
    )
    for (const operation of plan.operations) {
      if (operationIds.has(operation.id) || operationOccurrences.has(operation.occurrenceId)) {
        return false
      }
      operationIds.add(operation.id)
      operationsById.set(operation.id, operation)
      operationOccurrences.add(operation.occurrenceId)
      const occurrence = plan.occurrences.find(
        (candidate) => candidate.id === operation.occurrenceId,
      )
      const decision = decisionsByOccurrence.get(operation.occurrenceId)
      if (
        !(occurrence && decision) ||
        decision.status !== 'operation' ||
        decision.operationId !== operation.id ||
        occurrence.sourceFileId !== operation.sourceFileId ||
        occurrence.file !== operation.file ||
        occurrence.name !== operation.name ||
        JSON.stringify(occurrence.path) !== JSON.stringify(operation.path) ||
        occurrence.declaredValue !== operation.expectedValue ||
        repositorySources.get(operation.file) !== operation.sourceByteHash
      ) {
        return false
      }
      const { id: _id, ...operationBase } = operation
      const expectedId = `operation-${hashExactBytes(canonicalJson(operationBase)).slice(0, 24)}`
      if (operation.id !== expectedId) return false
    }
    for (const decision of plan.decisions) {
      if (
        decision.candidate?.targetVersion !== undefined &&
        !decision.candidate.eligibleVersions.includes(decision.candidate.targetVersion)
      ) {
        return false
      }
      if (decision.status === 'operation') {
        const operation = decision.operationId
          ? operationsById.get(decision.operationId)
          : undefined
        if (!operation || operation.occurrenceId !== decision.occurrenceId) return false
      } else if (decision.operationId !== undefined) {
        return false
      }
    }

    const counts = {
      total: plan.decisions.length,
      operations: plan.decisions.filter((decision) => decision.status === 'operation').length,
      unchanged: plan.decisions.filter((decision) => decision.status === 'unchanged').length,
      skipped: plan.decisions.filter((decision) => decision.status === 'skipped').length,
      blocked: plan.decisions.filter((decision) => decision.status === 'blocked').length,
      unknown: plan.decisions.filter((decision) => decision.status === 'unknown').length,
      errors: plan.decisions.filter((decision) => decision.status === 'error').length,
    }
    const expectedErrorOccurrences = new Set(
      plan.decisions
        .filter((decision) => decision.status === 'unknown' || decision.status === 'error')
        .map((decision) => decision.occurrenceId),
    )
    if (
      plan.errors.length !== expectedErrorOccurrences.size ||
      plan.errors.some(
        (error) =>
          error.fatal || !error.occurrenceId || !expectedErrorOccurrences.has(error.occurrenceId),
      )
    ) {
      return false
    }
    if (!hasValidPlanSignals(plan)) return false
    if (!hasValidPlanExecution(plan)) return false
    return (
      counts.operations === plan.operations.length &&
      (Object.keys(counts) as Array<keyof typeof counts>).every(
        (key) => counts[key] === plan.summary[key],
      )
    )
  } catch {
    return false
  }
}

function hasValidPlanSignals(plan: PlanResult): boolean {
  const fields = [plan.signals, plan.signalEvidence, plan.summary.signals]
  if (fields.every((field) => field === undefined)) return true
  if (fields.some((field) => field === undefined)) return false
  const signals = plan.signals!
  const signalEvidence = plan.signalEvidence!
  const summary = plan.summary.signals!
  const occurrenceIds = new Set(plan.occurrences.map((occurrence) => occurrence.id))
  const runtimeIds = new Set(plan.repository.runtimeDeclarations.map((item) => item.id))
  const repositoryEvidenceIds = new Set(plan.evidence.map((item) => item.id))
  if (!(isSortedById(signalEvidence) && isSortedById(signals))) {
    return false
  }
  const evidenceIds = new Set<string>()
  for (const evidence of signalEvidence) {
    if (evidenceIds.has(evidence.id)) return false
    evidenceIds.add(evidence.id)
    const { id: _id, ...semantic } = evidence
    if (`signal-evidence-${hashExactBytes(canonicalJson(semantic)).slice(0, 24)}` !== evidence.id) {
      return false
    }
    if (
      new Set(evidence.sourceRefs).size !== evidence.sourceRefs.length ||
      evidence.sourceRefs.some(
        (ref) => !(occurrenceIds.has(ref) || runtimeIds.has(ref) || repositoryEvidenceIds.has(ref)),
      ) ||
      ![
        evidence.id,
        evidence.kind,
        evidence.status,
        evidence.subject,
        ...evidence.sourceRefs,
        ...Object.keys(evidence.facts),
        ...Object.values(evidence.facts),
      ].every(isContractSafeText)
    ) {
      return false
    }
  }
  const signalIds = new Set<string>()
  const signalEvidenceById = new Map(signalEvidence.map((item) => [item.id, item]))
  for (const signal of signals) {
    if (signalIds.has(signal.id)) return false
    signalIds.add(signal.id)
    const { id: _id, ...semantic } = signal
    if (`signal-${hashExactBytes(canonicalJson(semantic)).slice(0, 24)}` !== signal.id) return false
    if (
      (signal.subject.occurrenceIds.length === 0 && !signal.subject.cohortId) ||
      new Set(signal.subject.occurrenceIds).size !== signal.subject.occurrenceIds.length ||
      signal.subject.occurrenceIds.some((id) => !occurrenceIds.has(id)) ||
      new Set(signal.evidenceRefs).size !== signal.evidenceRefs.length ||
      signal.evidenceRefs.some((id) => !evidenceIds.has(id)) ||
      new Set(signal.matchedRuleIds).size !== signal.matchedRuleIds.length ||
      ![
        signal.id,
        signal.family,
        signal.state,
        signal.reason,
        ...(signal.subject.dependencyName ? [signal.subject.dependencyName] : []),
        ...(signal.subject.workspacePath ? [signal.subject.workspacePath] : []),
        ...(signal.subject.cohortId ? [signal.subject.cohortId] : []),
        ...signal.subject.occurrenceIds,
        ...signal.evidenceRefs,
        ...signal.matchedRuleIds,
        ...(signal.winningRuleId ? [signal.winningRuleId] : []),
        ...(signal.override
          ? [
              signal.override.ruleId,
              signal.override.source,
              signal.override.from,
              signal.override.to,
            ]
          : []),
      ].every(isContractSafeText) ||
      !hasValidSignalTruth(signal) ||
      !hasValidSignalEvidenceTruth(signal, signalEvidenceById, plan) ||
      !hasValidSignalSubject(signal, signalEvidenceById, plan)
    ) {
      return false
    }
    if (
      (signal.winningRuleId !== undefined &&
        signal.matchedRuleIds.at(-1) !== signal.winningRuleId) ||
      (signal.override !== undefined &&
        (signal.override.ruleId !== signal.winningRuleId || signal.override.to !== signal.effect))
    ) {
      return false
    }
    const defaultEffect = defaultSignalEffect(signal)
    const inferred = signal.reason === 'COHORT_INFERRED_SUGGESTION'
    if (
      (inferred &&
        (signal.effect !== 'warn' ||
          signal.matchedRuleIds.length > 0 ||
          signal.winningRuleId !== undefined ||
          signal.override !== undefined)) ||
      (signal.matchedRuleIds.length === 0 &&
        (signal.winningRuleId !== undefined ||
          signal.override !== undefined ||
          signal.effect !== defaultEffect)) ||
      (signal.matchedRuleIds.length > 0 && signal.winningRuleId === undefined) ||
      (signal.override !== undefined &&
        (signal.override.from !== defaultEffect ||
          signal.override.from === signal.override.to ||
          signal.effect === defaultEffect)) ||
      (signal.override === undefined && signal.effect !== defaultEffect) ||
      (signal.effect === 'block' &&
        signal.subject.occurrenceIds.some((id) =>
          plan.operations.some((operation) => operation.occurrenceId === id),
        ))
    ) {
      return false
    }
  }
  const blockedBySignals = new Set(
    signals
      .filter((signal) => signal.effect === 'block')
      .flatMap((signal) => signal.subject.occurrenceIds),
  )
  if (
    plan.decisions.some(
      (decision) =>
        decision.reason === 'SIGNAL_POLICY_BLOCKED' && !blockedBySignals.has(decision.occurrenceId),
    )
  ) {
    return false
  }
  const expected = {
    total: signals.length,
    pass: signals.filter((signal) => signal.state === 'pass').length,
    warn: signals.filter((signal) => signal.state === 'warn').length,
    fail: signals.filter((signal) => signal.state === 'fail').length,
    unknown: signals.filter((signal) => signal.state === 'unknown').length,
    notApplicable: signals.filter((signal) => signal.state === 'not-applicable').length,
    blocking: signals.filter((signal) => signal.effect === 'block').length,
  }
  return (Object.keys(expected) as Array<keyof typeof expected>).every(
    (key) => expected[key] === summary[key],
  )
}

const SIGNAL_TRUTH = {
  RUNTIME_COMPATIBLE: ['runtime', 'pass'],
  RUNTIME_PARTIAL_OVERLAP: ['runtime', 'warn'],
  RUNTIME_INCOMPATIBLE: ['runtime', 'fail'],
  RUNTIME_UNCONSTRAINED: ['runtime', 'not-applicable'],
  RUNTIME_EVIDENCE_UNKNOWN: ['runtime', 'unknown'],
  TARGET_ENGINE_UNKNOWN: ['runtime', 'unknown'],
  PEER_COMPATIBLE: ['peer', 'pass'],
  PEER_PARTIAL_OVERLAP: ['peer', 'warn'],
  PEER_INCOMPATIBLE: ['peer', 'fail'],
  PEER_REQUIRED_MISSING: ['peer', 'fail'],
  PEER_OPTIONAL_MISSING: ['peer', 'not-applicable'],
  PEER_METADATA_ABSENT: ['peer', 'not-applicable'],
  PEER_EVIDENCE_UNKNOWN: ['peer', 'unknown'],
  COHORT_ALIGNED: ['cohort', 'pass'],
  COHORT_DIVERGED: ['cohort', 'fail'],
  COHORT_MEMBER_UNKNOWN: ['cohort', 'unknown'],
  COHORT_INFERRED_SUGGESTION: ['cohort', 'warn'],
  TARGET_STABLE: ['release-channel', 'pass'],
  TARGET_PRERELEASE: ['release-channel', 'warn'],
  TARGET_VERSION_UNKNOWN: ['release-channel', 'unknown'],
  MATURITY_POLICY_DISABLED: ['maturity', 'not-applicable'],
  TARGET_MATURE: ['maturity', 'pass'],
  TARGET_TOO_NEW: ['maturity', 'fail'],
  TARGET_TIME_UNKNOWN: ['maturity', 'unknown'],
  CURRENT_NOT_DEPRECATED: ['current-deprecation', 'pass'],
  CURRENT_DEPRECATED: ['current-deprecation', 'warn'],
  CURRENT_VERSION_UNKNOWN: ['current-deprecation', 'unknown'],
  CURRENT_DEPRECATION_UNKNOWN: ['current-deprecation', 'unknown'],
  TARGET_NOT_DEPRECATED: ['target-deprecation', 'pass'],
  TARGET_DEPRECATED: ['target-deprecation', 'fail'],
  TARGET_DEPRECATION_UNKNOWN: ['target-deprecation', 'unknown'],
  SIGNATURE_PRESENT_UNVERIFIED: ['signature-presence', 'warn'],
  SIGNATURE_METADATA_ABSENT: ['signature-presence', 'warn'],
  SIGNATURE_METADATA_UNKNOWN: ['signature-presence', 'unknown'],
  PROVENANCE_PRESENT_UNVERIFIED: ['provenance-presence', 'warn'],
  PROVENANCE_METADATA_ABSENT: ['provenance-presence', 'warn'],
  PROVENANCE_METADATA_UNKNOWN: ['provenance-presence', 'unknown'],
  SIGNATURE_INVALID: ['signature-verification', 'fail'],
  SIGNATURE_MISSING: ['signature-verification', 'fail'],
  SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE: ['signature-verification', 'unknown'],
  SIGNATURE_VERIFIER_UNAVAILABLE: ['signature-verification', 'unknown'],
  SIGNATURE_VERIFIER_ERROR: ['signature-verification', 'unknown'],
  SIGNATURE_VERIFIER_OFFLINE: ['signature-verification', 'unknown'],
  SIGNATURE_VERIFIER_STALE: ['signature-verification', 'unknown'],
  PROVENANCE_INVALID: ['provenance-verification', 'fail'],
  PROVENANCE_NOT_PRESENT: ['provenance-verification', 'not-applicable'],
  PROVENANCE_VERIFIED: ['provenance-verification', 'pass'],
  PROVENANCE_ARTIFACT_MISMATCH: ['provenance-verification', 'unknown'],
  PROVENANCE_VERIFICATION_UNAVAILABLE: ['provenance-verification', 'unknown'],
  PROVENANCE_PRESENCE_UNKNOWN: ['provenance-verification', 'unknown'],
  PROVENANCE_VERIFIER_UNAVAILABLE: ['provenance-verification', 'unknown'],
  PROVENANCE_VERIFIER_ERROR: ['provenance-verification', 'unknown'],
  PROVENANCE_VERIFIER_OFFLINE: ['provenance-verification', 'unknown'],
  PROVENANCE_VERIFIER_STALE: ['provenance-verification', 'unknown'],
  REGISTRY_EVIDENCE_COMPLETE: ['evidence-completeness', 'pass'],
  REGISTRY_EVIDENCE_UNKNOWN: ['evidence-completeness', 'unknown'],
  STALENESS_NOT_OBSERVED: ['evidence-staleness', 'not-applicable'],
} as const

function hasValidSignalTruth(signal: NonNullable<PlanResult['signals']>[number]): boolean {
  const expected = SIGNAL_TRUTH[signal.reason]
  return expected[0] === signal.family && expected[1] === signal.state
}

function hasValidSignalSubject(
  signal: NonNullable<PlanResult['signals']>[number],
  evidenceById: Map<string, NonNullable<PlanResult['signalEvidence']>[number]>,
  plan: PlanResult,
): boolean {
  const occurrences = signal.subject.occurrenceIds.map((id) =>
    plan.occurrences.find((item) => item.id === id),
  )
  if (occurrences.some((item) => !item)) return false
  const resolved = occurrences as PlanResult['occurrences']
  if (
    signal.subject.dependencyName !== undefined &&
    resolved.some((occurrence) => occurrence.name !== signal.subject.dependencyName)
  ) {
    return false
  }
  if (signal.subject.workspacePath !== undefined) {
    const packages = new Map(plan.repository.packages.map((item) => [item.id, item.workspacePath]))
    if (
      resolved.some(
        (occurrence) => packages.get(occurrence.ownerId) !== signal.subject.workspacePath,
      )
    ) {
      return false
    }
  }
  const evidence = signal.evidenceRefs
    .map((id) => evidenceById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (signal.family === 'cohort') {
    if (!signal.subject.cohortId || evidence.length !== 1) return false
    const cohort = evidence[0]
    return (
      (cohort?.kind === 'explicit-cohort' || cohort?.kind === 'inferred-cohort') &&
      (cohort.kind === 'explicit-cohort'
        ? cohort.subject === signal.subject.cohortId
        : `inferred-${cohort.subject}` === signal.subject.cohortId) &&
      canonicalJson([...cohort.sourceRefs].sort()) ===
        canonicalJson([...signal.subject.occurrenceIds].sort())
    )
  }
  if (
    signal.subject.cohortId !== undefined ||
    signal.subject.occurrenceIds.length !== 1 ||
    signal.subject.dependencyName === undefined
  ) {
    return false
  }
  const occurrenceId = signal.subject.occurrenceIds[0]!
  const occurrence = resolved[0]!
  const workspacePath = plan.repository.packages.find(
    (item) => item.id === occurrence.ownerId,
  )?.workspacePath
  if (
    workspacePath === undefined
      ? signal.subject.workspacePath !== undefined
      : signal.subject.workspacePath !== workspacePath
  ) {
    return false
  }
  return evidence.every((item) => {
    if (item.kind === 'planned-graph') return item.sourceRefs.includes(occurrenceId)
    return item.subject === occurrenceId
  })
}

function hasValidSignalEvidenceTruth(
  signal: NonNullable<PlanResult['signals']>[number],
  evidenceById: Map<string, NonNullable<PlanResult['signalEvidence']>[number]>,
  plan: PlanResult,
): boolean {
  const evidence = signal.evidenceRefs
    .map((id) => evidenceById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (evidence.length !== signal.evidenceRefs.length) return false
  const one = (kind: (typeof evidence)[number]['kind']) =>
    evidence.length === 1 && evidence[0]?.kind === kind ? evidence[0] : undefined
  const registry = evidence.find((item) => item.kind === 'registry-version')
  const graph = evidence.find((item) => item.kind === 'planned-graph')
  const runtime = one('repository-runtime')
  const runtimeProjection = runtime
    ? validateRuntimeEvidenceProjection(runtime, signal, plan)
    : undefined
  const peerProjectionValid = graph ? validatePeerEvidenceProjection(graph, signal, plan) : false
  const registryOnly = one('registry-version')
  const registryTargetValid = registry
    ? hasValidTargetRegistryProjection(registry, signal, plan)
    : false

  switch (signal.reason) {
    case 'RUNTIME_COMPATIBLE':
    case 'RUNTIME_PARTIAL_OVERLAP':
    case 'RUNTIME_INCOMPATIBLE': {
      if (runtime?.status !== 'observed') return false
      const target = semver.validRange(runtime.facts.targetEngine)
      const ranges = runtimeFactValues(runtime, 'repositoryRange.')
      if (!(target && ranges.length > 0 && runtimeProjection?.complete)) {
        return false
      }
      const validRanges = ranges.map((range) => semver.validRange(range))
      if (validRanges.some((range) => !range)) return false
      const normalized = validRanges as string[]
      if (
        normalized.some((range, index) =>
          normalized.slice(index + 1).some((other) => !semver.intersects(range, other)),
        )
      ) {
        return false
      }
      const disjoint = normalized.some((range) => !semver.intersects(range, target))
      const subset = normalized.every((range) => semver.subset(range, target))
      return (
        signal.reason ===
        (disjoint
          ? 'RUNTIME_INCOMPATIBLE'
          : subset
            ? 'RUNTIME_COMPATIBLE'
            : 'RUNTIME_PARTIAL_OVERLAP')
      )
    }
    case 'RUNTIME_UNCONSTRAINED':
      return (
        runtime?.status === 'absent' &&
        runtime.facts.targetEngine === 'absent' &&
        runtimeProjection?.complete === true
      )
    case 'RUNTIME_EVIDENCE_UNKNOWN':
      return (
        runtimeProjection !== undefined &&
        (runtime?.status === 'unknown' || runtime?.status === 'conflicting')
      )
    case 'TARGET_ENGINE_UNKNOWN':
      return (
        runtime?.status === 'unknown' &&
        runtime.facts.targetEngine === 'unknown' &&
        runtimeProjection?.complete === true
      )
    case 'PEER_COMPATIBLE':
    case 'PEER_PARTIAL_OVERLAP':
    case 'PEER_INCOMPATIBLE': {
      const required = semver.validRange(graph?.facts.requiredRange)
      const provider = semver.validRange(graph?.facts.providerRange)
      if (
        !(
          evidence.length === 2 &&
          registryTargetValid &&
          registry?.status === 'observed' &&
          Boolean(semver.valid(registry.facts.targetVersion)) &&
          registry?.facts.peerMetadata === 'present' &&
          peerProjectionValid &&
          graph?.status === 'observed' &&
          graph.facts.providerRange !== 'missing' &&
          graph.facts.providers === '1' &&
          graph.facts.overrideConstraints === '0' &&
          required &&
          provider
        )
      ) {
        return false
      }
      const intersects = semver.intersects(provider, required)
      const subset = semver.subset(provider, required)
      return (
        signal.reason ===
        (!intersects ? 'PEER_INCOMPATIBLE' : subset ? 'PEER_COMPATIBLE' : 'PEER_PARTIAL_OVERLAP')
      )
    }
    case 'PEER_REQUIRED_MISSING':
    case 'PEER_OPTIONAL_MISSING':
      return (
        evidence.length === 2 &&
        registryTargetValid &&
        registry?.status === 'observed' &&
        Boolean(semver.valid(registry.facts.targetVersion)) &&
        registry?.facts.peerMetadata === 'present' &&
        peerProjectionValid &&
        graph?.status === 'absent' &&
        graph.facts.providerRange === 'missing' &&
        graph.facts.providers === '0' &&
        graph.facts.boundaryProviders === '0' &&
        graph.facts.overrideConstraints === '0' &&
        graph.facts.optional === (signal.reason === 'PEER_OPTIONAL_MISSING' ? 'yes' : 'no')
      )
    case 'PEER_METADATA_ABSENT':
      return (
        registryTargetValid &&
        registryOnly?.status === 'observed' &&
        Boolean(semver.valid(registryOnly.facts.targetVersion)) &&
        registryOnly.facts.peerMetadata === 'absent'
      )
    case 'PEER_EVIDENCE_UNKNOWN':
      return (
        (registryOnly?.facts.peerMetadata === 'unknown' &&
          registryTargetValid &&
          hasKnownOrUnknownRegistryTarget(registryOnly)) ||
        (evidence.length === 2 &&
          registryTargetValid &&
          registry?.status === 'observed' &&
          Boolean(semver.valid(registry.facts.targetVersion)) &&
          registry?.facts.peerMetadata === 'present' &&
          graph !== undefined &&
          peerProjectionValid &&
          hasRecordedGraphAmbiguity(graph))
      )
    case 'COHORT_ALIGNED':
    case 'COHORT_DIVERGED': {
      const cohort = one('explicit-cohort')
      const aligned = cohort ? evaluateSerializedCohort(cohort, plan) : undefined
      return (
        cohort?.status === 'observed' &&
        ['config', 'library', 'cli'].includes(cohort.facts.source ?? '') &&
        aligned !== undefined &&
        (signal.reason === 'COHORT_ALIGNED' ? aligned : !aligned)
      )
    }
    case 'COHORT_MEMBER_UNKNOWN': {
      const cohort = one('explicit-cohort')
      return cohort?.status === 'unknown' && evaluateSerializedCohort(cohort, plan) === undefined
    }
    case 'COHORT_INFERRED_SUGGESTION': {
      const cohort = one('inferred-cohort')
      return (
        cohort?.status === 'observed' &&
        cohort.facts.sharedRepository === 'present' &&
        /^[a-f0-9]{64}$/u.test(cohort.facts.repositoryIdentity ?? '')
      )
    }
    case 'TARGET_STABLE':
    case 'TARGET_PRERELEASE': {
      const target = semver.parse(registryOnly?.facts.targetVersion)
      return (
        registryTargetValid &&
        registryOnly?.status === 'observed' &&
        Boolean(target) &&
        (signal.reason === 'TARGET_STABLE'
          ? target!.prerelease.length === 0
          : target!.prerelease.length > 0)
      )
    }
    case 'TARGET_VERSION_UNKNOWN':
      return (
        registryTargetValid &&
        registryOnly?.status === 'unknown' &&
        registryOnly.facts.targetVersion === 'unknown'
      )
    case 'MATURITY_POLICY_DISABLED':
      return (
        registryTargetValid &&
        registryOnly?.facts.cooldownDays === '0' &&
        isCanonicalUtcInstant(registryOnly.facts.asOf)
      )
    case 'TARGET_MATURE':
    case 'TARGET_TOO_NEW': {
      const publishedAt = Date.parse(registryOnly?.facts.publishedAt ?? '')
      const asOf = Date.parse(registryOnly?.facts.asOf ?? '')
      const cooldownDays = Number(registryOnly?.facts.cooldownDays)
      if (
        !(
          registryOnly?.status === 'observed' &&
          registryTargetValid &&
          Boolean(semver.valid(registryOnly.facts.targetVersion)) &&
          isCanonicalUtcInstant(registryOnly?.facts.publishedAt) &&
          isCanonicalUtcInstant(registryOnly?.facts.asOf) &&
          isPositiveSafeIntegerText(registryOnly?.facts.cooldownDays) &&
          Number.isFinite(publishedAt) &&
          Number.isFinite(asOf) &&
          Number.isSafeInteger(cooldownDays)
        ) ||
        cooldownDays < 0
      ) {
        return false
      }
      const mature = publishedAt <= asOf - cooldownDays * 24 * 60 * 60 * 1000
      return signal.reason === 'TARGET_MATURE' ? mature : !mature
    }
    case 'TARGET_TIME_UNKNOWN':
      return (
        registryOnly?.facts.publishedAt === 'unknown' &&
        registryTargetValid &&
        hasKnownOrUnknownRegistryTarget(registryOnly) &&
        isCanonicalUtcInstant(registryOnly.facts.asOf) &&
        isPositiveSafeIntegerText(registryOnly.facts.cooldownDays)
      )
    case 'CURRENT_NOT_DEPRECATED':
    case 'CURRENT_DEPRECATED':
    case 'CURRENT_VERSION_UNKNOWN':
    case 'CURRENT_DEPRECATION_UNKNOWN': {
      const currentVersion = expectedCurrentSignalVersion(signal, plan)
      return (
        registryOnly?.facts.versionRole === 'current' &&
        (signal.reason === 'CURRENT_VERSION_UNKNOWN'
          ? currentVersion === undefined &&
            registryOnly.facts.targetVersion === 'unknown' &&
            registryOnly.status === 'unknown'
          : currentVersion !== undefined &&
            registryOnly.facts.targetVersion === currentVersion &&
            registryOnly.status === 'observed') &&
        registryOnly.facts.deprecation ===
          (signal.reason === 'CURRENT_NOT_DEPRECATED'
            ? 'absent'
            : signal.reason === 'CURRENT_DEPRECATED'
              ? 'present'
              : 'unknown')
      )
    }
    case 'TARGET_NOT_DEPRECATED':
    case 'TARGET_DEPRECATED':
    case 'TARGET_DEPRECATION_UNKNOWN':
      return (
        registryTargetValid &&
        registryOnly?.facts.versionRole === 'target' &&
        (signal.reason === 'TARGET_DEPRECATION_UNKNOWN'
          ? registryOnly.facts.targetVersion === 'unknown'
            ? registryOnly.status === 'unknown'
            : Boolean(semver.valid(registryOnly.facts.targetVersion)) &&
              registryOnly.status === 'observed'
          : Boolean(semver.valid(registryOnly.facts.targetVersion)) &&
            registryOnly.status === 'observed') &&
        registryOnly.facts.deprecation ===
          (signal.reason === 'TARGET_NOT_DEPRECATED'
            ? 'absent'
            : signal.reason === 'TARGET_DEPRECATED'
              ? 'present'
              : 'unknown')
      )
    case 'SIGNATURE_PRESENT_UNVERIFIED':
    case 'SIGNATURE_METADATA_ABSENT':
    case 'SIGNATURE_METADATA_UNKNOWN':
      return hasValidPassiveRegistryFact(
        registryOnly,
        'signaturePresence',
        registryTargetValid,
        registryOnly?.facts.signaturePresence ===
          (signal.reason === 'SIGNATURE_PRESENT_UNVERIFIED'
            ? 'present'
            : signal.reason === 'SIGNATURE_METADATA_ABSENT'
              ? 'absent'
              : 'unknown'),
      )
    case 'PROVENANCE_PRESENT_UNVERIFIED':
    case 'PROVENANCE_METADATA_ABSENT':
    case 'PROVENANCE_METADATA_UNKNOWN':
      return hasValidPassiveRegistryFact(
        registryOnly,
        'provenancePresence',
        registryTargetValid,
        registryOnly?.facts.provenancePresence ===
          (signal.reason === 'PROVENANCE_PRESENT_UNVERIFIED'
            ? 'present'
            : signal.reason === 'PROVENANCE_METADATA_ABSENT'
              ? 'absent'
              : 'unknown'),
      )
    case 'REGISTRY_EVIDENCE_COMPLETE':
      return registryOnly?.status === 'observed' && registryOnly.facts.metadata === 'available'
    case 'REGISTRY_EVIDENCE_UNKNOWN':
      return registryOnly?.status === 'unknown' && registryOnly.facts.metadata === 'unavailable'
    case 'STALENESS_NOT_OBSERVED': {
      const clock = one('clock')
      return clock?.status === 'absent' && clock.facts.observation === 'not-recorded'
    }
    case 'SIGNATURE_INVALID':
    case 'SIGNATURE_MISSING':
    case 'SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE':
    case 'SIGNATURE_VERIFIER_UNAVAILABLE':
    case 'SIGNATURE_VERIFIER_ERROR':
    case 'SIGNATURE_VERIFIER_OFFLINE':
    case 'SIGNATURE_VERIFIER_STALE':
    case 'PROVENANCE_INVALID':
    case 'PROVENANCE_NOT_PRESENT':
    case 'PROVENANCE_VERIFIED':
    case 'PROVENANCE_ARTIFACT_MISMATCH':
    case 'PROVENANCE_VERIFICATION_UNAVAILABLE':
    case 'PROVENANCE_PRESENCE_UNKNOWN':
    case 'PROVENANCE_VERIFIER_UNAVAILABLE':
    case 'PROVENANCE_VERIFIER_ERROR':
    case 'PROVENANCE_VERIFIER_OFFLINE':
    case 'PROVENANCE_VERIFIER_STALE':
      return false
  }
}

function runtimeFactValues(
  evidence: NonNullable<PlanResult['signalEvidence']>[number],
  prefix: string,
): string[] {
  return Object.entries(evidence.facts)
    .filter(([key]) => key.startsWith(prefix))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
}

function hasRecordedGraphAmbiguity(
  evidence: NonNullable<PlanResult['signalEvidence']>[number],
): boolean {
  const providers = Number(evidence.facts.providers)
  const boundaryProviders = Number(evidence.facts.boundaryProviders)
  const overrides = Number(evidence.facts.overrideConstraints)
  if (
    ![providers, boundaryProviders, overrides].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    return false
  }
  if (evidence.status === 'conflicting') return providers > 1 || overrides > 0
  if (evidence.status !== 'unknown') return false
  return (
    (providers === 0 && boundaryProviders > 0) ||
    (providers === 1 && !semver.validRange(evidence.facts.providerRange))
  )
}

function isCanonicalUtcInstant(value: string | undefined): boolean {
  if (value === undefined) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function isPositiveSafeIntegerText(value: string | undefined): boolean {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) return false
  return Number.isSafeInteger(Number(value))
}

function hasKnownOrUnknownRegistryTarget(
  evidence: NonNullable<PlanResult['signalEvidence']>[number],
): boolean {
  return evidence.facts.targetVersion === 'unknown'
    ? evidence.status === 'unknown'
    : evidence.status === 'observed' && Boolean(semver.valid(evidence.facts.targetVersion))
}

function hasValidPassiveRegistryFact(
  evidence: NonNullable<PlanResult['signalEvidence']>[number] | undefined,
  fact: 'signaturePresence' | 'provenancePresence',
  targetProjectionValid: boolean,
  matchesReason: boolean,
): boolean {
  if (!(evidence && targetProjectionValid && matchesReason)) return false
  const presence = evidence.facts[fact]
  return presence === 'unknown'
    ? hasKnownOrUnknownRegistryTarget(evidence)
    : evidence.status === 'observed' && Boolean(semver.valid(evidence.facts.targetVersion))
}

function hasValidTargetRegistryProjection(
  evidence: NonNullable<PlanResult['signalEvidence']>[number],
  signal: NonNullable<PlanResult['signals']>[number],
  plan: PlanResult,
): boolean {
  const expected = expectedSignalTarget(signal, plan)
  return (
    evidence.facts.targetVersion === (expected ?? 'unknown') &&
    (expected ? evidence.status === 'observed' : evidence.status === 'unknown')
  )
}

function expectedSignalTarget(
  signal: NonNullable<PlanResult['signals']>[number],
  plan: PlanResult,
): string | undefined {
  const occurrence = plan.occurrences.find((item) => item.id === signal.subject.occurrenceIds[0])
  if (!occurrence) return undefined
  const candidate = plan.decisions.find((item) => item.occurrenceId === occurrence.id)?.candidate
    ?.targetVersion
  if (candidate && semver.valid(candidate)) return candidate
  return exactDeclaredVersion(occurrence.declaredValue, occurrence.role)
}

function expectedCurrentSignalVersion(
  signal: NonNullable<PlanResult['signals']>[number],
  plan: PlanResult,
): string | undefined {
  const occurrence = plan.occurrences.find((item) => item.id === signal.subject.occurrenceIds[0])
  if (!occurrence) return undefined
  return exactDeclaredVersion(occurrence.declaredValue, occurrence.role)
}

function validatePeerEvidenceProjection(
  evidence: NonNullable<PlanResult['signalEvidence']>[number],
  signal: NonNullable<PlanResult['signals']>[number],
  plan: PlanResult,
): boolean {
  const primary = plan.occurrences.find((item) => item.id === signal.subject.occurrenceIds[0])
  const peerName = evidence.facts.peer
  if (!(primary && peerName)) return false
  const contexts =
    primary.role === 'catalog-owner'
      ? plan.occurrences.filter(
          (item) =>
            item.role === 'catalog-consumer' &&
            item.catalogId === primary.catalogId &&
            item.name === primary.name,
        )
      : [primary]
  const context = contexts.find(
    (item) => evidence.subject === `${primary.id}:${item.id}:${peerName}`,
  )
  if (!context) return false
  const providers = plan.occurrences.filter(
    (item) =>
      item.ownerId === context.ownerId && item.name === peerName && isPeerProviderOccurrence(item),
  )
  const boundaryId = plan.repository.relationships.boundaryPackages.find(
    (item) => item.packageId === context.ownerId,
  )?.boundaryId
  const boundaryProviders = boundaryId
    ? plan.occurrences.filter(
        (item) =>
          item.ownerId !== context.ownerId &&
          item.name === peerName &&
          isPeerProviderOccurrence(item) &&
          plan.repository.relationships.boundaryPackages.some(
            (relationship) =>
              relationship.packageId === item.ownerId && relationship.boundaryId === boundaryId,
          ),
      )
    : []
  const overrides = plan.occurrences.filter(
    (item) =>
      item.name === peerName &&
      item.role === 'override' &&
      (item.ownerId === context.ownerId ||
        (boundaryId !== undefined &&
          plan.repository.relationships.boundaryPackages.some(
            (relationship) =>
              relationship.packageId === item.ownerId && relationship.boundaryId === boundaryId,
          ))),
  )
  const projection = providers.length === 1 ? projectPeerProvider(plan, providers[0]!) : undefined
  const expectedStatus =
    overrides.length > 0 || providers.length > 1
      ? 'conflicting'
      : providers.length === 0
        ? boundaryProviders.length > 0
          ? 'unknown'
          : 'absent'
        : projection?.range
          ? 'observed'
          : 'unknown'
  const expectedSources = [
    primary.id,
    context.id,
    ...providers.map((item) => item.id),
    ...boundaryProviders.map((item) => item.id),
    ...overrides.map((item) => item.id),
    ...(projection?.sourceRefs ?? []),
  ]
    .filter((item, index, items) => items.indexOf(item) === index)
    .sort()
  return (
    evidence.status === expectedStatus &&
    evidence.facts.providerRange === (projection?.range ?? 'missing') &&
    evidence.facts.providers === String(providers.length) &&
    evidence.facts.boundaryProviders === String(boundaryProviders.length) &&
    evidence.facts.overrideConstraints === String(overrides.length) &&
    canonicalJson([...evidence.sourceRefs].sort()) === canonicalJson(expectedSources)
  )
}

function isPeerProviderOccurrence(occurrence: PlanResult['occurrences'][number]): boolean {
  if (occurrence.role === 'catalog-consumer') return occurrence.protocol === 'catalog'
  return (
    occurrence.role === 'dependency' &&
    ['semver', 'npm', 'jsr', 'workspace'].includes(occurrence.protocol)
  )
}

function projectPeerProvider(
  plan: PlanResult,
  provider: PlanResult['occurrences'][number],
): { range: string | null; sourceRefs: string[] } {
  if (provider.role !== 'catalog-consumer') {
    const requested = plan.operations.find(
      (item) => item.occurrenceId === provider.id,
    )?.requestedValue
    return {
      range: normalizePeerProviderRange(requested ?? provider.declaredValue),
      sourceRefs: [],
    }
  }
  const owner = plan.occurrences.find(
    (item) =>
      item.role === 'catalog-owner' &&
      item.catalogId === provider.catalogId &&
      item.name === provider.name,
  )
  if (!owner) return { range: null, sourceRefs: [] }
  const requested = plan.operations.find((item) => item.occurrenceId === owner.id)?.requestedValue
  return {
    range: normalizePeerProviderRange(requested ?? owner.declaredValue),
    sourceRefs: [owner.id],
  }
}

function normalizePeerProviderRange(value: string): string | null {
  const withoutWorkspace = value.startsWith('workspace:') ? value.slice('workspace:'.length) : value
  const withoutAlias = withoutWorkspace.startsWith('npm:')
    ? withoutWorkspace.slice(withoutWorkspace.lastIndexOf('@') + 1)
    : withoutWorkspace
  return semver.validRange(withoutAlias)
}

function validateRuntimeEvidenceProjection(
  evidence: NonNullable<PlanResult['signalEvidence']>[number],
  signal: NonNullable<PlanResult['signals']>[number],
  plan: PlanResult,
): { complete: boolean } | undefined {
  const primary = plan.occurrences.find((item) => item.id === signal.subject.occurrenceIds[0])
  if (!primary) return undefined
  if (evidence.facts.targetVersion !== (expectedSignalTarget(signal, plan) ?? 'unknown')) {
    return undefined
  }
  const contexts =
    primary.role === 'catalog-owner'
      ? plan.occurrences.filter(
          (item) =>
            item.role === 'catalog-consumer' &&
            item.catalogId === primary.catalogId &&
            item.name === primary.name,
        )
      : [primary]
  const relevantOccurrences = [primary, ...contexts].filter(
    (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index,
  )
  const boundaryIds = new Set(
    relevantOccurrences
      .map(
        (occurrence) =>
          plan.repository.relationships.boundaryPackages.find(
            (item) => item.packageId === occurrence.ownerId,
          )?.boundaryId,
      )
      .filter((item): item is string => Boolean(item)),
  )
  const declarations = plan.repository.runtimeDeclarations.filter((item) =>
    boundaryIds.has(item.boundaryId),
  )
  const conclusions = plan.evidence.filter(
    (item) => item.kind === 'runtime' && item.boundaryId && boundaryIds.has(item.boundaryId),
  )
  const expectedSources = [
    ...relevantOccurrences.map((item) => item.id),
    ...declarations.map((item) => item.id),
    ...conclusions.map((item) => item.id),
  ]
    .filter((item, index, items) => items.indexOf(item) === index)
    .sort()
  if (canonicalJson([...evidence.sourceRefs].sort()) !== canonicalJson(expectedSources)) {
    return undefined
  }
  const expectedRanges = Object.fromEntries(
    declarations.map((item) => [`repositoryRange.${item.id}`, item.declaredText]),
  )
  const actualRanges = Object.fromEntries(
    Object.entries(evidence.facts).filter(([key]) => key.startsWith('repositoryRange.')),
  )
  const expectedConclusions = Object.fromEntries(
    conclusions.map((item) => [`conclusionStatus.${item.id}`, item.status]),
  )
  const actualConclusions = Object.fromEntries(
    Object.entries(evidence.facts).filter(([key]) => key.startsWith('conclusionStatus.')),
  )
  if (
    canonicalJson(actualRanges) !== canonicalJson(expectedRanges) ||
    canonicalJson(actualConclusions) !== canonicalJson(expectedConclusions)
  ) {
    return undefined
  }
  const complete =
    boundaryIds.size > 0 &&
    [...boundaryIds].every((boundaryId) => {
      const matching = conclusions.filter((item) => item.boundaryId === boundaryId)
      return matching.length === 1 && matching[0]?.status === 'confirmed'
    })
  return { complete }
}

function evaluateSerializedCohort(
  evidence: NonNullable<PlanResult['signalEvidence']>[number],
  plan: PlanResult,
): boolean | undefined {
  const configured = Object.entries(evidence.facts)
    .filter(([key]) => key.startsWith('configuredMember.'))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
  const proposedItems = Object.entries(evidence.facts)
    .filter(([key]) => key.startsWith('proposedVersion.'))
    .map(([key, version]) => ({
      occurrenceId: key.slice('proposedVersion.'.length),
      version,
    }))
  const candidateItems = Object.entries(evidence.facts)
    .filter(([key]) => key.startsWith('candidateOperation.'))
    .map(([key, value]) => ({
      occurrenceId: key.slice('candidateOperation.'.length),
      candidate: value === 'yes' ? true : value === 'no' ? false : undefined,
    }))
  const strategy = evidence.facts.strategy
  try {
    if (
      configured.length < 2 ||
      new Set(configured).size !== configured.length ||
      !['update-together', 'same-major', 'same-version'].includes(strategy ?? '')
    ) {
      return undefined
    }
    if (
      new Set(proposedItems.map((item) => item.occurrenceId)).size !== proposedItems.length ||
      new Set(candidateItems.map((item) => item.occurrenceId)).size !== candidateItems.length ||
      proposedItems.some((item) => {
        const occurrence = plan.occurrences.find((candidate) => candidate.id === item.occurrenceId)
        const decision = plan.decisions.find(
          (candidate) => candidate.occurrenceId === item.occurrenceId,
        )
        return !(
          occurrence &&
          configured.includes(occurrence.name) &&
          semver.valid(item.version) &&
          decision?.candidate?.targetVersion === item.version
        )
      }) ||
      configured.some(
        (name) =>
          !proposedItems.some(
            (item) =>
              plan.occurrences.find((candidate) => candidate.id === item.occurrenceId)?.name ===
              name,
          ),
      ) ||
      proposedItems.some(
        (item) => !candidateItems.some((candidate) => candidate.occurrenceId === item.occurrenceId),
      ) ||
      candidateItems.some((item) => {
        if (item.candidate === undefined) return true
        const decision = plan.decisions.find(
          (candidate) => candidate.occurrenceId === item.occurrenceId,
        )
        const expected =
          decision?.status === 'operation' || decision?.reason === 'SIGNAL_POLICY_BLOCKED'
        return item.candidate !== expected
      })
    ) {
      return undefined
    }
    const versions = proposedItems.map((item) => item.version)
    if (strategy === 'same-version') return new Set(versions).size === 1
    if (strategy === 'same-major') {
      return new Set(versions.map((version) => semver.parse(version)!.major)).size === 1
    }
    return (
      new Set(
        candidateItems
          .filter((candidate) =>
            proposedItems.some((item) => item.occurrenceId === candidate.occurrenceId),
          )
          .map((candidate) => candidate.candidate),
      ).size === 1
    )
  } catch {
    return undefined
  }
}

function defaultSignalEffect(
  signal: NonNullable<PlanResult['signals']>[number],
): NonNullable<PlanResult['signals']>[number]['effect'] {
  if (signal.reason === 'COHORT_INFERRED_SUGGESTION') return 'warn'
  if (
    signal.family === 'cohort' &&
    signal.subject.cohortId &&
    (signal.state === 'fail' || signal.state === 'unknown')
  ) {
    return 'block'
  }
  return signal.state === 'pass' || signal.state === 'not-applicable' ? 'none' : 'warn'
}

function isSortedById<T extends { id: string }>(items: readonly T[]): boolean {
  return items.every((item, index) => index === 0 || items[index - 1]!.id < item.id)
}

function hasValidRepositorySemantics(
  repository: InspectResult['repository'] | PlanResult['repository'],
): boolean {
  try {
    const sourcePaths = new Set(repository.sources.map((source) => source.path))
    if (sourcePaths.size !== repository.sources.length) return false
    return (
      createRepositoryFingerprint({
        schemaVersion: repository.modelSchemaVersion,
        rootIdentity: repository.identity,
        sources: repository.sources,
      }) === repository.fingerprint
    )
  } catch {
    return false
  }
}

function hasValidInspectSemantics(result: InspectResult): boolean {
  try {
    canonicalJson(result)
    return hasValidRepositorySemantics(result.repository) && hasValidReferences(result)
  } catch {
    return false
  }
}

function hasValidReferences(result: InspectResult | PlanResult): boolean {
  const repository = result.repository
  const sourceFiles = uniqueMap(repository.sourceFiles, (source) => source.id)
  const packages = uniqueMap(repository.packages, (pkg) => pkg.id)
  const catalogs = uniqueMap(repository.catalogs, (catalog) => catalog.id)
  const boundaries = uniqueMap(repository.boundaries, (boundary) => boundary.id)
  const occurrences = uniqueMap(result.occurrences, (occurrence) => occurrence.id)
  const lockfiles = uniqueMap(result.lockfiles, (lockfile) => lockfile.id)
  const evidence = uniqueMap(result.evidence, (entry) => entry.id)
  if (
    !(sourceFiles && packages && catalogs && boundaries && occurrences && lockfiles && evidence)
  ) {
    return false
  }
  if (new Set(repository.sourceFiles.map((source) => source.path)).size !== sourceFiles.size) {
    return false
  }
  if (repository.root && !evidence.has(repository.root.evidenceId)) return false
  const vcsTargets = new Set(result.vcs.targetFiles.map((target) => target.path))
  const unrelatedDirty = new Set(result.vcs.unrelatedDirtyPaths)
  if (
    vcsTargets.size !== result.vcs.targetFiles.length ||
    unrelatedDirty.size !== result.vcs.unrelatedDirtyPaths.length ||
    [...vcsTargets].some((path) => unrelatedDirty.has(path))
  ) {
    return false
  }

  for (const source of repository.sourceFiles) {
    if (
      repository.sources.find((candidate) => candidate.path === source.path)?.byteHash !==
      source.byteHash
    ) {
      return false
    }
  }
  for (const pkg of repository.packages) {
    if (!sourceFiles.has(pkg.sourceFileId)) return false
  }
  for (const catalog of repository.catalogs) {
    if (!sourceFiles.has(catalog.sourceFileId)) return false
    if (catalog.entries.some((entry) => !occurrences.has(entry.occurrenceId))) return false
  }
  for (const runtime of repository.runtimeDeclarations) {
    if (!boundaries.has(runtime.boundaryId)) return false
  }
  for (const occurrence of result.occurrences) {
    const source = sourceFiles.get(occurrence.sourceFileId)
    if (
      !source ||
      source.path !== occurrence.file ||
      !(packages.has(occurrence.ownerId) || catalogs.has(occurrence.ownerId)) ||
      (occurrence.catalogId !== undefined && !catalogs.has(occurrence.catalogId))
    ) {
      return false
    }
  }
  for (const lockfile of result.lockfiles) {
    if (!boundaries.has(lockfile.boundaryId)) return false
  }
  for (const entry of result.evidence) {
    if (entry.boundaryId !== undefined && !boundaries.has(entry.boundaryId)) return false
    if (new Set(entry.sources.map((source) => source.id)).size !== entry.sources.length)
      return false
  }
  for (const risk of result.risks) {
    if (risk.occurrenceId !== undefined && !occurrences.has(risk.occurrenceId)) return false
    if (risk.evidenceRefs.some((id) => !evidence.has(id))) return false
  }
  for (const error of result.errors) {
    if (error.occurrenceId !== undefined && !occurrences.has(error.occurrenceId)) return false
  }
  if ('operations' in result) {
    for (const operation of result.operations) {
      const source = sourceFiles.get(operation.sourceFileId)
      if (
        !source ||
        source.path !== operation.file ||
        source.byteHash !== operation.sourceByteHash
      ) {
        return false
      }
    }
    if (!hasValidExecutionReferences(result, boundaries, lockfiles, evidence)) return false
  } else if (
    result.requiredCapabilities.length !== 1 ||
    result.requiredCapabilities[0] !== 'filesystem-read'
  ) {
    return false
  }

  const relationships = repository.relationships
  if (
    relationships.workspaceMembers.some(
      (relationship) =>
        !(packages.has(relationship.workspaceId) && packages.has(relationship.packageId)),
    ) ||
    relationships.catalogConsumers.some(
      (relationship) =>
        !(catalogs.has(relationship.catalogId) && occurrences.has(relationship.occurrenceId)),
    ) ||
    relationships.boundaryPackages.some(
      (relationship) =>
        !(boundaries.has(relationship.boundaryId) && packages.has(relationship.packageId)),
    ) ||
    relationships.lockfileBoundaries.some(
      (relationship) =>
        !(lockfiles.has(relationship.lockfileId) && boundaries.has(relationship.boundaryId)),
    )
  ) {
    return false
  }
  return true
}

function hasValidPlanExecution(plan: PlanResult): boolean {
  const { execution } = plan
  const expectedCapabilities: PlanResult['requiredCapabilities'] = [
    'filesystem-read',
    'registry-read',
  ]
  if (plan.operations.length > 0) {
    expectedCapabilities.push('file-write')
    if (execution.mode !== 'file-only' && execution.status === 'ready') {
      expectedCapabilities.push('process-execute', 'lockfile-write')
      if (execution.mode === 'install') expectedCapabilities.push('install')
      if (execution.artifactVerification) {
        expectedCapabilities.push('artifact-verify', 'network-access')
      }
      if (execution.verification) expectedCapabilities.push('verify-command')
    }
  }
  if (canonicalJson(plan.requiredCapabilities) !== canonicalJson(expectedCapabilities)) return false

  if (execution.mode === 'file-only') {
    return (
      execution.status === 'ready' &&
      execution.targets.length === 0 &&
      execution.reason === undefined &&
      execution.verification === undefined &&
      execution.artifactVerification === undefined
    )
  }
  if (plan.operations.length === 0) {
    return (
      execution.status === 'not-needed' &&
      execution.targets.length === 0 &&
      execution.reason === undefined &&
      execution.verification === undefined &&
      execution.artifactVerification === undefined
    )
  }
  if (execution.status === 'blocked') {
    return (
      execution.targets.length === 0 &&
      execution.reason !== undefined &&
      isContractSafeText(execution.reason) &&
      execution.verification === undefined &&
      execution.artifactVerification === undefined
    )
  }
  if (execution.status !== 'ready' || execution.targets.length === 0) return false
  if (execution.reason !== undefined) return false
  if (execution.artifactVerification && !hasValidArtifactVerification(plan)) return false
  const decisionsByOperation = new Map(
    plan.decisions.map((decision) => [decision.operationId, decision]),
  )
  const occurrencesById = new Map(plan.occurrences.map((occurrence) => [occurrence.id, occurrence]))
  const lockfileFields = new Set([
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ])
  if (
    plan.operations.some((operation) => {
      const occurrence = occurrencesById.get(operation.occurrenceId)
      const targetVersion = decisionsByOperation.get(operation.id)?.candidate?.targetVersion
      return (
        operation.path.length !== 2 ||
        operation.path[1] !== operation.name ||
        !lockfileFields.has(operation.path[0] ?? '') ||
        !isSupportedManagerOccurrence(occurrence, operation, targetVersion)
      )
    })
  ) {
    return false
  }

  const expectedBoundaryIds = new Set(affectedBoundaryIds(plan))
  const targetBoundaryIds = new Set(execution.targets.map((target) => target.boundaryId))
  if (
    targetBoundaryIds.size !== execution.targets.length ||
    targetBoundaryIds.size !== expectedBoundaryIds.size ||
    [...expectedBoundaryIds].some((id) => !targetBoundaryIds.has(id))
  ) {
    return false
  }
  if (execution.verification) {
    const verificationPublic =
      isContractSafeArgv([execution.verification.executable, ...execution.verification.args]) &&
      [execution.verification.cwd, ...execution.verification.permittedPaths].every(
        isContractSafeText,
      )
    if (!verificationPublic || execution.verification.permittedPaths.length !== 0) {
      return false
    }
  }
  return true
}

function hasValidArtifactVerification(plan: PlanResult): boolean {
  const verification = plan.execution.artifactVerification
  if (!verification) return true
  if (plan.execution.mode !== 'install' || plan.execution.status !== 'ready') return false
  const ruleIds = new Set<string>()
  for (const rule of verification.rules) {
    if (
      ruleIds.has(rule.id) ||
      ![
        rule.id,
        rule.selectors.family,
        rule.selectors.state,
        rule.selectors.reason,
        rule.selectors.dependencyName,
        rule.selectors.workspacePath,
        rule.selectors.cohortId,
      ]
        .filter((value): value is string => value !== undefined)
        .every(isContractSafeText)
    ) {
      return false
    }
    ruleIds.add(rule.id)
  }
  if (
    !isSortedBy(verification.targets, (target) => target.boundaryId) ||
    verification.targets.length !== plan.execution.targets.length
  ) {
    return false
  }

  const executionTargets = new Map(
    plan.execution.targets.map((target) => [target.boundaryId, target]),
  )
  const decisions = new Map(plan.decisions.map((decision) => [decision.operationId, decision]))
  const operations = new Map(
    plan.operations.map((operation) => [operation.occurrenceId, operation]),
  )
  const occurrences = new Map(plan.occurrences.map((occurrence) => [occurrence.id, occurrence]))
  const evidence = new Map((plan.signalEvidence ?? []).map((item) => [item.id, item]))
  const covered = new Set<string>()
  const evidenceRefs = new Set<string>()
  for (const verificationTarget of verification.targets) {
    const target = executionTargets.get(verificationTarget.boundaryId)
    if (
      target?.manager.name !== 'npm' ||
      target.boundaryPath !== verificationTarget.cwd ||
      target.manager.version !== verificationTarget.verifier.version ||
      !semver.satisfies(target.manager.version, '>=11.12.0 <12.0.0') ||
      !isSortedById(verificationTarget.artifacts)
    ) {
      return false
    }
    const identities = new Set<string>()
    for (const artifact of verificationTarget.artifacts) {
      const identity = artifactIdentity(artifact)
      const identityJson = canonicalJson(identity)
      if (
        identities.has(identityJson) ||
        artifact.id !== `artifact-${hashExactBytes(identityJson).slice(0, 24)}` ||
        !isExactSha512Integrity(artifact.integrity) ||
        !isSorted(artifact.occurrenceIds) ||
        evidenceRefs.has(artifact.evidenceRef)
      ) {
        return false
      }
      identities.add(identityJson)
      evidenceRefs.add(artifact.evidenceRef)
      const expectedEvidence = artifactEvidenceBase(artifact.id, artifact)
      const observedEvidence = evidence.get(artifact.evidenceRef)
      if (
        artifact.evidenceRef !==
          `signal-evidence-${hashExactBytes(canonicalJson(expectedEvidence)).slice(0, 24)}` ||
        canonicalJson(observedEvidence) !==
          canonicalJson({ id: artifact.evidenceRef, ...expectedEvidence })
      ) {
        return false
      }
      for (const occurrenceId of artifact.occurrenceIds) {
        if (covered.has(occurrenceId)) return false
        covered.add(occurrenceId)
        const operation = operations.get(occurrenceId)
        const occurrence = occurrences.get(occurrenceId)
        const decision = operation ? decisions.get(operation.id) : undefined
        const expectedTarget = operation
          ? executionTargetForFile(operation.file, plan.execution.targets)
          : undefined
        if (
          !(operation && occurrence) ||
          decision?.candidate?.targetVersion !== artifact.version ||
          expectedTarget?.boundaryId !== verificationTarget.boundaryId ||
          resolvedPackageName(occurrence.name, occurrence.declaredValue) !== artifact.packageName
        ) {
          return false
        }
      }
    }
  }
  const registryEvidenceIds = new Set(
    (plan.signalEvidence ?? [])
      .filter((item) => item.kind === 'registry-artifact')
      .map((item) => item.id),
  )
  return (
    covered.size === plan.operations.length &&
    [...operations].every(([id]) => covered.has(id)) &&
    registryEvidenceIds.size === evidenceRefs.size &&
    [...registryEvidenceIds].every((id) => evidenceRefs.has(id))
  )
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
) {
  return {
    kind: 'registry-artifact' as const,
    status: 'observed' as const,
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

function isSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value)
}

function isSortedBy<T>(values: readonly T[], select: (value: T) => string): boolean {
  return values.every((value, index) => index === 0 || select(values[index - 1]!) < select(value))
}

function executionTargetForFile(
  file: string,
  targets: PlanResult['execution']['targets'],
): PlanResult['execution']['targets'][number] | undefined {
  return [...targets]
    .sort(
      (left, right) =>
        right.boundaryPath.length - left.boundaryPath.length ||
        left.boundaryId.localeCompare(right.boundaryId),
    )
    .find(
      (target) =>
        target.boundaryPath === '.' ||
        file === target.boundaryPath ||
        file.startsWith(`${target.boundaryPath}/`),
    )
}

function resolvedPackageName(name: string, declaredValue: string): string {
  const alias = /^npm:((?:@[^/]+\/)?[^@]+)@.+$/u.exec(declaredValue)
  return alias?.[1] ?? name
}

function isExactSha512Integrity(value: string): boolean {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(value)
  if (!match?.[1]) return false
  const bytes = Buffer.from(match[1], 'base64')
  return bytes.length === 64 && bytes.toString('base64') === match[1]
}

function hasValidExecutionReferences(
  plan: PlanResult,
  boundaries: Map<string, PlanResult['repository']['boundaries'][number]>,
  lockfiles: Map<string, PlanResult['lockfiles'][number]>,
  evidence: Map<string, PlanResult['evidence'][number]>,
): boolean {
  const lockfilePaths = new Set<string>()
  for (const target of plan.execution.targets) {
    const boundary = boundaries.get(target.boundaryId)
    const lockfile = lockfiles.get(target.lockfile.id)
    if (
      !boundary ||
      boundary.path !== target.boundaryPath ||
      !lockfile ||
      lockfile.boundaryId !== target.boundaryId ||
      lockfile.path !== target.lockfile.path ||
      lockfile.byteHash !== target.lockfile.byteHash ||
      lockfile.manager !== target.manager.name ||
      lockfile.parseState !== 'parsed' ||
      lockfilePaths.has(target.lockfile.path)
    ) {
      return false
    }
    lockfilePaths.add(target.lockfile.path)

    const managerEvidence = [...evidence.values()].filter(
      (entry) => entry.kind === 'package-manager' && entry.boundaryId === target.boundaryId,
    )
    const lockfileEvidence = [...evidence.values()].filter(
      (entry) => entry.kind === 'lockfile-selection' && entry.boundaryId === target.boundaryId,
    )
    if (
      managerEvidence.length !== 1 ||
      managerEvidence[0]?.status !== 'confirmed' ||
      managerEvidence[0].values.length !== 1 ||
      lockfileEvidence.length !== 1 ||
      lockfileEvidence[0]?.status !== 'confirmed' ||
      lockfileEvidence[0].values.length !== 1 ||
      lockfileEvidence[0].values[0] !== target.lockfile.id
    ) {
      return false
    }
    const manager = managerEvidence[0].values[0]
    if (
      !manager ||
      typeof manager !== 'object' ||
      Array.isArray(manager) ||
      manager.name !== target.manager.name ||
      manager.version !== target.manager.version
    ) {
      return false
    }
    const adapter = resolveManagerAdapter({
      manager: target.manager.name,
      version: target.manager.version,
      lockfilePath: target.lockfile.path,
      mode: plan.execution.mode === 'install' ? 'install' : 'sync-lockfile',
      boundaryPath: target.boundaryPath,
    })
    if ('unsupported' in adapter || canonicalJson(adapter) !== canonicalJson(target.adapter)) {
      return false
    }
    if (
      ![
        target.boundaryId,
        target.boundaryPath,
        target.manager.name,
        target.manager.version,
        target.lockfile.id,
        target.lockfile.path,
        target.adapter.executable,
        ...target.adapter.args,
        ...target.adapter.permittedPaths,
        ...target.adapter.externalEffects,
      ].every(isContractSafeText)
    ) {
      return false
    }
  }
  return true
}

function affectedBoundaryIds(plan: PlanResult): string[] {
  const deepest = [...plan.repository.boundaries].sort(
    (left, right) => right.path.length - left.path.length || left.path.localeCompare(right.path),
  )
  const ids = new Set<string>()
  for (const operation of plan.operations) {
    const boundary = deepest.find(
      (entry) =>
        entry.path === '.' ||
        operation.file === entry.path ||
        operation.file.startsWith(`${entry.path}/`),
    )
    if (boundary) ids.add(boundary.id)
  }
  return [...ids]
}

function uniqueMap<T>(
  values: readonly T[],
  getId: (value: T) => string,
): Map<string, T> | undefined {
  const result = new Map<string, T>()
  for (const value of values) {
    const id = getId(value)
    if (result.has(id)) return undefined
    result.set(id, value)
  }
  return result
}
