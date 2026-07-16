import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import * as semver from 'semver'
import YAML from 'yaml'
import { NPM_ARTIFACT_VERIFIER_SUPPORT } from '../../contracts/artifact-verifier'
import { hashExactBytes } from '../../contracts/fingerprint'
import type { ApplyResult, PlanResult } from '../../contracts/schemas'
import { inspectRepository } from '../../repository/inspect'
import { applySignalPolicy } from '../../signals/policy'
import { classifyNpmAuditSignaturesFailure, parseNpmAuditSignatures } from '../../trust/npm-audit'
import type {
  ArtifactTrustDimensionResult,
  ArtifactVerificationTarget,
  PlanSignal,
  SignalReason,
} from '../../types'
import { fsyncDirectory, type JournalHandle, ownsJournal } from './journal'
import { type ApplyLock, ownsApplyLock } from './lock'
import {
  type ExecutableHandle,
  type ProcessObservation,
  resolveExecutable,
  runResolvedProcess,
} from './process-runner'
import { observeValues } from './render'

type ApplyPhase = ApplyResult['phases'][number]
type ApplyCommand = NonNullable<ApplyPhase['commands']>[number]
type ExternalEffect = ApplyCommand['externalEffects'][number]
type LockfileObservation = NonNullable<ApplyCommand['lockfile']>

interface PhysicalLockfile {
  path: string
  absolutePath: string
  bytes: Buffer
  hash: string
  mode: number
  dev: bigint
  ino: bigint
}

interface PreparedTarget {
  plan: PlanResult['execution']['targets'][number]
  executable: ExecutableHandle
  lockfile: PhysicalLockfile
}

export interface PreparedManagerPhases {
  targets: PreparedTarget[]
  preflight: ApplyPhase
}

export interface ManagerPhaseFailure {
  reason: string
  unknown: boolean
  phase: ApplyPhase
  unrecoveredPaths: string[]
}

export interface ManagerPhaseExecution {
  success: boolean
  unknown: boolean
  reason: string
  phases: ApplyPhase[]
  restoredPaths: string[]
  unrecoveredPaths: string[]
  externalEffects: ExternalEffect[]
  artifactsClean: boolean
}

export async function prepareManagerPhases(
  root: string,
  plan: PlanResult,
  lock: ApplyLock,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): Promise<PreparedManagerPhases | ManagerPhaseFailure> {
  const commands: ApplyCommand[] = []
  const targets: PreparedTarget[] = []
  for (const target of plan.execution.targets) {
    try {
      const cwd = absoluteBoundary(root, target.boundaryPath)
      const lockfile = readPhysicalLockfile(root, target.lockfile.path)
      if (!lockfile || lockfile.hash !== target.lockfile.byteHash) {
        return failurePhase('LOCKFILE_PRECONDITION_MISMATCH', false, 'manager-preflight', commands)
      }
      if (!safeInstallState(root, target)) {
        return failurePhase('INSTALL_STATE_UNSAFE', true, 'manager-preflight', commands)
      }
      const executable = resolveExecutable(target.adapter.executable, cwd, inheritedEnv)
      if ('reason' in executable) {
        return failurePhase('MANAGER_EXECUTABLE_UNAVAILABLE', false, 'manager-preflight', commands)
      }
      if (!ownsApplyLock(lock)) {
        return failurePhase('LOCK_LOST', true, 'manager-preflight', commands)
      }
      const before = snapshotRepositoryTree(root)
      const observation = await runResolvedProcess(executable, ['--version'], {
        cwd,
        timeoutMs: plan.execution.timeoutMs,
        inheritedEnv,
        captureStdout: true,
        settlementMs: 1_000,
      })
      const changedPaths = diffRepositorySnapshots(before, snapshotRepositoryTree(root))
      commands.push(
        commandObservation(target, ['--version'], observation, changedPaths, changedPaths, {
          path: lockfile.path,
          byteHash: lockfile.hash,
          parseState: 'parsed',
          occurrences: 'not-checked',
        }),
      )
      if (!ownsApplyLock(lock)) {
        return failurePhase('LOCK_LOST', true, 'manager-preflight', commands, changedPaths)
      }
      if (changedPaths.length > 0) {
        return failurePhase(
          'MANAGER_PREFLIGHT_MUTATED_REPOSITORY',
          false,
          'manager-preflight',
          commands,
          changedPaths,
        )
      }
      if (!successful(observation)) {
        return failurePhase(
          processReason('MANAGER_VERSION', observation),
          unknown(observation),
          'manager-preflight',
          commands,
        )
      }
      const observedVersion = normalizeVersion(observation.stdout)
      if (observedVersion !== target.manager.version) {
        return failurePhase('MANAGER_VERSION_MISMATCH', false, 'manager-preflight', commands)
      }
      const confirmedLockfile = readPhysicalLockfile(root, target.lockfile.path)
      if (!(confirmedLockfile && sameLockfile(confirmedLockfile, lockfile))) {
        return failurePhase('LOCKFILE_PRECONDITION_MISMATCH', true, 'manager-preflight', commands)
      }
      targets.push({ plan: target, executable, lockfile })
    } catch {
      return failurePhase('MANAGER_PREFLIGHT_UNAVAILABLE', true, 'manager-preflight', commands)
    }
  }
  return {
    targets,
    preflight: {
      name: 'manager-preflight',
      status: 'passed',
      reason: 'MANAGER_AND_LOCKFILE_CONFIRMED',
      commands,
    },
  }
}

