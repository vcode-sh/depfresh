import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { hashExactBytes } from '../../contracts/fingerprint'
import type { ApplyRuntime } from './types'

const OWNER_VERSION = 1

export interface ApplyLockOwner {
  version: 1
  runId: string
  token: string
  pid: number
  host: string
  startedAt: string
  rootHash: string
  planFingerprint: string
  journal: string
}

export interface ApplyLock {
  stateRoot: string
  lockPath: string
  ownerPath: string
  owner: ApplyLockOwner
  lockDev: bigint
  lockIno: bigint
  ownerDev: bigint
  ownerIno: bigint
}

export interface ApplyLockFailure {
  reason: 'LOCK_HELD' | 'LOCK_OWNER_UNKNOWN' | 'RECOVERY_REQUIRED'
  unknown: boolean
}

export const defaultApplyRuntime: ApplyRuntime = {
  checkpoint: () => undefined,
  rename: renameSync,
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0)
      return 'live'
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
        return 'dead'
      }
      return 'unknown'
    }
  },
  now: Date.now,
  pid: process.pid,
  hostname,
  randomToken: randomUUID,
}

export function acquireApplyLock(
  root: string,
  canonicalRoot: string,
  planFingerprint: string,
  runtime: ApplyRuntime,
): ApplyLock | ApplyLockFailure {
  const stateRoot = join(root, '.depfresh')
  if (existsSync(stateRoot)) {
    const state = safeLstat(stateRoot)
    if (!state?.isDirectory() || state.isSymbolicLink()) {
      return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    }
  } else {
    try {
      mkdirSync(stateRoot, { mode: 0o700 })
      fsyncDirectory(root)
    } catch {
      return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    }
  }

  const lockPath = join(stateRoot, 'apply.lock')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      fsyncDirectory(stateRoot)
      const runId = runtime.randomToken()
      const token = runtime.randomToken()
      if (!(isOpaqueId(runId) && isOpaqueId(token))) {
        return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
      }
      const owner: ApplyLockOwner = {
        version: OWNER_VERSION,
        runId,
        token,
        pid: runtime.pid,
        host: runtime.hostname(),
        startedAt: new Date(runtime.now()).toISOString(),
        rootHash: hashExactBytes(canonicalRoot),
        planFingerprint,
        journal: `runs/${runId}/journal.json`,
      }
      const ownerPath = join(lockPath, 'owner.json')
      writeDurableOwner(ownerPath, owner)
      fsyncDirectory(lockPath)
      const lockStat = lstatSync(lockPath, { bigint: true })
      const ownerStat = lstatSync(ownerPath, { bigint: true })
      return {
        stateRoot,
        lockPath,
        ownerPath,
        owner,
        lockDev: lockStat.dev,
        lockIno: lockStat.ino,
        ownerDev: ownerStat.dev,
        ownerIno: ownerStat.ino,
      }
    } catch (error) {
      if (!isAlreadyExists(error)) return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    }

    const lockState = safeLstat(lockPath)
    if (!lockState?.isDirectory() || lockState.isSymbolicLink()) {
      return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    }
    const existing = readOwner(join(lockPath, 'owner.json'))
    if (
      !existing ||
      existing.host !== runtime.hostname() ||
      existing.rootHash !== hashExactBytes(canonicalRoot)
    ) {
      return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    }
    const alive = runtime.isProcessAlive(existing.pid)
    if (alive === 'live') return { reason: 'LOCK_HELD', unknown: false }
    if (alive === 'unknown') return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    if (existsSync(join(stateRoot, existing.journal))) {
      return { reason: 'RECOVERY_REQUIRED', unknown: true }
    }
    const staleToken = runtime.randomToken()
    if (!isOpaqueId(staleToken)) return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    const stalePath = join(stateRoot, `.apply.lock.stale-${staleToken}`)
    try {
      renameSync(lockPath, stalePath)
      const claimed = readOwner(join(stalePath, 'owner.json'))
      if (claimed?.runId !== existing.runId || claimed.token !== existing.token) {
        if (!existsSync(lockPath)) renameSync(stalePath, lockPath)
        return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
      }
      if (!removeLockDirectory(stalePath, existing)) {
        if (!existsSync(lockPath)) renameSync(stalePath, lockPath)
        return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
      }
    } catch {
      return { reason: 'LOCK_OWNER_UNKNOWN', unknown: true }
    }
  }
  return { reason: 'LOCK_HELD', unknown: false }
}

