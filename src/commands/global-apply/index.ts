import Ajv from 'ajv'
import * as semver from 'semver'
import { version } from '../../../package.json' with { type: 'json' }
import { canonicalJson } from '../../contracts/canonical-json'
import { hashExactBytes } from '../../contracts/fingerprint'
import { globalApplySchema, globalPlanSchema } from '../../contracts/global-schemas'
import { assertPlainDataInput } from '../../contracts/input'
import { isContractSafeArgv, isContractSafeText } from '../../contracts/sanitize'
import { ConfigError } from '../../errors'
import {
  defaultGlobalProcessRuntime,
  type GlobalProcessRuntime,
  getGlobalManagerAdapter,
  inspectGlobalManager,
  isValidGlobalPackageName,
} from '../../io/global-manager'
import type {
  GlobalApplyPlan,
  GlobalApplyResult,
  GlobalApplyStatus,
  GlobalApplySummary,
  GlobalCommandResult,
  GlobalInvocationAuthority,
  GlobalItemReason,
  GlobalItemResult,
  GlobalManagerEvidence,
  GlobalManagerName,
  GlobalPlanOperation,
  GlobalUpdateRequest,
} from '../../types'

export interface GlobalPlanOptions {
  cwd: string
  timeoutMs?: number
  inheritedEnv?: NodeJS.ProcessEnv
}

export interface GlobalApplyOptions {
  cwd: string
  inheritedEnv?: NodeJS.ProcessEnv
}

const ajv = new Ajv({ allErrors: true, strict: true })
const validateGlobalPlanShape = ajv.compile(globalPlanSchema)
const validateGlobalApplyShape = ajv.compile(globalApplySchema)
const GLOBAL_MANAGER_RANK = new Map<GlobalManagerName, number>([
  ['npm', 0],
  ['pnpm', 1],
  ['bun', 2],
])

export async function createGlobalApplyPlan(
  requests: GlobalUpdateRequest[],
  options: GlobalPlanOptions,
  runtime: GlobalProcessRuntime = defaultGlobalProcessRuntime,
): Promise<GlobalApplyPlan> {
  assertGlobalPlanInputs(requests, options)
  const timeoutMs = options.timeoutMs ?? 120_000
  const managers = [...new Set(requests.map((request) => request.manager))].sort(
    compareManagerNames,
  )
  const inspected = await Promise.all(
    managers.map((manager) =>
      inspectGlobalManager(
        manager,
        { cwd: options.cwd, timeoutMs, inheritedEnv: options.inheritedEnv },
        runtime,
      ),
    ),
  )
  const evidence = inspected.map((entry) => entry.evidence).sort(compareManagers)
  const evidenceByManager = new Map(evidence.map((entry) => [entry.manager, entry]))
  const operations = requests
    .map((request) => planOperation(request, evidenceByManager.get(request.manager), timeoutMs))
    .sort(compareOperations)
  const semanticPlan = {
    contract: 'depfresh.global-plan' as const,
    schemaVersion: 1 as const,
    toolVersion: version,
    managers: evidence,
    operations,
    requiredCapabilities: ['global-inventory-read', 'global-write', 'process-execute'] as const,
  }
  const plan = { ...semanticPlan, planFingerprint: hashExactBytes(canonicalJson(semanticPlan)) }
  assertGlobalApplyPlan(plan)
  return plan
}

