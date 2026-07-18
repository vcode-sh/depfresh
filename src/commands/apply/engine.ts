import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { version } from '../../../package.json' with { type: 'json' }
import { hashExactBytes } from '../../contracts/fingerprint'
import { assertPlainDataInput } from '../../contracts/input'
import { isContractSafeText, sanitizeContractText } from '../../contracts/sanitize'
import type { ApplyResult, PlanResult } from '../../contracts/schemas'
import { assertApplyResult, assertPlanResult } from '../../contracts/validate'
import { ConfigError } from '../../errors'
import { snapshotInvocationAuthority } from '../../invocation-authority'
import { resolveContainedPath } from '../../io/packages/containment'
import { createRepositoryId } from '../../repository/identity'
import { collectVcsEvidence } from '../../repository/vcs'
import type { RepositoryVcsEvidence, RepositoryVcsTargetStateName } from '../../types'
import { type InvocationAuthority, summarizeWriteOutcomes } from '../../types'
import {
  createJournal,
  fsyncDirectory,
  type JournalHandle,
  ownsJournal,
  persistJournal,
  removeJournal,
} from './journal'
import {
  type ApplyLock,
  type ApplyLockFailure,
  acquireApplyLock,
  cleanupApplyStateRoot,
  defaultApplyRuntime,
  hasApplyRecoveryEvidence,
  ownsApplyLock,
  releaseApplyLock,
} from './lock'
import {
  executeManagerPhases,
  type ManagerPhaseExecution,
  type PreparedManagerPhases,
  prepareManagerPhases,
} from './manager-phase'
import { type ApplySourceFormat, observeValues, renderFile } from './render'
import type {
  ApplyOperation,
  ApplyOperationResult,
  ApplyOptions,
  ApplyPhase,
  ApplyRuntime,
} from './types'

interface FileSnapshot {
  relativePath: string
  absolutePath: string
  canonicalPath: string
  parentPath: string
  bytes: Buffer
  hash: string
  dev: bigint
  ino: bigint
  mode: number
  nlink: bigint
}

interface TargetGroup {
  file: string
  operations: ApplyOperation[]
  format: ApplySourceFormat
  indent: string
  original: FileSnapshot
  stagedBytes?: Buffer
  stagedHash?: string
  stagePath?: string
  backupPath?: string
  stageRelative?: string
  backupRelative?: string
  stagedSnapshot?: FileSnapshot
  backupSnapshot?: FileSnapshot
  stageIdentity?: { dev: bigint; ino: bigint }
  backupIdentity?: { dev: bigint; ino: bigint }
  stageOwned: boolean
  backupOwned: boolean
  replacementAttempted: boolean
  replaced: boolean
  restored: boolean
}

interface PreflightFailure {
  reason: string
  unknown: boolean
}

interface LocalRecoveryResult {
  status: 'completed' | 'partial' | 'unknown'
  restoredPaths: string[]
  unrecoveredPaths: string[]
}

export interface ApplyExecutionEvidence {
  targetPath: string
  operationIds: string[]
  replacementAttempted: boolean
}

export type ApplyExecutionEvidenceObserver = (evidence: ApplyExecutionEvidence) => void
export type ApplyVcsEvidenceObserver = (evidence: RepositoryVcsEvidence) => void