export async function executeManagerPhases(
  root: string,
  plan: PlanResult,
  prepared: PreparedManagerPhases,
  lock: ApplyLock,
  journal: JournalHandle,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
  evidenceTime = new Date().toISOString(),
): Promise<ManagerPhaseExecution> {
  const backupPaths: string[] = []
  const phases: ApplyPhase[] = []
  const restoredPaths: string[] = []
  const unrecoveredPaths = new Set<string>()
  const externalEffects = new Set<ExternalEffect>()
  const observedLockfiles = new Map<string, PhysicalLockfile>()
  const executedTargets: PreparedTarget[] = []
  const sourceSnapshots = captureSourceSnapshots(root, plan)
  if (!sourceSnapshots) {
    return failedExecution(
      'SOURCE_CHANGED',
      true,
      phases,
      [],
      plan.operations.map((operation) => operation.file),
      [],
      false,
    )
  }
  try {
    if (!ownsPhase(lock, journal)) throw new Error('Apply ownership lost')
    for (let index = 0; index < prepared.targets.length; index += 1) {
      const target = prepared.targets[index]!
      const current = readPhysicalLockfile(root, target.plan.lockfile.path)
      if (!(current && sameLockfile(current, target.lockfile))) {
        return failedExecution(
          'LOCKFILE_CHANGED',
          false,
          phases,
          [],
          [target.plan.lockfile.path],
          [],
          false,
        )
      }
      const backupPath = join(journal.directory, `manager-lockfile-${index}.backup`)
      writeDurableExclusive(backupPath, target.lockfile.bytes, target.lockfile.mode)
      backupPaths.push(backupPath)
    }
    writePhaseJournal(journal, plan, backupPaths)
    if (!ownsPhase(lock, journal)) throw new Error('Apply ownership lost')
  } catch {
    return failedExecution('PHASE_BACKUP_FAILED', true, phases, [], [], [], false)
  }

  let beforeManager = snapshotRepositoryTree(root)
  const managerCommands: ApplyCommand[] = []
  let failure: { reason: string; unknown: boolean } | undefined
  for (const target of prepared.targets) {
    if (!ownsPhase(lock, journal)) {
      failure = { reason: 'APPLY_OWNERSHIP_LOST', unknown: true }
      break
    }
    if (!lockfilesMatchExpected(root, prepared.targets, observedLockfiles)) {
      failure = { reason: 'LOCKFILE_CHANGED', unknown: true }
      unrecoveredPaths.add(target.plan.lockfile.path)
      break
    }
    if (!sourcesMatchExpected(root, sourceSnapshots)) {
      failure = { reason: 'SOURCE_CHANGED', unknown: true }
      for (const operation of plan.operations) unrecoveredPaths.add(operation.file)
      break
    }
    const observation = await runResolvedProcess(target.executable, target.plan.adapter.args, {
      cwd: absoluteBoundary(root, target.plan.boundaryPath),
      timeoutMs: plan.execution.timeoutMs,
      inheritedEnv,
    })
    executedTargets.push(target)
    const afterCommand = snapshotRepositoryTree(root)
    const changedPaths = diffRepositorySnapshots(beforeManager, afterCommand)
    beforeManager = afterCommand
    const unexpectedPaths = changedPaths.filter(
      (path) =>
        !target.plan.adapter.permittedPaths.some((permitted) => containsPath(permitted, path)),
    )
    const finalLockfile = readPhysicalLockfile(root, target.plan.lockfile.path)
    if (finalLockfile) observedLockfiles.set(target.plan.lockfile.path, finalLockfile)
    const ownershipHeld = ownsPhase(lock, journal)
    const lockfileObservation = finalLockfile
      ? await inspectFinalLockfile(root, plan, target, finalLockfile)
      : {
          path: target.plan.lockfile.path,
          parseState: 'unavailable' as const,
          occurrences: 'mismatched' as const,
        }
    const lockfileValid =
      lockfileObservation.parseState === 'parsed' &&
      lockfileObservation.occurrences === 'matched' &&
      lockfileObservation.byteHash === finalLockfile?.hash &&
      finalLockfile !== undefined &&
      finalLockfile.hash !== target.lockfile.hash
    const sourcesHeld = sourcesMatchExpected(root, sourceSnapshots)
    const installStateHeld = safeInstallState(root, target.plan)
    for (const effect of target.plan.adapter.externalEffects) externalEffects.add(effect)
    managerCommands.push(
      commandObservation(
        target.plan,
        target.plan.adapter.args,
        observation,
        changedPaths,
        unexpectedPaths,
        lockfileObservation,
      ),
    )
    for (const path of unexpectedPaths) unrecoveredPaths.add(path)
    if (
      !successful(observation) ||
      unexpectedPaths.length > 0 ||
      !ownershipHeld ||
      !lockfileValid ||
      !sourcesHeld ||
      !installStateHeld
    ) {
      failure = {
        reason: !ownershipHeld
          ? 'APPLY_OWNERSHIP_LOST'
          : unexpectedPaths.length > 0
            ? 'UNEXPECTED_REPOSITORY_MUTATION'
            : !successful(observation)
              ? processReason('MANAGER_PHASE', observation)
              : !lockfileValid
                ? 'LOCKFILE_FINAL_STATE_INVALID'
                : !sourcesHeld
                  ? 'SOURCE_CHANGED'
                  : !installStateHeld
                    ? 'INSTALL_STATE_UNSAFE'
                    : 'MANAGER_PHASE_FAILED',
        unknown: !(ownershipHeld && installStateHeld) || unknown(observation),
      }
      break
    }
  }
  phases.push({
    name: plan.execution.mode === 'install' ? 'install' : 'sync-lockfile',
    status: failure ? (failure.unknown ? 'unknown' : 'failed') : 'passed',
    reason: failure?.reason ?? 'MANAGER_PHASE_COMPLETED',
    commands: managerCommands,
  })

  if (failure && plan.execution.artifactVerification) {
    phases.push({ name: 'artifact-verify', status: 'skipped', reason: 'MANAGER_PHASE_FAILED' })
  }
  if (failure && plan.execution.verification) {
    phases.push({ name: 'verify', status: 'skipped', reason: 'MANAGER_PHASE_FAILED' })
  }

  if (!failure && plan.execution.artifactVerification) {
    const verification = await executeArtifactVerification(
      root,
      plan,
      prepared,
      observedLockfiles,
      lock,
      journal,
      inheritedEnv,
      evidenceTime,
      sourceSnapshots,
    )
    phases.push(verification.phase)
    if (verification.failure) failure = verification.failure
  }

  if (failure && plan.execution.verification && !phases.some((entry) => entry.name === 'verify')) {
    phases.push({ name: 'verify', status: 'skipped', reason: 'ARTIFACT_VERIFICATION_BLOCKED' })
  }

  if (!failure && plan.execution.verification) {
    const verification = plan.execution.verification
    const ownershipHeldBefore = ownsPhase(lock, journal)
    const lockfilesHeldBefore = lockfilesMatchObserved(root, prepared.targets, observedLockfiles)
    const sourcesHeldBefore = sourcesMatchExpected(root, sourceSnapshots)
    const installStateHeldBefore = prepared.targets.every((entry) =>
      safeInstallState(root, entry.plan),
    )
    if (
      !(ownershipHeldBefore && lockfilesHeldBefore && sourcesHeldBefore && installStateHeldBefore)
    ) {
      const reason = !ownershipHeldBefore
        ? 'APPLY_OWNERSHIP_LOST'
        : !lockfilesHeldBefore
          ? 'LOCKFILE_CHANGED'
          : !sourcesHeldBefore
            ? 'SOURCE_CHANGED'
            : 'INSTALL_STATE_UNSAFE'
      phases.push({ name: 'verify', status: 'unknown', reason })
      failure = { reason, unknown: true }
    } else {
      const verificationCwd = absoluteBoundary(root, verification.cwd)
      const beforeVerify = snapshotRepositoryTree(root)
      const resolved = resolveExecutable(verification.executable, verificationCwd, inheritedEnv)
      const observation: ProcessObservation =
        'reason' in resolved
          ? {
              termination: 'unavailable',
              reason: resolved.reason,
              terminationConfirmed: true,
            }
          : await runResolvedProcess(resolved, verification.args, {
              cwd: verificationCwd,
              timeoutMs: verification.timeoutMs,
              inheritedEnv,
            })
      const changedPaths = diffRepositorySnapshots(beforeVerify, snapshotRepositoryTree(root))
      const unexpectedPaths = [...changedPaths]
      for (const path of unexpectedPaths) unrecoveredPaths.add(path)
      const command: ApplyCommand = {
        cwd: verification.cwd,
        executable: verification.executable,
        args: [...verification.args],
        ...processFields(observation),
        changedPaths,
        unexpectedPaths,
        externalEffects: [],
      }
      const ownershipHeldAfter = ownsPhase(lock, journal)
      const lockfilesHeldAfter = lockfilesMatchObserved(root, prepared.targets, observedLockfiles)
      const sourcesHeldAfter = sourcesMatchExpected(root, sourceSnapshots)
      const installStateHeldAfter = prepared.targets.every((entry) =>
        safeInstallState(root, entry.plan),
      )
      const passed =
        ownershipHeldAfter &&
        lockfilesHeldAfter &&
        sourcesHeldAfter &&
        installStateHeldAfter &&
        successful(observation) &&
        unexpectedPaths.length === 0
      for (const target of prepared.targets) {
        const observed = readPhysicalLockfile(root, target.plan.lockfile.path)
        if (observed) observedLockfiles.set(target.plan.lockfile.path, observed)
      }
      phases.push({
        name: 'verify',
        status: passed ? 'passed' : unknown(observation) ? 'unknown' : 'failed',
        reason: passed
          ? 'VERIFICATION_COMPLETED'
          : !ownershipHeldAfter
            ? 'APPLY_OWNERSHIP_LOST'
            : !lockfilesHeldAfter
              ? 'LOCKFILE_CHANGED'
              : !sourcesHeldAfter
                ? 'SOURCE_CHANGED'
                : !installStateHeldAfter
                  ? 'INSTALL_STATE_UNSAFE'
                  : unexpectedPaths.length > 0
                    ? 'VERIFICATION_MUTATED_REPOSITORY'
                    : processReason('VERIFICATION', observation),
        commands: [command],
      })
      if (!passed) {
        failure = {
          reason: phases.at(-1)!.reason,
          unknown: !(ownershipHeldAfter && installStateHeldAfter) || unknown(observation),
        }
      }
    }
  }

  if (failure) {
    const ownershipHeld = ownsPhase(lock, journal)
    let lockfileRecoveryUnknown = false
    for (const target of executedTargets) {
      const observed = observedLockfiles.get(target.plan.lockfile.path)
      const current = readPhysicalLockfile(root, target.plan.lockfile.path)
      if (current && sameLockfile(current, target.lockfile)) continue
      if (
        ownershipHeld &&
        observed &&
        current &&
        restoreLockfile(root, target.lockfile, observed, lock, journal)
      ) {
        restoredPaths.push(target.plan.lockfile.path)
        unrecoveredPaths.delete(target.plan.lockfile.path)
      } else {
        unrecoveredPaths.add(target.plan.lockfile.path)
        lockfileRecoveryUnknown = true
      }
    }
    const hasNonTransactionalEffects = externalEffects.size > 0
    const artifactsClean =
      !hasNonTransactionalEffects &&
      unrecoveredPaths.size === 0 &&
      cleanupArtifacts(lock, journal, backupPaths)
    return failedExecution(
      failure.reason,
      failure.unknown || lockfileRecoveryUnknown || hasNonTransactionalEffects,
      phases,
      restoredPaths,
      [...unrecoveredPaths].sort(),
      [...externalEffects].sort(),
      artifactsClean,
    )
  }

  const finalLockfilesHeld = lockfilesMatchObserved(root, prepared.targets, observedLockfiles)
  const finalSourcesHeld = sourcesMatchExpected(root, sourceSnapshots)
  const finalInstallStateHeld = prepared.targets.every((entry) =>
    safeInstallState(root, entry.plan),
  )
  const artifactsClean =
    finalLockfilesHeld &&
    finalSourcesHeld &&
    finalInstallStateHeld &&
    cleanupArtifacts(lock, journal, backupPaths)
  return {
    success: artifactsClean,
    unknown: !artifactsClean,
    reason: artifactsClean
      ? 'MANAGER_PHASES_COMPLETED'
      : finalLockfilesHeld && finalSourcesHeld && finalInstallStateHeld
        ? 'PHASE_CLEANUP_INCOMPLETE'
        : !finalLockfilesHeld
          ? 'LOCKFILE_CHANGED'
          : !finalSourcesHeld
            ? 'SOURCE_CHANGED'
            : 'INSTALL_STATE_UNSAFE',
    phases,
    restoredPaths: [],
    unrecoveredPaths:
      finalLockfilesHeld && finalSourcesHeld && finalInstallStateHeld
        ? []
        : [
            ...(!finalLockfilesHeld
              ? prepared.targets.map((target) => target.plan.lockfile.path)
              : []),
            ...(!finalSourcesHeld ? plan.operations.map((operation) => operation.file) : []),
          ],
    externalEffects: [...externalEffects].sort(),
    artifactsClean,
  }
}

