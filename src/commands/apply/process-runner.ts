import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { redactSensitiveText } from '../../utils/redact'

const OUTPUT_LIMIT = 64 * 1024
const CAPTURE_LIMIT = 4 * 1024
const MAX_PRIVATE_OUTPUT_LIMIT = 8 * 1024 * 1024
const PROCESS_SCAN_LIMIT = 16 * 1024 * 1024

export interface ExecutableHandle {
  requested: string
  path: string
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
}

export interface ExecutableFailure {
  reason: 'EXECUTABLE_UNAVAILABLE'
}

export interface ProcessOptions {
  cwd: string
  timeoutMs: number
  terminationGraceMs?: number
  settlementMs?: number
  inheritedEnv?: NodeJS.ProcessEnv
  environmentOverrides?: NodeJS.ProcessEnv
  captureStdout?: boolean
  captureStderr?: boolean
  redactCapturedStdout?: boolean
  maxOutputBytes?: number
  maxCaptureBytes?: number
}

export interface ProcessRequest extends ProcessOptions {
  executable: string
  args: string[]
}

export interface ProcessObservation {
  termination: 'exit' | 'signal' | 'timeout' | 'unavailable' | 'unknown'
  reason:
    | 'PROCESS_EXITED'
    | 'PROCESS_SIGNALED'
    | 'PROCESS_TIMEOUT'
    | 'PROCESS_OUTPUT_LIMIT'
    | 'PROCESS_DESCENDANTS_SURVIVED'
    | 'PROCESS_SUPERVISION_UNAVAILABLE'
    | 'EXECUTABLE_UNAVAILABLE'
    | 'EXECUTABLE_CHANGED'
    | 'PROCESS_START_FAILED'
  terminationConfirmed: boolean
  exitCode?: number
  signal?: NodeJS.Signals
  stdout?: string
  stderr?: string
  survivors?: {
    processGroup: boolean
    supervisionToken: boolean
    unattributed: boolean
  }
}

export interface ProcessIdentity {
  key: string
  parentPid: number
  processGroup: number
}

const ENVIRONMENT_KEYS = new Set(
  [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'COMSPEC',
    'PATHEXT',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'NO_COLOR',
    'CI',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
  ].map((key) => key.toUpperCase()),
)
const ENVIRONMENT_OVERRIDE_KEYS = new Set([
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NPM_CONFIG_CACHE',
  'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_GLOBALCONFIG',
  'NPM_CONFIG_REGISTRY',
])

export function sanitizedProcessEnvironment(
  inheritedEnv: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value !== undefined && ENVIRONMENT_KEYS.has(key.toUpperCase())) environment[key] = value
  }
  environment.CI = '1'
  environment.NO_COLOR = '1'
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && ENVIRONMENT_OVERRIDE_KEYS.has(key.toUpperCase())) {
      environment[key] = value
    }
  }
  return environment
}

export function resolveExecutable(
  executable: string,
  cwd: string,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): ExecutableHandle | ExecutableFailure {
  if (!executable || executable.includes('\0')) return { reason: 'EXECUTABLE_UNAVAILABLE' }
  const environment = sanitizedProcessEnvironment(inheritedEnv)
  const candidates = executableCandidates(executable, cwd, environment)
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      const path = realpathSync.native(candidate)
      const stat = statSync(path, { bigint: true })
      if (!stat.isFile()) continue
      return {
        requested: executable,
        path,
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeNs: stat.mtimeNs,
      }
    } catch {}
  }
  return { reason: 'EXECUTABLE_UNAVAILABLE' }
}

export async function runProcess(request: ProcessRequest): Promise<ProcessObservation> {
  const resolved = resolveExecutable(request.executable, request.cwd, request.inheritedEnv)
  if ('reason' in resolved) {
    return {
      termination: 'unavailable',
      reason: resolved.reason,
      terminationConfirmed: true,
    }
  }
  return runResolvedProcess(resolved, request.args, request)
}