export async function applyPlanWithRuntime(
  planInput: unknown,
  options: ApplyOptions,
  requestedAuthority: InvocationAuthority,
  runtimeOverrides: Partial<ApplyRuntime> = {},
  executionEvidenceObserver?: ApplyExecutionEvidenceObserver,
  vcsEvidenceObserver?: ApplyVcsEvidenceObserver,
): Promise<ApplyResult> {
  validateInputs(planInput, options)
  assertPlanResult(planInput)
  const plan = planInput
  emitInitialExecutionEvidence(plan, executionEvidenceObserver)
  const authority = snapshotInvocationAuthority(requestedAuthority)
  if (!authority.write) {
    throw new ConfigError('Applying a plan requires explicit file-write invocation authority.', {
      reason: 'AUTHORITY_REQUIRED',
    })
  }
  validateExecutionAuthority(plan, authority)
  const runtime: ApplyRuntime = { ...defaultApplyRuntime, ...runtimeOverrides }
  const phases: ApplyPhase[] = []
  const root = canonicalRoot(options.cwd)
  if (!root) {
    if (plan.operations.length === 0) {
      throw new ConfigError('Apply root must be an existing directory.', {
        reason: 'INVALID_CONFIG',
      })
    }
    return blockedResult(plan, phases, 'TARGET_NOT_CONTAINED', false)
  }
  if (plan.repository.identity !== createRepositoryId('repository', '.')) {
    if (plan.operations.length === 0) {
      throw new ConfigError('Apply repository identity does not match the plan contract.', {
        reason: 'INVALID_CONFIG',
      })
    }
    return blockedResult(plan, phases, 'REPOSITORY_IDENTITY_MISMATCH', false)
  }
  if (hasApplyRecoveryEvidence(root)) {
    return blockedResult(plan, phases, 'RECOVERY_REQUIRED', true)
  }
  if (plan.operations.length > 0 && plan.execution.status === 'blocked') {
    return blockedResult(plan, phases, plan.execution.reason ?? 'EXECUTION_BLOCKED', false)
  }
  if (plan.operations.length === 0) {
    phases.push(phase('preflight', 'passed', 'NO_OPERATIONS'))
    return createResult(plan, [], phases, { status: 'not-needed' })
  }
  const preflight = preflightTargets(root, plan)
  if ('reason' in preflight) {
    return blockedResult(plan, phases, preflight.reason, preflight.unknown)
  }
  const groups = preflight
  const initialVcs = validateTargetVcs(
    root,
    plan,
    groups.map((group) => group.file),
    vcsEvidenceObserver,
  )
  if (initialVcs) return blockedResult(plan, phases, initialVcs.reason, initialVcs.unknown)
  phases.push(phase('preflight', 'passed', 'PRECONDITIONS_CONFIRMED'))

  const activeGroups = groups.filter((group) =>
    group.operations.some((operation) => operation.expectedValue !== operation.requestedValue),
  )
  if (activeGroups.length === 0) {
    const outcomes = observeSuccessfulOutcomes(root, groups, true)
    phases.push(phase('lock', 'skipped', 'NO_CHANGES'))
    phases.push(phase('inspect', 'passed', 'FINAL_STATE_OBSERVED'))
    return createResult(plan, outcomes, phases, { status: 'not-needed' })
  }

  const lockResult = acquireApplyLock(root, root, plan.planFingerprint, runtime)
  if (isLockFailure(lockResult)) {
    phases.push(phase('lock', lockResult.unknown ? 'unknown' : 'failed', lockResult.reason))
    return createResult(
      plan,
      plan.operations.map((operation) =>
        operationResult(
          operation,
          lockResult.unknown ? 'unknown' : 'conflicted',
          lockResult.reason,
        ),
      ),
      phases,
      { status: lockResult.unknown ? 'unknown' : 'not-needed' },
    )
  }
  const lock = lockResult
  phases.push(phase('lock', 'passed', 'LOCK_ACQUIRED'))
  runtime.checkpoint('after-lock', {})

  let preparedManagerPhases: PreparedManagerPhases | undefined
  if (plan.execution.mode !== 'file-only') {
    const prepared = await prepareManagerPhases(root, plan, lock)
    if ('reason' in prepared) {
      phases.push(prepared.phase)
      phases.push(
        phase(
          plan.execution.mode === 'install' ? 'install' : 'sync-lockfile',
          'skipped',
          'MANAGER_PREFLIGHT_FAILED',
        ),
      )
      if (plan.execution.artifactVerification) {
        phases.push(phase('artifact-verify', 'skipped', 'MANAGER_PREFLIGHT_FAILED'))
      }
      if (plan.execution.verification) {
        phases.push(phase('verify', 'skipped', 'MANAGER_PREFLIGHT_FAILED'))
      }
      const cleaned = cleanupBeforeJournal(lock, [])
      phases.push(
        phase('cleanup', cleaned ? 'passed' : 'unknown', cleaned ? 'CLEAN' : 'CLEANUP_INCOMPLETE'),
      )
      const hasMutation = prepared.unrecoveredPaths.length > 0
      return createResult(
        plan,
        plan.operations.map((operation) =>
          operationResult(
            operation,
            prepared.unknown || !cleaned ? 'unknown' : hasMutation ? 'failed' : 'conflicted',
            prepared.reason,
          ),
        ),
        phases,
        hasMutation
          ? {
              status: prepared.unknown || !cleaned ? 'unknown' : 'partial',
              unrecoveredPaths: prepared.unrecoveredPaths,
            }
          : recoveryAfterCleanup(lock, cleaned),
      )
    }
    preparedManagerPhases = prepared
    phases.push(prepared.preflight)
  }

  let journal: JournalHandle | undefined
  try {
    stageTargets(root, activeGroups, lock.owner.runId, runtime)
    journal = createJournal(
      lock,
      plan.planFingerprint,
      activeGroups.map((group) => ({
        file: group.file,
        sourceHash: group.original.hash,
        stagedHash: required(group.stagedHash),
        stage: required(group.stageRelative),
        backup: required(group.backupRelative),
        mode: group.original.mode,
        state: 'staged' as const,
      })),
    )
    persistJournal(journal)
    runtime.checkpoint('after-journal-prepared', {})
    phases.push(phase('stage', 'passed', 'ALL_TARGETS_STAGED'))
  } catch {
    const released = journal
      ? finalizeCleanup(lock, journal, activeGroups)
      : cleanupBeforeJournal(lock, activeGroups)
    phases.push(phase('stage', 'failed', 'STAGING_FAILED'))
    phases.push(
      phase('cleanup', released ? 'passed' : 'unknown', released ? 'CLEAN' : 'CLEANUP_INCOMPLETE'),
    )
    const outcomes = observeFailedRun(root, groups)
    return createResult(
      plan,
      outcomes.map((outcome) =>
        outcome.reason === 'RUN_ABORTED' ? { ...outcome, reason: 'STAGING_FAILED' } : outcome,
      ),
      phases,
      recoveryAfterCleanup(lock, released),
    )
  }

  try {
    runtime.checkpoint('before-precommit', {})
    if (!ownsApplyLock(lock)) throw new ApplyRunError('LOCK_LOST')
    const recheckFailure = recheckAllTargets(root, plan, groups, vcsEvidenceObserver)
    if (recheckFailure) throw new ApplyRunError(recheckFailure.reason, recheckFailure.unknown)
    runtime.checkpoint('after-precommit', {})
    phases.push(phase('precommit', 'passed', 'ALL_TARGETS_RECHECKED'))
  } catch (error) {
    const runError = asRunError(error, 'PRECOMMIT_FAILED')
    const released = finalizeCleanup(lock, journal, activeGroups)
    phases.push(phase('precommit', runError.unknown ? 'unknown' : 'failed', runError.reason))
    phases.push(
      phase('cleanup', released ? 'passed' : 'unknown', released ? 'CLEAN' : 'CLEANUP_INCOMPLETE'),
    )
    return createResult(
      plan,
      plan.operations.map((operation) =>
        operationResult(
          operation,
          runError.unknown || !released ? 'unknown' : 'conflicted',
          !released ? 'CLEANUP_INCOMPLETE' : runError.reason,
        ),
      ),
      phases,
      recoveryAfterCleanup(lock, released, journal),
    )
  }

  let commitError: ApplyRunError | undefined
  let commitFailureIndex: number | undefined
  let managerPhaseExecution: ManagerPhaseExecution | undefined
  try {
    journal.value.state = 'committing'
    persistJournal(journal)
  } catch {
    commitError = new ApplyRunError('JOURNAL_WRITE_FAILED')
  }
  for (let index = 0; !commitError && index < activeGroups.length; index += 1) {
    const group = activeGroups[index]!
    try {
      if (!ownsApplyLock(lock)) throw new ApplyRunError('LOCK_LOST', true)
      const current = readSnapshot(root, group.file)
      if (!sameSource(current, group.original)) throw new ApplyRunError('SOURCE_CHANGED')
      const target = journal.value.targets[index]!
      target.state = 'replacing'
      persistJournal(journal)
      runtime.checkpoint('before-replace', {
        file: group.file,
        index,
        source: group.stagePath,
        target: group.original.absolutePath,
      })
      if (!ownsApplyLock(lock)) throw new ApplyRunError('LOCK_LOST', true)
      const finalTarget = readSnapshot(root, group.file)
      if (!sameSource(finalTarget, group.original)) throw new ApplyRunError('SOURCE_CHANGED')
      if (!matchesStagedArtifact(root, group)) {
        throw new ApplyRunError('STAGED_SOURCE_CHANGED')
      }
      if (!matchesBackupArtifact(root, group)) {
        throw new ApplyRunError('BACKUP_SOURCE_CHANGED')
      }
      group.replacementAttempted = true
      emitExecutionEvidence(executionEvidenceObserver, {
        targetPath: group.file,
        operationIds: group.operations.map((operation) => operation.id),
        replacementAttempted: true,
      })
      runtime.rename(required(group.stagePath), group.original.absolutePath)
      runtime.checkpoint('after-replace', {
        file: group.file,
        index,
        source: group.stagePath,
        target: group.original.absolutePath,
      })
      group.replaced = true
      fsyncDirectory(group.original.parentPath)
      runtime.checkpoint('after-directory-fsync', { file: group.file, index })
      target.state = 'replaced'
      persistJournal(journal)
      runtime.checkpoint('after-journal-replaced', { file: group.file, index })
    } catch (error) {
      commitError = asRunError(error, 'COMMIT_FAILED')
      commitFailureIndex = index
      break
    }
  }

  if (commitError && activeGroups.every((group) => !group.replacementAttempted)) {
    const zeroReplacementError = commitError
    phases.push(
      phase(
        'commit',
        zeroReplacementError.unknown ? 'unknown' : 'failed',
        zeroReplacementError.reason,
      ),
    )
    const released = finalizeCleanup(lock, journal, activeGroups)
    phases.push(
      phase('cleanup', released ? 'passed' : 'unknown', released ? 'CLEAN' : 'CLEANUP_INCOMPLETE'),
    )
    const isConflict = isPreconditionConflict(zeroReplacementError.reason)
    const abortedOutcomes = observeFailedRun(root, groups)
    const zeroReplacementOutcomes = zeroReplacementError.unknown
      ? plan.operations.map((operation) =>
          operationResult(operation, 'unknown', zeroReplacementError.reason),
        )
      : isConflict
        ? plan.operations.map((operation) =>
            operationResult(operation, 'conflicted', zeroReplacementError.reason),
          )
        : abortedOutcomes.map((outcome) => ({
            ...outcome,
            reason: outcome.reason === 'RUN_ABORTED' ? zeroReplacementError.reason : outcome.reason,
          }))
    return createResult(
      plan,
      released
        ? zeroReplacementOutcomes
        : zeroReplacementOutcomes.map((outcome) => ({
            ...outcome,
            status: 'unknown' as const,
            reason: 'CLEANUP_INCOMPLETE',
          })),
      phases,
      recoveryAfterCleanup(lock, released, journal),
    )
  }

  if (!commitError) {
    phases.push(phase('commit', 'passed', 'ALL_FILES_REPLACED'))
    if (preparedManagerPhases) {
      try {
        managerPhaseExecution = await executeManagerPhases(
          root,
          plan,
          preparedManagerPhases,
          lock,
          journal,
          process.env,
          new Date(runtime.now()).toISOString(),
        )
      } catch {
        managerPhaseExecution = {
          success: false,
          unknown: true,
          reason: 'PHASE_OBSERVATION_FAILED',
          phases: [
            phase(
              plan.execution.mode === 'install' ? 'install' : 'sync-lockfile',
              'unknown',
              'PHASE_OBSERVATION_FAILED',
            ),
            ...(plan.execution.artifactVerification
              ? [phase('artifact-verify', 'skipped', 'PHASE_OBSERVATION_FAILED')]
              : []),
            ...(plan.execution.verification
              ? [phase('verify', 'skipped', 'PHASE_OBSERVATION_FAILED')]
              : []),
          ],
          restoredPaths: [],
          unrecoveredPaths: plan.execution.targets.map((target) => target.lockfile.path),
          externalEffects: [
            ...new Set(plan.execution.targets.flatMap((target) => target.adapter.externalEffects)),
          ],
          artifactsClean: false,
        }
      }
      phases.push(...managerPhaseExecution.phases)
      if (!managerPhaseExecution.success) {
        commitError = new ApplyRunError(managerPhaseExecution.reason, managerPhaseExecution.unknown)
      }
    }
  }

  if (!commitError) {
    runtime.checkpoint('before-final-observation', {})
    const outcomes = observeSuccessfulOutcomes(root, groups, false)
    const observedFailure = outcomes.some(
      (outcome) => outcome.status === 'failed' || outcome.status === 'unknown',
    )
    if (!observedFailure) {
      phases.push(phase('inspect', 'passed', 'FINAL_STATE_OBSERVED'))
      const released = finalizeCleanup(lock, journal, activeGroups)
      phases.push(
        phase(
          'cleanup',
          released ? 'passed' : 'unknown',
          released ? 'CLEAN' : 'CLEANUP_INCOMPLETE',
        ),
      )
      if (!released) {
        return createResult(
          plan,
          outcomes.map((outcome) => ({
            ...outcome,
            status: 'unknown',
            reason: 'CLEANUP_INCOMPLETE',
          })),
          phases,
          withManagerRecovery(recoveryAfterCleanup(lock, false, journal), managerPhaseExecution),
        )
      }
      return createResult(plan, outcomes, phases, { status: 'not-needed' })
    }
    commitError = new ApplyRunError('FINAL_OBSERVATION_FAILED', true)
  }

  if (!phases.some((entry) => entry.name === 'commit')) {
    phases.push(phase('commit', commitError.unknown ? 'unknown' : 'failed', commitError.reason))
  }
  let recovery = recoverTargets(root, activeGroups, lock, journal, runtime)
  phases.push(
    phase(
      'recovery',
      recovery.status === 'completed'
        ? 'passed'
        : recovery.status === 'unknown'
          ? 'unknown'
          : 'failed',
      recovery.status === 'completed' ? 'RECOVERY_COMPLETED' : 'RECOVERY_INCOMPLETE',
    ),
  )
  runtime.checkpoint('before-final-observation', {})
  let outcomes = observeFailedRun(root, groups)
  if (
    commitFailureIndex !== undefined &&
    isPreconditionConflict(commitError.reason) &&
    !activeGroups[commitFailureIndex]?.replacementAttempted
  ) {
    const failedGroup = activeGroups[commitFailureIndex]!
    const failedIds = new Set(failedGroup.operations.map((operation) => operation.id))
    outcomes = outcomes.map((outcome) =>
      failedIds.has(outcome.operationId) && outcome.status !== 'unknown'
        ? { ...outcome, status: 'conflicted' as const, reason: commitError.reason }
        : outcome,
    )
  }
  if (recovery.status === 'unknown') {
    outcomes = outcomes.map((outcome) => ({
      ...outcome,
      status: 'unknown',
      reason: commitError.reason,
    }))
  }
  phases.push(
    phase(
      'inspect',
      outcomes.some((outcome) => outcome.status === 'unknown') ? 'unknown' : 'passed',
      'FINAL_STATE_OBSERVED',
    ),
  )
  const finalStateKnown = outcomes.every(
    (outcome) =>
      outcome.reason === 'COMMIT_FAILED_REVERTED' ||
      outcome.reason === 'RUN_ABORTED' ||
      (outcome.status === 'conflicted' && isPreconditionConflict(outcome.reason)),
  )
  if (recovery.status === 'completed' && finalStateKnown) {
    const released = finalizeCleanup(lock, journal, activeGroups)
    phases.push(
      phase('cleanup', released ? 'passed' : 'unknown', released ? 'CLEAN' : 'CLEANUP_INCOMPLETE'),
    )
    if (!released) {
      return createResult(
        plan,
        outcomes.map((outcome) => ({
          ...outcome,
          status: 'unknown',
          reason: 'CLEANUP_INCOMPLETE',
        })),
        phases,
        withManagerRecovery(
          { ...recovery, ...recoveryAfterCleanup(lock, false, journal) },
          managerPhaseExecution,
        ),
      )
    }
    return createResult(
      plan,
      outcomes,
      phases,
      withManagerRecovery(recovery, managerPhaseExecution),
    )
  }

  if (recovery.status === 'completed') {
    recovery = {
      ...recovery,
      status: outcomes.some((outcome) => outcome.status === 'unknown') ? 'unknown' : 'partial',
    }
  }

  journal.value.state = 'failed'
  try {
    persistJournal(journal)
  } catch {}
  phases.push(phase('cleanup', 'unknown', 'RECOVERY_EVIDENCE_RETAINED'))
  return createResult(
    plan,
    outcomes,
    phases,
    withManagerRecovery(
      {
        ...recovery,
        journalId: lock.owner.runId,
      },
      managerPhaseExecution,
    ),
  )
}

