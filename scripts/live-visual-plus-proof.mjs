import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractSinglePackEntry } from './pack-manifest.mjs'
import { classifyRawTerminalTransport, runInPty } from '../test/helpers/pty-runner.mjs'

const MAX_JSON_BYTES = 256 * 1024
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const COMMAND_TIMEOUT_MS = 30_000
const LIVE_PTY_TIMEOUT_MS = 15 * 60_000
const LIVE_PTY_OUTPUT_BYTES = 4 * 1024 * 1024
const EXPECTED_COLUMNS = [80, 118]
const EXPECTED_REPLAY_TOTALS = { files: 1, suites: 5, tests: 69 }
const GIT_EXECUTABLE = '/usr/bin/git'
const scriptPath = fileURLToPath(import.meta.url)

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const command = parseLiveVisualPlusProofCommand(process.argv.slice(2))
    const evidence = await runLiveVisualPlusProof(command)
    process.stdout.write(
      `${JSON.stringify({ output: command.outputPath, runs: evidence.runs.length })}\n`,
    )
  } catch {
    process.stderr.write('Live Visual+ proof failed\n')
    process.exitCode = 1
  }
}

export function parseLiveVisualPlusProofCommand(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.some((value) => typeof value !== 'string')) {
    throw new Error('Live Visual+ proof arguments are invalid')
  }
  const values = {}
  const columns = []
  let includeLong = false
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--include-long' && !includeLong) {
      includeLong = true
      continue
    }
    const key = new Map([
      ['--cwd', 'cwd'],
      ['--pack-json', 'packJsonPath'],
      ['--replay-evidence', 'replayEvidencePath'],
      ['--output', 'outputPath'],
    ]).get(argument)
    if (key !== undefined && values[key] === undefined) {
      const value = arguments_[index + 1]
      if (typeof value !== 'string' || value.startsWith('--')) throw usageError()
      values[key] = value
      index += 1
      continue
    }
    if (argument === '--columns') {
      const value = arguments_[index + 1]
      if (typeof value !== 'string' || !/^[0-9]+$/u.test(value)) throw usageError()
      columns.push(Number(value))
      index += 1
      continue
    }
    throw usageError()
  }
  if (
    typeof values.cwd !== 'string' ||
    typeof values.packJsonPath !== 'string' ||
    typeof values.replayEvidencePath !== 'string' ||
    typeof values.outputPath !== 'string' ||
    columns.length !== EXPECTED_COLUMNS.length ||
    columns.some((value, index) => value !== EXPECTED_COLUMNS[index])
  ) {
    throw usageError()
  }
  return {
    columns,
    cwd: values.cwd,
    includeLong,
    outputPath: values.outputPath,
    packJsonPath: values.packJsonPath,
    replayEvidencePath: values.replayEvidencePath,
  }
}

export async function runLiveVisualPlusProof(options) {
  const command = requireProofOptions(options)
  const cwd = requireSafeDirectory(command.cwd, 'repository')
  const repositoryPackage = readBoundedJson(
    requireSafeRegularFile(join(cwd, 'package.json'), 'repository package manifest'),
  )
  if (!isRecord(repositoryPackage) || typeof repositoryPackage.name !== 'string') {
    throw new Error('Live repository package identity is invalid')
  }
  rejectLocalShadow(cwd)
  const artifact = verifyArtifactBinding(command.packJsonPath, command.replayEvidencePath)
  const outputPath = requireContainedNewOutput(command.outputPath, artifact.root)
  const environment = requireEnvironment(command.environment ?? process.env)
  const bunx = resolveUniqueBunx(environment.PATH)
  const bunGlobal = resolveBunGlobalIdentity(bunx, cwd, environment, artifact.replay.cli.sha256)
  const before = repositorySnapshot(cwd)
  const launcher = createBunxPtyLauncher(bunx)
  const runs = []
  const longRuns = []
  try {
    for (const columns of command.columns) {
      const argv = fixedArgv(cwd, false)
      const result = await runInPty({
        args: argv,
        cliPath: launcher.path,
        columns,
        env: capableEnvironment(environment),
        input: Buffer.alloc(0),
        outputLimit: LIVE_PTY_OUTPUT_BYTES,
        timeoutMs: LIVE_PTY_TIMEOUT_MS,
      })
      runs.push(analyzeHybridRun(result, columns, argv, repositoryPackage.name))
      requireUnchanged(before, repositorySnapshot(cwd))
    }
    if (command.includeLong) {
      for (let index = 0; index < command.columns.length; index += 1) {
        const columns = command.columns[index]
        const argv = fixedArgv(cwd, true)
        const result = await runInPty({
          args: argv,
          cliPath: launcher.path,
          columns,
          env: capableEnvironment(environment),
          input: Buffer.alloc(0),
          outputLimit: LIVE_PTY_OUTPUT_BYTES,
          timeoutMs: LIVE_PTY_TIMEOUT_MS,
        })
        longRuns.push(analyzeLongRun(result, columns, argv, runs[index].operationRows.declared))
        requireUnchanged(before, repositorySnapshot(cwd))
      }
    }
  } finally {
    launcher.cleanup()
  }
  const after = repositorySnapshot(cwd)
  requireUnchanged(before, after)
  const evidence = {
    schemaVersion: 1,
    kind: 'depfresh-live-visual-plus-proof',
    cwd,
    bunx: {
      path: bunx.path,
      realpath: bunx.realpath,
      sha256: bunx.sha256,
      launchIdentity: launcher.identity,
    },
    bunGlobal,
    artifact: {
      packJsonRealpath: artifact.packJsonPath,
      replayEvidenceRealpath: artifact.replayEvidencePath,
      tarballRealpath: artifact.tarballPath,
      tarballSha256: artifact.tarballSha256,
      packageVersion: artifact.replay.packageVersion,
    },
    runs,
    ...(command.includeLong ? { longRuns } : {}),
    repository: { before, after, unchanged: true },
  }
  writeJsonAtomicNoReplace(outputPath, evidence)
  return evidence
}

