import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

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
  const cliPath = resolveCliPath(process.argv.slice(2))
  const packageRoot = resolve(dirname(cliPath), '..')
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const version = requireVersion(packageJson?.version)
  const verificationRoot = mkdtempSync(join(tmpdir(), 'depfresh-installed-read-only-'))

  try {
    const fixture = join(verificationRoot, 'fixture')
    const isolatedHome = join(verificationRoot, 'home')
    const blockedExecutablePath = join(verificationRoot, 'external-commands-disabled')
    mkdirSync(fixture)
    mkdirSync(blockedExecutablePath)
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
      PATH: blockedExecutablePath,
      USERPROFILE: isolatedHome,
      XDG_CACHE_HOME: join(isolatedHome, 'cache'),
    }
    const observedVersion = runCli(cliPath, ['--version'], packageRoot, env).trim()
    if (observedVersion !== version) throw new Error('Installed CLI version mismatch')

    const help = runCli(cliPath, ['--help'], packageRoot, env)
    if (!/\bdepfresh\b/iu.test(help) || !/\busage\b/iu.test(help)) {
      throw new Error('Installed CLI help output is invalid')
    }

    const capabilities = parseObject(
      runCli(cliPath, ['capabilities', '--json'], packageRoot, env),
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
      runCli(cliPath, READ_ONLY_ARGS, fixture, env),
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

function resolveCliPath(arguments_) {
  if (arguments_.length !== 1) throw new Error('Usage: verify-installed-read-only.mjs <cli-path>')
  const cliPath = resolve(arguments_[0])
  const stat = lstatSync(cliPath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Installed CLI must be a regular file')
  return cliPath
}

function requireVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error('Installed package version is invalid')
  }
  return value
}

function runCli(cliPath, arguments_, cwd, env) {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: OUTPUT_LIMIT,
    timeout: PROCESS_TIMEOUT_MS,
  })
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`Installed CLI command failed: ${arguments_.join(' ')}`)
  }
  if (Buffer.byteLength(result.stderr) !== 0) {
    throw new Error(`Installed CLI command wrote stderr: ${arguments_.join(' ')}`)
  }
  return result.stdout
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
