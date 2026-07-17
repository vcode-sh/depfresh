#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const repositoryRoot = new URL('..', import.meta.url).pathname.replace(/\/$/u, '')
const cliPathInput = process.env.DEPFRESH_CLI_PATH
if (cliPathInput && !isAbsolute(cliPathInput)) {
  throw new Error('DEPFRESH_CLI_PATH must be an absolute path')
}
const cliPath = cliPathInput ? resolve(cliPathInput) : join(repositoryRoot, 'dist', 'cli.mjs')
const proofRoot = mkdtempSync(join(tmpdir(), 'depfresh-wun-demo-proof-'))
const persistentRootInput = process.env.DEPFRESH_DEMO_ROOT
const demoRoot = persistentRootInput ? resolve(persistentRootInput) : join(proofRoot, 'demo')
const homeRoot = join(proofRoot, 'home')
const writeRoot = join(proofRoot, 'write-copy')
const staleRoot = join(proofRoot, 'stale-copy')

if (!existsSync(cliPath)) throw new Error(`Cannot find the depfresh CLI: ${cliPath}`)
if (persistentRootInput && !isAbsolute(persistentRootInput)) {
  throw new Error('DEPFRESH_DEMO_ROOT must be an absolute path')
}
if (existsSync(demoRoot) && readdirSync(demoRoot).length > 0) {
  throw new Error(`Refusing to replace a non-empty demo directory: ${demoRoot}`)
}

const registryData = {
  bun: ['1.3.14'],
  'expo-server-sdk': ['6.0.0', '6.1.0'],
  expo: ['57.0.0', '57.0.1'],
  'native-direct-helper': ['1.0.0', '1.1.0'],
  'react-native': ['0.86.0', '0.87.0'],
  typescript: ['5.0.0', '5.1.0'],
}
const registryRequests = []
const registry = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1)
  const name = decodeURIComponent(pathname)
  registryRequests.push(name)
  const versions = registryData[name]
  if (!versions) {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
    return
  }

  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      name,
      versions: Object.fromEntries(versions.map((version) => [version, {}])),
      time: Object.fromEntries(versions.map((version) => [version, '2026-06-01T00:00:00.000Z'])),
      'dist-tags': { latest: versions.at(-1) },
    }),
  )
})

await new Promise((resolveListen) => registry.listen(0, '127.0.0.1', resolveListen))
const registryAddress = registry.address()
assert.ok(registryAddress && typeof registryAddress !== 'string')
const registryUrl = `http://127.0.0.1:${registryAddress.port}/`

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function createDemo(root) {
  for (const directory of [
    root,
    join(root, 'apps', 'native'),
    join(root, 'apps', 'web'),
    join(root, 'apps', 'worker'),
    join(root, 'packages', 'shared'),
  ]) {
    mkdirSync(directory, { recursive: true })
  }

  writeJson(join(root, 'package.json'), {
    name: 'depfresh-wun-demo',
    private: true,
    packageManager: 'bun@1.3.14',
    workspaces: {
      packages: ['apps/*', 'packages/*'],
      catalog: {
        'expo-server-sdk': '^6.0.0',
        typescript: '^5.0.0',
      },
      catalogs: {
        native: {
          expo: '~57.0.0',
          'react-native': '0.86.0',
        },
      },
    },
  })
  writeJson(join(root, 'apps', 'web', 'package.json'), {
    name: '@demo/web',
    private: true,
    devDependencies: { typescript: 'catalog:' },
  })
  writeJson(join(root, 'apps', 'worker', 'package.json'), {
    name: '@demo/worker',
    private: true,
    dependencies: { 'expo-server-sdk': 'catalog:', '@demo/shared': 'workspace:*' },
  })
  writeJson(join(root, 'apps', 'native', 'package.json'), {
    name: '@demo/native',
    private: true,
    dependencies: {
      '@demo/shared': 'workspace:*',
      expo: 'catalog:native',
      'native-direct-helper': '^1.0.0',
      'react-native': 'catalog:native',
    },
  })
  writeJson(join(root, 'packages', 'shared', 'package.json'), {
    name: '@demo/shared',
    private: true,
    version: '1.0.0',
  })
  writeJson(join(root, '.depfreshrc.json'), {
    ignorePaths: ['**/.worktrees/**', 'tmp/**'],
    policyRules: [
      {
        id: 'skip-native-catalog',
        selectors: { catalogName: '^native$' },
        action: 'exclude',
      },
      {
        id: 'skip-native-direct',
        selectors: { workspacePath: '^apps/native$', catalogRole: 'direct' },
        action: 'exclude',
      },
    ],
  })
  writeJson(join(root, 'bun.lock'), { lockfileVersion: 1, configVersion: 1 })
  writeFileSync(join(root, '.gitignore'), '.npmrc\ndepfresh-plan.json\n', 'utf8')
  writeFileSync(
    join(root, 'README.md'),
    `# depfresh WUN-shaped demo

This sanitized Bun workspace proves default and named catalogs, native policy exclusions,
workspace links, machine planning, safe writes, and cache reuse without copying WUN data.

Test the current local checkout:

\`\`\`bash
bunx --package file:${repositoryRoot} depfresh
node ${cliPath} --cwd . plan --json --mode minor --include-locked > depfresh-plan.json
\`\`\`

Run from this directory after depfresh 2.0.1 is available:

\`\`\`bash
bunx depfresh@2.0.1
bunx depfresh@2.0.1 plan --json --mode minor --include-locked > depfresh-plan.json
\`\`\`

The \`native\` catalog and direct dependencies in \`apps/native\` are excluded by
\`.depfreshrc.json\`. Default-catalog dependencies remain eligible.
`,
    'utf8',
  )
}

