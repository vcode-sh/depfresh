#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVisualPlusFixture } from './helpers/visual-plus-fixture.mjs'

const CHECK_SELECTOR = '--check'
const PIPE_RECEIPT_CHECK = 'piped write receipt stays complete and ordered on stdout'
const COMMAND_TRANSACTION_CHECK = 'command transaction preflights every recursive target'
const VISUAL_PLUS_FIXTURE_CHECK = 'Visual Plus fixture applies or blocks all selected targets'
const CHILD_TIMEOUT_MS = 30_000
const CHILD_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024
const selectableChecks = new Set([
  PIPE_RECEIPT_CHECK,
  COMMAND_TRANSACTION_CHECK,
  VISUAL_PLUS_FIXTURE_CHECK,
])
const selectedCheck = parseCheckSelector(process.argv.slice(2))

function parseCheckSelector(args) {
  let selected
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument !== CHECK_SELECTOR) {
      throw new Error(`Unknown practical smoke selector argument: ${JSON.stringify(argument)}`)
    }
    if (selected !== undefined) {
      throw new Error('Practical smoke check selector may be provided only once')
    }
    const name = args[index + 1]
    if (!name || name === CHECK_SELECTOR) {
      throw new Error('Practical smoke check selector requires an exact check name')
    }
    selected = name
    index += 1
  }
  if (selected !== undefined && !selectableChecks.has(selected)) {
    throw new Error(`Unknown practical smoke check: ${JSON.stringify(selected)}`)
  }
  return selected
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cliPath = join(repoRoot, 'dist', 'cli.mjs')
const pkgVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version

const tmpRoot = mkdtempSync(join(tmpdir(), 'depfresh-practical-'))
let server
await using _fixtureCleanup = {
  async [Symbol.asyncDispose]() {
    try {
      if (server?.listening) {
        await new Promise((resolve, reject) => {
          let settled = false
          const finish = (error) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            if (error) reject(error)
            else resolve()
          }
          const timer = setTimeout(() => {
            server.closeAllConnections?.()
            finish()
          }, 1_000)
          server.close((error) => finish(error))
          server.closeAllConnections?.()
        })
      }
    } finally {
      rmSync(tmpRoot, { force: true, recursive: true })
    }
  },
}

const homeDir = join(tmpRoot, 'home')
const binDir = join(tmpRoot, 'bin')
const singleRepo = join(tmpRoot, 'single-app')
const workspaceRoot = join(tmpRoot, 'workspace')
const emptyRepo = join(tmpRoot, 'empty')
const vcsOverflowBin = join(tmpRoot, 'vcs-overflow-bin')
const logFile = join(tmpRoot, 'pm.log')
const gitXdgCache = join(tmpRoot, 'git-xdg-cache')
const gitXdgConfig = join(tmpRoot, 'git-xdg-config')
const gitGlobalConfig = join(tmpRoot, 'git-global-config')

const fixtureDirectories = selectedCheck
  ? [homeDir, binDir, vcsOverflowBin, gitXdgCache, gitXdgConfig]
  : [
      homeDir,
      binDir,
      singleRepo,
      workspaceRoot,
      emptyRepo,
      vcsOverflowBin,
      gitXdgCache,
      gitXdgConfig,
    ]
for (const dir of fixtureDirectories) {
  mkdirSync(dir, { recursive: true })
}
writeFileSync(logFile, '', 'utf8')
writeFileSync(gitGlobalConfig, '', 'utf8')

const registryData = {
  alpha: {
    versions: ['1.0.0', '1.0.1', '1.1.0', '2.0.0', '3.0.0-beta.1'],
    latest: '2.0.0',
    next: '3.0.0-beta.1',
    homepage: 'https://example.test/alpha',
    engines: { '2.0.0': '>=24', '3.0.0-beta.1': '>=24' },
  },
  beta: {
    versions: ['1.0.0', '1.0.5', '1.2.0', '2.0.0'],
    latest: '2.0.0',
    homepage: 'https://example.test/beta',
  },
  gamma: {
    versions: ['1.0.0', '1.0.2'],
    latest: '1.0.2',
  },
  delta: {
    versions: ['1.0.0', '1.1.0'],
    latest: '1.1.0',
  },
  pnpm: {
    versions: ['10.33.0', '10.34.0'],
    latest: '10.34.0',
  },
  npm: {
    versions: ['10.9.0'],
    latest: '10.9.0',
  },
  'glob-a': {
    versions: ['1.2.0', '2.0.0'],
    latest: '2.0.0',
  },
  'glob-b': {
    versions: ['1.0.0', '1.3.0'],
    latest: '1.3.0',
  },
  'glob-c': {
    versions: ['0.5.0', '0.6.0'],
    latest: '0.6.0',
  },
  'shared-glob': {
    versions: ['1.9.0', '2.1.0', '2.2.0'],
    latest: '2.2.0',
  },
  'cache-probe': {
    versions: ['1.0.0', '1.0.1'],
    latest: '1.0.1',
  },
}

function getRegistryMetadata(name) {
  const data = registryData[name]
  if (!data) return null

  const versions = {}
  const time = {}
  for (const version of data.versions) {
    versions[version] = {
      ...(data.engines?.[version] ? { engines: { node: data.engines[version] } } : {}),
    }
    time[version] = new Date(Date.now() - 7 * 86_400_000).toISOString()
  }

  return {
    name,
    versions,
    time,
    homepage: data.homepage,
    'dist-tags': {
      latest: data.latest,
      ...(data.next ? { next: data.next } : {}),
    },
  }
}