export async function applyGlobalPlan(
  planInput: GlobalApplyPlan,
  options: GlobalApplyOptions,
  requestedAuthority: GlobalInvocationAuthority,
  runtime: GlobalProcessRuntime = defaultGlobalProcessRuntime,
): Promise<GlobalApplyResult> {
  assertPlainDataInput(planInput)
  assertPlainDataInput(options)
  assertPlainDataInput(requestedAuthority)
  assertGlobalApplyPlan(planInput)
  const plan = structuredClone(planInput)
  const authority = snapshotGlobalAuthority(requestedAuthority)
  validateGlobalAuthority(plan, authority)
  const items = new Map<string, GlobalItemResult>()
  const commands: GlobalCommandResult[] = []
  const ready: GlobalPlanOperation[] = []
  const preflight = new Map<GlobalManagerName, Awaited<ReturnType<typeof inspectGlobalManager>>>()

  for (const manager of [...new Set(plan.operations.map((operation) => operation.manager))].sort(
    compareManagerNames,
  )) {
    const operation = plan.operations.find((candidate) => candidate.manager === manager)
    if (!operation) continue
    preflight.set(
      manager,
      await inspectGlobalManager(
        manager,
        {
          cwd: options.cwd,
          timeoutMs: operation.timeoutMs,
          inheritedEnv: options.inheritedEnv,
        },
        runtime,
      ),
    )
  }

  for (const operation of plan.operations) {
    const result = preflightResult(operation, preflight.get(operation.manager))
    if (result) items.set(operation.id, result)
    else ready.push(operation)
  }

  let unsafeProcess = false
  for (const operation of ready) {
    if (unsafeProcess) {
      items.set(operation.id, item(operation, 'unknown', 'COMMAND_UNOBSERVABLE'))
      continue
    }
    const immediate = await inspectGlobalManager(
      operation.manager,
      {
        cwd: options.cwd,
        timeoutMs: operation.timeoutMs,
        inheritedEnv: options.inheritedEnv,
      },
      runtime,
    )
    const immediateResult = preflightResult(operation, immediate)
    if (immediateResult) {
      items.set(operation.id, immediateResult)
      continue
    }
    if (!immediate.executable) {
      items.set(operation.id, item(operation, 'unknown', 'MANAGER_UNAVAILABLE'))
      continue
    }
    const process = await runtime.run(immediate.executable, operation.args, {
      cwd: options.cwd,
      timeoutMs: operation.timeoutMs,
      inheritedEnv: options.inheritedEnv,
      captureStdout: false,
    })
    commands.push({
      operationId: operation.id,
      manager: operation.manager,
      executable: operation.executable,
      args: [...operation.args],
      termination: process.termination,
      terminationConfirmed: process.terminationConfirmed,
      ...(process.exitCode === undefined ? {} : { exitCode: process.exitCode }),
      ...(process.signal === undefined ? {} : { signal: process.signal }),
    })
    const processUnsafe =
      !process.terminationConfirmed ||
      process.termination === 'unknown' ||
      process.termination === 'unavailable' ||
      process.reason === 'PROCESS_DESCENDANTS_SURVIVED' ||
      process.reason === 'PROCESS_SUPERVISION_UNAVAILABLE'
    unsafeProcess = unsafeProcess || processUnsafe
    const observed = await inspectGlobalManager(
      operation.manager,
      {
        cwd: options.cwd,
        timeoutMs: operation.timeoutMs,
        inheritedEnv: options.inheritedEnv,
      },
      runtime,
    )
    items.set(operation.id, postCommandResult(operation, process, observed.evidence, processUnsafe))
  }

  const orderedItems = plan.operations.map(
    (operation) => items.get(operation.id) ?? item(operation, 'unknown', 'INVENTORY_UNKNOWN'),
  )
  return createGlobalResult(plan, orderedItems, commands)
}

export function createGlobalInvocationAuthority(
  managers: GlobalManagerName[],
  grants: { globalWrite: boolean; processExecute: boolean },
): GlobalInvocationAuthority {
  const uniqueManagers = [...new Set(managers)].sort(compareManagerNames)
  return Object.freeze({
    globalWrite: grants.globalWrite === true,
    processExecute: grants.processExecute === true,
    managers: Object.freeze(uniqueManagers) as unknown as GlobalManagerName[],
  })
}

export function validateGlobalApplyPlan(value: unknown): value is GlobalApplyPlan {
  try {
    assertGlobalApplyPlan(value)
    return true
  } catch {
    return false
  }
}

export function validateGlobalApplyResult(value: unknown): value is GlobalApplyResult {
  try {
    assertGlobalApplyResult(value)
    return true
  } catch {
    return false
  }
}

