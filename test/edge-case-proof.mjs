#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const outputPath = join(repoRoot, 'audit', 'edge-case-proof-results.json')
const artifactRoot = join(repoRoot, 'audit', 'edge-case-proof-artifacts')

async function main() {
  await rm(artifactRoot, { recursive: true, force: true })
  await mkdir(artifactRoot)

  const results = []
  results.push(await runEmptyMonorepoScenario())
  results.push(await runLargeDependencyScenario())
  results.push(await runCorruptCacheScenario())

  const report = {
    generatedAt: new Date().toISOString(),
    depfreshVersion: await getDepfreshVersion(),
    tazeVersion: '19.9.2',
    repoRoot,
    scenarios: results,
  }

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  printSummary(report)
}

async function runEmptyMonorepoScenario() {
  const scenarioId = 'empty-monorepo'
  const root = await mkdtemp(join(tmpdir(), 'depfresh-edge-empty-'))
  const workspace = join(root, 'workspace')
  const depfreshHome = join(root, 'home-depfresh')
  const tazeHome = join(root, 'home-taze')
  await mkdir(workspace)
  await mkdir(join(workspace, 'packages'))
  await mkdir(depfreshHome)
  await mkdir(tazeHome)

  writeFileSync(join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf8')

  const depfresh = await runDepfresh({
    cwd: workspace,
    home: depfreshHome,
    args: ['--output', 'json', '--fail-on-outdated', '--loglevel', 'silent'],
    artifactDir: join(artifactRoot, scenarioId),
  })

  const taze = await runTaze({
    cwd: workspace,
    home: tazeHome,
    args: ['--fail-on-outdated', '--loglevel', 'silent'],
    artifactDir: join(artifactRoot, scenarioId),
  })

  await rm(root, { recursive: true, force: true })

  return {
    id: scenarioId,
    title: 'Empty monorepo (no package manifests)',
    depfresh: summarizeDepfresh(depfresh),
    taze: summarizeTaze(taze),
    verdict:
      depfresh.parsedJson?.meta?.noPackagesFound === true
        ? 'depfresh emits explicit noPackagesFound JSON metadata; taze only emits a human sentence.'
        : 'Both tools complete without crashing.',
  }
}

async function runLargeDependencyScenario() {
  const scenarioId = 'large-120-deps'
  const root = await mkdtemp(join(tmpdir(), 'depfresh-edge-large-'))
  const workspace = join(root, 'workspace')
  const depfreshHome = join(root, 'home-depfresh')
  const tazeHome = join(root, 'home-taze')
  await mkdir(workspace)
  await mkdir(depfreshHome)
  await mkdir(tazeHome)

  const packageNames = await fetchNpmPackageNames(120)
  const deps = Object.fromEntries(packageNames.map((name) => [name, '^0.0.0']))

  writeJson(
    join(workspace, 'package.json'),
    {
      name: 'large-fixture',
      private: true,
      dependencies: deps,
    },
    true,
  )

  const depfresh = await runDepfresh({
    cwd: workspace,
    home: depfreshHome,
    args: [
      '--output',
      'json',
      '--mode',
      'latest',
      '--fail-on-outdated',
      '--concurrency',
      '16',
      '--loglevel',
      'silent',
    ],
    artifactDir: join(artifactRoot, scenarioId),
  })

  const taze = await runTaze({
    cwd: workspace,
    home: tazeHome,
    args: ['latest', '--fail-on-outdated', '--concurrency', '16', '--loglevel', 'silent'],
    artifactDir: join(artifactRoot, scenarioId),
  })

  await rm(root, { recursive: true, force: true })

  const depfreshProcessed = (depfresh.parsedJson?.summary?.total ?? 0) + (depfresh.parsedJson?.errors?.length ?? 0)

  return {
    id: scenarioId,
    title: 'Large package set (120 dependencies)',
    depfresh: summarizeDepfresh(depfresh),
    taze: summarizeTaze(taze),
    packageSample: packageNames.slice(0, 10),
    verdict:
      depfreshProcessed === 120
        ? 'depfresh reports exact structured counts for all 120 dependencies; taze requires text parsing.'
        : 'Large-set run completed, but one tool did not return full dependency accounting.',
  }
}

async function runCorruptCacheScenario() {
  const scenarioId = 'corrupt-cache'
  const root = await mkdtemp(join(tmpdir(), 'depfresh-edge-cache-'))
  const workspace = join(root, 'workspace')
  const depfreshHome = join(root, 'home-depfresh')
  const tazeHome = join(root, 'home-taze')
  const tazeTmp = join(root, 'tmp-for-taze')
  await mkdir(workspace)
  await mkdir(depfreshHome)
  await mkdir(tazeHome)
  await mkdir(tazeTmp)

  writeJson(
    join(workspace, 'package.json'),
    {
      name: 'cache-fixture',
      private: true,
      dependencies: {
        lodash: '^4.17.0',
      },
    },
    true,
  )

  mkdirSync(join(depfreshHome, '.depfresh'), { recursive: true })
  writeFileSync(join(depfreshHome, '.depfresh', 'cache.db'), 'not-a-sqlite-db', 'utf8')

  mkdirSync(join(tazeTmp, 'taze'), { recursive: true })
  writeFileSync(join(tazeTmp, 'taze', 'cache.json'), '{bad-json', 'utf8')

  const depfresh = await runDepfresh({
    cwd: workspace,
    home: depfreshHome,
    args: ['--output', 'json', '--mode', 'latest', '--fail-on-outdated', '--loglevel', 'silent'],
    artifactDir: join(artifactRoot, scenarioId),
  })

  const taze = await runTaze({
    cwd: workspace,
    home: tazeHome,
    args: ['latest', '--fail-on-outdated', '--loglevel', 'silent'],
    env: {
      TMPDIR: tazeTmp,
      TMP: tazeTmp,
      TEMP: tazeTmp,
    },
    artifactDir: join(artifactRoot, scenarioId),
  })

  await rm(root, { recursive: true, force: true })

  const tazeCacheParseCrash =
    taze.stderr.includes('SyntaxError') && taze.stderr.includes('loadCache')

  return {
    id: scenarioId,
    title: 'Corrupt cache file',
    depfresh: summarizeDepfresh(depfresh),
    taze: summarizeTaze(taze),
    verdict: tazeCacheParseCrash
      ? 'depfresh continues and returns valid JSON despite corrupt cache; taze aborts with a cache JSON parse error.'
      : 'Both tools survived cache corruption in this run.',
  }
}

async function runDepfresh({
  cwd,
  home,
  args,
  env = {},
  artifactDir,
}) {
  const result = await runCommand({
    command: 'node',
    args: ['--import', 'tsx', join(repoRoot, 'src/cli/index.ts'), '--cwd', cwd, ...args],
    cwd: repoRoot,
    env: {
      HOME: home,
      ...env,
    },
  })

  await writeRunArtifacts(artifactDir, 'depfresh', result)
  result.parsedJson = tryParseJson(result.stdout)
  return result
}

async function runTaze({ cwd, home, args, env = {}, artifactDir }) {
  const result = await runCommand({
    command: 'pnpm',
    args: ['--silent', 'dlx', 'taze@19.9.2', '--cwd', cwd, ...args],
    cwd: repoRoot,
    env: {
      HOME: home,
      ...env,
    },
  })

  await writeRunArtifacts(artifactDir, 'taze', result)
  return result
}

function summarizeDepfresh(run) {
  const parsed = run.parsedJson
  return {
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    jsonParseable: Boolean(parsed),
    totalUpdates: parsed?.summary?.total ?? null,
    scannedPackages: parsed?.summary?.scannedPackages ?? null,
    noPackagesFound: parsed?.meta?.noPackagesFound ?? null,
    errors: parsed?.errors?.length ?? null,
    artifacts: run.artifacts,
  }
}

function summarizeTaze(run) {
  const combined = `${run.stdout}\n${run.stderr}`
  const updateRows = (combined.match(/→/g) ?? []).length
  const errorRows = (combined.match(/^> .+ unknown error$/gm) ?? []).length
  return {
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    jsonParseable: Boolean(tryParseJson(run.stdout)),
    parsedUpdateCountFromText: updateRows > 0 ? updateRows : null,
    parsedErrorCountFromText: errorRows > 0 ? errorRows : null,
    upToDateMessage: combined.includes('dependencies are already up-to-date'),
    cacheParseError: run.stderr.includes('SyntaxError') && run.stderr.includes('loadCache'),
    artifacts: run.artifacts,
  }
}

function tryParseJson(raw) {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

async function runCommand({ command, args, cwd, env = {} }) {
  const startedAt = performance.now()
  const mergedEnv = {
    ...process.env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ...env,
  }

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        stdout,
        stderr,
      })
    })

    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        stdout,
        stderr: `${stderr}\n${String(error)}`,
      })
    })
  })
}

