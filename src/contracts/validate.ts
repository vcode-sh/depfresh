import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import { canonicalJson } from './canonical-json'
import { createPlanFingerprint, createRepositoryFingerprint, hashExactBytes } from './fingerprint'
import { isContractSafeText } from './sanitize'
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
  if (
    result.requiredCapabilities.length !== 2 ||
    result.requiredCapabilities[0] !== 'filesystem-read' ||
    result.requiredCapabilities[1] !== 'file-write'
  ) {
    return false
  }
  const expectedStatus =
    result.operations.length === 0 && result.recovery.status === 'unknown'
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
    const capabilities = new Set(plan.requiredCapabilities)
    if (
      !(capabilities.has('filesystem-read') && capabilities.has('registry-read')) ||
      capabilities.has('file-write') !== plan.operations.length > 0 ||
      capabilities.size !== (plan.operations.length > 0 ? 3 : 2)
    ) {
      return false
    }
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