async function executeArtifactVerification(
  root: string,
  plan: PlanResult,
  prepared: PreparedManagerPhases,
  observedLockfiles: Map<string, PhysicalLockfile>,
  lock: ApplyLock,
  journal: JournalHandle,
  inheritedEnv: NodeJS.ProcessEnv,
  evidenceTime: string,
  sourceSnapshots: Map<string, PhysicalLockfile>,
): Promise<{ phase: ApplyPhase; failure?: { reason: string; unknown: boolean } }> {
  const verification = plan.execution.artifactVerification!
  const commands: ApplyCommand[] = []
  const artifactResults: NonNullable<ApplyPhase['artifactResults']> = []
  let bindingFailed = false
  let safetyFailure: { reason: string; unknown: boolean } | undefined

  for (let index = 0; index < verification.targets.length; index += 1) {
    const verificationTarget = verification.targets[index]!
    const preparedTarget = prepared.targets.find(
      (entry) => entry.plan.boundaryId === verificationTarget.boundaryId,
    )
    const finalLockfile = preparedTarget
      ? observedLockfiles.get(preparedTarget.plan.lockfile.path)
      : undefined
    if (!(preparedTarget && finalLockfile && ownsPhase(lock, journal))) {
      bindingFailed = true
      break
    }
    const operations = operationsForTarget(plan, preparedTarget)
    const targets = resolveNpmArtifactTargets(
      root,
      verificationTarget.boundaryId,
      verificationTarget.cwd,
      finalLockfile.bytes,
      verificationTarget.artifacts,
      operations,
    )
    if (!targets) {
      bindingFailed = true
      break
    }

    const cwd = absoluteBoundary(root, verificationTarget.cwd)
    const before = snapshotRepositoryTree(root)
    let observation: ProcessObservation
    let trustResults: ReturnType<typeof parseNpmAuditSignatures>
    const verifierHome = join(journal.directory, `artifact-verifier-${index}`)
    const projectConfigPresent = existsSync(join(cwd, '.npmrc'))
    if (projectConfigPresent) {
      observation = {
        termination: 'unavailable',
        reason: 'EXECUTABLE_UNAVAILABLE',
        terminationConfirmed: true,
      }
      trustResults = unavailableTrustResults(targets, 'unavailable')
    } else {
      try {
        mkdirSync(verifierHome, { mode: 0o700 })
        const cache = join(verifierHome, 'cache')
        mkdirSync(cache, { mode: 0o700 })
        const userConfig = join(verifierHome, 'user.npmrc')
        const globalConfig = join(verifierHome, 'global.npmrc')
        writeFileSync(userConfig, '', { mode: 0o600, flag: 'wx' })
        writeFileSync(globalConfig, '', { mode: 0o600, flag: 'wx' })
        observation = await runResolvedProcess(preparedTarget.executable, verificationTarget.args, {
          cwd,
          timeoutMs: verification.timeoutMs,
          inheritedEnv,
          environmentOverrides: {
            HOME: verifierHome,
            USERPROFILE: verifierHome,
            npm_config_cache: cache,
            npm_config_userconfig: userConfig,
            npm_config_globalconfig: globalConfig,
            npm_config_registry: NPM_ARTIFACT_VERIFIER_SUPPORT.registry,
          },
          captureStdout: true,
          captureStderr: true,
          redactCapturedStdout: false,
          maxOutputBytes: 8 * 1024 * 1024,
          maxCaptureBytes: 8 * 1024 * 1024,
        })
        trustResults =
          observation.termination === 'exit' &&
          (observation.exitCode === 0 || observation.exitCode === 1) &&
          (observation.stdout !== undefined || observation.stderr !== undefined)
            ? parseVerifierOutput(observation.stdout ?? '', observation.stderr ?? '', targets)
            : unavailableTrustResults(targets, 'error')
      } catch {
        observation = {
          termination: 'unknown',
          reason: 'PROCESS_START_FAILED',
          terminationConfirmed: true,
        }
        trustResults = unavailableTrustResults(targets, 'error')
      } finally {
        try {
          rmSync(verifierHome, { recursive: true, force: true })
        } catch {
          safetyFailure = { reason: 'ARTIFACT_VERIFIER_CLEANUP_FAILED', unknown: true }
        }
      }
    }

    const changedPaths = diffRepositorySnapshots(before, snapshotRepositoryTree(root))
    const command: ApplyCommand = {
      boundaryId: verificationTarget.boundaryId,
      manager: 'npm',
      managerVersion: verificationTarget.verifier.version,
      cwd: verificationTarget.cwd,
      executable: verificationTarget.executable,
      args: [...verificationTarget.args],
      ...processFields(observation),
      changedPaths,
      unexpectedPaths: [...changedPaths],
      lockfile: {
        path: preparedTarget.plan.lockfile.path,
        byteHash: finalLockfile.hash,
        parseState: 'parsed',
        occurrences: 'matched',
      },
      externalEffects: [],
    }
    commands.push(command)
    const plannedById = new Map(
      verificationTarget.artifacts.map((artifact) => [artifact.id, artifact]),
    )
    for (const target of targets) {
      const trust = trustResults.find(
        (result) => result.artifactId === target.id && result.location === target.location,
      )
      const planned = plannedById.get(target.id)
      if (!(trust && planned)) {
        bindingFailed = true
        continue
      }
      artifactResults.push({
        artifactId: target.id,
        boundaryId: target.boundaryId,
        location: target.location,
        packageName: target.packageName,
        version: target.version,
        registry: target.registry,
        integrity: target.integrity,
        lockfile: { path: preparedTarget.plan.lockfile.path, byteHash: finalLockfile.hash },
        verifier: { name: 'npm', version: verificationTarget.verifier.version },
        observedAt: evidenceTime,
        signature: projectTrustPolicy(
          plan,
          verification,
          target,
          planned.evidenceRef,
          trust.signature,
        ),
        provenance: projectTrustPolicy(
          plan,
          verification,
          target,
          planned.evidenceRef,
          trust.provenance,
        ),
      })
    }
    if (changedPaths.length > 0) {
      safetyFailure = { reason: 'ARTIFACT_VERIFIER_MUTATED_REPOSITORY', unknown: false }
    }
    if (
      !(
        ownsPhase(lock, journal) &&
        sourcesMatchExpected(root, sourceSnapshots) &&
        lockfilesMatchObserved(root, prepared.targets, observedLockfiles) &&
        safeInstallState(root, preparedTarget.plan)
      )
    ) {
      safetyFailure = { reason: 'ARTIFACT_VERIFICATION_STATE_CHANGED', unknown: true }
    }
  }

  artifactResults.sort(
    (left, right) =>
      left.artifactId.localeCompare(right.artifactId) ||
      left.location.localeCompare(right.location),
  )
  const blocked = artifactResults.some(
    (result) => result.signature.effect === 'block' || result.provenance.effect === 'block',
  )
  const failure =
    safetyFailure ??
    (bindingFailed
      ? { reason: 'ARTIFACT_BINDING_FAILED', unknown: true }
      : blocked
        ? { reason: 'ARTIFACT_POLICY_BLOCKED', unknown: false }
        : undefined)
  return {
    phase: {
      name: 'artifact-verify',
      status: failure ? (failure.unknown ? 'unknown' : 'failed') : 'passed',
      reason: failure?.reason ?? 'ARTIFACT_VERIFICATION_RECORDED',
      ...(commands.length > 0 ? { commands } : {}),
      ...(artifactResults.length > 0 ? { artifactResults } : {}),
    },
    ...(failure ? { failure } : {}),
  }
}