export function assertGlobalApplyPlan(value: unknown): asserts value is GlobalApplyPlan {
  assertPlainDataInput(value)
  if (!(validateGlobalPlanShape(value) && isRecord(value))) invalidContract('global plan')
  const plan = value as unknown as GlobalApplyPlan
  if (
    plan.contract !== 'depfresh.global-plan' ||
    plan.schemaVersion !== 1 ||
    !isContractSafeText(plan.toolVersion) ||
    !Array.isArray(plan.managers) ||
    !Array.isArray(plan.operations) ||
    canonicalJson(plan.requiredCapabilities) !==
      canonicalJson(['global-inventory-read', 'global-write', 'process-execute'])
  ) {
    invalidContract('global plan')
  }
  if (canonicalJson(plan.managers) !== canonicalJson([...plan.managers].sort(compareManagers))) {
    invalidContract('global plan')
  }
  if (
    canonicalJson(plan.operations) !== canonicalJson([...plan.operations].sort(compareOperations))
  ) {
    invalidContract('global plan')
  }
  const managers = new Map<GlobalManagerName, GlobalManagerEvidence>()
  for (const evidence of plan.managers) {
    if (!isValidManagerEvidence(evidence) || managers.has(evidence.manager)) {
      invalidContract('global plan')
    }
    managers.set(evidence.manager, evidence)
  }
  const ids = new Set<string>()
  const occurrences = new Set<string>()
  const physical = new Set<string>()
  for (const operation of plan.operations) {
    const evidence = managers.get(operation.manager)
    if (
      !evidence ||
      ids.has(operation.id) ||
      occurrences.has(operation.occurrenceId) ||
      physical.has(`${operation.manager}\0${operation.name}`) ||
      !isValidOperation(operation, evidence)
    ) {
      invalidContract('global plan')
    }
    ids.add(operation.id)
    occurrences.add(operation.occurrenceId)
    physical.add(`${operation.manager}\0${operation.name}`)
  }
  if (
    canonicalJson([...managers.keys()].sort(compareManagerNames)) !==
    canonicalJson(
      [...new Set(plan.operations.map((operation) => operation.manager))].sort(compareManagerNames),
    )
  ) {
    invalidContract('global plan')
  }
  const { planFingerprint: _fingerprint, ...semanticPlan } = plan
  if (
    typeof plan.planFingerprint !== 'string' ||
    plan.planFingerprint !== hashExactBytes(canonicalJson(semanticPlan))
  ) {
    invalidContract('global plan')
  }
}

export function assertGlobalApplyResult(value: unknown): asserts value is GlobalApplyResult {
  assertPlainDataInput(value)
  if (!(validateGlobalApplyShape(value) && isRecord(value))) {
    invalidContract('global apply result')
  }
  const result = value as unknown as GlobalApplyResult
  if (
    result.contract !== 'depfresh.global-apply' ||
    result.schemaVersion !== 1 ||
    !isContractSafeText(result.toolVersion) ||
    !Array.isArray(result.items) ||
    !Array.isArray(result.commands) ||
    result.rollback !== 'not-supported' ||
    canonicalJson(result.requiredCapabilities) !==
      canonicalJson(['global-write', 'process-execute'])
  ) {
    invalidContract('global apply result')
  }
  const summary = summarizeGlobalItems(result.items)
  if (canonicalJson(summary) !== canonicalJson(result.summary))
    invalidContract('global apply result')
  if (result.status !== reconcileGlobalStatus(summary)) invalidContract('global apply result')
  if (
    new Set(result.items.map((entry) => entry.operationId)).size !== result.items.length ||
    new Set(result.commands.map((entry) => entry.operationId)).size !== result.commands.length
  ) {
    invalidContract('global apply result')
  }
  for (const entry of [...result.items, ...result.commands]) {
    if (!publicStrings(entry).every(isContractSafeText)) invalidContract('global apply result')
  }
  if (result.commands.some((entry) => !validGlobalCommandObservation(entry))) {
    invalidContract('global apply result')
  }
  const itemIds = new Set(result.items.map((entry) => entry.operationId))
  if (result.commands.some((entry) => !itemIds.has(entry.operationId))) {
    invalidContract('global apply result')
  }
  const commandsByOperation = new Map(
    result.commands.map((entry) => [entry.operationId, entry] as const),
  )
  for (const entry of result.items) {
    const expected = semver.valid(entry.expectedVersion)
    const target = semver.valid(entry.targetVersion)
    const observed = entry.observedVersion ? semver.valid(entry.observedVersion) : undefined
    if (!(expected && target) || (entry.observedVersion !== undefined && !observed)) {
      invalidContract('global apply result')
    }
    const command = commandsByOperation.get(entry.operationId)
    if (!validGlobalItemSemantics(entry, command, expected, target)) {
      invalidContract('global apply result')
    }
  }
}