function emitInitialExecutionEvidence(
  plan: PlanResult,
  observer: ApplyExecutionEvidenceObserver | undefined,
): void {
  if (!observer) return
  const operationsByTarget = new Map<string, string[]>()
  for (const operation of plan.operations) {
    const operationIds = operationsByTarget.get(operation.file)
    if (operationIds) operationIds.push(operation.id)
    else operationsByTarget.set(operation.file, [operation.id])
  }
  for (const [targetPath, operationIds] of operationsByTarget) {
    emitExecutionEvidence(observer, { targetPath, operationIds, replacementAttempted: false })
  }
}

function emitExecutionEvidence(
  observer: ApplyExecutionEvidenceObserver | undefined,
  evidence: ApplyExecutionEvidence,
): void {
  if (!observer) return
  try {
    observer(evidence)
  } catch {}
}

function validateExecutionAuthority(plan: PlanResult, authority: InvocationAuthority): void {
  const phaseRequired =
    plan.operations.length > 0 &&
    plan.execution.status === 'ready' &&
    plan.execution.mode !== 'file-only'
  const installRequired = phaseRequired && plan.execution.mode === 'install'
  const verifyRequired = phaseRequired && plan.execution.verification !== undefined
  const artifactRequired = phaseRequired && plan.execution.artifactVerification !== undefined
  const grants: Array<[boolean, boolean, string]> = [
    [phaseRequired, authority.processExecute, 'process-execute'],
    [phaseRequired, authority.lockfileWrite, 'lockfile-write'],
    [installRequired, authority.install, 'install'],
    [verifyRequired, authority.verifyCommand, 'verify-command'],
    [artifactRequired, authority.artifactVerify, 'artifact-verify'],
    [artifactRequired, authority.networkAccess, 'network-access'],
  ]
  for (const [required, granted, capability] of grants) {
    if (required && !granted) {
      throw new ConfigError(`Applying this plan requires explicit ${capability} authority.`, {
        reason: 'AUTHORITY_REQUIRED',
      })
    }
    if (!required && granted) {
      throw new ConfigError(`${capability} authority does not match this plan.`, {
        reason: 'AUTHORITY_MISMATCH',
      })
    }
  }
}