function parseVerifierOutput(
  stdout: string,
  stderr: string,
  targets: readonly ArtifactVerificationTarget[],
): ReturnType<typeof parseNpmAuditSignatures> {
  try {
    return parseNpmAuditSignatures(stdout, targets)
  } catch {
    const stdoutKind = classifyNpmAuditSignaturesFailure(stdout)
    const stderrKind = classifyNpmAuditSignaturesFailure(stderr)
    return unavailableTrustResults(targets, stdoutKind !== 'error' ? stdoutKind : stderrKind)
  }
}

function unavailableTrustResults(
  targets: readonly ArtifactVerificationTarget[],
  kind: 'unavailable' | 'offline' | 'stale' | 'error',
): ReturnType<typeof parseNpmAuditSignatures> {
  return targets.map((target) => ({
    artifactId: target.id,
    location: target.location,
    signature: {
      state: 'unknown',
      reason:
        kind === 'unavailable'
          ? 'SIGNATURE_VERIFIER_UNAVAILABLE'
          : kind === 'offline'
            ? 'SIGNATURE_VERIFIER_OFFLINE'
            : kind === 'stale'
              ? 'SIGNATURE_VERIFIER_STALE'
              : 'SIGNATURE_VERIFIER_ERROR',
    },
    provenance: {
      state: 'unknown',
      reason:
        kind === 'unavailable'
          ? 'PROVENANCE_VERIFIER_UNAVAILABLE'
          : kind === 'offline'
            ? 'PROVENANCE_VERIFIER_OFFLINE'
            : kind === 'stale'
              ? 'PROVENANCE_VERIFIER_STALE'
              : 'PROVENANCE_VERIFIER_ERROR',
    },
  }))
}