function validGlobalCommandObservation(command: GlobalCommandResult): boolean {
  if (command.termination === 'exit') {
    return command.terminationConfirmed && command.exitCode !== undefined && !command.signal
  }
  if (command.termination === 'signal') {
    return command.terminationConfirmed && command.exitCode === undefined && Boolean(command.signal)
  }
  return command.exitCode === undefined && command.signal === undefined
}

function validGlobalItemSemantics(
  entry: GlobalItemResult,
  command: GlobalCommandResult | undefined,
  expected: string,
  target: string,
): boolean {
  if (command) {
    const adapter = getGlobalManagerAdapter(entry.manager)
    if (
      command.manager !== entry.manager ||
      command.executable !== adapter.executable ||
      canonicalJson(command.args) !==
        canonicalJson(adapter.updateArgs(entry.name, entry.targetVersion))
    ) {
      return false
    }
  }
  const commandConfirmed = Boolean(
    command?.terminationConfirmed &&
      command.termination !== 'unknown' &&
      command.termination !== 'unavailable',
  )
  if (entry.status === 'applied') {
    return Boolean(
      commandConfirmed && entry.reason === 'APPLIED' && entry.observedVersion === target,
    )
  }
  if (entry.status === 'skipped') {
    return (
      !command &&
      ((entry.reason === 'NO_CHANGE' && expected === target && entry.observedVersion === target) ||
        (entry.reason === 'DOWNGRADE_BLOCKED' &&
          semver.gt(expected, target) &&
          entry.observedVersion === expected))
    )
  }
  if (entry.status === 'conflicted') {
    if (entry.reason === 'PACKAGE_MISSING') return !command && entry.observedVersion === undefined
    if (entry.reason === 'EXPECTED_VALUE_MISMATCH') {
      return !command && entry.observedVersion !== undefined && entry.observedVersion !== expected
    }
    return (
      entry.reason === 'POST_STATE_MISMATCH' &&
      commandConfirmed &&
      entry.observedVersion !== undefined &&
      entry.observedVersion !== expected &&
      entry.observedVersion !== target
    )
  }
  if (entry.status === 'failed') {
    if (entry.reason === 'INVALID_PACKAGE' || entry.reason === 'INVALID_VERSION') {
      return !command && entry.observedVersion === undefined
    }
    if (entry.observedVersion === target || !commandConfirmed) return false
    if (entry.reason === 'PACKAGE_MISSING') {
      return (
        command?.termination === 'exit' &&
        command.exitCode === 0 &&
        entry.observedVersion === undefined
      )
    }
    if (entry.reason === 'COMMAND_TIMEOUT') {
      return (
        command?.termination === 'timeout' &&
        (entry.observedVersion === undefined || entry.observedVersion === expected)
      )
    }
    return (
      entry.reason === 'COMMAND_FAILED' &&
      (command?.termination === 'exit' || command?.termination === 'signal') &&
      (entry.observedVersion === undefined || entry.observedVersion === expected)
    )
  }
  if (entry.observedVersion !== undefined) return false
  const validUnknownReason = [
    'MANAGER_UNAVAILABLE',
    'MANAGER_UNSUPPORTED',
    'INVENTORY_MALFORMED',
    'INVENTORY_TIMEOUT',
    'INVENTORY_UNKNOWN',
    'EXECUTABLE_CHANGED',
    'COMMAND_UNOBSERVABLE',
  ].includes(entry.reason)
  if (!validUnknownReason) return false
  if (!command) return true
  return entry.reason === 'COMMAND_UNOBSERVABLE' ? !commandConfirmed : commandConfirmed
}