export async function runResolvedProcess(
  executable: ExecutableHandle,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessObservation> {
  if (!matchesExecutable(executable)) {
    return {
      termination: 'unavailable',
      reason: 'EXECUTABLE_CHANGED',
      terminationConfirmed: true,
    }
  }
  if (!processSupervisionAvailable()) {
    return {
      termination: 'unavailable',
      reason: 'PROCESS_SUPERVISION_UNAVAILABLE',
      terminationConfirmed: true,
    }
  }
  const environment = sanitizedProcessEnvironment(
    options.inheritedEnv,
    options.environmentOverrides,
  )
  const supervisionToken = randomUUID()
  environment.DEPFRESH_PROCESS_RUN_ID = supervisionToken
  const baselineProcesses = await snapshotUserProcesses()
  if (!baselineProcesses) {
    return {
      termination: 'unavailable',
      reason: 'PROCESS_SUPERVISION_UNAVAILABLE',
      terminationConfirmed: true,
    }
  }
  const detached = process.platform !== 'win32'
  let child: ChildProcessByStdio<null, Readable, Readable>
  try {
    child = spawn(executable.path, [...args], {
      cwd: options.cwd,
      env: environment,
      shell: false,
      detached,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch {
    return {
      termination: 'unavailable',
      reason: 'PROCESS_START_FAILED',
      terminationConfirmed: true,
    }
  }

  let stdout = Buffer.alloc(0)
  let stderr = Buffer.alloc(0)
  const outputLimit = boundedLimit(options.maxOutputBytes, OUTPUT_LIMIT)
  const captureLimit = Math.min(boundedLimit(options.maxCaptureBytes, CAPTURE_LIMIT), outputLimit)
  let stdoutBytes = 0
  let stderrBytes = 0
  let outputExceeded = false
  let timedOut = false
  let spawnError = false
  let triggerTermination: (() => void) | undefined
  const terminationTriggered = new Promise<void>((resolveTermination) => {
    triggerTermination = resolveTermination
  })
  const requestTermination = (): void => {
    terminateProcessGroup(child.pid, 'SIGTERM')
    triggerTermination?.()
    triggerTermination = undefined
  }
  const append = (chunk: Buffer, stream: 'stdout' | 'stderr', capture: boolean): void => {
    if (stream === 'stdout') stdoutBytes += chunk.length
    else stderrBytes += chunk.length
    const captured = stream === 'stdout' ? stdout : stderr
    if (capture && captured.length < captureLimit) {
      const next = Buffer.concat([captured, chunk.subarray(0, captureLimit - captured.length)])
      if (stream === 'stdout') stdout = next
      else stderr = next
    }
    if ((stdoutBytes > outputLimit || stderrBytes > outputLimit) && !outputExceeded) {
      outputExceeded = true
      requestTermination()
    }
  }
  child.stdout.on('data', (chunk: Buffer) =>
    append(chunk, 'stdout', options.captureStdout === true),
  )
  child.stderr.on('data', (chunk: Buffer) =>
    append(chunk, 'stderr', options.captureStderr === true),
  )
  child.once('error', () => {
    spawnError = true
  })

  const timeout = setTimeout(() => {
    timedOut = true
    requestTermination()
  }, options.timeoutMs)
  timeout.unref()

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveClose) => {
      child.once('close', (code, signal) => resolveClose({ code, signal }))
    },
  )
  const first = await Promise.race([
    closePromise.then((closed) => ({ closed })),
    terminationTriggered.then(() => ({ closed: undefined })),
  ])
  clearTimeout(timeout)

  let terminationConfirmed = true
  let descendantsSurvived = false
  let processGroupSurvived = false
  let supervisionTokenSurvived = false
  let unattributedSurvived = false
  let closed = first.closed
  if (!closed && (timedOut || outputExceeded)) {
    if ((options.terminationGraceMs ?? 250) > 0) {
      await delay(options.terminationGraceMs ?? 250)
    }
    terminateProcessGroup(child.pid, 'SIGKILL')
    terminationConfirmed = await confirmProcessGroupStopped(child.pid)
    closed = await Promise.race([closePromise, delay(500).then(() => undefined)])
  }

  if (closed && !timedOut && !outputExceeded && !processGroupStopped(child.pid)) {
    descendantsSurvived = true
    terminateProcessGroup(child.pid, 'SIGTERM')
    if ((options.terminationGraceMs ?? 250) > 0) {
      await delay(options.terminationGraceMs ?? 250)
    }
    terminateProcessGroup(child.pid, 'SIGKILL')
    terminationConfirmed = await confirmProcessGroupStopped(child.pid)
  }

  if (closed || timedOut || outputExceeded) {
    const finalProcesses = await snapshotUserProcesses()
    const escaped = await processesWithEnvironmentToken(supervisionToken)
    if (!(escaped && finalProcesses)) {
      return {
        termination: 'unknown',
        reason: 'PROCESS_SUPERVISION_UNAVAILABLE',
        terminationConfirmed: false,
      }
    }
    processGroupSurvived = !processGroupStopped(child.pid)
    if (processGroupSurvived) {
      descendantsSurvived = true
      terminationConfirmed = false
    }
    const escapedSurvivors = new Set(
      [...escaped].filter((pid) =>
        isSupervisionTokenSurvivor(pid, finalProcesses.get(pid), child.pid, processGroupSurvived),
      ),
    )
    if (escapedSurvivors.size > 0) {
      descendantsSurvived = true
      supervisionTokenSurvived = true
      for (const pid of escapedSurvivors) terminatePid(pid, 'SIGTERM')
      if ((options.terminationGraceMs ?? 250) > 0) await delay(options.terminationGraceMs ?? 250)
      for (const pid of escapedSurvivors) terminatePid(pid, 'SIGKILL')
      terminationConfirmed =
        terminationConfirmed && [...escapedSurvivors].every((pid) => !pidExists(pid))
    }
    const unattributed = [...finalProcesses].filter(([pid, identity]) =>
      isUnattributedProcessSurvivor(pid, identity, {
        baseline: baselineProcesses,
        childPid: child.pid,
        current: finalProcesses,
        escaped: escapedSurvivors,
        processGroupSurvived,
      }),
    )
    if (unattributed.length > 0) {
      descendantsSurvived = true
      unattributedSurvived = true
      terminationConfirmed = false
    }
  }

  if (closed && !timedOut && !outputExceeded && (options.settlementMs ?? 0) > 0) {
    await delay(options.settlementMs)
  }

  if (spawnError) {
    return {
      termination: 'unavailable',
      reason: 'PROCESS_START_FAILED',
      terminationConfirmed,
    }
  }
  if (descendantsSurvived) {
    return {
      termination: 'unknown',
      reason: 'PROCESS_DESCENDANTS_SURVIVED',
      terminationConfirmed,
      survivors: {
        processGroup: processGroupSurvived,
        supervisionToken: supervisionTokenSurvived,
        unattributed: unattributedSurvived,
      },
    }
  }
  if (outputExceeded) {
    return {
      termination: 'unknown',
      reason: 'PROCESS_OUTPUT_LIMIT',
      terminationConfirmed,
    }
  }
  if (timedOut) {
    return {
      termination: 'timeout',
      reason: 'PROCESS_TIMEOUT',
      terminationConfirmed,
    }
  }
  if (closed?.signal) {
    return {
      termination: 'signal',
      reason: 'PROCESS_SIGNALED',
      signal: closed.signal,
      terminationConfirmed: true,
    }
  }
  const result: ProcessObservation = {
    termination: 'exit',
    reason: 'PROCESS_EXITED',
    exitCode: closed?.code ?? 1,
    terminationConfirmed: true,
  }
  if (options.captureStdout) {
    const captured = stdout.toString('utf8').trim()
    result.stdout =
      options.redactCapturedStdout === false ? captured : redactSensitiveText(captured)
  }
  if (options.captureStderr) {
    const captured = stderr.toString('utf8').trim()
    result.stderr =
      options.redactCapturedStdout === false ? captured : redactSensitiveText(captured)
  }
  return result
}

function boundedLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0
    ? Math.min(value!, MAX_PRIVATE_OUTPUT_LIMIT)
    : fallback
}

function executableCandidates(
  executable: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  if (isAbsolute(executable) || executable.includes('/') || executable.includes('\\')) {
    return [resolve(cwd, executable)]
  }
  const pathValue = environment.PATH ?? environment.Path ?? ''
  const extensions =
    process.platform === 'win32'
      ? (environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : ['']
  const candidates: string[] = []
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    for (const extension of extensions)
      candidates.push(join(directory, `${executable}${extension}`))
  }
  return candidates
}

function matchesExecutable(expected: ExecutableHandle): boolean {
  try {
    const path = realpathSync.native(expected.path)
    const stat = statSync(path, { bigint: true })
    return (
      path === expected.path &&
      stat.isFile() &&
      stat.dev === expected.dev &&
      stat.ino === expected.ino &&
      stat.size === expected.size &&
      stat.mtimeNs === expected.mtimeNs
    )
  } catch {
    return false
  }
}

function terminateProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal)
  } catch {}
}