function projectTrustPolicy(
  plan: PlanResult,
  verification: NonNullable<PlanResult['execution']['artifactVerification']>,
  target: ArtifactVerificationTarget,
  evidenceRef: string,
  result: ArtifactTrustDimensionResult,
): NonNullable<ApplyPhase['artifactResults']>[number]['signature'] {
  const family = result.reason.startsWith('SIGNATURE_')
    ? ('signature-verification' as const)
    : ('provenance-verification' as const)
  const workspacePaths = new Set(
    target.occurrenceIds.flatMap((id) => {
      const occurrence = plan.occurrences.find((item) => item.id === id)
      const owner = occurrence
        ? plan.repository.packages.find((item) => item.id === occurrence.ownerId)
        : undefined
      return owner ? [owner.workspacePath] : []
    }),
  )
  const base: Omit<PlanSignal, 'id' | 'effect' | 'matchedRuleIds' | 'winningRuleId' | 'override'> =
    {
      family,
      state: result.state,
      reason: result.reason as SignalReason,
      subject: {
        occurrenceIds: [...target.occurrenceIds],
        dependencyName: target.packageName,
        ...(workspacePaths.size === 1 ? { workspacePath: [...workspacePaths][0]! } : {}),
      },
      evidenceRefs: [evidenceRef],
    }
  const projected = applySignalPolicy(
    base,
    verification.rules,
    verification.policySource,
    false,
    false,
  )
  return {
    state: projected.state,
    reason: projected.reason,
    effect: projected.effect,
    matchedRuleIds: [...projected.matchedRuleIds],
    ...(projected.winningRuleId ? { winningRuleId: projected.winningRuleId } : {}),
  }
}

function commandObservation(
  target: PlanResult['execution']['targets'][number],
  args: string[],
  observation: ProcessObservation,
  changedPaths: string[],
  unexpectedPaths: string[],
  lockfile: LockfileObservation,
): ApplyCommand {
  return {
    boundaryId: target.boundaryId,
    manager: target.manager.name,
    managerVersion: target.manager.version,
    lifecycle: target.adapter.lifecycle,
    cwd: target.boundaryPath,
    executable: target.adapter.executable,
    args: [...args],
    ...processFields(observation),
    changedPaths,
    unexpectedPaths,
    lockfile,
    externalEffects: [...target.adapter.externalEffects],
  }
}

function processFields(observation: ProcessObservation) {
  return {
    termination: observation.termination,
    terminationConfirmed: observation.terminationConfirmed,
    ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
    ...(observation.signal === undefined ? {} : { signal: observation.signal }),
  }
}

function successful(observation: ProcessObservation): boolean {
  return observation.termination === 'exit' && observation.exitCode === 0
}

function unknown(observation: ProcessObservation): boolean {
  return observation.termination === 'unknown' || !observation.terminationConfirmed
}

function processReason(prefix: string, observation: ProcessObservation): string {
  return `${prefix}_${observation.reason}`
}

function normalizeVersion(value: string | undefined): string | undefined {
  if (!value || value.includes('\n') || value.includes('\r')) return undefined
  const normalized = value.startsWith('v') ? value.slice(1) : value
  return semver.valid(normalized) ?? undefined
}

function readPhysicalLockfile(root: string, path: string): PhysicalLockfile | undefined {
  let descriptor: number | undefined
  try {
    const absolutePath = containedAbsolute(root, path)
    const lexical = lstatSync(absolutePath, { bigint: true })
    if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1n) return undefined
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const physical = fstatSync(descriptor, { bigint: true })
    if (
      !physical.isFile() ||
      physical.dev !== lexical.dev ||
      physical.ino !== lexical.ino ||
      physical.nlink !== 1n
    ) {
      return undefined
    }
    const bytes = readFileSync(descriptor)
    return {
      path,
      absolutePath,
      bytes,
      hash: hashExactBytes(bytes),
      mode: Number(physical.mode & 0o777n),
      dev: physical.dev,
      ino: physical.ino,
    }
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function sameLockfile(left: PhysicalLockfile, right: PhysicalLockfile): boolean {
  return (
    left.absolutePath === right.absolutePath &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.hash === right.hash &&
    left.mode === right.mode
  )
}

function restoreLockfile(
  root: string,
  original: PhysicalLockfile,
  expectedCurrent: PhysicalLockfile,
  lock: ApplyLock,
  journal: JournalHandle,
): boolean {
  const temporary = `${original.absolutePath}.depfresh-restore-${process.pid}`
  try {
    if (!ownsPhase(lock, journal)) return false
    const current = readPhysicalLockfile(root, original.path)
    if (!(current && sameLockfile(current, expectedCurrent))) return false
    writeDurableExclusive(temporary, original.bytes, original.mode)
    if (!ownsPhase(lock, journal)) return false
    const beforeRename = readPhysicalLockfile(root, original.path)
    if (!(beforeRename && sameLockfile(beforeRename, expectedCurrent))) return false
    renameSync(temporary, original.absolutePath)
    fsyncDirectory(dirname(original.absolutePath))
    const restored = lstatSync(original.absolutePath)
    return (
      restored.isFile() &&
      !restored.isSymbolicLink() &&
      hashExactBytes(readFileSync(original.absolutePath)) === original.hash
    )
  } catch {
    return false
  } finally {
    rmSync(temporary, { force: true })
  }
}

function writeDurableExclusive(path: string, bytes: Buffer, mode: number): void {
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    mode,
  )
  try {
    writeFileSync(descriptor, bytes)
    fchmodSync(descriptor, mode)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  fsyncDirectory(dirname(path))
}

function writePhaseJournal(journal: JournalHandle, plan: PlanResult, backups: string[]): void {
  const path = join(journal.directory, 'manager-phase.json')
  const value = `${JSON.stringify({
    version: 1,
    planFingerprint: plan.planFingerprint,
    mode: plan.execution.mode,
    lockfiles: plan.execution.targets.map((target, index) => ({
      path: target.lockfile.path,
      byteHash: target.lockfile.byteHash,
      backup: relative(journal.directory, backups[index]!),
    })),
  })}\n`
  writeDurableExclusive(path, Buffer.from(value), 0o600)
}

function cleanupArtifacts(lock: ApplyLock, journal: JournalHandle, backups: string[]): boolean {
  try {
    if (!ownsPhase(lock, journal)) return false
    for (const path of backups) rmSync(path)
    rmSync(join(journal.directory, 'manager-phase.json'))
    fsyncDirectory(journal.directory)
    return true
  } catch {
    return false
  }
}

export function snapshotRepositoryTree(root: string): Map<string, string> {
  const snapshot = new Map<string, string>()
  const visit = (absolute: string, relativePath: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name
      const child = join(absolute, entry.name)
      const stat = lstatSync(child)
      if (stat.isSymbolicLink()) {
        snapshot.set(childRelative, `symlink:${readlinkSync(child)}`)
      } else if (stat.isDirectory()) {
        snapshot.set(`${childRelative}/`, 'directory')
        visit(child, childRelative)
      } else if (stat.isFile()) {
        snapshot.set(
          childRelative,
          `file:${stat.mode & 0o777}:${hashExactBytes(readFileSync(child))}`,
        )
      } else {
        snapshot.set(childRelative, `special:${stat.mode}`)
      }
    }
  }
  visit(root, '')
  snapshotGitPointerMetadata(root, snapshot, visit)
  return snapshot
}

