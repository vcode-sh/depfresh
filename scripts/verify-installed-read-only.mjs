import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const OUTPUT_LIMIT = 1024 * 1024
const PROCESS_TIMEOUT_MS = 30_000
const READ_ONLY_ARGS = ['--output', 'json', '--no-recursive']
const MANAGER_AUTHORITY_FLAGS = new Set([
  '--global',
  '--global-all',
  '--install',
  '--sync-lockfile',
  '--verify',
  '--verify-artifacts',
  '--write',
])

try {
  const { commandShim, packageJson, packageRoot } = resolveCommandShim(process.argv.slice(2))
  const version = requireVersion(packageJson?.version)
  const verificationRoot = mkdtempSync(join(tmpdir(), 'depfresh-installed-read-only-'))

  try {
    const fixture = join(verificationRoot, 'fixture')
    const isolatedHome = join(verificationRoot, 'home')
    const allowedExecutablePath = join(verificationRoot, 'allowed-executables')
    mkdirSync(fixture)
    mkdirSync(allowedExecutablePath)
    installNodeLauncher(allowedExecutablePath)
    mkdirSync(join(isolatedHome, 'cache'), { recursive: true })
    mkdirSync(join(isolatedHome, 'local-app-data'), { recursive: true })
    writeFileSync(
      join(fixture, 'package.json'),
      '{"name":"depfresh-empty-read-only","private":true,"dependencies":{}}\n',
    )

    const inheritedEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
    )
    const env = {
      ...inheritedEnvironment,
      CI: 'true',
      HOME: isolatedHome,
      LOCALAPPDATA: join(isolatedHome, 'local-app-data'),
      NO_COLOR: '1',
      PATH: allowedExecutablePath,
      USERPROFILE: isolatedHome,
      XDG_CACHE_HOME: join(isolatedHome, 'cache'),
      DEPFRESH_COMMAND_SHIM: commandShim,
    }
    const observedVersion = runCommandShim(commandShim, ['--version'], packageRoot, env).trim()
    if (observedVersion !== version) throw new Error('Installed CLI version mismatch')

    const help = runCommandShim(commandShim, ['--help'], packageRoot, env)
    if (!/\bdepfresh\b/iu.test(help) || !/\busage\b/iu.test(help)) {
      throw new Error('Installed CLI help output is invalid')
    }

    const capabilities = parseObject(
      runCommandShim(commandShim, ['capabilities', '--json'], packageRoot, env),
      'Installed capabilities output',
    )
    if (
      capabilities.contract !== 'depfresh.capabilities' ||
      capabilities.schemaVersion !== 2 ||
      capabilities.version !== version
    ) {
      throw new Error('Installed capabilities output is incompatible')
    }

    if (READ_ONLY_ARGS.some((argument) => MANAGER_AUTHORITY_FLAGS.has(argument))) {
      throw new Error('Read-only verification requested manager authority')
    }
    const before = snapshotTree(fixture)
    const result = parseObject(
      runCommandShim(commandShim, READ_ONLY_ARGS, fixture, env),
      'Installed read-only JSON output',
    )
    const after = snapshotTree(fixture)
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error('Read-only fixture changed')
    }
    if (
      result.meta?.didWrite !== false ||
      result.summary?.total !== 0 ||
      !Array.isArray(result.packages) ||
      result.packages.length !== 0 ||
      !Array.isArray(result.errors) ||
      result.errors.length !== 0
    ) {
      throw new Error('Installed read-only JSON output is incompatible')
    }

    process.stdout.write(
      `${JSON.stringify({
        capabilitiesContract: capabilities.contract,
        capabilitiesSchemaVersion: capabilities.schemaVersion,
        commandShim: basename(commandShim),
        commandShimInvoked: true,
        fixtureUnchanged: true,
        help: true,
        managerExecutionRequested: false,
        managerExecutionSupported: false,
        version,
      })}\n`,
    )
  } finally {
    rmSync(verificationRoot, { force: true, recursive: true })
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Verification failed'}\n`)
  process.exitCode = 1
}

