import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
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
import { hashExactBytes } from '../../contracts/fingerprint'
import type { ApplyResult, PlanResult } from '../../contracts/schemas'
import { inspectRepository } from '../../repository/inspect'
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

  if (failure && plan.execution.verification) {
    phases.push({ name: 'verify', status: 'skipped', reason: 'MANAGER_PHASE_FAILED' })
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