export function diffRepositorySnapshots(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .map((path) => (path.endsWith('/') ? path.slice(0, -1) : path))
    .sort()
}

function snapshotGitPointerMetadata(
  root: string,
  snapshot: Map<string, string>,
  visit: (absolute: string, relativePath: string) => void,
): void {
  const pointer = join(root, '.git')
  if (!existsSync(pointer)) return
  const pointerStat = lstatSync(pointer)
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) return
  const text = readFileSync(pointer, 'utf8')
  const match = /^gitdir: ([^\r\n]+)\r?\n?$/u.exec(text)
  if (!match?.[1]) throw new Error('Git directory pointer is invalid')
  const gitDirectory = realpathSync.native(resolve(dirname(pointer), match[1]))
  const gitStat = lstatSync(gitDirectory)
  if (!gitStat.isDirectory() || gitStat.isSymbolicLink()) {
    throw new Error('Git directory pointer target is unavailable')
  }
  snapshot.set('.git-metadata/', 'directory')
  visit(gitDirectory, '.git-metadata')
  const commonPointer = join(gitDirectory, 'commondir')
  if (!existsSync(commonPointer)) return
  const commonText = readFileSync(commonPointer, 'utf8').trim()
  if (!commonText || commonText.includes('\0')) throw new Error('Git common directory is invalid')
  const commonDirectory = realpathSync.native(resolve(gitDirectory, commonText))
  const commonStat = lstatSync(commonDirectory)
  if (!commonStat.isDirectory() || commonStat.isSymbolicLink()) {
    throw new Error('Git common directory is unavailable')
  }
  snapshot.set('.git-common/', 'directory')
  visit(commonDirectory, '.git-common')
}

function containsPath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

function ownsPhase(lock: ApplyLock, journal: JournalHandle): boolean {
  return ownsApplyLock(lock) && ownsJournal(journal)
}

function lockfilesMatchObserved(
  root: string,
  targets: PreparedTarget[],
  observedLockfiles: Map<string, PhysicalLockfile>,
): boolean {
  return targets.every((target) => {
    const observed = observedLockfiles.get(target.plan.lockfile.path)
    const current = readPhysicalLockfile(root, target.plan.lockfile.path)
    return Boolean(observed && current && sameLockfile(current, observed))
  })
}

function lockfilesMatchExpected(
  root: string,
  targets: PreparedTarget[],
  observedLockfiles: Map<string, PhysicalLockfile>,
): boolean {
  return targets.every((target) => {
    const expected = observedLockfiles.get(target.plan.lockfile.path) ?? target.lockfile
    const current = readPhysicalLockfile(root, target.plan.lockfile.path)
    return Boolean(current && sameLockfile(current, expected))
  })
}

function captureSourceSnapshots(
  root: string,
  plan: PlanResult,
): Map<string, PhysicalLockfile> | undefined {
  const byFile = new Map<string, typeof plan.operations>()
  for (const operation of plan.operations) {
    const operations = byFile.get(operation.file)
    if (operations) operations.push(operation)
    else byFile.set(operation.file, [operation])
  }
  const snapshots = new Map<string, PhysicalLockfile>()
  try {
    for (const [file, operations] of byFile) {
      const source = plan.repository.sourceFiles.find((entry) => entry.path === file)
      if (!(source && (source.format === 'json' || source.format === 'yaml'))) return undefined
      const physical = readPhysicalLockfile(root, file)
      if (!physical) return undefined
      const values = observeValues(physical.bytes, source.format, operations)
      if (operations.some((operation) => values.get(operation.id) !== operation.requestedValue)) {
        return undefined
      }
      snapshots.set(file, physical)
    }
    return snapshots
  } catch {
    return undefined
  }
}

function sourcesMatchExpected(root: string, expected: Map<string, PhysicalLockfile>): boolean {
  for (const [file, snapshot] of expected) {
    const current = readPhysicalLockfile(root, file)
    if (!(current && sameLockfile(current, snapshot))) return false
  }
  return true
}

async function inspectFinalLockfile(
  root: string,
  plan: PlanResult,
  target: PreparedTarget,
  lockfile: PhysicalLockfile,
): Promise<LockfileObservation> {
  try {
    const model = await inspectRepository({ cwd: root })
    const observed = model.lockfiles?.find(
      (entry) =>
        entry.path === target.plan.lockfile.path && entry.manager === target.plan.manager.name,
    )
    return {
      path: target.plan.lockfile.path,
      byteHash: lockfile.hash,
      parseState:
        observed && observed.byteHash === lockfile.hash ? observed.parseState : 'unavailable',
      occurrences: lockfileOccurrencesMatch(plan, target, lockfile.bytes)
        ? 'matched'
        : 'mismatched',
    }
  } catch {
    return {
      path: target.plan.lockfile.path,
      byteHash: lockfile.hash,
      parseState: 'unavailable',
      occurrences: 'mismatched',
    }
  }
}

