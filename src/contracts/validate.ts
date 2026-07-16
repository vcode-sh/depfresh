import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import { canonicalJson } from './canonical-json'
import { createPlanFingerprint, createRepositoryFingerprint, hashExactBytes } from './fingerprint'
import type { InspectResult, MachineCommandError, PlanResult } from './schemas'
import { commandErrorSchema, inspectResultSchema, planResultSchema } from './schemas'

const ajv = new Ajv({ allErrors: true, strict: true })
const inspectValidator = ajv.compile(inspectResultSchema) as ValidateFunction<InspectResult>
const planValidator = ajv.compile(planResultSchema) as ValidateFunction<PlanResult>
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

export function assertMachineCommandError(value: unknown): asserts value is MachineCommandError {
  assertValid('depfresh.error', errorValidator, value)
}

export function validateInspectResult(value: unknown): value is InspectResult {
  return inspectValidator(value) && hasValidInspectSemantics(value)
}

export function validatePlanResult(value: unknown): value is PlanResult {
  return planValidator(value) && hasValidPlanSemantics(value)
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
  if (repository.root && !evidence.has(repository.root.evidenceId)) return false

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
