import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import { resolveManagerAdapter } from '../commands/apply/manager-adapters'
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
  const expectedCapabilities: ApplyResult['requiredCapabilities'] = [
    'filesystem-read',
    'file-write',
  ]
  if (hasManagerPhase) expectedCapabilities.push('process-execute', 'lockfile-write')
  if (hasInstallPhase) expectedCapabilities.push('install')
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
        return (
          entry.status === 'passed' &&
          (command.termination !== 'exit' ||
            command.exitCode !== 0 ||
            !command.terminationConfirmed ||
            (command.manager !== undefined && command.lockfile?.parseState !== 'parsed') ||
            ((entry.name === 'sync-lockfile' || entry.name === 'install') &&
              command.lockfile?.occurrences !== 'matched') ||
            command.unexpectedPaths.length > 0)
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
      if (execution.verification) expectedCapabilities.push('verify-command')
    }
  }
  if (canonicalJson(plan.requiredCapabilities) !== canonicalJson(expectedCapabilities)) return false

  if (execution.mode === 'file-only') {
    return (
      execution.status === 'ready' &&
      execution.targets.length === 0 &&
      execution.reason === undefined &&
      execution.verification === undefined
    )
  }
  if (plan.operations.length === 0) {
    return (
      execution.status === 'not-needed' &&
      execution.targets.length === 0 &&
      execution.reason === undefined &&
      execution.verification === undefined
    )
  }
  if (execution.status === 'blocked') {
    return (
      execution.targets.length === 0 &&
      execution.reason !== undefined &&
      isContractSafeText(execution.reason) &&
      execution.verification === undefined
    )
  }
  if (execution.status !== 'ready' || execution.targets.length === 0) return false
  if (execution.reason !== undefined) return false
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