const LOCKFILE_DEPENDENCY_FIELDS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
])

function lockfileOccurrencesMatch(
  plan: PlanResult,
  target: PreparedTarget,
  bytes: Buffer,
): boolean {
  const operations = operationsForTarget(plan, target)
  const decisions = new Map(plan.decisions.map((decision) => [decision.operationId, decision]))
  const expectations = operations.flatMap((operation) => {
    const targetVersion = decisions.get(operation.id)?.candidate?.targetVersion
    return targetVersion ? [{ operation, targetVersion }] : []
  })
  if (expectations.length !== operations.length) return false
  return lockfileDependencyOccurrencesMatch(
    target.plan.manager.name,
    target.plan.boundaryPath,
    expectations,
    bytes,
  )
}

export interface LockfileOperationExpectation {
  operation: PlanResult['operations'][number]
  targetVersion: string
}

export function lockfileDependencyOccurrencesMatch(
  manager: 'npm' | 'pnpm' | 'bun',
  boundaryPath: string,
  expectations: LockfileOperationExpectation[],
  bytes: Buffer,
): boolean {
  if (expectations.length === 0) return false
  try {
    const parsed = parseLockfileData(manager, bytes)
    return expectations.every(({ operation, targetVersion }) => {
      const field = operation.path[0]
      if (
        !(field && LOCKFILE_DEPENDENCY_FIELDS.has(field)) ||
        operation.path.length !== 2 ||
        operation.path[1] !== operation.name
      ) {
        return false
      }
      const workspace = workspaceKey(boundaryPath, operation.file)
      if (manager === 'npm') {
        const packages = ownRecord(parsed, 'packages')
        const manifest = packages
          ? ownRecord(packages, workspace === '.' ? '' : workspace)
          : undefined
        const resolved = packages
          ? (ownRecord(
              packages,
              workspace === '.'
                ? `node_modules/${operation.name}`
                : `${workspace}/node_modules/${operation.name}`,
            ) ?? ownRecord(packages, `node_modules/${operation.name}`))
          : undefined
        const packageName = resolvedPackageName(operation)
        const resolvedName = ownString(resolved, 'name')
        const identityMatches = operation.requestedValue.startsWith('npm:')
          ? resolvedName === packageName
          : resolvedName === undefined || resolvedName === packageName
        return (
          ownString(ownRecord(manifest, field), operation.name) === operation.requestedValue &&
          identityMatches &&
          ownString(resolved, 'version') === targetVersion
        )
      }
      if (manager === 'pnpm') {
        const importers = ownRecord(parsed, 'importers')
        const importer = importers ? ownRecord(importers, workspace) : undefined
        const packages = ownRecord(parsed, 'packages')
        const snapshots = ownRecord(parsed, 'snapshots')
        const fields = field === 'peerDependencies' ? [field, 'dependencies'] : [field]
        return fields.some((candidateField) => {
          const dependency = ownRecord(ownRecord(importer, candidateField), operation.name)
          const specifier = dependency
            ? ownString(dependency, 'specifier')
            : ownString(ownRecord(importer, 'specifiers'), operation.name)
          const resolved = dependency ? ownString(dependency, 'version') : undefined
          return (
            specifier === operation.requestedValue &&
            resolved !== undefined &&
            pnpmResolutionMatches(packages, snapshots, operation, resolved, targetVersion)
          )
        })
      }
      const workspaces = ownRecord(parsed, 'workspaces')
      const bunKey = workspace === '.' ? '' : workspace
      const manifest = workspaces
        ? (ownRecord(workspaces, bunKey) ?? ownRecord(workspaces, workspace))
        : undefined
      const packageEntry = ownArray(ownRecord(parsed, 'packages'), operation.name)
      const descriptor = packageEntry?.[0]
      return (
        ownString(ownRecord(manifest, field), operation.name) === operation.requestedValue &&
        typeof descriptor === 'string' &&
        descriptor === `${resolvedPackageName(operation)}@${targetVersion}`
      )
    })
  } catch {
    return false
  }
}

type PlannedArtifact = NonNullable<
  PlanResult['execution']['artifactVerification']
>['targets'][number]['artifacts'][number]

export function resolveNpmArtifactTargets(
  root: string,
  boundaryId: string,
  boundaryPath: string,
  lockfileBytes: Buffer,
  artifacts: readonly PlannedArtifact[],
  operations: readonly PlanResult['operations'][number][],
): ArtifactVerificationTarget[] | undefined {
  try {
    const boundaryRoot = absoluteBoundary(root, boundaryPath)
    const parsed = parseLockfileData('npm', lockfileBytes)
    const packages = ownRecord(parsed, 'packages')
    if (!packages) return undefined
    const operationsByOccurrence = new Map(
      operations.map((operation) => [operation.occurrenceId, operation]),
    )
    const targets = new Map<string, ArtifactVerificationTarget>()
    for (const artifact of artifacts) {
      for (const occurrenceId of artifact.occurrenceIds) {
        const operation = operationsByOccurrence.get(occurrenceId)
        if (!operation) return undefined
        const workspace = workspaceKey(boundaryPath, operation.file)
        const candidates = [
          ...(workspace === '.' ? [] : [`${workspace}/node_modules/${operation.name}`]),
          `node_modules/${operation.name}`,
        ]
        const location = candidates.find((candidate) => {
          const entry = ownRecord(packages, candidate)
          const observedName = ownString(entry, 'name')
          return (
            Boolean(entry) &&
            (observedName === undefined
              ? artifact.packageName === operation.name
              : observedName === artifact.packageName) &&
            ownString(entry, 'version') === artifact.version &&
            ownString(entry, 'integrity') === artifact.integrity &&
            hasExactInstalledPackage(
              boundaryRoot,
              candidate,
              artifact.packageName,
              artifact.version,
            )
          )
        })
        if (!location) return undefined
        const key = `${artifact.id}\0${location}`
        const existing = targets.get(key)
        if (existing) {
          existing.occurrenceIds.push(occurrenceId)
          existing.occurrenceIds.sort()
        } else {
          targets.set(key, {
            id: artifact.id,
            occurrenceIds: [occurrenceId],
            boundaryId,
            location,
            packageName: artifact.packageName,
            version: artifact.version,
            registry: artifact.registry,
            integrity: artifact.integrity,
            signaturePresence: artifact.signaturePresence,
            provenancePresence: artifact.provenancePresence,
          })
        }
      }
    }
    return [...targets.values()].sort(
      (left, right) =>
        left.id.localeCompare(right.id) || left.location.localeCompare(right.location),
    )
  } catch {
    return undefined
  }
}