function requireProofOptions(options) {
  if (!isRecord(options)) throw new Error('Live Visual+ proof options are invalid')
  const columns = options.columns
  if (
    !Array.isArray(columns) ||
    columns.length !== EXPECTED_COLUMNS.length ||
    columns.some((value, index) => value !== EXPECTED_COLUMNS[index]) ||
    typeof options.cwd !== 'string' ||
    typeof options.packJsonPath !== 'string' ||
    typeof options.replayEvidencePath !== 'string' ||
    typeof options.outputPath !== 'string' ||
    typeof options.includeLong !== 'boolean'
  ) {
    throw new Error('Live Visual+ proof options are invalid')
  }
  return { ...options, columns: [...columns] }
}

function verifyArtifactBinding(packJsonArgument, replayEvidenceArgument) {
  const packJsonPath = requireSafeRegularFile(resolve(packJsonArgument), 'pack JSON')
  const root = requireSafeDirectory(dirname(packJsonPath), 'artifact root')
  const replayEvidencePath = requireSafeRegularFile(
    resolve(replayEvidenceArgument),
    'installed replay evidence',
  )
  requireContained(replayEvidencePath, root, 'Installed replay evidence is not contained')
  const replay = requireReplayEvidence(readBoundedJson(replayEvidencePath))
  let entry
  try {
    entry = extractSinglePackEntry(readBoundedJson(packJsonPath))
  } catch {
    throw new Error('Pack JSON is invalid')
  }
  if (
    !isRecord(entry) ||
    entry.name !== 'depfresh' ||
    entry.version !== replay.packageVersion ||
    typeof entry.filename !== 'string' ||
    basename(entry.filename) !== entry.filename ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 1
  ) {
    throw new Error('Pack JSON identity is invalid')
  }
  const tarballPath = requireSafeRegularFile(join(root, entry.filename), 'tarball')
  requireContained(tarballPath, root, 'Tarball is not contained')
  const tarballBytes = readFileSync(tarballPath)
  const tarballSha256 = sha256(tarballBytes)
  if (
    tarballBytes.byteLength !== entry.size ||
    replay.tarball.realpath !== tarballPath ||
    replay.tarball.sha256 !== tarballSha256
  ) {
    throw new Error('Pack JSON and installed replay tarball identities differ')
  }
  return { packJsonPath, replay, replayEvidencePath, root, tarballPath, tarballSha256 }
}

function requireReplayEvidence(value) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'depfresh-installed-visual-plus-replay' ||
    typeof value.packageVersion !== 'string' ||
    !isRecord(value.tarball) ||
    typeof value.tarball.realpath !== 'string' ||
    !isSha256(value.tarball.sha256) ||
    !isRecord(value.extractedPackage) ||
    typeof value.extractedPackage.realpath !== 'string' ||
    !isRecord(value.cli) ||
    typeof value.cli.realpath !== 'string' ||
    !isSha256(value.cli.sha256) ||
    !isRecord(value.passed) ||
    value.passed.files !== EXPECTED_REPLAY_TOTALS.files ||
    value.passed.suites !== EXPECTED_REPLAY_TOTALS.suites ||
    value.passed.tests !== EXPECTED_REPLAY_TOTALS.tests
  ) {
    throw new Error('Installed replay evidence is invalid')
  }
  return value
}