function planOperation(
  request: GlobalUpdateRequest,
  evidence: GlobalManagerEvidence | undefined,
  timeoutMs: number,
): GlobalPlanOperation {
  const adapter = getGlobalManagerAdapter(request.manager)
  const occurrenceBase = {
    manager: request.manager,
    name: request.name,
    expectedVersion: request.expectedVersion,
    executableFingerprint: evidence?.executableFingerprint ?? null,
    realmFingerprint: evidence?.realmFingerprint ?? null,
  }
  const occurrenceId = `global-occurrence-${hashExactBytes(canonicalJson(occurrenceBase)).slice(0, 24)}`
  const operationBase = {
    occurrenceId,
    manager: request.manager,
    executable: adapter.executable,
    ...(evidence?.executableFingerprint
      ? { executableFingerprint: evidence.executableFingerprint }
      : {}),
    ...(evidence?.realmFingerprint ? { realmFingerprint: evidence.realmFingerprint } : {}),
    ...(evidence?.managerVersion ? { managerVersion: evidence.managerVersion } : {}),
    name: request.name,
    expectedVersion: request.expectedVersion,
    targetVersion: request.targetVersion,
    args: adapter.updateArgs(request.name, request.targetVersion),
    timeoutMs,
  }
  return {
    id: `global-operation-${hashExactBytes(canonicalJson(operationBase)).slice(0, 24)}`,
    ...operationBase,
  }
}

function preflightResult(
  operation: GlobalPlanOperation,
  inspected: Awaited<ReturnType<typeof inspectGlobalManager>> | undefined,
): GlobalItemResult | undefined {
  if (!isValidGlobalPackageName(operation.name)) {
    return item(operation, 'failed', 'INVALID_PACKAGE')
  }
  const expected = semver.valid(operation.expectedVersion)
  const target = semver.valid(operation.targetVersion)
  if (!(expected && target)) return item(operation, 'failed', 'INVALID_VERSION')
  if (!inspected) return item(operation, 'unknown', 'INVENTORY_UNKNOWN')
  const evidenceReason = inventoryReason(inspected.evidence)
  if (evidenceReason) return item(operation, 'unknown', evidenceReason)
  if (
    !operation.executableFingerprint ||
    inspected.evidence.executableFingerprint !== operation.executableFingerprint ||
    !operation.realmFingerprint ||
    inspected.evidence.realmFingerprint !== operation.realmFingerprint ||
    inspected.evidence.managerVersion !== operation.managerVersion
  ) {
    return item(operation, 'unknown', 'EXECUTABLE_CHANGED')
  }
  const installed = inspected.evidence.packages.find((pkg) => pkg.name === operation.name)
  if (!installed) return item(operation, 'conflicted', 'PACKAGE_MISSING')
  if (installed.version !== operation.expectedVersion) {
    return item(operation, 'conflicted', 'EXPECTED_VALUE_MISMATCH', installed.version)
  }
  if (semver.gt(expected, target)) {
    return item(operation, 'skipped', 'DOWNGRADE_BLOCKED', installed.version)
  }
  if (expected === target) return item(operation, 'skipped', 'NO_CHANGE', installed.version)
  return undefined
}

function postCommandResult(
  operation: GlobalPlanOperation,
  process: Awaited<ReturnType<GlobalProcessRuntime['run']>>,
  evidence: GlobalManagerEvidence,
  processUnsafe: boolean,
): GlobalItemResult {
  if (processUnsafe) return item(operation, 'unknown', 'COMMAND_UNOBSERVABLE')
  const evidenceReason = inventoryReason(evidence)
  if (evidenceReason) return item(operation, 'unknown', evidenceReason)
  if (
    evidence.executableFingerprint !== operation.executableFingerprint ||
    evidence.realmFingerprint !== operation.realmFingerprint ||
    evidence.managerVersion !== operation.managerVersion
  ) {
    return item(operation, 'unknown', 'EXECUTABLE_CHANGED')
  }
  const installed = evidence.packages.find((pkg) => pkg.name === operation.name)
  if (installed?.version === operation.targetVersion) {
    return item(operation, 'applied', 'APPLIED', installed.version)
  }
  if (installed && installed.version !== operation.expectedVersion) {
    return item(operation, 'conflicted', 'POST_STATE_MISMATCH', installed.version)
  }
  if (process.termination === 'timeout') {
    return item(operation, 'failed', 'COMMAND_TIMEOUT', installed?.version)
  }
  if (process.termination !== 'exit' || process.exitCode !== 0 || !process.terminationConfirmed) {
    return item(operation, 'failed', 'COMMAND_FAILED', installed?.version)
  }
  if (!installed) return item(operation, 'failed', 'PACKAGE_MISSING')
  return item(operation, 'failed', 'COMMAND_FAILED', installed.version)
}