function terminatePid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {}
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')
  }
}

function processSupervisionAvailable(): boolean {
  if (process.platform === 'linux') {
    try {
      accessSync('/proc', constants.R_OK)
      return true
    } catch {
      return false
    }
  }
  if (process.platform === 'darwin') {
    try {
      accessSync('/bin/ps', constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  return false
}

async function snapshotUserProcesses(): Promise<Map<number, ProcessIdentity> | undefined> {
  if (process.platform === 'linux') {
    const identities = new Map<number, ProcessIdentity>()
    try {
      const uid = process.getuid?.()
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/u.test(entry)) continue
        try {
          if (uid !== undefined && statSync(`/proc/${entry}`).uid !== uid) continue
          const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
          const startTime = fields[19]
          const parentPid = Number(fields[1])
          const processGroup = Number(fields[2])
          if (startTime && Number.isSafeInteger(parentPid) && Number.isSafeInteger(processGroup)) {
            identities.set(Number(entry), {
              key: `${entry}:${startTime}`,
              parentPid,
              processGroup,
            })
          }
        } catch {}
      }
      return identities
    } catch {
      return undefined
    }
  }
  if (process.platform !== 'darwin' || process.getuid === undefined) return undefined
  const uid = process.getuid()
  return new Promise((resolveProcesses) => {
    let output = ''
    let failed = false
    const observer = spawn(
      '/bin/ps',
      ['-U', String(uid), '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart='],
      {
        cwd: '/',
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    observer.stdout.on('data', (chunk: Buffer) => {
      if (output.length <= PROCESS_SCAN_LIMIT) output += chunk.toString('utf8')
    })
    observer.once('error', () => {
      failed = true
    })
    observer.once('close', (code) => {
      if (failed || code !== 0 || output.length > PROCESS_SCAN_LIMIT) {
        resolveProcesses(undefined)
        return
      }
      const identities = new Map<number, ProcessIdentity>()
      for (const line of output.split('\n')) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u)
        if (!match) continue
        const pid = Number(match[1])
        const parentPid = Number(match[2])
        const processGroup = Number(match[3])
        if (pid !== observer.pid) {
          identities.set(pid, {
            key: `${pid}:${match[4]}`,
            parentPid,
            processGroup,
          })
        }
      }
      resolveProcesses(identities)
    })
  })
}

function sameProcessIdentity(
  left: ProcessIdentity | undefined,
  right: ProcessIdentity | undefined,
): boolean {
  return Boolean(
    left && right && left.key === right.key && left.processGroup === right.processGroup,
  )
}

export function isUnattributedProcessSurvivor(
  pid: number,
  identity: ProcessIdentity,
  options: {
    baseline: ReadonlyMap<number, ProcessIdentity>
    childPid: number | undefined
    current: ReadonlyMap<number, ProcessIdentity>
    escaped: ReadonlySet<number>
    processGroupSurvived: boolean
  },
): boolean {
  if (pid === options.childPid || options.escaped.has(pid)) return false
  if (sameProcessIdentity(options.baseline.get(pid), identity)) return false
  if (
    [...options.baseline.values()].some(
      (baseline) => baseline.processGroup === identity.processGroup,
    )
  ) {
    return false
  }
  if (hasBaselineAncestor(identity, options.baseline, options.current)) return false
  return !(
    options.childPid !== undefined &&
    identity.processGroup === options.childPid &&
    !options.processGroupSurvived
  )
}

export function isSupervisionTokenSurvivor(
  pid: number,
  identity: ProcessIdentity | undefined,
  childPid: number | undefined,
  processGroupSurvived: boolean,
): boolean {
  if (childPid === undefined || processGroupSurvived) return true
  if (pid === childPid) return false
  return identity?.processGroup !== childPid
}

function hasBaselineAncestor(
  identity: ProcessIdentity,
  baseline: ReadonlyMap<number, ProcessIdentity>,
  current: ReadonlyMap<number, ProcessIdentity>,
): boolean {
  const visited = new Set<number>()
  let parentPid = identity.parentPid
  while (parentPid > 1 && !visited.has(parentPid)) {
    visited.add(parentPid)
    const parent = current.get(parentPid)
    if (!parent) return false
    if (sameProcessIdentity(baseline.get(parentPid), parent)) return true
    parentPid = parent.parentPid
  }
  return false
}

async function processesWithEnvironmentToken(token: string): Promise<Set<number> | undefined> {
  if (process.platform === 'linux') {
    const pids = new Set<number>()
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/u.test(entry)) continue
        try {
          const environment = readFileSync(`/proc/${entry}/environ`)
          if (environment.includes(Buffer.from(`DEPFRESH_PROCESS_RUN_ID=${token}\0`))) {
            pids.add(Number(entry))
          }
        } catch {}
      }
      return pids
    } catch {
      return undefined
    }
  }
  if (process.platform !== 'darwin') return undefined
  return new Promise((resolveProcesses) => {
    let output = ''
    let failed = false
    const observer = spawn('/bin/ps', ['eww', '-axo', 'pid=,command='], {
      cwd: '/',
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    observer.stdout.on('data', (chunk: Buffer) => {
      if (output.length <= PROCESS_SCAN_LIMIT) output += chunk.toString('utf8')
    })
    observer.once('error', () => {
      failed = true
    })
    observer.once('close', (code) => {
      if (failed || code !== 0 || output.length > PROCESS_SCAN_LIMIT) {
        resolveProcesses(undefined)
        return
      }
      resolveProcesses(
        new Set(
          output
            .split('\n')
            .filter((line) => line.includes(`DEPFRESH_PROCESS_RUN_ID=${token}`))
            .map((line) => Number(line.trimStart().match(/^\d+/u)?.[0]))
            .filter((pid) => Number.isSafeInteger(pid) && pid !== observer.pid),
        ),
      )
    })
  })
}

async function confirmProcessGroupStopped(pid: number | undefined): Promise<boolean> {
  if (!pid) return true
  if (process.platform === 'win32') return false
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      process.kill(-pid, 0)
      await delay(20)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
        return true
      }
      return false
    }
  }
  return false
}

function processGroupStopped(pid: number | undefined): boolean {
  if (!pid) return true
  if (process.platform === 'win32') return false
  try {
    process.kill(-pid, 0)
    return false
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')
  }
}
