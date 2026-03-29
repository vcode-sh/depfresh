#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const cliPath = join(repoRoot, 'dist', 'cli.mjs')

const tmpRoot = mkdtempSync(join(tmpdir(), 'depfresh-practical-'))
const homeDir = join(tmpRoot, 'home')
const binDir = join(tmpRoot, 'bin')
const singleRepo = join(tmpRoot, 'single-app')
const workspaceRoot = join(tmpRoot, 'workspace')
const emptyRepo = join(tmpRoot, 'empty')
const logFile = join(tmpRoot, 'pm.log')

for (const dir of [homeDir, binDir, singleRepo, workspaceRoot, emptyRepo]) {
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

function writeExecutable(name, content) {
  const filepath = join(binDir, name)
  writeFileSync(filepath, content, 'utf8')
  chmodSync(filepath, 0o755)
}

function createPmScript(name) {
  const version = name === 'bun' ? '1.1.38' : name === 'pnpm' ? '10.33.0' : '10.9.0'

  return `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.DEPFRESH_PM_LOG, JSON.stringify({ pm: '${name}', args }) + '\\n')

if (args[0] === '--version') {
  process.stdout.write('${version}\\n')
  process.exit(0)
}

if ('${name}' === 'npm' && args.join(' ') === 'list -g --depth=0 --json') {
  process.stdout.write(JSON.stringify({
    dependencies: {
      'glob-a': { version: '1.2.0' },
      'shared-glob': { version: '2.1.0' },
    },
  }))
  process.exit(0)
}

if ('${name}' === 'pnpm' && args.join(' ') === 'list -g --json') {
  process.stdout.write(JSON.stringify([{
    dependencies: {
      'glob-b': { version: '1.0.0' },
      'shared-glob': { version: '1.9.0' },
    },
  }]))
  process.exit(0)
}

if ('${name}' === 'bun' && args.join(' ') === 'pm ls -g') {
  process.stdout.write('└── glob-c@0.5.0\\n')
  process.exit(0)
}

process.exit(0)
`
}

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
writeFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf8')
mkdirSync(join(workspaceRoot, 'packages', 'web', 'src'), { recursive: true })
writeJson(join(workspaceRoot, 'packages', 'web', 'package.json'), {
  name: 'web',
  private: true,
  dependencies: {
    alpha: '^1.0.0',
    delta: '^1.0.0',
  },
})
writeFileSync(join(workspaceRoot, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')

// Strip npm_config_* env vars that pnpm injects — they override .npmrc in fixtures
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('npm_config_')),
)

async function runCli(args, extra = {}) {
  return await new Promise((resolve, reject) => {
    const needsCache = !args.some((a) =>
      ['--help', '--help-json', '--version', 'help', 'capabilities'].includes(a),
    )
    const cacheArgs = needsCache ? ['--refresh-cache'] : []
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
  assert.match(result.stdout, /1\.1\.0/)
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
  assert.equal(payload.meta.effectiveRoot, workspaceRoot)
  assert.ok(payload.discovery)
  assert.ok(payload.profile)
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

await record('verify-command success', async () => {
  const repo = join(tmpRoot, 'verify-ok-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'verify-ok-repo',
    private: true,
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

  const result = await runCli([
    '--cwd',
    repo,
    '--write',
    '--mode',
    'latest',
    '--verify-command',
    'ok-cmd',
    '--output',
    'json',
  ])
  assert.equal(result.status, 0, JSON.stringify(result, null, 2))

  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies.gamma, '^1.0.2', JSON.stringify({ result, manifest }, null, 2))
})

await record('verify-command failure reverts', async () => {
  const repo = join(tmpRoot, 'verify-fail-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'verify-fail-repo',
    private: true,
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

  const result = await runCli([
    '--cwd',
    repo,
    '--write',
    '--mode',
    'latest',
    '--verify-command',
    'fail-cmd',
    '--output',
    'json',
  ])
  assert.equal(result.status, 0)

  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies.gamma, '^1.0.0')
})

await record('execute and install', async () => {
  const repo = join(tmpRoot, 'install-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'install-repo',
    private: true,
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

  const beforeCount = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length
  const result = await runCli(['--cwd', repo, '--write', '--execute', 'ok-cmd', '--install'])
  assert.equal(result.status, 0)

  const entries = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(beforeCount)
    .map((line) => JSON.parse(line))
  assert.ok(entries.some((entry) => entry.pm === 'pnpm' && entry.args[0] === 'install'))
})

await record('update command', async () => {
  const repo = join(tmpRoot, 'update-repo')
  mkdirSync(repo, { recursive: true })
  writeJson(join(repo, 'package.json'), {
    name: 'update-repo',
    private: true,
    dependencies: { gamma: '^1.0.0' },
  })
  writeFileSync(join(repo, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

  const beforeCount = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length
  const result = await runCli(['--cwd', repo, '--write', '--update'])
  assert.equal(result.status, 0)

  const entries = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(beforeCount)
    .map((line) => JSON.parse(line))
  assert.ok(entries.some((entry) => entry.pm === 'pnpm' && entry.args[0] === 'update'))
})

await record('global json', async () => {
  const result = await runCli([
    '--cwd',
    singleRepo,
    '--global',
    '--mode',
    'latest',
    '--output',
    'json',
  ])
  assert.equal(result.status, 0)
  const payload = parseJsonStdout(result)
  assert.ok(payload.summary.total >= 1, JSON.stringify({ result, payload }, null, 2))
})

await record('global-all json', async () => {
  const result = await runCli([
    '--cwd',
    singleRepo,
    '--global-all',
    '--mode',
    'latest',
    '--output',
    'json',
  ])
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
  assert.equal(result.status, 0)

  const entries = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(beforeCount)
    .map((line) => JSON.parse(line))
  assert.ok(
    entries.some(
      (entry) => entry.pm === 'npm' && entry.args.join(' ') === 'install -g shared-glob@2.2.0',
    ),
  )
  assert.ok(
    entries.some(
      (entry) => entry.pm === 'pnpm' && entry.args.join(' ') === 'add -g shared-glob@2.2.0',
    ),
  )
})

await record('invalid json combo rejected', async () => {
  const result = await runCli(['--cwd', singleRepo, '--output', 'json', '--write', '--install'])
  assert.equal(result.status, 2)
  const payload = parseJsonStdout(result)
  assert.equal(payload.error.code, 'ERR_CONFIG')
})

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