function inventoryReason(evidence: GlobalManagerEvidence): GlobalItemReason | undefined {
  if (evidence.status === 'confirmed') return undefined
  if (evidence.status === 'malformed') return 'INVENTORY_MALFORMED'
  if (evidence.status === 'timeout') return 'INVENTORY_TIMEOUT'
  if (evidence.status === 'unsupported') return 'MANAGER_UNSUPPORTED'
  if (evidence.status === 'unavailable') return 'MANAGER_UNAVAILABLE'
  return 'INVENTORY_UNKNOWN'
}

function item(
  operation: GlobalPlanOperation,
  status: GlobalItemResult['status'],
  reason: GlobalItemReason,
  observedVersion?: string,
): GlobalItemResult {
  return {
    operationId: operation.id,
    occurrenceId: operation.occurrenceId,
    manager: operation.manager,
    name: operation.name,
    expectedVersion: operation.expectedVersion,
    targetVersion: operation.targetVersion,
    ...(observedVersion === undefined ? {} : { observedVersion }),
    status,
    reason,
  }
}

function createGlobalResult(
  plan: GlobalApplyPlan,
  items: GlobalItemResult[],
  commands: GlobalCommandResult[],
): GlobalApplyResult {
  const summary = summarizeGlobalItems(items)
  const result: GlobalApplyResult = {
    contract: 'depfresh.global-apply',
    schemaVersion: 1,
    toolVersion: version,
    planFingerprint: plan.planFingerprint,
    status: reconcileGlobalStatus(summary),
    items,
    commands,
    summary,
    requiredCapabilities: ['global-write', 'process-execute'],
    rollback: 'not-supported',
  }
  assertGlobalApplyResult(result)
  return result
}

function summarizeGlobalItems(items: GlobalItemResult[]): GlobalApplySummary {
  const count = (status: GlobalItemResult['status']) =>
    items.filter((entry) => entry.status === status).length
  return {
    planned: items.length,
    applied: count('applied'),
    skipped: count('skipped'),
    conflicted: count('conflicted'),
    failed: count('failed'),
    unknown: count('unknown'),
  }
}

function reconcileGlobalStatus(summary: GlobalApplySummary): GlobalApplyStatus {
  const successful = summary.applied + summary.skipped
  const incomplete = summary.conflicted + summary.failed + summary.unknown
  if (successful > 0 && incomplete > 0) return 'partial'
  if (summary.unknown > 0) return 'unknown'
  if (summary.failed > 0) return 'failed'
  if (summary.conflicted > 0) return 'conflicted'
  return summary.applied > 0 ? 'applied' : 'noop'
}

function validateGlobalAuthority(
  plan: GlobalApplyPlan,
  authority: GlobalInvocationAuthority,
): void {
  if (!(authority.globalWrite && authority.processExecute)) {
    throw new ConfigError(
      'Global apply requires explicit global-write and process-execute authority.',
      { reason: 'AUTHORITY_REQUIRED' },
    )
  }
  const granted = new Set(authority.managers)
  const planned = [...new Set(plan.operations.map((operation) => operation.manager))].sort(
    compareManagerNames,
  )
  if (canonicalJson([...granted].sort(compareManagerNames)) !== canonicalJson(planned)) {
    throw new ConfigError('Global apply lacks authority for a planned package manager.', {
      reason: 'AUTHORITY_REQUIRED',
    })
  }
}