export function hasApplyRecoveryEvidence(root: string): boolean {
  const stateRoot = join(root, '.depfresh')
  if (!existsSync(stateRoot)) return false
  const state = safeLstat(stateRoot)
  if (!(state?.isDirectory() && !state.isSymbolicLink())) return true
  const runsPath = join(stateRoot, 'runs')
  if (existsSync(runsPath)) {
    const runs = safeLstat(runsPath)
    if (!runs?.isDirectory() || runs.isSymbolicLink()) return true
    try {
      if (readdirSync(runsPath).length > 0) return true
    } catch {
      return true
    }
  }
  const owner = readOwner(join(stateRoot, 'apply.lock', 'owner.json'))
  return Boolean(owner && existsSync(join(stateRoot, owner.journal)))
}

export function ownsApplyLock(lock: ApplyLock): boolean {
  try {
    const lockStat = lstatSync(lock.lockPath, { bigint: true })
    const ownerStat = lstatSync(lock.ownerPath, { bigint: true })
    if (
      !lockStat.isDirectory() ||
      lockStat.isSymbolicLink() ||
      !ownerStat.isFile() ||
      ownerStat.isSymbolicLink() ||
      lockStat.dev !== lock.lockDev ||
      lockStat.ino !== lock.lockIno ||
      ownerStat.dev !== lock.ownerDev ||
      ownerStat.ino !== lock.ownerIno
    ) {
      return false
    }
  } catch {
    return false
  }
  const current = readOwner(lock.ownerPath)
  return current?.token === lock.owner.token && current.runId === lock.owner.runId
}

export function releaseApplyLock(lock: ApplyLock): boolean {
  if (!ownsApplyLock(lock)) return false
  const releasePath = join(lock.stateRoot, `.apply.lock.release-${lock.owner.token}`)
  try {
    renameSync(lock.lockPath, releasePath)
    const releasedOwner = readOwner(join(releasePath, 'owner.json'))
    if (releasedOwner?.token !== lock.owner.token) {
      if (!existsSync(lock.lockPath)) renameSync(releasePath, lock.lockPath)
      return false
    }
    if (!removeLockDirectory(releasePath, lock.owner)) throw new Error('Lock cleanup failed')
    cleanupApplyStateRoot(lock.stateRoot)
    return true
  } catch {
    try {
      if (existsSync(releasePath) && !existsSync(lock.lockPath)) {
        renameSync(releasePath, lock.lockPath)
      }
    } catch {}
    return false
  }
}

export function cleanupApplyStateRoot(stateRoot: string): void {
  try {
    rmdirSync(stateRoot)
  } catch {}
}

function readOwner(path: string): ApplyLockOwner | undefined {
  let descriptor: number | undefined
  try {
    const lexical = lstatSync(path, { bigint: true })
    if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1n) return undefined
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const physical = fstatSync(descriptor, { bigint: true })
    if (
      !physical.isFile() ||
      physical.nlink !== 1n ||
      physical.dev !== lexical.dev ||
      physical.ino !== lexical.ino
    ) {
      return undefined
    }
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'))
    if (!isOwner(value)) return undefined
    return value
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function isOwner(value: unknown): value is ApplyLockOwner {
  if (!value || typeof value !== 'object') return false
  const owner = value as Partial<ApplyLockOwner>
  return (
    owner.version === OWNER_VERSION &&
    typeof owner.runId === 'string' &&
    isOpaqueId(owner.runId) &&
    typeof owner.token === 'string' &&
    isOpaqueId(owner.token) &&
    Number.isSafeInteger(owner.pid) &&
    (owner.pid ?? 0) > 0 &&
    typeof owner.host === 'string' &&
    typeof owner.startedAt === 'string' &&
    isCanonicalInstant(owner.startedAt) &&
    typeof owner.rootHash === 'string' &&
    /^[a-f0-9]{64}$/u.test(owner.rootHash) &&
    typeof owner.planFingerprint === 'string' &&
    /^[a-f0-9]{64}$/u.test(owner.planFingerprint) &&
    typeof owner.journal === 'string' &&
    owner.journal === `runs/${owner.runId}/journal.json`
  )
}

function isOpaqueId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value)
}

function isCanonicalInstant(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function safeLstat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}

function writeDurableOwner(path: string, owner: ApplyLockOwner): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(owner, null, 2)}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function removeLockDirectory(path: string, expected: ApplyLockOwner): boolean {
  try {
    const directory = lstatSync(path)
    if (!directory.isDirectory() || directory.isSymbolicLink()) return false
    const entries = readdirSync(path)
    if (entries.length !== 1 || entries[0] !== 'owner.json') return false
    const ownerPath = join(path, 'owner.json')
    const owner = readOwner(ownerPath)
    if (owner?.runId !== expected.runId || owner.token !== expected.token) return false
    unlinkSync(ownerPath)
    fsyncDirectory(path)
    rmdirSync(path)
    fsyncDirectory(join(path, '..'))
    return true
  } catch {
    return false
  }
}