function hasExactInstalledPackage(
  root: string,
  location: string,
  packageName: string,
  version: string,
): boolean {
  try {
    const directory = containedAbsolute(root, location)
    const lexical = lstatSync(directory)
    if (!lexical.isDirectory() || lexical.isSymbolicLink()) return false
    const physical = realpathSync.native(directory)
    const physicalRelative = relative(realpathSync.native(root), physical)
    if (physicalRelative === '..' || physicalRelative.startsWith(`..${sep}`)) return false
    const manifestPath = join(directory, 'package.json')
    const manifest = lstatSync(manifestPath)
    if (!manifest.isFile() || manifest.isSymbolicLink()) return false
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return (
      Boolean(parsed) &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).name === packageName &&
      (parsed as Record<string, unknown>).version === version
    )
  } catch {
    return false
  }
}

function pnpmResolutionMatches(
  packages: Record<string, unknown> | undefined,
  snapshots: Record<string, unknown> | undefined,
  operation: PlanResult['operations'][number],
  value: string,
  targetVersion: string,
): boolean {
  const packageName = resolvedPackageName(operation)
  const aliasPrefix = `npm:${packageName}@`
  const plainAliasPrefix = `${packageName}@`
  const isAlias = operation.requestedValue.startsWith('npm:')
  const versionText = isAlias
    ? value.startsWith(aliasPrefix)
      ? value.slice(aliasPrefix.length)
      : value.startsWith(plainAliasPrefix)
        ? value.slice(plainAliasPrefix.length)
        : undefined
    : value.startsWith('npm:')
      ? undefined
      : value
  if (!versionText) return false
  if (!(versionText === targetVersion || versionText.startsWith(`${targetVersion}(`))) return false
  const packageKey = `${packageName}@${targetVersion}`
  const snapshotKey = `${packageName}@${versionText}`
  return hasOwn(packages, packageKey) && hasOwn(snapshots, snapshotKey)
}

function resolvedPackageName(operation: PlanResult['operations'][number]): string {
  const alias = operation.requestedValue.match(/^npm:((?:@[^/]+\/)?[^@]+)@/u)?.[1]
  return alias ?? operation.name
}

function operationsForTarget(plan: PlanResult, target: PreparedTarget): PlanResult['operations'] {
  const deepestTargets = [...plan.execution.targets].sort(
    (left, right) => right.boundaryPath.length - left.boundaryPath.length,
  )
  return plan.operations.filter((operation) => {
    const owner = deepestTargets.find(
      (candidate) =>
        candidate.boundaryPath === '.' ||
        operation.file === candidate.boundaryPath ||
        operation.file.startsWith(`${candidate.boundaryPath}/`),
    )
    return owner?.boundaryId === target.plan.boundaryId
  })
}

function parseLockfileData(
  manager: 'npm' | 'pnpm' | 'bun',
  bytes: Buffer,
): Record<string, unknown> {
  const text = bytes.toString('utf8')
  const value: unknown =
    manager === 'pnpm'
      ? YAML.parse(text)
      : manager === 'bun'
        ? parseJsonc(text, [], { allowTrailingComma: true, disallowComments: false })
        : JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Lockfile is not an object')
  }
  return value as Record<string, unknown>
}

function workspaceKey(boundaryPath: string, file: string): string {
  const manifestDirectory = dirname(file)
  const key = relative(boundaryPath === '.' ? '.' : boundaryPath, manifestDirectory)
  return !key || key === '.' ? '.' : key.split(sep).join('/')
}

function ownRecord(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!(value && Object.hasOwn(value, key))) return undefined
  const nested = value[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : undefined
}

function ownString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return value && Object.hasOwn(value, key) && typeof value[key] === 'string'
    ? (value[key] as string)
    : undefined
}

function ownArray(value: Record<string, unknown> | undefined, key: string): unknown[] | undefined {
  if (!(value && Object.hasOwn(value, key))) return undefined
  const nested = value[key]
  return Array.isArray(nested) ? nested : undefined
}

function hasOwn(value: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(value && Object.hasOwn(value, key))
}

function safeInstallState(
  root: string,
  target: PlanResult['execution']['targets'][number],
): boolean {
  if (!target.adapter.externalEffects.includes('dependency-install-state')) return true
  for (const permitted of target.adapter.permittedPaths) {
    if (!(permitted === 'node_modules' || permitted.endsWith('/node_modules'))) continue
    const absolute = containedAbsolute(root, permitted)
    if (!existsSync(absolute)) continue
    try {
      const lexical = lstatSync(absolute)
      if (!lexical.isDirectory() || lexical.isSymbolicLink()) return false
      const physical = realpathSync.native(absolute)
      const physicalRelative = relative(realpathSync.native(root), physical)
      if (physicalRelative === '..' || physicalRelative.startsWith(`..${sep}`)) return false
      if (!containedTreeSymlinks(absolute, root)) return false
    } catch {
      return false
    }
  }
  return true
}

function containedTreeSymlinks(directory: string, root: string): boolean {
  const physicalRoot = realpathSync.native(root)
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = realpathSync.native(path)
        const targetRelative = relative(physicalRoot, target)
        if (targetRelative === '..' || targetRelative.startsWith(`..${sep}`)) return false
      } else if (entry.isDirectory() && !containedTreeSymlinks(path, root)) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function absoluteBoundary(root: string, path: string): string {
  const absolute = containedAbsolute(root, path)
  const stat = lstatSync(absolute)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Boundary unavailable')
  const physical = realpathSync.native(absolute)
  const physicalRelative = relative(realpathSync.native(root), physical)
  if (physicalRelative === '..' || physicalRelative.startsWith(`..${sep}`)) {
    throw new Error('Boundary escapes repository')
  }
  return physical
}

function containedAbsolute(root: string, path: string): string {
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel === '') {
    if (path !== '.') throw new Error('Path not contained')
  }
  return absolute
}

function failurePhase(
  reason: string,
  isUnknown: boolean,
  name: ApplyPhase['name'],
  commands: ApplyCommand[],
  unrecoveredPaths: string[] = [],
): ManagerPhaseFailure {
  return {
    reason,
    unknown: isUnknown,
    phase: { name, status: isUnknown ? 'unknown' : 'failed', reason, commands },
    unrecoveredPaths,
  }
}

function failedExecution(
  reason: string,
  isUnknown: boolean,
  phases: ApplyPhase[],
  restoredPaths: string[],
  unrecoveredPaths: string[],
  externalEffects: ExternalEffect[],
  artifactsClean: boolean,
): ManagerPhaseExecution {
  return {
    success: false,
    unknown: isUnknown,
    reason,
    phases,
    restoredPaths,
    unrecoveredPaths,
    externalEffects,
    artifactsClean,
  }
}