function snapshotGlobalAuthority(authority: GlobalInvocationAuthority): GlobalInvocationAuthority {
  return createGlobalInvocationAuthority(authority.managers, authority)
}

function assertGlobalPlanInputs(requests: GlobalUpdateRequest[], options: GlobalPlanOptions): void {
  try {
    assertPlainDataInput(requests)
    assertPlainDataInput(options)
  } catch {
    throw new ConfigError('Global plan inputs must be plain JSON data.', {
      reason: 'INVALID_CONFIG',
    })
  }
  if (!Array.isArray(requests)) {
    throw new ConfigError('Global update requests must be an array.', {
      reason: 'INVALID_CONFIG',
    })
  }
  const identities = new Set<string>()
  for (const request of requests) {
    const identity = `${request.manager}\0${request.name}`
    if (
      !(
        ['npm', 'pnpm', 'bun'].includes(request.manager) && isValidGlobalPackageName(request.name)
      ) ||
      semver.valid(request.expectedVersion) === null ||
      semver.valid(request.targetVersion) === null ||
      identities.has(identity)
    ) {
      throw new ConfigError('Global update requests contain invalid or duplicate operations.', {
        reason: 'INVALID_CONFIG',
      })
    }
    identities.add(identity)
  }
  const timeout = options.timeoutMs ?? 120_000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600_000) {
    throw new ConfigError('Global update timeout must be between 1 and 600000 milliseconds.', {
      reason: 'INVALID_OPTION_VALUE',
    })
  }
}

function isValidManagerEvidence(value: GlobalManagerEvidence): boolean {
  if (
    !['npm', 'pnpm', 'bun'].includes(value.manager) ||
    value.executable !== value.manager ||
    !['confirmed', 'unavailable', 'malformed', 'timeout', 'unknown', 'unsupported'].includes(
      value.status,
    ) ||
    !isContractSafeText(value.reason) ||
    !Array.isArray(value.packages)
  ) {
    return false
  }
  if (
    value.status === 'confirmed' &&
    !(
      value.executableFingerprint &&
      value.realmFingerprint &&
      value.managerVersion &&
      semver.valid(value.managerVersion)
    )
  ) {
    return false
  }
  if (value.status !== 'confirmed' && value.packages.length > 0) return false
  const names = new Set<string>()
  for (const pkg of value.packages) {
    if (
      !isValidGlobalPackageName(pkg.name) ||
      semver.valid(pkg.version) === null ||
      names.has(pkg.name)
    ) {
      return false
    }
    names.add(pkg.name)
  }
  return canonicalJson(value.packages) === canonicalJson([...value.packages].sort(comparePackages))
}

function isValidOperation(
  operation: GlobalPlanOperation,
  evidence: GlobalManagerEvidence,
): boolean {
  const expected = planOperation(
    {
      manager: operation.manager,
      name: operation.name,
      expectedVersion: operation.expectedVersion,
      targetVersion: operation.targetVersion,
    },
    evidence,
    operation.timeoutMs,
  )
  return (
    Number.isSafeInteger(operation.timeoutMs) &&
    operation.timeoutMs >= 1 &&
    operation.timeoutMs <= 600_000 &&
    isContractSafeArgv(operation.args) &&
    canonicalJson(operation) === canonicalJson(expected)
  )
}

function publicStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(publicStrings)
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(publicStrings)
}

function invalidContract(label: string): never {
  throw new ConfigError(`Invalid ${label} contract.`, { reason: 'INVALID_CONFIG' })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function compareManagers(left: GlobalManagerEvidence, right: GlobalManagerEvidence): number {
  return compareManagerNames(left.manager, right.manager)
}

function compareOperations(left: GlobalPlanOperation, right: GlobalPlanOperation): number {
  return (
    compareManagerNames(left.manager, right.manager) ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  )
}

function comparePackages(
  left: { name: string; version: string },
  right: { name: string; version: string },
): number {
  return compareText(left.name, right.name) || compareText(left.version, right.version)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareManagerNames(left: GlobalManagerName, right: GlobalManagerName): number {
  return (GLOBAL_MANAGER_RANK.get(left) ?? 99) - (GLOBAL_MANAGER_RANK.get(right) ?? 99)
}