function withManagerRecovery(
  recovery: ApplyResult['recovery'],
  execution: ManagerPhaseExecution | undefined,
): ApplyResult['recovery'] {
  if (!execution || execution.success) return recovery
  const status =
    recovery.status === 'completed' && execution.unknown
      ? 'unknown'
      : recovery.status === 'completed' && execution.unrecoveredPaths.length > 0
        ? 'partial'
        : recovery.status
  return {
    ...recovery,
    status,
    ...((recovery.restoredPaths?.length ?? 0) + execution.restoredPaths.length === 0
      ? {}
      : {
          restoredPaths: [
            ...new Set([...(recovery.restoredPaths ?? []), ...execution.restoredPaths]),
          ],
        }),
    ...((recovery.unrecoveredPaths?.length ?? 0) + execution.unrecoveredPaths.length === 0
      ? {}
      : {
          unrecoveredPaths: [
            ...new Set([...(recovery.unrecoveredPaths ?? []), ...execution.unrecoveredPaths]),
          ],
        }),
    ...((recovery.externalEffects?.length ?? 0) + execution.externalEffects.length === 0
      ? {}
      : {
          externalEffects: [
            ...new Set([...(recovery.externalEffects ?? []), ...execution.externalEffects]),
          ],
        }),
  }
}

function validateInputs(plan: unknown, options: ApplyOptions): void {
  try {
    assertPlainDataInput(plan)
    assertPlainDataInput(options)
  } catch {
    throw new ConfigError('Apply inputs must be plain JSON data.', { reason: 'INVALID_CONFIG' })
  }
  if (!plan || typeof plan !== 'object') return
  const candidate = plan as { operations?: unknown }
  if (!Array.isArray(candidate.operations)) return
  for (const operation of candidate.operations) {
    if (!operation || typeof operation !== 'object') continue
    const value = operation as Record<string, unknown>
    for (const field of ['file', 'name', 'expectedValue', 'requestedValue']) {
      if (typeof value[field] === 'string' && !isContractSafeText(value[field] as string)) {
        throw new ConfigError('Apply plan contains non-public operation data.', {
          reason: 'INVALID_CONFIG',
        })
      }
    }
    if (
      Array.isArray(value.path) &&
      value.path.some((segment) => typeof segment === 'string' && !isContractSafeText(segment))
    ) {
      throw new ConfigError('Apply plan contains non-public operation data.', {
        reason: 'INVALID_CONFIG',
      })
    }
  }
}

function canonicalRoot(cwd: string): string | undefined {
  try {
    const root = realpathSync.native(resolve(cwd))
    return statSync(root).isDirectory() ? root : undefined
  } catch {
    return undefined
  }
}

