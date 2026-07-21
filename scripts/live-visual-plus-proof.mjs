import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  constants,
  linkSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractSinglePackEntry } from './pack-manifest.mjs'
import {
  canonicalContainedNewOutput,
  canonicalExistingDirectory,
  canonicalExistingRegularFile,
  publishJsonAtomicNoReplace,
  readStableRegularFile,
} from './visual-plus-replay-failure.mjs'
import {
  analyzeHybridRun,
  analyzeLongRun,
  observeBunx,
  pathIdentity,
  requireBoundBunxIdentity,
  requireBunxIdentity,
  requireExecutionIdentity,
} from './live-visual-plus-proof-support.mjs'
import { runInPty } from '../test/helpers/pty-runner.mjs'

const MAX_JSON_BYTES = 256 * 1024
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const MAX_IDENTITY_FILE_BYTES = 64 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 30_000
const LIVE_PTY_TIMEOUT_MS = 15 * 60_000
const LIVE_PTY_OUTPUT_BYTES = 4 * 1024 * 1024
const EXPECTED_COLUMNS = [80, 118]
const EXPECTED_REPLAY_TOTALS = { files: 1, suites: 5, tests: 71 }
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
  const outputPath = canonicalContainedNewOutput(
    resolve(command.outputPath),
    artifact.root,
    'Live proof evidence',
  )
  rejectRepositoryPublication(outputPath, cwd)
  const environment = requireEnvironment(command.environment ?? process.env)
  let bunx = resolveUniqueBunx(environment.PATH)
  const before = repositorySnapshot(cwd)
  const launcher = createBoundBunLaunchers(bunx)
  bunx = requireBoundBunxIdentity(bunx, MAX_IDENTITY_FILE_BYTES)
  const runs = []
  const longRuns = []
  let bunGlobal
  try {
    requireBunxIdentity(bunx, MAX_IDENTITY_FILE_BYTES)
    requireBoundLauncherIdentity(launcher.bunPath, bunx)
    bunGlobal = resolveBunGlobalIdentity(
      launcher.bunPath,
      cwd,
      environment,
      artifact.replay.cli.sha256,
    )
    requireExecutionIdentity(
      bunx,
      bunGlobal,
      artifact.replay.cli.sha256,
      MAX_IDENTITY_FILE_BYTES,
    )
    requireBoundLauncherIdentity(launcher.bunPath, bunx)
    requireUnchanged(before, repositorySnapshot(cwd))
    for (const columns of command.columns) {
      requireExecutionIdentity(
        bunx,
        bunGlobal,
        artifact.replay.cli.sha256,
        MAX_IDENTITY_FILE_BYTES,
      )
      requireBoundLauncherIdentity(launcher.bunxPath, bunx)
      const argv = fixedArgv(cwd, false)
      const result = await runInPty({
        args: argv,
        cliPath: launcher.bunxPath,
        columns,
        env: capableEnvironment(environment),
        input: Buffer.alloc(0),
        outputLimit: LIVE_PTY_OUTPUT_BYTES,
        timeoutMs: LIVE_PTY_TIMEOUT_MS,
      })
      runs.push(analyzeHybridRun(result, columns, argv, repositoryPackage.name))
      requireExecutionIdentity(
        bunx,
        bunGlobal,
        artifact.replay.cli.sha256,
        MAX_IDENTITY_FILE_BYTES,
      )
      requireBoundLauncherIdentity(launcher.bunxPath, bunx)
      requireUnchanged(before, repositorySnapshot(cwd))
    }
    if (command.includeLong) {
      for (let index = 0; index < command.columns.length; index += 1) {
        const columns = command.columns[index]
        requireExecutionIdentity(
          bunx,
          bunGlobal,
          artifact.replay.cli.sha256,
          MAX_IDENTITY_FILE_BYTES,
        )
        requireBoundLauncherIdentity(launcher.bunxPath, bunx)
        const argv = fixedArgv(cwd, true)
        const result = await runInPty({
          args: argv,
          cliPath: launcher.bunxPath,
          columns,
          env: capableEnvironment(environment),
          input: Buffer.alloc(0),
          outputLimit: LIVE_PTY_OUTPUT_BYTES,
          timeoutMs: LIVE_PTY_TIMEOUT_MS,
        })
        longRuns.push(analyzeLongRun(result, columns, argv, runs[index].operationRows.declared))
        requireExecutionIdentity(
          bunx,
          bunGlobal,
          artifact.replay.cli.sha256,
          MAX_IDENTITY_FILE_BYTES,
        )
        requireBoundLauncherIdentity(launcher.bunxPath, bunx)
        requireUnchanged(before, repositorySnapshot(cwd))
      }
    }
  } finally {
    launcher.cleanup()
  }
  const after = repositorySnapshot(cwd)
  requireUnchanged(before, after)
  if (bunGlobal === undefined) throw new Error('Bun global identity is unavailable')
  const evidence = {
    schemaVersion: 1,
    kind: 'depfresh-live-visual-plus-proof',
    cwd,
    bunx: {
      path: bunx.path,
      realpath: bunx.realpath,
      sha256: bunx.sha256,
      pathIdentity: bunx.pathIdentity,
      targetIdentity: bunx.targetIdentity,
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
  let publicationSnapshot
  publishJsonAtomicNoReplace(outputPath, evidence, {
    errorPrefix: 'Live proof evidence',
    hooks: command.publicationHooks,
    afterPublication: () => {
      publicationSnapshot = repositorySnapshot(cwd)
      requireUnchanged(before, publicationSnapshot)
    },
  })
  if (publicationSnapshot === undefined) {
    throw new Error('Live repository publication snapshot is unavailable')
  }
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
  const tarball = readStableRegularFile(tarballPath, {
    label: 'tarball',
    maxBytes: MAX_IDENTITY_FILE_BYTES,
  })
  const tarballSha256 = tarball.identity.sha256
  if (
    tarball.bytes.byteLength !== entry.size ||
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
  const directories = new Set()
  for (const directory of pathValue.split(delimiter)) {
    if (!isAbsolute(directory) || resolve(directory) !== directory) {
      throw new Error('PATH contains an unsafe entry')
    }
    directories.add(canonicalExistingDirectory(directory, 'PATH directory'))
  }
  for (const directory of directories) {
    const candidate = join(directory, process.platform === 'win32' ? 'bunx.exe' : 'bunx')
    try {
      candidates.push(observeBunx(candidate, MAX_IDENTITY_FILE_BYTES))
    } catch {}
  }
  if (candidates.length !== 1) throw new Error('PATH must resolve exactly one bunx executable')
  return candidates[0]
}

function resolveBunGlobalIdentity(executable, cwd, environment, expectedCliSha256) {
  const result = runBounded(executable, ['pm', 'bin', '-g'], { cwd, environment })
  const lines = result.stdout.trimEnd().split('\n')
  if (result.stderr !== '' || lines.length !== 1 || lines[0].length < 1) {
    throw new Error('Bun global bin could not be resolved')
  }
  const binRealpath = requireSafeDirectory(lines[0], 'Bun global bin')
  const binIdentity = pathIdentity(lstatSync(binRealpath))
  const depfreshLink = join(binRealpath, 'depfresh')
  let linkStats
  try {
    linkStats = lstatSync(depfreshLink)
  } catch {
    throw new Error('Bun global depfresh link is unavailable')
  }
  if (!linkStats.isSymbolicLink()) throw new Error('Bun global depfresh entry is not a symlink')
  const linkIdentity = pathIdentity(linkStats)
  const depfreshLinkTarget = requireSafeRegularFile(
    realpathSync.native(depfreshLink),
    'Bun global depfresh CLI',
  )
  requireContained(
    depfreshLinkTarget,
    dirname(binRealpath),
    'Bun global depfresh CLI is outside the Bun installation',
  )
  const cli = readStableRegularFile(depfreshLinkTarget, {
    label: 'Bun global depfresh CLI',
    maxBytes: MAX_IDENTITY_FILE_BYTES,
  })
  const cliSha256 = cli.identity.sha256
  if (cliSha256 !== expectedCliSha256) {
    throw new Error('Bun global depfresh CLI does not match installed replay evidence')
  }
  return {
    binRealpath,
    binIdentity,
    depfreshLink,
    linkIdentity,
    depfreshLinkTarget,
    targetIdentity: cli.identity,
    cliSha256,
  }
}

function createBoundBunLaunchers(bunx) {
  const lexicalRoot = mkdtempSync(join(tmpdir(), 'depfresh-live-bunx-'))
  const root = realpathSync.native(lexicalRoot)
  const bunPath = join(root, 'bun')
  const bunxPath = join(root, 'bunx')
  try {
    linkSync(bunx.realpath, bunPath)
    linkSync(bunx.realpath, bunxPath)
    requireBoundLauncherIdentity(bunPath, bunx)
    requireBoundLauncherIdentity(bunxPath, bunx)
    return {
      bunPath,
      bunxPath,
      identity: {
        method: 'inode-bound-bun-and-bunx',
        device: bunx.targetIdentity.device,
        inode: bunx.targetIdentity.inode,
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

function requireBoundLauncherIdentity(path, bunx) {
  let stats
  try {
    stats = lstatSync(path)
    accessSync(path, constants.X_OK)
  } catch {
    throw new Error('Bound Bun launcher identity changed')
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    String(stats.dev) !== bunx.targetIdentity.device ||
    String(stats.ino) !== bunx.targetIdentity.inode ||
    stats.mode !== bunx.targetIdentity.mode ||
    stats.size !== bunx.targetIdentity.bytes
  ) {
    throw new Error('Bound Bun launcher identity changed')
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
  const index = readStableRegularFile(indexPath, {
    label: 'Git index',
    maxBytes: MAX_IDENTITY_FILE_BYTES,
  })
  const diff = runGit(cwd, ['diff', '--no-ext-diff', '--binary']).stdoutBytes
  const cachedDiff = runGit(cwd, ['diff', '--cached', '--no-ext-diff', '--binary']).stdoutBytes
  const status = runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all']).stdoutBytes
  const bunLockPath = requireSafeRegularFile(join(cwd, 'bun.lock'), 'bun.lock')
  const bunLock = readStableRegularFile(bunLockPath, {
    label: 'bun.lock',
    maxBytes: MAX_IDENTITY_FILE_BYTES,
  })
  return {
    head,
    index: index.identity,
    diff: byteIdentity(diff),
    cachedDiff: byteIdentity(cachedDiff),
    status: byteIdentity(status),
    bunLock: bunLock.identity,
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
  const input = readStableRegularFile(path, {
    label: 'Live proof JSON input',
    maxBytes: MAX_JSON_BYTES,
  })
  if (input.bytes.byteLength < 1) throw new Error('Live proof JSON input is unsafe')
  try {
    return JSON.parse(input.bytes.toString('utf8'))
  } catch {
    throw new Error('Live proof JSON input is invalid')
  }
}

function requireSafeDirectory(path, label) {
  return canonicalExistingDirectory(path, label)
}

function requireSafeRegularFile(path, label) {
  return canonicalExistingRegularFile(path, label)
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

function rejectRepositoryPublication(path, cwd) {
  const containment = relative(cwd, path)
  if (containment === '' || (!containment.startsWith('..') && !isAbsolute(containment))) {
    throw new Error('Live proof evidence must be published outside the repository')
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
