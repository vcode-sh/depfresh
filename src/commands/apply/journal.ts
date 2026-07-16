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
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { ApplyLock } from './lock'

export type JournalTargetState =
  | 'staged'
  | 'replacing'
  | 'replaced'
  | 'restored'
  | 'recovery-failed'

export interface ApplyJournalTarget {
  file: string
  sourceHash: string
  stagedHash: string
  stage: string
  backup: string
  mode: number
  state: JournalTargetState
}

export interface ApplyJournal {
  version: 1
  runId: string
  planFingerprint: string
  state: 'staged' | 'committing' | 'recovering' | 'recovered' | 'failed'
  targets: ApplyJournalTarget[]
}

export interface JournalHandle {
  runsDirectory: string
  runsIdentity: { dev: bigint; ino: bigint }
  directory: string
  directoryIdentity: { dev: bigint; ino: bigint }
  path: string
  journalIdentity?: { dev: bigint; ino: bigint }
  value: ApplyJournal
}

export function createJournal(
  lock: ApplyLock,
  planFingerprint: string,
  targets: ApplyJournalTarget[],
): JournalHandle {
  let runsCreated = false
  let runCreated = false
  const runsDirectory = join(lock.stateRoot, 'runs')
  const directory = join(runsDirectory, lock.owner.runId)
  try {
    assertDirectory(lock.stateRoot)
    if (existsSync(runsDirectory)) {
      assertDirectory(runsDirectory)
    } else {
      mkdirSync(runsDirectory, { mode: 0o700 })
      runsCreated = true
      fsyncDirectory(lock.stateRoot)
    }
    mkdirSync(directory, { mode: 0o700 })
    runCreated = true
    fsyncDirectory(runsDirectory)
    const runsIdentity = directoryIdentity(runsDirectory)
    const runIdentity = directoryIdentity(directory)
    return {
      runsDirectory,
      runsIdentity,
      directory,
      directoryIdentity: runIdentity,
      path: join(directory, 'journal.json'),
      value: {
        version: 1,
        runId: lock.owner.runId,
        planFingerprint,
        state: 'staged',
        targets,
      },
    }
  } catch (error) {
    if (runCreated) removeEmptyDirectory(directory, runsDirectory)
    if (runsCreated) removeEmptyDirectory(runsDirectory, lock.stateRoot)
    throw error
  }
}

export function persistJournal(handle: JournalHandle): void {
  assertHandleDirectories(handle)
  if (!ownsJournal(handle, true)) throw new Error('Journal identity changed')
  const temporary = join(handle.directory, `.journal-${randomUUID()}.tmp`)
  let descriptor: number | undefined
  let identity: { dev: bigint; ino: bigint } | undefined
  try {
    try {
      descriptor = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      )
      const stat = fstatSync(descriptor, { bigint: true })
      identity = { dev: stat.dev, ino: stat.ino }
      writeFileSync(descriptor, `${JSON.stringify(handle.value, null, 2)}\n`)
      fsyncSync(descriptor)
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
    const current = lstatSync(temporary, { bigint: true })
    if (
      !(identity && current.isFile()) ||
      current.isSymbolicLink() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    ) {
      throw new Error('Journal temporary identity changed')
    }
    renameSync(temporary, handle.path)
    fsyncDirectory(handle.directory)
    const persisted = lstatSync(handle.path, { bigint: true })
    if (
      !persisted.isFile() ||
      persisted.isSymbolicLink() ||
      persisted.nlink !== 1n ||
      persisted.dev !== identity.dev ||
      persisted.ino !== identity.ino
    ) {
      throw new Error('Persisted journal identity changed')
    }
    handle.journalIdentity = { dev: persisted.dev, ino: persisted.ino }
  } catch (error) {
    removeIfOwned(temporary, identity)
    throw error
  }
}

export function removeJournal(handle: JournalHandle): boolean {
  try {
    assertHandleDirectories(handle)
    const entries = readdirSync(handle.directory)
    if (entries.length > 1 || (entries.length === 1 && entries[0] !== 'journal.json')) return false
    if (entries.length === 0 && handle.journalIdentity) return false
    if (entries[0] === 'journal.json') {
      if (!ownsJournal(handle)) return false
      unlinkSync(handle.path)
      fsyncDirectory(handle.directory)
    }
    rmdirSync(handle.directory)
    fsyncDirectory(handle.runsDirectory)
    try {
      rmdirSync(handle.runsDirectory)
      fsyncDirectory(dirname(handle.runsDirectory))
    } catch {}
    return true
  } catch {
    return false
  }
}

export function ownsJournal(handle: JournalHandle, allowMissing = false): boolean {
  try {
    assertHandleDirectories(handle)
    if (!handle.journalIdentity) return allowMissing && !existsSync(handle.path)
    const journal = lstatSync(handle.path, { bigint: true })
    return (
      journal.isFile() &&
      !journal.isSymbolicLink() &&
      journal.nlink === 1n &&
      journal.dev === handle.journalIdentity.dev &&
      journal.ino === handle.journalIdentity.ino
    )
  } catch {
    return false
  }
}

export function removeJournalRun(stateRoot: string, runId: string): boolean {
  const runsDirectory = join(stateRoot, 'runs')
  try {
    if (!existsSync(runsDirectory)) return true
    assertDirectory(runsDirectory)
    const directory = join(runsDirectory, runId)
    if (existsSync(directory)) {
      assertDirectory(directory)
      if (readdirSync(directory).length > 0) return false
      rmdirSync(directory)
      fsyncDirectory(runsDirectory)
    }
    try {
      rmdirSync(runsDirectory)
      fsyncDirectory(stateRoot)
    } catch {}
    return true
  } catch {
    return false
  }
}

export function fsyncDirectory(path: string): void {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function assertDirectory(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Apply state path is not a physical directory')
  }
}

function assertHandleDirectories(handle: JournalHandle): void {
  const runs = directoryIdentity(handle.runsDirectory)
  const run = directoryIdentity(handle.directory)
  if (
    runs.dev !== handle.runsIdentity.dev ||
    runs.ino !== handle.runsIdentity.ino ||
    run.dev !== handle.directoryIdentity.dev ||
    run.ino !== handle.directoryIdentity.ino
  ) {
    throw new Error('Journal directory identity changed')
  }
}

function directoryIdentity(path: string): { dev: bigint; ino: bigint } {
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Apply state path is not a physical directory')
  }
  return { dev: stat.dev, ino: stat.ino }
}

function removeIfOwned(path: string, identity: { dev: bigint; ino: bigint } | undefined): void {
  if (!identity) return
  try {
    const current = lstatSync(path, { bigint: true })
    if (current.dev === identity.dev && current.ino === identity.ino) rmSync(path)
  } catch {}
}

function removeEmptyDirectory(path: string, parent: string): void {
  try {
    if (readdirSync(path).length > 0) return
    rmdirSync(path)
    fsyncDirectory(parent)
  } catch {}
}