function preflightTargets(root: string, plan: PlanResult): TargetGroup[] | PreflightFailure {
  const byFile = new Map<string, ApplyOperation[]>()
  const occurrenceKeys = new Set<string>()
  for (const operation of plan.operations) {
    const key = `${operation.file}\0${operation.path.join('\0')}`
    if (occurrenceKeys.has(key)) return { reason: 'DUPLICATE_OPERATION', unknown: false }
    occurrenceKeys.add(key)
    const matching = byFile.get(operation.file) ?? []
    matching.push(operation)
    byFile.set(operation.file, matching)
  }

  const identities = new Set<string>()
  const sourceFiles = new Map(plan.repository.sourceFiles.map((source) => [source.id, source]))
  const groups: TargetGroup[] = []
  for (const [file, operations] of [...byFile.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    let snapshot: FileSnapshot
    try {
      snapshot = readSnapshot(root, file)
    } catch (error) {
      return {
        reason: error instanceof ApplyRunError ? error.reason : 'READ_FAILED',
        unknown: false,
      }
    }
    const identity = `${snapshot.dev}:${snapshot.ino}`
    if (identities.has(identity) || snapshot.nlink > 1n) {
      return { reason: 'TARGET_IDENTITY_AMBIGUOUS', unknown: false }
    }
    identities.add(identity)
    if (operations.some((operation) => operation.sourceByteHash !== snapshot.hash)) {
      return { reason: 'SOURCE_HASH_MISMATCH', unknown: false }
    }
    const source = sourceFiles.get(operations[0]!.sourceFileId)
    if (
      !source ||
      source.path !== file ||
      operations.some((operation) => operation.sourceFileId !== source.id)
    ) {
      return { reason: 'SOURCE_IDENTITY_MISMATCH', unknown: false }
    }
    const format = source.format
    let values: Map<string, string | undefined>
    try {
      values = observeValues(snapshot.bytes, format, operations)
    } catch {
      return { reason: 'PARSE_FAILED', unknown: false }
    }
    if (operations.some((operation) => values.get(operation.id) !== operation.expectedValue)) {
      return { reason: 'EXPECTED_VALUE_MISMATCH', unknown: false }
    }
    groups.push({
      file,
      operations,
      format,
      indent: source.indent,
      original: snapshot,
      stageOwned: false,
      backupOwned: false,
      replacementAttempted: false,
      replaced: false,
      restored: false,
    })
  }
  return groups
}

function readSnapshot(root: string, file: string): FileSnapshot {
  const contained = resolveContainedPath(root, file)
  if (!contained.allowed) throw new ApplyRunError('TARGET_NOT_CONTAINED')
  const absolutePath = resolve(root, file)
  const lexical = lstatSync(absolutePath, { bigint: true })
  if (!lexical.isFile() || lexical.isSymbolicLink())
    throw new ApplyRunError('TARGET_NOT_REGULAR_FILE')
  const descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(descriptor, { bigint: true })
    if (!stat.isFile()) throw new ApplyRunError('TARGET_NOT_REGULAR_FILE')
    const canonicalPath = realpathSync.native(absolutePath)
    if (canonicalPath !== contained.path) throw new ApplyRunError('TARGET_IDENTITY_MISMATCH')
    const bytes = readFileSync(descriptor)
    return {
      relativePath: file,
      absolutePath,
      canonicalPath,
      parentPath: realpathSync.native(dirname(absolutePath)),
      bytes,
      hash: hashExactBytes(bytes),
      dev: stat.dev,
      ino: stat.ino,
      mode: Number(stat.mode & 0o777n),
      nlink: stat.nlink,
    }
  } finally {
    closeSync(descriptor)
  }
}

function validateTargetVcs(
  root: string,
  plan: PlanResult,
  targets: string[],
  observer?: ApplyVcsEvidenceObserver,
): PreflightFailure | undefined {
  const current = collectVcsEvidence(root, targets)
  emitVcsEvidence(observer, current)
  const plannedNonRepository = isNonRepository(plan.vcs)
  const currentNonRepository = isNonRepository(current)
  if (plannedNonRepository && currentNonRepository) return undefined
  if (plan.vcs.status !== 'confirmed' || current.status !== 'confirmed') {
    return { reason: 'VCS_UNAVAILABLE', unknown: true }
  }
  const planned = new Map(plan.vcs.targetFiles.map((target) => [target.path, target.state]))
  const observed = new Map(current.targetFiles.map((target) => [target.path, target.state]))
  for (const target of targets) {
    const state = observed.get(target)
    if (!(state && isAllowedTargetState(state))) {
      return { reason: 'TARGET_DIRTY', unknown: false }
    }
    if (planned.get(target) !== state) {
      return { reason: 'VCS_STATE_MISMATCH', unknown: false }
    }
  }
  return undefined
}

function isNonRepository(
  vcs: Pick<RepositoryVcsEvidence, 'status' | 'diagnostics'> | PlanResult['vcs'],
): boolean {
  return (
    vcs.status === 'unavailable' &&
    vcs.diagnostics.length > 0 &&
    vcs.diagnostics.every((diagnostic) => diagnostic.code === 'VCS_NOT_REPOSITORY')
  )
}

function isAllowedTargetState(state: RepositoryVcsTargetStateName): boolean {
  return state === 'clean' || state === 'ignored'
}