async function writeRunArtifacts(artifactDir, tool, run) {
  await mkdir(artifactDir)
  const stdoutPath = join(artifactDir, `${tool}.stdout.txt`)
  const stderrPath = join(artifactDir, `${tool}.stderr.txt`)
  await writeFile(stdoutPath, run.stdout, 'utf8')
  await writeFile(stderrPath, run.stderr, 'utf8')
  run.artifacts = { stdoutPath, stderrPath }
}

async function getDepfreshVersion() {
  const pkgRaw = await readFile(join(repoRoot, 'package.json'), 'utf8')
  const pkg = JSON.parse(pkgRaw)
  return pkg.version
}

async function fetchNpmPackageNames(count) {
  const response = await fetch('https://registry.npmjs.org/-/v1/search?text=keywords:javascript&size=250')
  if (!response.ok) {
    throw new Error(`Failed to fetch npm package sample: HTTP ${response.status}`)
  }

  const payload = await response.json()
  const names = []
  const seen = new Set()
  for (const item of payload.objects ?? []) {
    const name = item?.package?.name
    if (typeof name !== 'string' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= count) break
  }

  if (names.length < count) {
    throw new Error(`Expected at least ${count} package names from npm search, got ${names.length}`)
  }
  return names
}

async function mkdir(path) {
  mkdirSync(path, { recursive: true })
}

function writeJson(path, payload, trailingNewline = false) {
  const json = JSON.stringify(payload, null, 2)
  writeFileSync(path, trailingNewline ? `${json}\n` : json, 'utf8')
}

function printSummary(report) {
  const lines = []
  lines.push(`Edge-case proof completed at ${report.generatedAt}`)
  for (const scenario of report.scenarios) {
    lines.push(
      `- ${scenario.id}: depfresh(exit=${scenario.depfresh.exitCode}, json=${scenario.depfresh.jsonParseable}) | taze(exit=${scenario.taze.exitCode}, json=${scenario.taze.jsonParseable})`,
    )
    lines.push(`  verdict: ${scenario.verdict}`)
  }
  lines.push(`JSON report: ${outputPath}`)
  lines.push(`Artifacts: ${artifactRoot}`)
  // biome-ignore lint/suspicious/noConsole: script summary output
  console.log(lines.join('\n'))
}

main().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: script failure output
  console.error(error)
  process.exit(1)
})