function resolveUniqueBunx(pathValue) {
  if (typeof pathValue !== 'string' || pathValue.length < 1 || pathValue.includes('\0')) {
    throw new Error('PATH is unavailable')
  }
  const candidates = []
  const directories = new Set(pathValue.split(delimiter))
  for (const directory of directories) {
    if (!isAbsolute(directory) || resolve(directory) !== directory) {
      throw new Error('PATH contains an unsafe entry')
    }
    const candidate = join(directory, process.platform === 'win32' ? 'bunx.exe' : 'bunx')
    try {
      const stats = statSync(candidate)
      accessSync(candidate, constants.X_OK)
      if (!stats.isFile()) continue
      candidates.push({ path: candidate, realpath: realpathSync.native(candidate) })
    } catch {}
  }
  if (candidates.length !== 1) throw new Error('PATH must resolve exactly one bunx executable')
  const candidate = candidates[0]
  return { ...candidate, sha256: sha256(readFileSync(candidate.realpath)) }
}

function resolveBunGlobalIdentity(bunx, cwd, environment, expectedCliSha256) {
  const result = runBounded(bunx.realpath, ['pm', 'bin', '-g'], { cwd, environment })
  const lines = result.stdout.trimEnd().split('\n')
  if (result.stderr !== '' || lines.length !== 1 || lines[0].length < 1) {
    throw new Error('Bun global bin could not be resolved')
  }
  const binRealpath = requireSafeDirectory(lines[0], 'Bun global bin')
  const depfreshLink = join(binRealpath, 'depfresh')
  let linkStats
  try {
    linkStats = lstatSync(depfreshLink)
  } catch {
    throw new Error('Bun global depfresh link is unavailable')
  }
  if (!linkStats.isSymbolicLink()) throw new Error('Bun global depfresh entry is not a symlink')
  const depfreshLinkTarget = requireSafeRegularFile(
    realpathSync.native(depfreshLink),
    'Bun global depfresh CLI',
  )
  requireContained(
    depfreshLinkTarget,
    dirname(binRealpath),
    'Bun global depfresh CLI is outside the Bun installation',
  )
  const cliSha256 = sha256(readFileSync(depfreshLinkTarget))
  if (cliSha256 !== expectedCliSha256) {
    throw new Error('Bun global depfresh CLI does not match installed replay evidence')
  }
  return { binRealpath, depfreshLink, depfreshLinkTarget, cliSha256 }
}

function createBunxPtyLauncher(bunx) {
  const stats = lstatSync(bunx.path)
  const targetStats = statSync(bunx.realpath)
  if (stats.isFile() && !stats.isSymbolicLink() && bunx.path === bunx.realpath) {
    return {
      path: bunx.realpath,
      identity: {
        method: 'direct',
        device: String(targetStats.dev),
        inode: String(targetStats.ino),
      },
      cleanup() {},
    }
  }
  const lexicalRoot = mkdtempSync(join(tmpdir(), 'depfresh-live-bunx-'))
  const root = realpathSync.native(lexicalRoot)
  const launcherPath = join(root, 'bunx')
  try {
    linkSync(bunx.realpath, launcherPath)
    const launcherStats = lstatSync(launcherPath)
    if (
      !launcherStats.isFile() ||
      launcherStats.isSymbolicLink() ||
      launcherStats.dev !== targetStats.dev ||
      launcherStats.ino !== targetStats.ino
    ) {
      throw new Error()
    }
    return {
      path: launcherPath,
      identity: {
        method: 'inode-bound-bunx',
        device: String(targetStats.dev),
        inode: String(targetStats.ino),
      },
      cleanup() {
        rmSync(root, { force: true, recursive: true })
      },
    }
  } catch {
    rmSync(root, { force: true, recursive: true })
    throw new Error('Resolved bunx executable could not be bound for PTY execution')
  }
}