function stageTargets(
  root: string,
  groups: TargetGroup[],
  runId: string,
  runtime: ApplyRuntime,
): void {
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!
    const rendered = renderFile(group.original.bytes, group.format, group.operations, group.indent)
    if (
      group.operations.some(
        (operation) => rendered.values.get(operation.id) !== operation.requestedValue,
      )
    ) {
      throw new ApplyRunError('STAGED_VALUE_MISMATCH')
    }
    const prefix = `.${basename(group.original.absolutePath)}.depfresh-${runId}`
    const stagePath = join(group.original.parentPath, `${prefix}.stage`)
    const backupPath = join(group.original.parentPath, `${prefix}.backup`)
    group.stagePath = stagePath
    group.backupPath = backupPath
    group.stageRelative = rootRelative(root, stagePath)
    group.backupRelative = rootRelative(root, backupPath)
    writeExclusive(stagePath, rendered.bytes, group.original.mode, (identity) => {
      group.stageOwned = true
      group.stageIdentity = identity
    })
    fsyncDirectory(group.original.parentPath)
    runtime.checkpoint('after-stage-write', { file: group.file, index, target: stagePath })
    runtime.checkpoint('after-stage-fsync', { file: group.file, index, target: stagePath })
    const stagedSnapshot = readSnapshot(root, group.stageRelative)
    if (
      stagedSnapshot.dev !== group.original.dev ||
      stagedSnapshot.nlink !== 1n ||
      stagedSnapshot.hash !== hashExactBytes(rendered.bytes)
    ) {
      throw new ApplyRunError('STAGED_SOURCE_CHANGED')
    }
    const reparsed = observeValues(stagedSnapshot.bytes, group.format, group.operations)
    if (
      group.operations.some((operation) => reparsed.get(operation.id) !== operation.requestedValue)
    ) {
      throw new ApplyRunError('STAGED_VALUE_MISMATCH')
    }
    runtime.checkpoint('after-stage-validation', { file: group.file, index, target: stagePath })
    writeExclusive(backupPath, group.original.bytes, group.original.mode, (identity) => {
      group.backupOwned = true
      group.backupIdentity = identity
    })
    fsyncDirectory(group.original.parentPath)
    runtime.checkpoint('after-backup-fsync', { file: group.file, index, target: backupPath })
    const backupSnapshot = readSnapshot(root, group.backupRelative)
    if (
      backupSnapshot.dev !== group.original.dev ||
      backupSnapshot.nlink !== 1n ||
      backupSnapshot.hash !== group.original.hash
    ) {
      throw new ApplyRunError('BACKUP_HASH_MISMATCH')
    }
    group.stagedBytes = rendered.bytes
    group.stagedHash = hashExactBytes(rendered.bytes)
    group.stagedSnapshot = stagedSnapshot
    group.backupSnapshot = backupSnapshot
  }
}

function writeExclusive(
  path: string,
  bytes: Buffer,
  mode: number,
  onCreated: (identity: { dev: bigint; ino: bigint }) => void,
): void {
  const descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode)
  const created = fstatSync(descriptor, { bigint: true })
  onCreated({ dev: created.dev, ino: created.ino })
  try {
    writeFileSync(descriptor, bytes)
    fchmodSync(descriptor, mode)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function rootRelative(root: string, path: string): string {
  const value = relative(root, path)
  if (value === '..' || value.startsWith(`..${sep}`))
    throw new ApplyRunError('TARGET_NOT_CONTAINED')
  return value.split(sep).join('/')
}

function recheckAllTargets(
  root: string,
  plan: PlanResult,
  groups: TargetGroup[],
  vcsEvidenceObserver?: ApplyVcsEvidenceObserver,
): PreflightFailure | undefined {
  for (const group of groups) {
    let current: FileSnapshot
    try {
      current = readSnapshot(root, group.file)
    } catch {
      return { reason: 'SOURCE_CHANGED', unknown: false }
    }
    if (!sameSource(current, group.original)) {
      return { reason: 'SOURCE_CHANGED', unknown: false }
    }
    if (group.stageOwned && !matchesStagedArtifact(root, group)) {
      return { reason: 'STAGED_SOURCE_CHANGED', unknown: false }
    }
    if (group.backupOwned && !matchesBackupArtifact(root, group)) {
      return { reason: 'BACKUP_SOURCE_CHANGED', unknown: false }
    }
    try {
      const values = observeValues(current.bytes, group.format, group.operations)
      if (
        group.operations.some((operation) => values.get(operation.id) !== operation.expectedValue)
      ) {
        return { reason: 'EXPECTED_VALUE_MISMATCH', unknown: false }
      }
    } catch {
      return { reason: 'PARSE_FAILED', unknown: false }
    }
  }
  return validateTargetVcs(
    root,
    plan,
    groups.map((group) => group.file),
    vcsEvidenceObserver,
  )
}

function emitVcsEvidence(
  observer: ApplyVcsEvidenceObserver | undefined,
  evidence: RepositoryVcsEvidence,
): void {
  if (!observer) return
  try {
    observer(evidence)
  } catch {}
}

function sameSource(left: FileSnapshot, right: FileSnapshot): boolean {
  return (
    left.canonicalPath === right.canonicalPath &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.hash === right.hash &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.nlink === 1n
  )
}

function sameArtifact(left: FileSnapshot, right: FileSnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.hash === right.hash &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.nlink === 1n
  )
}

function matchesStagedArtifact(root: string, group: TargetGroup): boolean {
  try {
    return sameArtifact(
      readSnapshot(root, required(group.stageRelative)),
      required(group.stagedSnapshot),
    )
  } catch {
    return false
  }
}

function matchesBackupArtifact(root: string, group: TargetGroup): boolean {
  try {
    return sameArtifact(
      readSnapshot(root, required(group.backupRelative)),
      required(group.backupSnapshot),
    )
  } catch {
    return false
  }
}

function observeSuccessfulOutcomes(
  root: string,
  groups: TargetGroup[],
  allSkipped: boolean,
): ApplyOperationResult[] {
  const outcomes: ApplyOperationResult[] = []
  for (const group of groups) {
    let snapshot: FileSnapshot
    let values: Map<string, string | undefined>
    try {
      snapshot = readSnapshot(root, group.file)
      const expectedPhysical = group.stagedSnapshot ?? group.original
      if (!sameArtifact(snapshot, expectedPhysical)) throw new ApplyRunError('SOURCE_CHANGED')
      values = observeValues(snapshot.bytes, group.format, group.operations)
    } catch {
      outcomes.push(
        ...group.operations.map((operation) =>
          operationResult(operation, 'unknown', 'OBSERVATION_FAILED'),
        ),
      )
      continue
    }
    const observedByteHash = snapshot.hash
    const expectedByteHash = group.stagedHash ?? group.original.hash
    const fileMatches = observedByteHash === expectedByteHash
    for (const operation of group.operations) {
      const observedValue = values.get(operation.id)
      const skipped = allSkipped || operation.expectedValue === operation.requestedValue
      outcomes.push(
        operationResult(
          operation,
          observedValue === operation.requestedValue && fileMatches
            ? skipped
              ? 'skipped'
              : 'applied'
            : 'failed',
          observedValue === operation.requestedValue && fileMatches
            ? skipped
              ? 'NO_CHANGE'
              : 'APPLIED'
            : 'FINAL_STATE_MISMATCH',
          observedValue,
          observedByteHash,
        ),
      )
    }
  }
  return outcomes
}

