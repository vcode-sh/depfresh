#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const CHECK_SELECTOR = '--check'
const PIPE_RECEIPT_CHECK = 'piped write receipt stays complete and ordered on stdout'
const selectableChecks = new Set([PIPE_RECEIPT_CHECK])
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

const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const cliPath = join(repoRoot, 'dist', 'cli.mjs')
const pkgVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version

const tmpRoot = mkdtempSync(join(tmpdir(), 'depfresh-practical-'))
const homeDir = join(tmpRoot, 'home')
const binDir = join(tmpRoot, 'bin')
const singleRepo = join(tmpRoot, 'single-app')
const workspaceRoot = join(tmpRoot, 'workspace')
const emptyRepo = join(tmpRoot, 'empty')
const vcsOverflowBin = join(tmpRoot, 'vcs-overflow-bin')
const logFile = join(tmpRoot, 'pm.log')

const fixtureDirectories = selectedCheck
  ? [homeDir, binDir, vcsOverflowBin]
  : [homeDir, binDir, singleRepo, workspaceRoot, emptyRepo, vcsOverflowBin]
for (const dir of fixtureDirectories) {
  mkdirSync(dir, { recursive: true })
}
writeFileSync(logFile, '', 'utf8')

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
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.slice(1)
  const packageName = decodeURIComponent(pathname)
  requests.push(packageName)

  const body = getRegistryMetadata(packageName)
  if (!body) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string', 'Failed to start mock registry server')
const registryUrl = `http://127.0.0.1:${address.port}/`

function writeJson(filepath, value) {
  writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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
  execFileSync(git, args, { cwd, stdio: 'ignore' })
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

function stripNpmConfigEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.toLowerCase().startsWith('npm_config_')),
  )
}

if (selectedCheck === undefined) {
  assert.equal(
    stripNpmConfigEnvironment({ NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/' })
      .NPM_CONFIG_REGISTRY,
    undefined,
  )
}

// Package-manager config from the parent would override the fixture-local .npmrc registry.
const cleanEnv = stripNpmConfigEnvironment(process.env)

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
    const child = spawn(process.execPath, [cliPath, ...cacheArgs, ...args], {
      cwd: repoRoot,
      env: {
        ...cleanEnv,
        HOME: homeDir,
        PATH: `${binDir}:${process.env.PATH}`,
        DEPFRESH_PM_LOG: logFile,
        ...(extra.env ?? {}),
      },
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => {
      resolve({
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
    'Safety block · no files were changed',
    'package.json · 1 update not attempted',
    'Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_OUTPUT_LIMIT_EXCEEDED)',
    'Exit 2 · fix the Git evidence problem, then rerun',
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

server.close()