function addRegistry(root) {
  writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`, 'utf8')
}

function runProcess(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => resolveRun({ status, stderr, stdout }))
  })
}

const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
)
const cliEnvironment = {
  ...cleanEnvironment,
  CI: '1',
  HOME: homeRoot,
  NO_COLOR: '1',
  XDG_CACHE_HOME: join(homeRoot, 'cache'),
}

async function runCli(root, args) {
  return runProcess(process.execPath, [cliPath, '--cwd', root, ...args], {
    cwd: root,
    env: cliEnvironment,
  })
}

async function runGit(root, args) {
  const result = await runProcess('git', args, { cwd: root, env: cleanEnvironment })
  assert.equal(result.status, 0, JSON.stringify({ args, result }, null, 2))
  return result.stdout.trim()
}

function parseJson(result, expectedStatus) {
  assert.equal(result.status, expectedStatus, JSON.stringify(result, null, 2))
  assert.equal(result.stderr, '', JSON.stringify(result, null, 2))
  return JSON.parse(result.stdout)
}

createDemo(demoRoot)
addRegistry(demoRoot)
mkdirSync(homeRoot, { recursive: true })
await runGit(demoRoot, ['init', '--quiet'])
await runGit(demoRoot, ['add', '.'])
await runGit(demoRoot, [
  '-c',
  'user.name=depfresh demo',
  '-c',
  'user.email=demo@depfresh.invalid',
  'commit',
  '--quiet',
  '-m',
  'Create WUN-shaped demo',
])
const cleanStatus = await runGit(demoRoot, ['status', '--short'])
assert.equal(cleanStatus, '')

const capabilities = parseJson(await runCli(demoRoot, ['capabilities', '--json']), 0)
assert.equal(capabilities.version, '2.0.1')

const inspected = parseJson(await runCli(demoRoot, ['inspect', '--json']), 0)
assert.equal(inspected.repository.packageManager, undefined)
assert.equal(inspected.errors.length, 0)
assert.equal(inspected.occurrences.length, 12)

const requestsBeforeColdPlan = registryRequests.length
const coldPlanResult = await runCli(demoRoot, [
  'plan',
  '--json',
  '--mode',
  'minor',
  '--include-locked',
])
const coldPlan = parseJson(coldPlanResult, 1)
const requestsAfterColdPlan = registryRequests.length
assert.equal(requestsBeforeColdPlan, 0)
assert.equal(requestsAfterColdPlan, 3, JSON.stringify(registryRequests))
assert.deepEqual(new Set(registryRequests), new Set(['bun', 'expo-server-sdk', 'typescript']))

const occurrences = new Map(coldPlan.occurrences.map((occurrence) => [occurrence.id, occurrence]))
const decisions = coldPlan.decisions.map((decision) => ({
  ...decision,
  occurrence: occurrences.get(decision.occurrenceId),
}))
const nativeNames = new Set(['expo', 'native-direct-helper', 'react-native'])
const nativeDecisions = decisions.filter((decision) => nativeNames.has(decision.occurrence?.name))
assert.ok(nativeDecisions.length >= 5)
assert.ok(
  nativeDecisions.every(
    (decision) => decision.status === 'skipped' && decision.reason === 'POLICY_RULE_EXCLUDED',
  ),
)
const operationNames = coldPlan.operations.map(
  (operation) => occurrences.get(operation.occurrenceId)?.name,
)
assert.deepEqual(new Set(operationNames), new Set(['expo-server-sdk', 'typescript']))
assert.equal(coldPlan.summary.blocked, 0)
assert.equal(coldPlan.summary.errors, 0)

const workspaceSelection = parseJson(
  await runCli(demoRoot, [
    'plan',
    '--json',
    '--mode',
    'minor',
    '--include-locked',
    '--exclude-workspace',
    'apps/worker',
  ]),
  1,
)
assert.deepEqual(workspaceSelection.selection.summary, {
  requestedWorkspaces: 1,
  requestedCatalogs: 0,
  matchedWorkspaces: 1,
  matchedCatalogNames: 0,
  matchedCatalogOwners: 0,
  excludedOccurrences: 2,
  eligibleSharedCatalogOwners: 1,
})

const catalogSelection = parseJson(
  await runCli(demoRoot, [
    'plan',
    '--json',
    '--mode',
    'minor',
    '--include-locked',
    '--exclude-catalog',
    'default',
  ]),
  1,
)
assert.equal(catalogSelection.selection.summary.matchedCatalogOwners, 1)
assert.equal(catalogSelection.selection.summary.excludedOccurrences, 4)

const combinedSelection = parseJson(
  await runCli(demoRoot, [
    'plan',
    '--json',
    '--mode',
    'minor',
    '--include-locked',
    '--exclude-workspace',
    'apps/worker',
    '--exclude-catalog',
    'default',
  ]),
  1,
)
assert.equal(combinedSelection.selection.summary.excludedOccurrences, 5)
assert.equal(combinedSelection.selection.summary.eligibleSharedCatalogOwners, 0)

const requestsBeforeColdCache = registryRequests.length
parseJson(
  await runCli(demoRoot, [
    '--output',
    'json',
    '--mode',
    'minor',
    '--include-locked',
    '--refresh-cache',
  ]),
  0,
)
const coldCacheRequests = registryRequests.length - requestsBeforeColdCache
parseJson(await runCli(demoRoot, ['--output', 'json', '--mode', 'minor', '--include-locked']), 0)
const warmAdditionalRequests = registryRequests.length - requestsBeforeColdCache - coldCacheRequests
assert.equal(coldCacheRequests, 3)
assert.equal(warmAdditionalRequests, 0)
assert.equal(await runGit(demoRoot, ['status', '--short']), cleanStatus)

for (const targetRoot of [writeRoot, staleRoot]) {
  createDemo(targetRoot)
  addRegistry(targetRoot)
}

const writePlan = parseJson(
  await runCli(writeRoot, ['plan', '--json', '--mode', 'minor', '--include-locked']),
  1,
)
const writePlanPath = join(writeRoot, 'depfresh-plan.json')
writeJson(writePlanPath, writePlan)
const nativeManifestBefore = readFileSync(join(writeRoot, 'apps', 'native', 'package.json'), 'utf8')
const nativeCatalogBefore = JSON.parse(readFileSync(join(writeRoot, 'package.json'), 'utf8'))
  .workspaces.catalogs.native

const deniedApply = parseJson(
  await runCli(writeRoot, ['apply', '--json', '--plan-file', writePlanPath]),
  2,
)
assert.equal(deniedApply.errors[0]?.reason, 'AUTHORITY_REQUIRED')
assert.equal(
  readFileSync(join(writeRoot, 'apps', 'native', 'package.json'), 'utf8'),
  nativeManifestBefore,
)

const applied = parseJson(
  await runCli(writeRoot, ['apply', '--json', '--write', '--plan-file', writePlanPath]),
  0,
)
assert.equal(applied.status, 'applied')
const writtenRoot = JSON.parse(readFileSync(join(writeRoot, 'package.json'), 'utf8'))
assert.deepEqual(writtenRoot.workspaces.catalogs.native, nativeCatalogBefore)
assert.equal(writtenRoot.workspaces.catalog.typescript, '^5.1.0')
assert.equal(writtenRoot.workspaces.catalog['expo-server-sdk'], '^6.1.0')
assert.equal(
  readFileSync(join(writeRoot, 'apps', 'native', 'package.json'), 'utf8'),
  nativeManifestBefore,
)

const stalePlan = parseJson(
  await runCli(staleRoot, ['plan', '--json', '--mode', 'minor', '--include-locked']),
  1,
)
const stalePlanPath = join(staleRoot, 'depfresh-plan.json')
writeJson(stalePlanPath, stalePlan)
const staleManifestPath = join(staleRoot, 'package.json')
const concurrentBytes = `${readFileSync(staleManifestPath, 'utf8').trimEnd()}\n `
writeFileSync(staleManifestPath, concurrentBytes, 'utf8')
const staleApply = parseJson(
  await runCli(staleRoot, ['apply', '--json', '--write', '--plan-file', stalePlanPath]),
  1,
)
assert.equal(staleApply.status, 'conflicted')
assert.equal(readFileSync(staleManifestPath, 'utf8'), concurrentBytes)

rmSync(join(demoRoot, '.npmrc'))
assert.equal(await runGit(demoRoot, ['status', '--short']), cleanStatus)
await new Promise((resolveClose) => registry.close(resolveClose))

// biome-ignore lint/suspicious/noConsole: intentional proof summary
console.log(
  JSON.stringify(
    {
      ok: true,
      demoRoot,
      persistent: Boolean(persistentRootInput),
      packages: 5,
      occurrences: inspected.occurrences.length,
      registryRequests: {
        cold: coldCacheRequests,
        warmAdditional: warmAdditionalRequests,
      },
      operations: [...new Set(operationNames)].sort(),
      excludedNative: [...nativeNames].sort(),
      checks: [
        'capabilities',
        'inspect',
        'native catalog exclusion',
        'direct native exclusion',
        'exact Bun workspace exclusion',
        'exact Bun catalog exclusion',
        'combined Bun exclusion receipt',
        'ordinary catalog updates',
        'workspace protocol skip',
        'authority denial',
        'file-only apply',
        'stale-plan conflict',
        'cold and warm cache',
        'read-only Git state',
      ],
    },
    null,
    2,
  ),
)