function recoverTargets(
  root: string,
  groups: TargetGroup[],
  lock: ApplyLock,
  journal: JournalHandle,
  runtime: ApplyRuntime,
): LocalRecoveryResult {
  journal.value.state = 'recovering'
  try {
    persistJournal(journal)
  } catch {}
  let failed = false
  let unknown = false
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!
    if (!group.replacementAttempted) continue
    try {
      if (!ownsApplyLock(lock)) throw new ApplyRunError('LOCK_LOST', true)
      const current = readSnapshot(root, group.file)
      if (sameSource(current, group.original)) {
        group.restored = true
        journal.value.targets[index]!.state = 'restored'
        continue
      }
      if (!sameArtifact(current, required(group.stagedSnapshot))) {
        throw new ApplyRunError('RECOVERY_TARGET_CHANGED')
      }
      if (!matchesBackupArtifact(root, group)) throw new ApplyRunError('BACKUP_HASH_MISMATCH')
      const backupPath = required(group.backupPath)
      runtime.checkpoint('before-recover', {
        file: group.file,
        index,
        source: backupPath,
        target: group.original.absolutePath,
      })
      if (!ownsApplyLock(lock)) throw new ApplyRunError('LOCK_LOST', true)
      const finalCurrent = readSnapshot(root, group.file)
      if (!sameArtifact(finalCurrent, required(group.stagedSnapshot))) {
        throw new ApplyRunError('RECOVERY_TARGET_CHANGED')
      }
      if (!matchesBackupArtifact(root, group)) throw new ApplyRunError('BACKUP_HASH_MISMATCH')
      runtime.rename(backupPath, group.original.absolutePath)
      runtime.checkpoint('after-recover-rename', { file: group.file, index })
      fsyncDirectory(group.original.parentPath)
      const restored = readSnapshot(root, group.file)
      if (!sameArtifact(restored, required(group.backupSnapshot))) {
        throw new ApplyRunError('RECOVERY_STATE_MISMATCH')
      }
      group.restored = true
      journal.value.targets[index]!.state = 'restored'
      persistJournal(journal)
    } catch (error) {
      failed = true
      if (error instanceof ApplyRunError && error.unknown) unknown = true
      journal.value.targets[index]!.state = 'recovery-failed'
      try {
        readSnapshot(root, group.file)
      } catch {
        unknown = true
      }
      try {
        persistJournal(journal)
      } catch {}
    }
  }
  if (!failed) {
    journal.value.state = 'recovered'
    try {
      persistJournal(journal)
    } catch {
      return recoveryResult(groups, 'unknown')
    }
    return recoveryResult(groups, 'completed')
  }
  return recoveryResult(groups, unknown ? 'unknown' : 'partial')
}

function recoveryResult(
  groups: readonly TargetGroup[],
  status: LocalRecoveryResult['status'],
): LocalRecoveryResult {
  const attempted = groups.filter((group) => group.replacementAttempted)
  return {
    status,
    restoredPaths: attempted.filter((group) => group.restored).map((group) => group.file),
    unrecoveredPaths: attempted.filter((group) => !group.restored).map((group) => group.file),
  }
}

function observeFailedRun(root: string, groups: TargetGroup[]): ApplyOperationResult[] {
  const outcomes: ApplyOperationResult[] = []
  for (const group of groups) {
    let snapshot: FileSnapshot
    let values: Map<string, string | undefined>
    try {
      snapshot = readSnapshot(root, group.file)
      values = observeValues(snapshot.bytes, group.format, group.operations)
    } catch {
      outcomes.push(
        ...group.operations.map((operation) =>
          operationResult(operation, 'unknown', 'OBSERVATION_FAILED'),
        ),
      )
      continue
    }
    const hash = snapshot.hash
    if (snapshot.nlink !== 1n) {
      outcomes.push(
        ...group.operations.map((operation) =>
          operationResult(operation, 'unknown', 'TARGET_IDENTITY_AMBIGUOUS'),
        ),
      )
      continue
    }
    for (const operation of group.operations) {
      const observedValue = values.get(operation.id)
      if (
        hash === group.original.hash &&
        snapshot.mode === group.original.mode &&
        observedValue === operation.expectedValue
      ) {
        outcomes.push(
          operationResult(
            operation,
            group.replacementAttempted ? 'reverted' : 'failed',
            group.replacementAttempted ? 'COMMIT_FAILED_REVERTED' : 'RUN_ABORTED',
            observedValue,
            hash,
          ),
        )
      } else {
        outcomes.push(operationResult(operation, 'failed', 'RECOVERY_FAILED', observedValue, hash))
      }
    }
  }
  return outcomes
}

function cleanupTemporaryFiles(root: string, groups: TargetGroup[]): boolean {
  let clean = true
  for (const group of groups) {
    clean = removeOwnedArtifact(root, group.stageRelative, group.stageIdentity, group.stageOwned)
      ? clean
      : false
    clean = removeOwnedArtifact(root, group.backupRelative, group.backupIdentity, group.backupOwned)
      ? clean
      : false
  }
  return clean
}

function removeOwnedArtifact(
  root: string,
  relativePath: string | undefined,
  ownedIdentity: { dev: bigint; ino: bigint } | undefined,
  owned: boolean,
): boolean {
  if (!(owned && relativePath && ownedIdentity)) return true
  const absolutePath = resolve(root, relativePath)
  try {
    lstatSync(absolutePath)
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
  }
  try {
    const current = readSnapshot(root, relativePath)
    if (current.dev !== ownedIdentity.dev || current.ino !== ownedIdentity.ino) return false
    rmSync(absolutePath)
    fsyncDirectory(dirname(absolutePath))
    return true
  } catch {
    return false
  }
}

function finalizeCleanup(lock: ApplyLock, journal: JournalHandle, groups: TargetGroup[]): boolean {
  if (!ownsApplyLock(lock)) return false
  if (!ownsJournal(journal)) return false
  if (!cleanupTemporaryFiles(dirname(lock.stateRoot), groups)) return false
  if (!removeJournal(journal)) return false
  if (!releaseApplyLock(lock)) return false
  cleanupApplyStateRoot(lock.stateRoot)
  return true
}

function cleanupBeforeJournal(lock: ApplyLock, groups: TargetGroup[]): boolean {
  if (!ownsApplyLock(lock)) return false
  if (existsSync(join(lock.stateRoot, lock.owner.journal))) return false
  const temporaryClean = cleanupTemporaryFiles(dirname(lock.stateRoot), groups)
  const released = releaseApplyLock(lock)
  cleanupApplyStateRoot(lock.stateRoot)
  return temporaryClean && released
}

function recoveryAfterCleanup(
  lock: ApplyLock,
  clean: boolean,
  journal?: JournalHandle,
): ApplyResult['recovery'] {
  if (clean) return { status: 'not-needed' }
  const journalExists = existsSync(journal?.path ?? join(lock.stateRoot, lock.owner.journal))
  return {
    status: 'unknown',
    ...(journalExists ? { journalId: lock.owner.runId } : {}),
  }
}