function analyzeHybridRun(result, columns, argv, repositoryName) {
  requireSuccessfulPty(result, columns)
  const screen = result.transcript
  const lines = screen.trimEnd().split('\n')
  const context = lines.findIndex(
    (line) =>
      line.includes(repositoryName) &&
      /\bbun(?:\s|\b)/u.test(line) &&
      line.includes('major') &&
      line.includes('read-only'),
  )
  const topology = lines.findIndex((line) => /\b[0-9]+ updates\b/u.test(line))
  const severity = lines.findIndex((line) => /^Major [0-9]+ .*Minor [0-9]+ .*Patch [0-9]+$/u.test(line))
  const breaking = lines.findIndex((line) => line === 'Breaking changes')
  const ledger = lines.findIndex((line) => /^dependency\b.*\bseverity\b/u.test(line))
  const indexes = [context, topology, severity, breaking, ledger]
  if (indexes.some((index) => index < 0) || indexes.some((value, index) => index > 0 && value <= indexes[index - 1])) {
    throw new Error('Live Visual+ hierarchy is incomplete')
  }
  const topologyMatch = lines[topology].match(/\b([0-9]+) updates\b/u)
  const declared = Number(topologyMatch?.[1])
  const ledgerTail = lines.slice(ledger + 1)
  const receiptIndex = ledgerTail.findIndex((line) => /^Review complete\b/u.test(line))
  if (!Number.isSafeInteger(declared) || declared < 1 || receiptIndex < 0) {
    throw new Error('Live Visual+ update membership is incomplete')
  }
  const rendered = ledgerTail
    .slice(0, receiptIndex)
    .filter((line) => /\b(?:Major|Minor|Patch)\b/u.test(line)).length
  if (rendered !== declared || !ledgerTail[receiptIndex].includes(`${declared} updates`)) {
    throw new Error('Live Visual+ update membership differs from the summary')
  }
  if (
    /Lifecycle|Update preview|audit preview|Operation ID|Owner ID|Dependency ID|Package ID|Source ID/iu.test(
      screen,
    )
  ) {
    throw new Error('Live Visual+ default output contains forbidden audit details')
  }
  return {
    columns,
    argv,
    exitCode: result.exitCode,
    signal: result.signal,
    finalCursorVisible: result.finalCursorVisible,
    controls: result.controls,
    rawControl: classifyRawTerminalTransport(result.rawTerminal),
    operationRows: { declared, rendered, complete: true },
    hierarchyTokens: [
      'context',
      'topology',
      'severity',
      'breaking-changes',
      'update-ledger',
    ],
    finalScreen: screen,
  }
}

function analyzeLongRun(result, columns, argv, expectedOperations) {
  requireSuccessfulPty(result, columns)
  const screen = result.transcript
  const membership = {
    dependencies: countExactLines(screen, 'Dependency ID '),
    majorCards: countExactLines(screen, 'Major card'),
    occurrences: countExactLines(screen, 'Occurrence'),
    operations: countExactLines(screen, 'Operation ID '),
    owners: countExactLines(screen, 'Owner ID '),
    targets: countExactLines(screen, 'Target '),
  }
  if (
    membership.operations !== expectedOperations ||
    membership.occurrences < 1 ||
    membership.owners < 1 ||
    membership.targets < 1
  ) {
    throw new Error('Live Visual+ long membership is incomplete')
  }
  return {
    columns,
    argv,
    exitCode: result.exitCode,
    signal: result.signal,
    finalCursorVisible: result.finalCursorVisible,
    controls: result.controls,
    rawControl: classifyRawTerminalTransport(result.rawTerminal),
    membership,
    finalScreen: screen,
  }
}

function requireSuccessfulPty(result, columns) {
  if (
    !isRecord(result) ||
    result.exitCode !== 0 ||
    result.signal !== null ||
    result.finalCursorVisible !== true ||
    result.evidence?.columns !== columns ||
    typeof result.transcript !== 'string' ||
    !result.transcript.endsWith('Exit 0\n')
  ) {
    throw new Error('Live Visual+ PTY run is incomplete')
  }
}

function repositorySnapshot(cwd) {
  const root = runGit(cwd, ['rev-parse', '--show-toplevel']).stdout.trim()
  if (requireSafeDirectory(root, 'Git repository root') !== cwd) {
    throw new Error('Live proof cwd is not the Git repository root')
  }
  const head = runGit(cwd, ['rev-parse', '--verify', 'HEAD']).stdout.trim()
  if (!/^[a-f0-9]{40,64}$/u.test(head)) throw new Error('Git HEAD identity is invalid')
  const rawIndexPath = runGit(cwd, ['rev-parse', '--git-path', 'index']).stdout.trim()
  const indexPath = requireSafeRegularFile(
    isAbsolute(rawIndexPath) ? rawIndexPath : resolve(cwd, rawIndexPath),
    'Git index',
  )
  const indexBytes = readFileSync(indexPath)
  const diff = runGit(cwd, ['diff', '--no-ext-diff', '--binary']).stdoutBytes
  const cachedDiff = runGit(cwd, ['diff', '--cached', '--no-ext-diff', '--binary']).stdoutBytes
  const status = runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all']).stdoutBytes
  const bunLockPath = requireSafeRegularFile(join(cwd, 'bun.lock'), 'bun.lock')
  const bunLockBytes = readFileSync(bunLockPath)
  return {
    head,
    index: byteIdentity(indexBytes, indexPath),
    diff: byteIdentity(diff),
    cachedDiff: byteIdentity(cachedDiff),
    status: byteIdentity(status),
    bunLock: byteIdentity(bunLockBytes, bunLockPath),
  }
}