const requests = []
const visualPlusRegistryResponses = []
server = createServer((req, res) => {
  const rawUrl = req.url ?? ''
  let requestBodyBytes = 0
  req.on('data', (chunk) => {
    requestBodyBytes += chunk.byteLength
    if (requestBodyBytes > 1_024) req.destroy()
  })
  if (Buffer.byteLength(rawUrl) > 4_096) {
    res.writeHead(414)
    res.end()
    return
  }
  const declaredBodyBytes = Number(req.headers['content-length'] ?? 0)
  if (!Number.isSafeInteger(declaredBodyBytes) || declaredBodyBytes > 1_024) {
    res.writeHead(413)
    res.end()
    return
  }
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.slice(1)
  const packageName = decodeURIComponent(pathname)
  requests.push(packageName)

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }

  const fixtureBody = visualPlusRegistryResponses
    .map((responses) => responses.get(packageName))
    .find((body) => body !== undefined)
  if (fixtureBody) {
    res.writeHead(200, {
      'content-type': 'application/vnd.npm.install-v1+json',
      'content-length': fixtureBody.byteLength,
    })
    res.end(req.method === 'HEAD' ? undefined : fixtureBody)
    return
  }

  const body = getRegistryMetadata(packageName)
  if (!body) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body))
})

await new Promise((resolve, reject) => {
  const onError = (error) => {
    server.off('listening', onListening)
    reject(error)
  }
  const onListening = () => {
    server.off('error', onError)
    resolve()
  }
  server.once('error', onError)
  server.once('listening', onListening)
  server.listen(0, '127.0.0.1')
})
const address = server.address()
assert.ok(address && typeof address !== 'string', 'Failed to start mock registry server')
const registryUrl = `http://127.0.0.1:${address.port}/`

function writeJson(filepath, value) {
  writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function discoverTargetManifests(root) {
  const found = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      if (entry === '.git' || entry === '.depfresh' || entry === 'node_modules') continue
      const path = join(directory, entry)
      const stats = statSync(path)
      if (stats.isDirectory()) visit(path)
      else if (stats.isFile() && entry === 'package.json') found.push(relative(root, path))
    }
  }
  visit(root)
  return found.sort()
}

function hashTargetManifests(root, expectedPaths) {
  assert.deepEqual(discoverTargetManifests(root), expectedPaths)
  return Object.fromEntries(
    expectedPaths.map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex'),
    ]),
  )
}