function blockedResult(
  plan: PlanResult,
  phases: ApplyPhase[],
  reason: string,
  unknown: boolean,
): ApplyResult {
  phases.push(phase('preflight', unknown ? 'unknown' : 'failed', reason))
  if (
    plan.operations.length > 0 &&
    plan.execution.status === 'ready' &&
    plan.execution.mode !== 'file-only'
  ) {
    const managerPhaseName = plan.execution.mode === 'install' ? 'install' : 'sync-lockfile'
    if (!phases.some((entry) => entry.name === managerPhaseName)) {
      phases.push(phase(managerPhaseName, 'skipped', 'PRECONDITION_FAILED'))
    }
    if (
      plan.execution.artifactVerification &&
      !phases.some((entry) => entry.name === 'artifact-verify')
    ) {
      phases.push(phase('artifact-verify', 'skipped', 'PRECONDITION_FAILED'))
    }
    if (plan.execution.verification && !phases.some((entry) => entry.name === 'verify')) {
      phases.push(phase('verify', 'skipped', 'PRECONDITION_FAILED'))
    }
  }
  return createResult(
    plan,
    plan.operations.map((operation) =>
      operationResult(operation, unknown ? 'unknown' : 'conflicted', reason),
    ),
    phases,
    { status: unknown ? 'unknown' : 'not-needed' },
  )
}

function operationResult(
  operation: ApplyOperation,
  status: ApplyOperationResult['status'],
  reason: string,
  observedValue?: string,
  observedByteHash?: string,
): ApplyOperationResult {
  return {
    operationId: operation.id,
    occurrenceId: operation.occurrenceId,
    sourceFileId: operation.sourceFileId,
    file: operation.file,
    path: [...operation.path],
    name: operation.name,
    expectedValue: operation.expectedValue,
    requestedValue: operation.requestedValue,
    ...(observedValue === undefined ? {} : { observedValue: sanitizeContractText(observedValue) }),
    ...(observedByteHash === undefined ? {} : { observedByteHash }),
    status,
    reason,
  }
}

function createResult(
  plan: PlanResult,
  operations: ApplyOperationResult[],
  phases: ApplyPhase[],
  recovery: ApplyResult['recovery'],
): ApplyResult {
  const completePhases = [...phases]
  if (
    plan.operations.length > 0 &&
    plan.execution.status === 'ready' &&
    plan.execution.mode !== 'file-only'
  ) {
    const managerPhaseName = plan.execution.mode === 'install' ? 'install' : 'sync-lockfile'
    const missing: ApplyPhase[] = []
    if (!completePhases.some((entry) => entry.name === managerPhaseName)) {
      missing.push(phase(managerPhaseName, 'skipped', 'PHASE_NOT_EXECUTED'))
    }
    if (
      plan.execution.artifactVerification &&
      !completePhases.some((entry) => entry.name === 'artifact-verify')
    ) {
      missing.push(phase('artifact-verify', 'skipped', 'PHASE_NOT_EXECUTED'))
    }
    if (plan.execution.verification && !completePhases.some((entry) => entry.name === 'verify')) {
      missing.push(phase('verify', 'skipped', 'PHASE_NOT_EXECUTED'))
    }
    const laterPhase = completePhases.findIndex((entry) =>
      ['recovery', 'inspect', 'cleanup'].includes(entry.name),
    )
    completePhases.splice(laterPhase < 0 ? completePhases.length : laterPhase, 0, ...missing)
  }
  const recoveryPhase = completePhases.findIndex((entry) => entry.name === 'recovery')
  if (recoveryPhase >= 0 && recovery.status !== 'completed' && recovery.status !== 'not-needed') {
    completePhases[recoveryPhase] = phase(
      'recovery',
      recovery.status === 'unknown' ? 'unknown' : 'failed',
      'RECOVERY_INCOMPLETE',
    )
  }
  const summary = summarizeWriteOutcomes(
    operations.map((operation) => ({
      name: operation.name,
      occurrence: { file: operation.file, path: [...operation.path] },
      expectedValue: operation.expectedValue,
      requestedValue: operation.requestedValue,
      ...(operation.observedValue === undefined ? {} : { observedValue: operation.observedValue }),
      status: operation.status,
      reason: 'WRITE_FAILED',
    })),
  )
  const status =
    recovery.status === 'unknown'
      ? 'unknown'
      : summary.unknown > 0
        ? 'unknown'
        : summary.failed > 0
          ? 'failed'
          : summary.reverted > 0
            ? 'reverted'
            : summary.conflicted > 0
              ? 'conflicted'
              : summary.applied > 0
                ? 'applied'
                : 'noop'
  const result: ApplyResult = {
    contract: 'depfresh.apply',
    schemaVersion: 1,
    toolVersion: version,
    planFingerprint: plan.planFingerprint,
    repositoryIdentity: plan.repository.identity,
    status,
    operations,
    phases: completePhases,
    summary,
    recovery,
    requiredCapabilities: applyCapabilities(plan),
  }
  assertApplyResult(result)
  return result
}

function applyCapabilities(plan: PlanResult): ApplyResult['requiredCapabilities'] {
  const capabilities: ApplyResult['requiredCapabilities'] = ['filesystem-read', 'file-write']
  if (
    plan.operations.length === 0 ||
    plan.execution.mode === 'file-only' ||
    plan.execution.status !== 'ready'
  ) {
    return capabilities
  }
  capabilities.push('process-execute', 'lockfile-write')
  if (plan.execution.mode === 'install') capabilities.push('install')
  if (plan.execution.artifactVerification) {
    capabilities.push('artifact-verify', 'network-access')
  }
  if (plan.execution.verification) capabilities.push('verify-command')
  return capabilities
}

function phase(name: ApplyPhase['name'], status: ApplyPhase['status'], reason: string): ApplyPhase {
  return { name, status, reason }
}

function isLockFailure(value: ApplyLock | ApplyLockFailure): value is ApplyLockFailure {
  return 'reason' in value
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new ApplyRunError('INTERNAL_STATE_MISSING', true)
  return value
}

class ApplyRunError extends Error {
  constructor(
    readonly reason: string,
    readonly unknown = false,
  ) {
    super(reason)
    this.name = 'ApplyRunError'
  }
}

function asRunError(error: unknown, fallback: string): ApplyRunError {
  return error instanceof ApplyRunError ? error : new ApplyRunError(fallback)
}

function isPreconditionConflict(reason: string): boolean {
  return (
    reason === 'SOURCE_CHANGED' ||
    reason === 'STAGED_SOURCE_CHANGED' ||
    reason === 'BACKUP_SOURCE_CHANGED'
  )
}