function runGit(cwd, args) {
  return runBounded(GIT_EXECUTABLE, args, {
    cwd,
    environment: {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      HOME: cwd,
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
    },
  })
}

function runBounded(executable, args, options) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'buffer',
    env: options.environment,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    shell: false,
    timeout: COMMAND_TIMEOUT_MS,
  })
  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new Error('Live proof command failed')
  }
  const stdoutBytes = result.stdout ?? Buffer.alloc(0)
  const stderrBytes = result.stderr ?? Buffer.alloc(0)
  return {
    stdout: stdoutBytes.toString('utf8'),
    stderr: stderrBytes.toString('utf8'),
    stdoutBytes,
  }
}

function readBoundedJson(path) {
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > MAX_JSON_BYTES) {
    throw new Error('Live proof JSON input is unsafe')
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Live proof JSON input is invalid')
  }
}

function requireSafeDirectory(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} path is invalid`)
  }
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    throw new Error(`${label} is unavailable`)
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync.native(path) !== path) {
    throw new Error(`${label} is unsafe`)
  }
  return path
}

function requireSafeRegularFile(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} path is invalid`)
  }
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    throw new Error(`${label} is unavailable`)
  }
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync.native(path) !== path) {
    throw new Error(`${label} is unsafe`)
  }
  return path
}

function requireContainedNewOutput(path, root) {
  if (typeof path !== 'string') throw new Error('Live proof output path is invalid')
  const outputPath = resolve(path)
  const parent = requireSafeDirectory(dirname(outputPath), 'live proof output parent')
  requireContained(parent, root, 'Live proof output is not contained')
  try {
    lstatSync(outputPath)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return outputPath
    throw new Error('Live proof output is unavailable')
  }
  throw new Error('Live proof output already exists')
}

function rejectLocalShadow(cwd) {
  const shadow = join(cwd, 'node_modules', '.bin', 'depfresh')
  try {
    lstatSync(shadow)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return
    throw new Error('Local depfresh shadow could not be inspected')
  }
  throw new Error('Local depfresh shadow is present')
}

function requireEnvironment(input) {
  if (!isRecord(input)) throw new Error('Live proof environment is invalid')
  const environment = {}
  for (const [name, value] of Object.entries(input)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) ||
      typeof value !== 'string' ||
      value.includes('\0')
    ) {
      throw new Error('Live proof environment is invalid')
    }
    environment[name] = value
  }
  if (typeof environment.PATH !== 'string') throw new Error('PATH is unavailable')
  return environment
}

function capableEnvironment(environment) {
  const result = {}
  for (const [name, value] of Object.entries(environment)) {
    if (!['CI', 'NO_COLOR', 'FORCE_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE'].includes(name.toUpperCase())) {
      result[name] = value
    }
  }
  result.TERM = 'xterm-256color'
  return result
}

function fixedArgv(cwd, long) {
  return ['--no-install', 'depfresh', 'major', '--cwd', cwd, ...(long ? ['--long'] : [])]
}

function countExactLines(screen, prefix) {
  return screen.split('\n').filter((line) => (prefix.endsWith(' ') ? line.startsWith(prefix) : line === prefix)).length
}

function requireUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Live repository identity changed during proof')
  }
}

function byteIdentity(bytes, realpath) {
  return {
    ...(realpath === undefined ? {} : { realpath }),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function requireContained(path, root, message) {
  const containment = relative(root, path)
  if (containment.startsWith('..') || isAbsolute(containment)) throw new Error(message)
}

function writeJsonAtomicNoReplace(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const pendingPath = join(
    dirname(path),
    `.${basename(path)}.pending-${process.pid}-${randomBytes(12).toString('hex')}`,
  )
  let descriptor
  try {
    descriptor = openSync(
      pendingPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    )
    let offset = 0
    while (offset < bytes.byteLength) {
      offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset)
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    chmodSync(pendingPath, 0o600)
    linkSync(pendingPath, path)
  } catch {
    throw new Error('Live proof evidence could not be published')
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {}
    }
    try {
      unlinkSync(pendingPath)
    } catch {}
  }
}

function usageError() {
  return new Error(
    'Usage: node scripts/live-visual-plus-proof.mjs --cwd <path> --pack-json <path> --replay-evidence <path> --columns 80 --columns 118 [--include-long] --output <path>',
  )
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