function resolveCommandShim(arguments_) {
  if (arguments_.length !== 1) {
    throw new Error('Usage: verify-installed-read-only.mjs <command-shim-path>')
  }
  const commandShim = resolve(arguments_[0])
  const commandDirectory = dirname(commandShim)
  const nodeModulesRoot = dirname(commandDirectory)
  const expectedName = process.platform === 'win32' ? 'depfresh.cmd' : 'depfresh'
  const commandStat = lstatSync(commandShim)
  if (
    basename(commandDirectory) !== '.bin' ||
    basename(nodeModulesRoot) !== 'node_modules' ||
    basename(commandShim) !== expectedName
  ) {
    throw new Error('Expected the npm-generated depfresh command shim')
  }

  const packageRoot = join(nodeModulesRoot, 'depfresh')
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (
    packageJson?.name !== 'depfresh' ||
    !packageJson.bin ||
    typeof packageJson.bin !== 'object' ||
    packageJson.bin.depfresh !== 'dist/cli.mjs'
  ) {
    throw new Error('Installed depfresh command metadata is invalid')
  }
  const entrypoint = resolve(packageRoot, packageJson.bin.depfresh)
  const entrypointRelative = relative(packageRoot, entrypoint)
  if (
    entrypointRelative.startsWith('..') ||
    isAbsolute(entrypointRelative) ||
    !lstatSync(entrypoint).isFile()
  ) {
    throw new Error('Installed depfresh command entrypoint is invalid')
  }

  if (process.platform === 'win32') {
    if (!commandStat.isFile() || commandStat.isSymbolicLink()) {
      throw new Error('Installed Windows command shim must be a regular file')
    }
    const shimSource = readFileSync(commandShim, 'utf8').replaceAll('\\', '/').toLowerCase()
    if (!shimSource.includes('../depfresh/dist/cli.mjs') || !shimSource.includes('%*')) {
      throw new Error('Installed Windows command shim is incompatible')
    }
    if (/[&|<>^%!\r\n]/u.test(commandShim)) {
      throw new Error('Installed Windows command shim path is not shell-safe')
    }
  } else if (
    !commandStat.isSymbolicLink() ||
    realpathSync(commandShim) !== realpathSync(entrypoint)
  ) {
    throw new Error('Installed command shim does not target depfresh')
  }

  return { commandShim, packageJson, packageRoot }
}

function requireVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error('Installed package version is invalid')
  }
  return value
}

function installNodeLauncher(directory) {
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, join(directory, 'node.exe'))
    return
  }
  symlinkSync(process.execPath, join(directory, 'node'))
}

function runCommandShim(commandShim, arguments_, cwd, env) {
  if (!arguments_.every((argument) => /^(?:--[a-z][a-z-]*|[a-z][a-z-]*)$/u.test(argument))) {
    throw new Error('Installed command arguments are invalid')
  }
  const windows = process.platform === 'win32'
  const command = windows ? resolveWindowsCommandProcessor() : commandShim
  const commandArguments = windows
    ? ['/d', '/q', '/v:off', '/c', `call "%DEPFRESH_COMMAND_SHIM%" ${arguments_.join(' ')}`]
    : arguments_
  const result = spawnSync(command, commandArguments, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: OUTPUT_LIMIT,
    shell: false,
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`Installed CLI command failed: ${arguments_.join(' ')}`)
  }
  if (Buffer.byteLength(result.stderr) !== 0) {
    throw new Error(`Installed CLI command wrote stderr: ${arguments_.join(' ')}`)
  }
  return result.stdout
}

function resolveWindowsCommandProcessor() {
  const commandProcessor = process.env.ComSpec
  if (!commandProcessor || !isAbsolute(commandProcessor)) {
    throw new Error('Windows command processor is unavailable')
  }
  const resolved = resolve(commandProcessor)
  const stat = lstatSync(resolved)
  if (basename(resolved).toLowerCase() !== 'cmd.exe' || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Windows command processor is invalid')
  }
  return resolved
}

function parseObject(value, label) {
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${label} is not JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} is invalid`)
  }
  return parsed
}

function snapshotTree(root) {
  const entries = []
  const visit = (path) => {
    const stat = lstatSync(path, { bigint: true })
    const name = relative(root, path).split('\\').join('/') || '.'
    const identity = {
      ctimeNs: stat.ctimeNs.toString(),
      mode: stat.mode.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      name,
    }
    if (stat.isSymbolicLink()) {
      entries.push({ ...identity, kind: 'symlink' })
      return
    }
    if (stat.isDirectory()) {
      entries.push({ ...identity, kind: 'directory' })
      for (const child of readdirSync(path).sort()) visit(join(path, child))
      return
    }
    if (!stat.isFile()) {
      entries.push({ ...identity, kind: 'special' })
      return
    }
    const bytes = readFileSync(path)
    entries.push({
      hash: createHash('sha256').update(bytes).digest('hex'),
      ...identity,
      kind: 'file',
      size: stat.size.toString(),
    })
  }
  visit(root)
  return entries
}