function createCatalogSelectionFixture(name) {
  const root = join(tmpRoot, name)
  const consumer = join(root, 'packages', 'consumer')
  mkdirSync(consumer, { recursive: true })
  writeJson(join(root, 'package.json'), {
    name: `${name}-root`,
    private: true,
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n  - "packages/*"\ncatalogs:\n  "mobile,v2":\n    gamma: 1.0.0\n`,
    'utf8',
  )
  writeJson(join(consumer, 'package.json'), {
    name: `${name}-consumer`,
    private: true,
    dependencies: { gamma: 'catalog:mobile,v2' },
  })
  writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  return {
    root,
    manifest: join(root, 'package.json'),
    catalog: join(root, 'pnpm-workspace.yaml'),
    consumer: join(consumer, 'package.json'),
  }
}

function writeExecutable(name, content) {
  const filepath = join(binDir, name)
  writeFileSync(filepath, content, 'utf8')
  chmodSync(filepath, 0o755)
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, process.platform === 'win32' ? `${name}.exe` : name)
    if (existsSync(candidate)) return realpathSync(candidate)
  }
  throw new Error(`Missing smoke-test executable: ${name}`)
}

function runGit(git, cwd, ...args) {
  execFileSync(git, args, {
    cwd,
    env: cleanEnv,
    stdio: 'ignore',
    timeout: CHILD_TIMEOUT_MS,
  })
}

function runGitOutput(git, cwd, ...args) {
  return execFileSync(git, args, {
    cwd,
    env: cleanEnv,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
}

function assertNoApplyResidue(root) {
  assert.equal(existsSync(join(root, '.depfresh')), false)
  const residue = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === '.git' || entry === 'filler') continue
      const path = join(directory, entry)
      if (/\.depfresh-.+\.(?:stage|backup)$/u.test(entry)) residue.push(relative(root, path))
      else if (statSync(path).isDirectory()) visit(path)
    }
  }
  visit(root)
  assert.deepEqual(residue, [])
}

function createPmScript(name) {
  const version = name === 'bun' ? '1.2.0' : name === 'pnpm' ? '10.33.0' : '10.9.0'
  const initialDependencies =
    name === 'npm'
      ? { 'glob-a': '1.2.0', 'shared-glob': '2.1.0' }
      : name === 'pnpm'
        ? { 'glob-b': '1.0.0', 'shared-glob': '1.9.0' }
        : { 'glob-c': '0.5.0' }

  return `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
const logFile = ${JSON.stringify(logFile)}
appendFileSync(logFile, JSON.stringify({ pm: '${name}', args }) + '\\n')
const stateFile = logFile + '.${name}.json'
const initialDependencies = ${JSON.stringify(initialDependencies)}
const dependencies = existsSync(stateFile)
? JSON.parse(readFileSync(stateFile, 'utf8'))
: initialDependencies

if (args[0] === '--version') {
process.stdout.write('${version}\\n')
process.exit(0)
}

if ('${name}' === 'npm' && args[0] === 'install' && !args.includes('-g')) {
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const root = {}
const packages = { '': root }
for (const field of fields) {
  if (!manifest[field]) continue
  root[field] = manifest[field]
  for (const [packageName, specifier] of Object.entries(manifest[field])) {
    packages['node_modules/' + packageName] = {
      version: String(specifier).replace(/^[~^=]/, ''),
    }
  }
}
writeFileSync('package-lock.json', JSON.stringify({
  name: manifest.name,
  lockfileVersion: 3,
  packages,
}, null, 2) + '\\n')
process.exit(0)
}

if ('${name}' === 'npm' && args.join(' ') === 'list -g --depth=0 --json --ignore-scripts') {
process.stdout.write(JSON.stringify({
  dependencies: Object.fromEntries(
    Object.entries(dependencies).map(([packageName, packageVersion]) => [
      packageName,
      { version: packageVersion },
    ]),
  ),
}))
process.exit(0)
}

if ('${name}' === 'pnpm' && args.join(' ') === 'list -g --depth=0 --json --ignore-scripts') {
process.stdout.write(JSON.stringify([{
  dependencies: Object.fromEntries(
    Object.entries(dependencies).map(([packageName, packageVersion]) => [
      packageName,
      { version: packageVersion },
    ]),
  ),
}]))
process.exit(0)
}

if ('${name}' === 'bun' && args.join(' ') === 'pm ls -g') {
process.stdout.write(
  [logFile + '.bun-global', ...Object.entries(dependencies)
    .map(([packageName, packageVersion], index, entries) =>
      (index === entries.length - 1 ? '└' : '├') + '── ' + packageName + '@' + packageVersion,
    )]
    .join('\\n') + '\\n',
)
process.exit(0)
}

if (('${name}' === 'npm' || '${name}' === 'pnpm') && args.join(' ') === 'root -g') {
process.stdout.write(logFile + '.${name}-global\\n')
process.exit(0)
}

const writeCommand =
('${name}' === 'npm' && args[0] === 'install' && args[1] === '-g') ||
(('${name}' === 'pnpm' || '${name}' === 'bun') && args[0] === 'add' && args[1] === '-g')
if (writeCommand) {
const spec = args.at(-1) ?? ''
const separator = spec.lastIndexOf('@')
if (separator > 0) {
  dependencies[spec.slice(0, separator)] = spec.slice(separator + 1)
  writeFileSync(stateFile, JSON.stringify(dependencies))
}
process.exit(0)
}

process.exit(0)
`
}

if (selectedCheck === undefined) setupFullSmokeFixtures()

function setupFullSmokeFixtures() {
  writeExecutable('npm', createPmScript('npm'))
  writeExecutable('pnpm', createPmScript('pnpm'))
  writeExecutable('bun', createPmScript('bun'))
  writeExecutable('ok-cmd', '#!/bin/sh\nexit 0\n')
  writeExecutable('fail-cmd', '#!/bin/sh\nexit 1\n')

  writeJson(join(singleRepo, 'package.json'), {
    name: 'single-app',
    private: true,
    packageManager: 'pnpm@10.33.0',
    dependencies: {
      alpha: '^1.0.0',
      beta: '~1.0.0',
      gamma: '1.0.0',
    },
    devDependencies: {
      delta: '^1.0.0',
    },
  })
  writeFileSync(join(singleRepo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')

  writeJson(join(workspaceRoot, 'package.json'), {
    name: 'workspace-root',
    private: true,
    packageManager: 'pnpm@10.33.0',
  })
  writeFileSync(
    join(workspaceRoot, 'pnpm-workspace.yaml'),
    `packages:\n  - "packages/*"\ncatalog:\n  beta: ^1.0.0\ncatalogs:\n  "mobile,v2":\n    gamma: 1.0.0\n`,
    'utf8',
  )
  mkdirSync(join(workspaceRoot, 'packages', 'web', 'src'), { recursive: true })
  writeJson(join(workspaceRoot, 'packages', 'web', 'package.json'), {
    name: 'web',
    private: true,
    dependencies: {
      alpha: '^1.0.0',
      beta: 'catalog:',
      gamma: 'catalog:mobile,v2',
    },
  })
  writeFileSync(join(workspaceRoot, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
}

function stripSensitiveEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => {
      const normalized = name.toLowerCase()
      return !(normalized.startsWith('npm_config_') || normalized.startsWith('git_'))
    }),
  )
}

if (selectedCheck === undefined) {
  assert.equal(
    stripSensitiveEnvironment({
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
      GIT_DIR: '/host/git-dir',
    }).NPM_CONFIG_REGISTRY,
    undefined,
  )
  assert.equal(stripSensitiveEnvironment({ GIT_DIR: '/host/git-dir' }).GIT_DIR, undefined)
}

// Package-manager config from the parent would override the fixture-local .npmrc registry.
const cleanEnv = Object.freeze({
  ...stripSensitiveEnvironment(process.env),
  HOME: homeDir,
  XDG_CACHE_HOME: gitXdgCache,
  XDG_CONFIG_HOME: gitXdgConfig,
  GIT_CONFIG_GLOBAL: gitGlobalConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  LC_ALL: 'C',
  LANG: 'C',
  TZ: 'UTC',
})

async function runCli(args, extra = {}) {
  return await new Promise((resolve, reject) => {
    const needsCache = !args.some((a) =>
      [
        '--help',
        '--help-json',
        '--version',
        'help',
        'capabilities',
        'inspect',
        'plan',
        'apply',
      ].includes(a),
    )
    const cacheArgs = needsCache && extra.refreshCache !== false ? ['--refresh-cache'] : []
    const detached = process.platform !== 'win32'
    const child = spawn(process.execPath, [cliPath, ...cacheArgs, ...args], {
      cwd: repoRoot,
      env: {
        ...cleanEnv,
        HOME: homeDir,
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
        DEPFRESH_PM_LOG: logFile,
        ...(extra.env ?? {}),
      },
      detached,
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let terminalError
    let settled = false
    let secondaryTimer

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (secondaryTimer) clearTimeout(secondaryTimer)
      if (error) reject(error)
      else resolve(result)
    }

    const killTree = () => {
      let killed = false
      if (detached && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
          killed = true
        } catch {
          // Fall back to killing the direct child below.
        }
      }
      if (!killed) child.kill('SIGKILL')
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }

    const terminate = (error) => {
      if (terminalError !== undefined || settled) return
      terminalError = error
      killTree()
      secondaryTimer = setTimeout(() => finish(error), 1_000)
    }

    const timer = setTimeout(
      () => terminate(new Error(`CLI exceeded ${CHILD_TIMEOUT_MS}ms timeout`)),
      CHILD_TIMEOUT_MS,
    )

    const append = (stream, chunk) => {
      if (terminalError !== undefined) return stream
      const chunkBytes = Buffer.byteLength(chunk)
      if (outputBytes + chunkBytes > CHILD_OUTPUT_LIMIT_BYTES) {
        terminate(new Error(`CLI output exceeded ${CHILD_OUTPUT_LIMIT_BYTES} bytes`))
        return stream
      }
      outputBytes += chunkBytes
      return stream + chunk
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk)
    })
    child.on('error', (error) => {
      finish(error)
    })
    child.on('close', (status) => {
      if (terminalError) {
        finish(terminalError)
        return
      }
      finish(undefined, {
        status,
        stdout,
        stderr,
      })
    })

    if (extra.input) {
      child.stdin.write(extra.input)
    }
    child.stdin.end()
  })
}

function parseJsonStdout(result) {
  const stdout = result.stdout.trim()
  assert.ok(stdout.length > 0, 'Expected JSON output on stdout')
  return JSON.parse(stdout)
}

const checks = []
async function record(name, fn) {
  if (selectedCheck !== undefined && name !== selectedCheck) return
  await fn()
  checks.push(name)
}

await record('help flag', async () => {
  const result = await runCli(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Docs:/)
})

await record('help command', async () => {
  const result = await runCli(['help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /USAGE|Usage:/)
})

await record('help json', async () => {
  const result = await runCli(['--help-json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, 'depfresh')
})

await record('capabilities command', async () => {
  const result = await runCli(['capabilities', '--json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.ok(payload.workflows)
})

await record('version flag', async () => {
  const result = await runCli(['--version'])
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), pkgVersion)
})

await record('default json check', async () => {
  const result = await runCli(['--cwd', singleRepo, '--output', 'json', '--fail-on-outdated'])
  assert.equal(result.status, 1, JSON.stringify(result, null, 2))
  const payload = parseJsonStdout(result)
  assert.equal(payload.summary.total, 3)
})

for (const mode of ['major', 'minor', 'patch', 'latest', 'newest', 'next']) {
  await record(`mode ${mode}`, async () => {
    const result = await runCli([mode, '--cwd', singleRepo, '--output', 'json'])
    assert.equal(result.status, 0)
    const payload = parseJsonStdout(result)
    assert.ok(Array.isArray(payload.packages))
  })
}

await record('deps-only', async () => {
  const result = await runCli(['--cwd', singleRepo, '--output', 'json', '--deps-only'])
  assert.equal(result.status, 0)
  const payload = parseJsonStdout(result)
  assert.equal(payload.summary.total, 2)
})

await record('dev-only', async () => {
  const result = await runCli(['--cwd', singleRepo, '--output', 'json', '--dev-only'])
  assert.equal(result.status, 0)
  const payload = parseJsonStdout(result)
  assert.equal(payload.summary.total, 1)
})

await record('include and exclude', async () => {
  const result = await runCli([
    '--cwd',
    singleRepo,
    '--output',
    'json',
    '--include',
    'alpha,delta',
    '--exclude',
    'delta',
  ])
  assert.equal(result.status, 0)
  const payload = parseJsonStdout(result)
  assert.equal(payload.summary.total, 1)
  assert.equal(payload.packages[0]?.updates[0]?.name, 'alpha')
})

await record('profile and explain-discovery', async () => {
  const result = await runCli([
    '--cwd',
    join(workspaceRoot, 'packages', 'web', 'src'),
    '--output',
    'json',
    '--profile',
    '--explain-discovery',
  ])
  assert.equal(result.status, 0)
  const payload = parseJsonStdout(result)
  assert.equal(payload.meta.effectiveRoot, realpathSync(workspaceRoot))
  assert.ok(payload.discovery)
  assert.ok(payload.profile)
})

await record('exact workspace exclusion keeps shared catalog owners eligible', async () => {
  const beforeRequests = requests.length
  const result = await runCli([
    '--cwd',
    workspaceRoot,
    '--output',
    'json',
    '--mode',
    'patch',
    '--include-locked',
    '--exclude-workspace',
    'packages/web',
  ])
  assert.equal(result.status, 0, JSON.stringify(result, null, 2))
  const payload = parseJsonStdout(result)
  assert.equal(payload.selection.summary.matchedWorkspaces, 1)
  assert.equal(payload.selection.summary.eligibleSharedCatalogOwners, 2)
  assert.equal(payload.selection.summary.excludedOccurrences, 3)
  assert.ok(!requests.slice(beforeRequests).includes('alpha'))
  assert.ok(requests.slice(beforeRequests).includes('beta'))
  assert.ok(requests.slice(beforeRequests).includes('gamma'))
})

await record('exact comma catalog exclusion is literal in plan v2', async () => {
  const beforeRequests = requests.length
  const result = await runCli([
    'plan',
    '--json',
    '--cwd',
    workspaceRoot,
    '--mode',
    'patch',
    '--include-locked',
    '--exclude-catalog=mobile,v2',
  ])
  assert.equal(result.status, 1, JSON.stringify(result, null, 2))
  const payload = parseJsonStdout(result)
  assert.equal(payload.schemaVersion, 2)
  assert.equal(payload.selection.summary.matchedCatalogNames, 1)
  assert.equal(payload.selection.summary.matchedCatalogOwners, 1)
  assert.equal(payload.selection.summary.excludedOccurrences, 2)
  assert.ok(!requests.slice(beforeRequests).includes('gamma'))
})

await record(
  'combined exclusions deduplicate overlap and retain the other shared owner',
  async () => {
    const beforeRequests = requests.length
    const result = await runCli([
      'plan',
      '--json',
      '--cwd',
      workspaceRoot,
      '--mode',
      'patch',
      '--include-locked',
      '--exclude-workspace',
      'packages/web',
      '--exclude-catalog=mobile,v2',
    ])
    assert.equal(result.status, 1, JSON.stringify(result, null, 2))
    const payload = parseJsonStdout(result)
    assert.equal(payload.selection.summary.requestedWorkspaces, 1)
    assert.equal(payload.selection.summary.requestedCatalogs, 1)
    assert.equal(payload.selection.summary.excludedOccurrences, 4)
    assert.equal(payload.selection.summary.eligibleSharedCatalogOwners, 1)
    assert.ok(!requests.slice(beforeRequests).includes('alpha'))
    assert.ok(requests.slice(beforeRequests).includes('beta'))
    assert.ok(!requests.slice(beforeRequests).includes('gamma'))
  },
)

await record('malformed and missing selection targets fail before registry work', async () => {
  for (const args of [
    ['--exclude-catalog', 'mobile\u200eunsafe'],
    ['--exclude-workspace', 'packages/missing'],
    ['--ignore-paths', 'packages/web/**', '--exclude-workspace', 'packages/web'],
  ]) {
    const beforeRequests = requests.length
    const result = await runCli(['--cwd', workspaceRoot, '--output', 'json', ...args])
    assert.equal(result.status, 2, JSON.stringify(result, null, 2))
    const payload = parseJsonStdout(result)
    assert.equal(payload.error.reason, 'SELECTION_TARGET_UNPROVEN')
    assert.equal(requests.length, beforeRequests)
  }
})

await record('catalog-excluded write changes eligible direct bytes only', async () => {
  const fixture = createCatalogSelectionFixture('catalog-write')
  const catalogBefore = readFileSync(fixture.catalog)
  const consumerBefore = readFileSync(fixture.consumer)
  const result = await runCli([
    '--cwd',
    fixture.root,
    '--write',
    '--output',
    'json',
    '--mode',
    'patch',
    '--include-locked',
    '--exclude-catalog=mobile,v2',
  ])
  assert.equal(result.status, 0, JSON.stringify(result, null, 2))
  const payload = parseJsonStdout(result)
  assert.equal(payload.selection.summary.excludedOccurrences, 2)
  assert.equal(JSON.parse(readFileSync(fixture.manifest, 'utf8')).dependencies.gamma, '^1.0.2')
  assert.deepEqual(readFileSync(fixture.catalog), catalogBefore)
  assert.deepEqual(readFileSync(fixture.consumer), consumerBefore)
})

await record('fingerprinted selection plan applies only eligible operations', async () => {
  const fixture = createCatalogSelectionFixture('catalog-plan-apply')
  const catalogBefore = readFileSync(fixture.catalog)
  const consumerBefore = readFileSync(fixture.consumer)
  const planResult = await runCli([
    'plan',
    '--json',
    '--cwd',
    fixture.root,
    '--mode',
    'patch',
    '--include-locked',
    '--exclude-catalog=mobile,v2',
  ])
  assert.equal(planResult.status, 1, JSON.stringify(planResult, null, 2))
  const plan = parseJsonStdout(planResult)
  assert.equal(plan.schemaVersion, 2)
  assert.equal(plan.selection.summary.excludedOccurrences, 2)
  assert.equal(plan.operations.length, 1)
  const planPath = join(fixture.root, 'selection-plan.json')
  writeJson(planPath, plan)

  const applyResult = await runCli([
    'apply',
    '--json',
    '--cwd',
    fixture.root,
    '--write',
    '--plan-file',
    planPath,
  ])
  assert.equal(applyResult.status, 0, JSON.stringify(applyResult, null, 2))
  const applied = parseJsonStdout(applyResult)
  assert.equal(applied.status, 'applied')
  assert.equal(applied.planFingerprint, plan.planFingerprint)
  assert.equal(JSON.parse(readFileSync(fixture.manifest, 'utf8')).dependencies.gamma, '^1.0.2')
  assert.deepEqual(readFileSync(fixture.catalog), catalogBefore)
  assert.deepEqual(readFileSync(fixture.consumer), consumerBefore)
})

await record('workspace-excluded write leaves its manifest byte-identical', async () => {
  const manifest = join(workspaceRoot, 'packages', 'web', 'package.json')
  const before = readFileSync(manifest)
  const result = await runCli([
    '--cwd',
    workspaceRoot,
    '--write',
    '--output',
    'json',
    '--mode',
    'patch',
    '--include-locked',
    '--exclude-workspace',
    'packages/web',
  ])
  assert.equal(result.status, 0, JSON.stringify(result, null, 2))
  assert.deepEqual(readFileSync(manifest), before)
})

await record('fail-on-no-packages', async () => {
  const result = await runCli(['--cwd', emptyRepo, '--output', 'json', '--fail-on-no-packages'])
  assert.equal(result.status, 2)
  const payload = parseJsonStdout(result)
  assert.equal(payload.meta.noPackagesFound, true)
})

await record('write updates manifest', async () => {
  const repo = join(tmpRoot, 'write-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'write-repo',
    private: true,
    dependencies: { alpha: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

  const result = await runCli(['--cwd', repo, '--write', '--mode', 'minor', '--output', 'json'])
  assert.equal(result.status, 0)

  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies.alpha, '^1.1.0')
})

await record(PIPE_RECEIPT_CHECK, async () => {
  const repo = join(tmpRoot, 'receipt-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'receipt-repo',
    private: true,
    dependencies: { gamma: '1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  const git = findExecutable('git')
  runGit(git, repo, 'init', '--quiet')
  runGit(git, repo, 'config', 'user.email', 'smoke@example.invalid')
  runGit(git, repo, 'config', 'user.name', 'Smoke Test')
  runGit(git, repo, 'add', '--', 'package.json')
  runGit(git, repo, 'commit', '--quiet', '-m', 'fixture')

  const wrapper = join(vcsOverflowBin, process.platform === 'win32' ? 'git.cmd' : 'git')
  writeFileSync(
    wrapper,
    `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const { writeSync } = require('node:fs')
const args = process.argv.slice(2)
if (args.includes('ls-files')) {
writeSync(1, Buffer.alloc(2 * 1024 * 1024, 97))
process.exit(0)
}
const result = spawnSync(${JSON.stringify(git)}, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
`,
  )
  chmodSync(wrapper, 0o755)
  const manifestBefore = readFileSync(join(repo, 'package.json'))
  const result = await runCli(['--cwd', repo, '--write', '--mode', 'patch', '--include-locked'], {
    env: { PATH: `${vcsOverflowBin}${delimiter}${binDir}${delimiter}${process.env.PATH}` },
  })

  assert.equal(result.status, 2, JSON.stringify(result, null, 2))
  const orderedReceipt = [
    'Safety block',
    'no files were changed',
    'Applied 0  Blocked 0  Not attempted 1  Failed 0  Unknown 1',
    'Preflight could not confirm Git state for package.json.',
    'Exit 2',
  ]
  let previousIndex = -1
  for (const fragment of orderedReceipt) {
    const index = result.stdout.indexOf(fragment)
    assert.ok(index > previousIndex, `Missing or unordered stdout receipt fragment: ${fragment}`)
    previousIndex = index
    assert.ok(!result.stderr.includes(fragment), `Receipt fragment leaked to stderr: ${fragment}`)
  }
  assert.ok(!result.stdout.includes(repo), 'Receipt exposed an absolute target path on stdout')
  assert.ok(!result.stderr.includes(repo), 'Receipt exposed an absolute target path on stderr')
  assert.deepEqual(readFileSync(join(repo, 'package.json')), manifestBefore)
})

await record(COMMAND_TRANSACTION_CHECK, async () => {
  const expectedManifests = ['package.json', 'packages/a/package.json', 'packages/b/package.json']
  const createFixture = (name) => {
    const repo = join(tmpRoot, name)
    mkdirSync(join(repo, 'packages', 'a'), { recursive: true })
    mkdirSync(join(repo, 'packages', 'b'), { recursive: true })
    writeJson(join(repo, 'package.json'), {
      name: `${name}-root`,
      private: true,
      workspaces: ['packages/*'],
      dependencies: { alpha: '^1.0.0' },
    })
    writeJson(join(repo, 'packages', 'a', 'package.json'), {
      name: `${name}-a`,
      private: true,
      dependencies: { beta: '^1.0.0' },
    })
    writeJson(join(repo, 'packages', 'b', 'package.json'), {
      name: `${name}-b`,
      private: true,
      dependencies: { gamma: '^1.0.0' },
    })
    writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
    assert.deepEqual(discoverTargetManifests(repo), expectedManifests)
    return repo
  }

  const blockedRepo = createFixture('command-transaction-blocked')
  const git = findExecutable('git')
  runGit(git, blockedRepo, 'init', '--quiet')
  runGit(git, blockedRepo, 'config', 'user.email', 'smoke@example.invalid')
  runGit(git, blockedRepo, 'config', 'user.name', 'Smoke Test')
  runGit(git, blockedRepo, 'add', '--', ...expectedManifests)
  runGit(git, blockedRepo, 'commit', '--quiet', '-m', 'fixture')
  const before = hashTargetManifests(blockedRepo, expectedManifests)
  const wrapperBin = join(blockedRepo, 'git-wrapper')
  const counter = join(blockedRepo, 'ls-files-count')
  mkdirSync(wrapperBin)
  const wrapper = join(wrapperBin, process.platform === 'win32' ? 'git.cmd' : 'git')
  writeFileSync(
    wrapper,
    `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync, writeSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
const counter = ${JSON.stringify(counter)}
let count = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0
if (args.includes('ls-files')) {
count += 1
writeFileSync(counter, String(count))
if (count === 3) {
  writeSync(1, Buffer.alloc(2 * 1024 * 1024, 97))
  process.exit(0)
}
}
const result = spawnSync(${JSON.stringify(git)}, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
`,
  )
  chmodSync(wrapper, 0o755)

  const blocked = await runCli(
    ['--cwd', blockedRepo, '--recursive', '--write', '--mode', 'patch'],
    { env: { PATH: `${wrapperBin}${delimiter}${binDir}${delimiter}${process.env.PATH}` } },
  )

  assert.equal(blocked.status, 2, JSON.stringify(blocked, null, 2))
  assert.equal(readFileSync(counter, 'utf8'), '3')
  const safetyBlockIndex = blocked.stdout.indexOf('Safety block')
  assert.ok(safetyBlockIndex >= 0)
  assert.ok(blocked.stdout.indexOf('no files were changed', safetyBlockIndex) > safetyBlockIndex)
  assert.deepEqual(hashTargetManifests(blockedRepo, expectedManifests), before)

  const successRepo = createFixture('command-transaction-success')
  const success = await runCli([
    '--cwd',
    successRepo,
    '--recursive',
    '--write',
    '--mode',
    'patch',
    '--output',
    'json',
  ])
  assert.equal(success.status, 0, JSON.stringify(success, null, 2))
  assert.equal(
    JSON.parse(readFileSync(join(successRepo, 'package.json'), 'utf8')).dependencies.alpha,
    '^1.0.1',
  )
  assert.equal(
    JSON.parse(readFileSync(join(successRepo, 'packages', 'a', 'package.json'), 'utf8'))
      .dependencies.beta,
    '^1.0.5',
  )
  assert.equal(
    JSON.parse(readFileSync(join(successRepo, 'packages', 'b', 'package.json'), 'utf8'))
      .dependencies.gamma,
    '^1.0.2',
  )
  assert.equal(existsSync(join(successRepo, '.depfresh')), false)
})

await record(VISUAL_PLUS_FIXTURE_CHECK, async () => {
  const asOfMs = Date.parse('2026-07-19T00:00:00.000Z')
  const fixtureRoots = []
  const createFixture = (name) => {
    const root = join(tmpRoot, name)
    mkdirSync(root)
    fixtureRoots.push(root)
    const fixture = createVisualPlusFixture(realpathSync(root), { asOfMs, registryUrl })
    visualPlusRegistryResponses.push(fixture.registry.responses)
    return fixture
  }
  try {
    const successFixture = createFixture('visual-plus-success')
    const safetyFixture = createFixture('visual-plus-safety')
    const commonPlanArgs = ['plan', '--json', '--recursive', '--mode', 'major']
    const successPlanResult = await runCli(
      [...commonPlanArgs, '--cwd', successFixture.repository],
      {
        env: successFixture.variants.success.environment,
      },
    )
    const safetyPlanResult = await runCli([...commonPlanArgs, '--cwd', safetyFixture.repository], {
      env: safetyFixture.variants.success.environment,
    })
    assert.equal(successPlanResult.status, 1, JSON.stringify(successPlanResult, null, 2))
    assert.equal(safetyPlanResult.status, 1, JSON.stringify(safetyPlanResult, null, 2))
    const successPlan = parseJsonStdout(successPlanResult)
    const safetyPlan = parseJsonStdout(safetyPlanResult)
    const normalizeOperations = (plan) =>
      plan.operations.map(({ id, file, path, current, target }) => ({
        id,
        file,
        path,
        current,
        target,
      }))
    assert.equal(successPlan.operations.length, 76)
    assert.equal(new Set(successPlan.operations.map((operation) => operation.file)).size, 14)
    assert.deepEqual(normalizeOperations(safetyPlan), normalizeOperations(successPlan))
    assert.deepEqual(
      safetyFixture.targets.map(({ path, beforeHash }) => ({ path, beforeHash })),
      successFixture.targets.map(({ path, beforeHash }) => ({ path, beforeHash })),
    )

    for (const fixture of [successFixture, safetyFixture]) {
      assert.equal(
        runGitOutput(fixture.git, fixture.repository, 'status', '--porcelain=v1', '-z').length,
        0,
      )
    }

    const writeArgs = ['--recursive', '--write', '--mode', 'major', '--output', 'json']
    const successResult = await runCli(['--cwd', successFixture.repository, ...writeArgs], {
      env: successFixture.variants.success.environment,
    })
    assert.equal(successResult.status, 0, JSON.stringify(successResult, null, 2))
    const successPayload = parseJsonStdout(successResult)
    assert.deepEqual(
      {
        planned: successPayload.summary.plannedUpdates,
        applied: successPayload.summary.appliedUpdates,
        failed: successPayload.summary.failedWrites,
        unknown: successPayload.summary.unknownWrites,
      },
      { planned: 76, applied: 76, failed: 0, unknown: 0 },
    )
    assert.equal(successPayload.writeOutcomes.length, 76)
    assert.ok(successPayload.writeOutcomes.every((outcome) => outcome.status === 'applied'))
    for (const target of successFixture.targets) {
      const actual = readFileSync(join(successFixture.repository, target.path))
      assert.deepEqual(
        actual,
        target.expectedAfterBytes,
        `Unexpected success bytes: ${target.path}`,
      )
      assert.equal(createHash('sha256').update(actual).digest('hex'), target.expectedAfterHash)
    }
    assertNoApplyResidue(successFixture.repository)
    runGit(successFixture.git, successFixture.repository, 'add', '-A')
    runGit(
      successFixture.git,
      successFixture.repository,
      'commit',
      '--quiet',
      '-m',
      'expected update',
    )
    assert.equal(
      runGitOutput(successFixture.git, successFixture.repository, 'status', '--porcelain=v1', '-z')
        .length,
      0,
    )

    const safetyResult = await runCli(['--cwd', safetyFixture.repository, ...writeArgs], {
      env: safetyFixture.variants.safety.environment,
    })
    assert.equal(safetyResult.status, 2, JSON.stringify(safetyResult, null, 2))
    const safetyPayload = parseJsonStdout(safetyResult)
    assert.deepEqual(
      {
        planned: safetyPayload.summary.plannedUpdates,
        applied: safetyPayload.summary.appliedUpdates,
        failed: safetyPayload.summary.failedWrites,
        unknown: safetyPayload.summary.unknownWrites,
      },
      { planned: 76, applied: 0, failed: 0, unknown: 76 },
    )
    assert.equal(readFileSync(safetyFixture.variants.safety.counter, 'utf8'), '2')
    assert.equal(safetyPayload.writeOutcomes.length, 76)
    assert.ok(
      safetyPayload.writeOutcomes.every(
        (outcome) => outcome.status === 'unknown' && outcome.reason === 'VCS_UNAVAILABLE',
      ),
    )
    assert.equal(
      new Set(safetyPayload.writeOutcomes.map((outcome) => outcome.occurrence.file)).size,
      14,
    )
    for (const target of safetyFixture.targets) {
      const actual = readFileSync(join(safetyFixture.repository, target.path))
      assert.deepEqual(actual, target.beforeBytes, `Safety variant changed bytes: ${target.path}`)
      assert.equal(createHash('sha256').update(actual).digest('hex'), target.beforeHash)
    }
    assertNoApplyResidue(safetyFixture.repository)
    assert.equal(
      runGitOutput(safetyFixture.git, safetyFixture.repository, 'status', '--porcelain=v1', '-z')
        .length,
      0,
    )
  } finally {
    visualPlusRegistryResponses.length = 0
    for (const root of fixtureRoots) rmSync(root, { force: true, recursive: true })
  }
})

await record('plan and file-only apply', async () => {
  const repo = join(tmpRoot, 'file-apply-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'file-apply-repo',
    private: true,
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')

  const planned = await runCli(['plan', '--json', '--cwd', repo, '--mode', 'latest'])
  assert.equal(planned.status, 1, JSON.stringify(planned, null, 2))
  const planFile = join(repo, 'plan.json')
  writeFileSync(planFile, planned.stdout, 'utf8')
  const applied = await runCli([
    'apply',
    '--json',
    '--cwd',
    repo,
    '--write',
    '--plan-file',
    planFile,
  ])
  assert.equal(applied.status, 0, JSON.stringify(applied, null, 2))
  assert.equal(parseJsonStdout(applied).status, 'applied')

  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  assert.equal(
    manifest.dependencies.gamma,
    '^1.0.2',
    JSON.stringify({ applied, manifest }, null, 2),
  )
})

await record('manager sync and exact verification', async () => {
  const repo = join(tmpRoot, 'manager-sync-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'manager-sync-repo',
    private: true,
    packageManager: 'npm@10.9.0',
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  writeJson(join(repo, 'package-lock.json'), {
    name: 'manager-sync-repo',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { gamma: '^1.0.0' } },
      'node_modules/gamma': { version: '1.0.0' },
    },
  })

  const planned = await runCli([
    'plan',
    '--json',
    '--cwd',
    repo,
    '--mode',
    'latest',
    '--sync-lockfile',
    '--verify-argv',
    '["ok-cmd"]',
  ])
  assert.equal(planned.status, 1, JSON.stringify(planned, null, 2))
  const planFile = join(repo, 'plan.json')
  writeFileSync(planFile, planned.stdout, 'utf8')
  const applied = await runCli([
    'apply',
    '--json',
    '--cwd',
    repo,
    '--write',
    '--sync-lockfile',
    '--verify',
    '--plan-file',
    planFile,
  ])
  assert.equal(applied.status, 0, JSON.stringify(applied, null, 2))
  const payload = parseJsonStdout(applied)
  assert.equal(payload.status, 'applied')
  assert.ok(
    payload.phases.some((phase) => phase.name === 'sync-lockfile' && phase.status === 'passed'),
  )
  assert.ok(payload.phases.some((phase) => phase.name === 'verify' && phase.status === 'passed'))

  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const lockfile = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'))
  assert.equal(manifest.dependencies.gamma, '^1.0.2')
  assert.equal(lockfile.packages[''].dependencies.gamma, '^1.0.2')
  assert.equal(lockfile.packages['node_modules/gamma'].version, '1.0.2')
})

await record('legacy post-write commands rejected', async () => {
  const repo = join(tmpRoot, 'legacy-post-write-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'legacy-post-write-repo',
    private: true,
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

  const beforeCount = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length
  for (const args of [
    ['--verify-command', 'ok-cmd'],
    ['--execute', 'ok-cmd'],
    ['--install'],
    ['--update'],
  ]) {
    const result = await runCli(['--cwd', repo, '--write', '--output', 'json', ...args])
    assert.equal(result.status, 2, JSON.stringify({ args, result }, null, 2))
    assert.equal(parseJsonStdout(result).error.code, 'ERR_CONFIG')
  }
  const afterCount = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length
  assert.equal(afterCount, beforeCount)
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies.gamma, '^1.0.0')
})

await record('global json', async () => {
  const result = await runCli(['--cwd', singleRepo, '--global', '--output', 'json'])
  assert.equal(result.status, 0)
  const payload = parseJsonStdout(result)
  assert.ok(payload.summary.total >= 1, JSON.stringify({ result, payload }, null, 2))
})

await record('global-all json', async () => {
  const result = await runCli(['--cwd', singleRepo, '--global-all', '--output', 'json'])
  assert.equal(result.status, 0)
  const payload = parseJsonStdout(result)
  assert.ok(payload.summary.total >= 1)
  const names = payload.packages[0]?.updates.map((update) => update.name) ?? []
  assert.ok(names.includes('shared-glob'))
})

await record('global-all write', async () => {
  const beforeCount = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length
  const result = await runCli([
    '--cwd',
    singleRepo,
    '--global-all',
    '--write',
    '--include',
    'shared-glob',
    '--mode',
    'latest',
  ])
  assert.equal(result.status, 0, JSON.stringify(result, null, 2))
  assert.match(result.stdout, /Global writes: 2 applied, 0 skipped, 0 failed, 0 unknown/u)
  assert.doesNotMatch(result.stdout, /(?:Complete|Partial result|Safety block).*across/u)
  assert.ok(!result.stdout.includes('global:npm ·'))
  assert.ok(!result.stdout.includes('global:pnpm ·'))

  const entries = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(beforeCount)
    .map((line) => JSON.parse(line))
  assert.ok(
    entries.some(
      (entry) =>
        entry.pm === 'npm' &&
        entry.args.join(' ') ===
          'install -g --ignore-scripts --no-audit --no-fund -- shared-glob@2.2.0',
    ),
  )
  assert.ok(
    entries.some(
      (entry) =>
        entry.pm === 'pnpm' &&
        entry.args.join(' ') === 'add -g --ignore-scripts --ignore-pnpmfile -- shared-glob@2.2.0',
    ),
    JSON.stringify(entries, null, 2),
  )
})

await record('cold and warm isolated cache', async () => {
  const repo = join(tmpRoot, 'cache-probe-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'cache-probe-repo',
    private: true,
    dependencies: { 'cache-probe': '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')

  const before = requests.length
  const cold = await runCli(['--cwd', repo, '--output', 'json'], { refreshCache: false })
  assert.equal(cold.status, 0)
  assert.equal(requests.length, before + 1)
  const warm = await runCli(['--cwd', repo, '--output', 'json'], { refreshCache: false })
  assert.equal(warm.status, 0)
  assert.equal(requests.length, before + 1)
  assert.ok(existsSync(join(homeDir, '.depfresh', 'cache.db')))
})

await record('invalid json combo rejected', async () => {
  const result = await runCli(['--cwd', singleRepo, '--output', 'json', '--write', '--install'])
  assert.equal(result.status, 2)
  const payload = parseJsonStdout(result)
  assert.equal(payload.error.code, 'ERR_CONFIG')
})

if (selectedCheck !== undefined) assert.deepEqual(checks, [selectedCheck])

// biome-ignore lint/suspicious/noConsole: intentional smoke-test summary
console.log(
  JSON.stringify(
    {
      ok: true,
      tmpRoot,
      registryUrl,
      checks,
      requestCount: requests.length,
    },
    null,
    2,
  ),
)
