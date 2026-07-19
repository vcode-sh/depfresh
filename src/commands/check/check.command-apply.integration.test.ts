import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashExactBytes } from '../../contracts/fingerprint'
import type { ApplyResult } from '../../contracts/schemas'
import type {
  depfreshOptions,
  PackageMeta,
  RepositoryVcsEvidence,
  ResolvedDepChange,
} from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import type { ApplyRuntime } from '../apply/types'
import { check } from './index'

const applyRuntime = vi.hoisted(() => ({
  overrides: undefined as Partial<ApplyRuntime> | undefined,
  result: undefined as unknown,
  evidence: [] as unknown[],
}))

vi.mock('../apply/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apply/index')>()
  const { applyPlanWithRuntime } = await import('../apply/engine')
  return {
    ...actual,
    applyWithExecutionEvidence: async (
      ...args: Parameters<typeof actual.applyWithExecutionEvidence>
    ) => {
      if (!applyRuntime.overrides) {
        const result = await actual.applyWithExecutionEvidence(...args)
        applyRuntime.result = result.applyResult
        applyRuntime.evidence = result.evidence
        return result
      }
      const evidenceByTarget = new Map<
        string,
        {
          targetPath: string
          operationIds: string[]
          replacementAttempted: boolean
        }
      >()
      let vcsEvidence: RepositoryVcsEvidence | undefined
      const applyResult = await applyPlanWithRuntime(
        args[0],
        args[1],
        args[2],
        applyRuntime.overrides,
        (evidence) => evidenceByTarget.set(evidence.targetPath, { ...evidence }),
        (evidence) => {
          vcsEvidence = evidence
        },
      )
      applyRuntime.result = applyResult
      applyRuntime.evidence = [...evidenceByTarget.values()]
      return {
        applyResult,
        evidence: [...evidenceByTarget.values()],
        ...(vcsEvidence === undefined ? {} : { vcsEvidence }),
      }
    },
  }
})

interface CheckPayload {
  summary: {
    plannedUpdates: number
    appliedUpdates: number
    unknownWrites: number
  }
  meta: { didWrite: boolean }
}

describe('command-level check apply integration', () => {
  const roots: string[] = []
  let registry: Server | undefined
  let registryUrl = ''
  let originalHome: string | undefined
  let originalNpmConfig: string | undefined
  let originalNpmRegistry: string | undefined
  let originalNpmRegistryUpper: string | undefined
  let originalPath: string | undefined

  beforeEach(async () => {
    applyRuntime.overrides = undefined
    applyRuntime.result = undefined
    applyRuntime.evidence = []
    originalHome = process.env.HOME
    originalNpmConfig = process.env.npm_config_userconfig
    originalNpmRegistry = process.env.npm_config_registry
    originalNpmRegistryUpper = process.env.NPM_CONFIG_REGISTRY
    originalPath = process.env.PATH
    delete process.env.npm_config_registry
    delete process.env.NPM_CONFIG_REGISTRY

    const started = await startRegistry()
    registry = started.server
    registryUrl = started.url
  })

  afterEach(async () => {
    applyRuntime.overrides = undefined
    applyRuntime.result = undefined
    applyRuntime.evidence = []
    vi.restoreAllMocks()
    restoreEnvironment('HOME', originalHome)
    restoreEnvironment('npm_config_userconfig', originalNpmConfig)
    restoreEnvironment('npm_config_registry', originalNpmRegistry)
    restoreEnvironment('NPM_CONFIG_REGISTRY', originalNpmRegistryUpper)
    restoreEnvironment('PATH', originalPath)
    if (registry) await closeServer(registry)
    for (const root of roots) rmSync(root, { recursive: true, force: true })
    roots.length = 0
  })

  it('observes every requested value from one three-target command apply', async () => {
    const fixture = createWorkspace()

    const result = await runCheck(fixture.root, 'json')

    expect(result.loadedPackages).toBe(3)
    expect(result.resolvedDependencies).toBe(3)
    expect(result.exitCode).toBe(0)
    expect(result.payload).toMatchObject({
      summary: { plannedUpdates: 3, appliedUpdates: 3, unknownWrites: 0 },
      meta: { didWrite: true },
    })
    expect(readDependency(fixture.manifests[0]!, 'alpha')).toBe('^1.0.2')
    expect(readDependency(fixture.manifests[1]!, 'beta')).toBe('^1.0.1')
    expect(readDependency(fixture.manifests[2]!, 'gamma')).toBe('^1.0.1')
    expect(existsSync(join(fixture.root, '.depfresh'))).toBe(false)
  })

  it('blocks all three targets when the apply-time Git preflight becomes unavailable', async () => {
    const fixture = createWorkspace()
    const git = findExecutable('git')
    initializeGit(git, fixture.root)
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    const wrapperBin = join(fixture.root, 'git-wrapper-bin')
    const counter = join(fixture.root, 'git-ls-files-count')
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
    process.env.PATH = `${wrapperBin}${delimiter}${originalPath ?? ''}`

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Safety block · no files were changed')
    expect(result.output.match(/1 update not attempted/gu)).toHaveLength(3)
    expect(result.output.match(/VCS_UNAVAILABLE/gu)).toHaveLength(3)
    expect(result.output).toContain('Exit 2')
    expect(readFileSync(counter, 'utf8')).toBe('3')
    for (let index = 0; index < fixture.manifests.length; index += 1) {
      expect(readFileSync(fixture.manifests[index]!)).toEqual(originalBytes[index])
    }
    expect(existsSync(join(fixture.root, '.depfresh'))).toBe(false)
  })

  it('safety-blocks every target when one source becomes stale before the first replacement', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    let swapped = false
    applyRuntime.overrides = {
      checkpoint(name) {
        if (name !== 'before-precommit' || swapped) return
        swapped = true
        const replacement = join(fixture.root, 'replacement.json')
        writeFileSync(replacement, originalBytes[2]!)
        renameSync(replacement, fixture.manifests[2]!)
      },
    }

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Safety block · no files were changed')
    expect(result.output.match(/SOURCE_CHANGED/gu)).toHaveLength(3)
    expect(result.output.match(/not attempted/gu)).toHaveLength(3)
    expect(capturedApplyResult()).toMatchObject({
      status: 'conflicted',
      operations: [
        { status: 'conflicted', reason: 'SOURCE_CHANGED' },
        { status: 'conflicted', reason: 'SOURCE_CHANGED' },
        { status: 'conflicted', reason: 'SOURCE_CHANGED' },
      ],
      recovery: { status: 'not-needed' },
    })
    expect(capturedAttempts()).toEqual([false, false, false])
    expectManifestBytes(fixture.manifests, originalBytes)
    expect(existsSync(join(fixture.root, '.depfresh'))).toBe(false)
  })

  it('restores an earlier replacement and preserves a later stale target', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    const external = Buffer.from('{"dependencies":{"beta":"1.0.9"}}\n')
    applyRuntime.overrides = {
      checkpoint(name, context) {
        if (name === 'before-replace' && context.index === 1) {
          writeFileSync(fixture.manifests[1]!, external)
        }
      },
    }

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Partial result')
    expect(result.output).toContain('COMMIT_FAILED_REVERTED')
    expect(result.output).toContain('SOURCE_CHANGED')
    expect(capturedApplyResult()).toMatchObject({
      status: 'failed',
      operations: [
        { status: 'reverted', reason: 'COMMIT_FAILED_REVERTED' },
        { status: 'conflicted', reason: 'SOURCE_CHANGED' },
        { status: 'failed', reason: 'RUN_ABORTED' },
      ],
      recovery: {
        status: 'completed',
        restoredPaths: ['package.json'],
        unrecoveredPaths: [],
      },
    })
    expect(capturedAttempts()).toEqual([true, false, false])
    expect(readFileSync(fixture.manifests[0]!)).toEqual(originalBytes[0])
    expect(readFileSync(fixture.manifests[1]!)).toEqual(external)
    expect(readFileSync(fixture.manifests[2]!)).toEqual(originalBytes[2])
    expect(existsSync(join(fixture.root, '.depfresh'))).toBe(false)
  })

  it('retains unknown recovery evidence when final observation loses target identity', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    const outside = join(fixture.root, 'outside.json')
    const displaced = join(fixture.root, 'displaced.json')
    writeFileSync(outside, '{"dependencies":{"alpha":"^1.0.2"}}\n')
    let swapped = false
    applyRuntime.overrides = {
      checkpoint(name) {
        if (name !== 'before-final-observation' || swapped) return
        swapped = true
        renameSync(fixture.manifests[0]!, displaced)
        symlinkSync(outside, fixture.manifests[0]!)
      },
    }

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Unknown result')
    expect(result.output).toMatch(/TARGET_IDENTITY_AMBIGUOUS|FINAL_OBSERVATION_FAILED/u)
    expect(capturedApplyResult()).toMatchObject({
      status: 'unknown',
      recovery: {
        status: 'unknown',
        restoredPaths: ['packages/a/package.json', 'packages/b/package.json'],
        unrecoveredPaths: ['package.json'],
      },
    })
    expect(capturedAttempts()).toEqual([true, true, true])
    expect(lstatSync(fixture.manifests[0]!).isSymbolicLink()).toBe(true)
    expect(readFileSync(fixture.manifests[1]!)).toEqual(originalBytes[1])
    expect(readFileSync(fixture.manifests[2]!)).toEqual(originalBytes[2])
    expectRetainedRecovery(fixture.root)
  })

  it('reports completed recovery with one restored path after an injected commit failure', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    applyRuntime.overrides = {
      checkpoint(name, context) {
        if (name === 'after-replace' && context.index === 0) throw new Error('commit fault')
      },
    }

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Partial result')
    expect(result.output).toContain('COMMIT_FAILED_REVERTED')
    expect(result.output.match(/RUN_ABORTED/gu)).toHaveLength(2)
    expect(capturedApplyResult()).toMatchObject({
      status: 'failed',
      operations: [
        { status: 'reverted', reason: 'COMMIT_FAILED_REVERTED' },
        { status: 'failed', reason: 'RUN_ABORTED' },
        { status: 'failed', reason: 'RUN_ABORTED' },
      ],
      recovery: {
        status: 'completed',
        restoredPaths: ['package.json'],
        unrecoveredPaths: [],
      },
    })
    expect(capturedAttempts()).toEqual([true, false, false])
    expectManifestBytes(fixture.manifests, originalBytes)
    expect(existsSync(join(fixture.root, '.depfresh'))).toBe(false)
  })

  it('preserves external bytes and retained evidence after partial recovery', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    const external = Buffer.from('{"dependencies":{"alpha":"^1.0.9"}}\n')
    applyRuntime.overrides = {
      checkpoint(name, context) {
        if (name === 'after-replace' && context.index === 0) throw new Error('commit fault')
        if (name === 'before-recover' && context.index === 0) {
          writeFileSync(fixture.manifests[0]!, external)
        }
      },
    }

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Write failed')
    expect(result.output).toContain('RECOVERY_FAILED')
    expect(capturedApplyResult()).toMatchObject({
      status: 'failed',
      recovery: {
        status: 'partial',
        restoredPaths: [],
        unrecoveredPaths: ['package.json'],
        journalId: expect.any(String),
      },
    })
    expect(capturedAttempts()).toEqual([true, false, false])
    expect(readFileSync(fixture.manifests[0]!)).toEqual(external)
    expect(readFileSync(fixture.manifests[1]!)).toEqual(originalBytes[1])
    expect(readFileSync(fixture.manifests[2]!)).toEqual(originalBytes[2])
    expectRetainedRecovery(fixture.root)
  })

  it('reports unknown recovery when the attempted target disappears', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    applyRuntime.overrides = {
      checkpoint(name, context) {
        if (name === 'after-replace' && context.index === 0) throw new Error('commit fault')
        if (name === 'before-recover' && context.index === 0) unlinkSync(fixture.manifests[0]!)
      },
    }

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Unknown result')
    expect(capturedApplyResult()).toMatchObject({
      status: 'unknown',
      recovery: {
        status: 'unknown',
        restoredPaths: [],
        unrecoveredPaths: ['package.json'],
        journalId: expect.any(String),
      },
    })
    expect(capturedAttempts()).toEqual([true, false, false])
    expect(existsSync(fixture.manifests[0]!)).toBe(false)
    expect(readFileSync(fixture.manifests[1]!)).toEqual(originalBytes[1])
    expect(readFileSync(fixture.manifests[2]!)).toEqual(originalBytes[2])
    expectRetainedRecovery(fixture.root)
  })

  it('reports orphan recovery evidence as unknown without changing or cleaning targets', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    const orphan = join(fixture.root, '.depfresh', 'runs', 'orphan-run')
    mkdirSync(orphan, { recursive: true })
    writeFileSync(join(orphan, 'journal.json'), '{}')

    const result = await runCheck(fixture.root, 'table')

    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Unknown result')
    expect(result.output).toContain('RECOVERY_REQUIRED')
    expect(result.output).not.toContain('Safety block · no files were changed')
    expect(capturedApplyResult()).toMatchObject({
      status: 'unknown',
      operations: [
        { status: 'unknown', reason: 'RECOVERY_REQUIRED' },
        { status: 'unknown', reason: 'RECOVERY_REQUIRED' },
        { status: 'unknown', reason: 'RECOVERY_REQUIRED' },
      ],
      recovery: { status: 'unknown' },
    })
    expect(capturedAttempts()).toEqual([false, false, false])
    expectManifestBytes(fixture.manifests, originalBytes)
    expect(existsSync(join(fixture.root, '.depfresh', 'apply.lock'))).toBe(false)
    expect(existsSync(join(orphan, 'journal.json'))).toBe(true)
  })

  it('retains signal evidence and blocks a fresh authoritative check without further mutation', async () => {
    const fixture = createWorkspace()
    const originalBytes = fixture.manifests.map((manifest) => readFileSync(manifest))
    const { createLegacyPlan } = await import('../apply/legacy-plan')
    const names = ['alpha', 'beta', 'gamma'] as const
    const selections = fixture.manifests.map((manifest, packageIndex) => ({
      packageIndex,
      pkg: packageMeta(manifest, `signal-${packageIndex}`),
      changes: [resolvedChange(names[packageIndex]!)],
    }))
    const plan = createLegacyPlan(fixture.root, selections).plan
    const planPath = join(fixture.root, 'signal-plan.json')
    const childPath = join(fixture.root, 'signal-apply.mjs')
    const marker = join(fixture.root, 'signal-replaced')
    writeFileSync(planPath, JSON.stringify(plan))
    const engineUrl = pathToFileURL(
      fileURLToPath(new URL('../apply/engine.ts', import.meta.url)),
    ).href
    const signalsUrl = pathToFileURL(
      fileURLToPath(new URL('../../cli/signals.ts', import.meta.url)),
    ).href
    writeFileSync(
      childPath,
      `import { readFileSync, writeFileSync } from 'node:fs'
import ${JSON.stringify(signalsUrl)}
import { applyPlanWithRuntime } from ${JSON.stringify(engineUrl)}
const plan = JSON.parse(readFileSync(${JSON.stringify(planPath)}, 'utf8'))
const authority = { write: true, install: false, update: false, execute: false, verifyCommand: false, globalWrite: false }
await applyPlanWithRuntime(plan, { cwd: ${JSON.stringify(fixture.root)} }, authority, {
  checkpoint(name, context) {
    if (name !== 'after-replace' || context.index !== 0) return
    writeFileSync(${JSON.stringify(marker)}, 'replaced')
    process.emit('SIGTERM', 'SIGTERM')
  },
})
`,
    )
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), childPath], {
      cwd: fixture.root,
      stdio: 'pipe',
      env: { ...process.env, HOME: join(fixture.root, '.home') },
    })
    const childExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => child.once('exit', (code, signal) => resolve({ code, signal })),
    )
    await expect(childExit).resolves.toEqual({ code: 143, signal: null })
    expect(readFileSync(marker, 'utf8')).toBe('replaced')
    expect(readDependency(fixture.manifests[0]!, 'alpha')).toBe('^1.0.1')
    expect(readFileSync(fixture.manifests[1]!)).toEqual(originalBytes[1])
    expect(readFileSync(fixture.manifests[2]!)).toEqual(originalBytes[2])
    const ownerPath = join(fixture.root, '.depfresh', 'apply.lock', 'owner.json')
    expect(existsSync(ownerPath)).toBe(true)
    const runs = join(fixture.root, '.depfresh', 'runs')
    const runId = readdirSync(runs)[0]!
    const journalPath = join(runs, runId, 'journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      targets: Array<{ file: string; backup: string; sourceHash: string }>
    }
    expect(readFileSync(journalPath, 'utf8')).not.toContain(fixture.root)
    expect(journal.targets.map(({ file }) => file)).toEqual([
      'package.json',
      'packages/a/package.json',
      'packages/b/package.json',
    ])
    const backupHashes = new Map<string, string>()
    for (const target of journal.targets) {
      expect(target.backup.startsWith('/')).toBe(false)
      const backupPath = join(fixture.root, target.backup)
      expect(existsSync(backupPath)).toBe(true)
      const backupHash = hashExactBytes(readFileSync(backupPath))
      expect(backupHash).toBe(target.sourceHash)
      backupHashes.set(target.backup, backupHash)
    }
    const crashBytes = fixture.manifests.map((manifest) => readFileSync(manifest))

    const followUp = await runCheck(fixture.root, 'table')

    expect(followUp.exitCode).toBe(2)
    expect(followUp.output).toContain('Unknown result')
    expect(followUp.output).toContain('RECOVERY_REQUIRED')
    expect(followUp.output).not.toContain('Safety block · no files were changed')
    expect(capturedApplyResult()).toMatchObject({
      status: 'unknown',
      operations: [
        { status: 'unknown', reason: 'RECOVERY_REQUIRED' },
        { status: 'unknown', reason: 'RECOVERY_REQUIRED' },
        { status: 'unknown', reason: 'RECOVERY_REQUIRED' },
      ],
      recovery: { status: 'unknown' },
    })
    expect(capturedAttempts()).toEqual([false, false, false])
    expectManifestBytes(fixture.manifests, crashBytes)
    expect(existsSync(ownerPath)).toBe(true)
    expect(existsSync(journalPath)).toBe(true)
    for (const [backup, hash] of backupHashes) {
      expect(hashExactBytes(readFileSync(join(fixture.root, backup)))).toBe(hash)
    }
  }, 30_000)

  function createWorkspace(): { root: string; manifests: string[] } {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'depfresh-command-apply-')))
    roots.push(root)
    const home = join(root, '.home')
    mkdirSync(home)
    process.env.HOME = home
    process.env.npm_config_userconfig = join(home, '.npmrc')
    writeFileSync(process.env.npm_config_userconfig, '\n')
    writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`)
    writeJson(join(root, 'package.json'), {
      name: 'command-apply-root',
      private: true,
      workspaces: ['packages/*'],
      dependencies: { alpha: '^1.0.0' },
    })
    const manifests = [join(root, 'package.json')]
    for (const [name, dependency] of [
      ['a', 'beta'],
      ['b', 'gamma'],
    ] as const) {
      const directory = join(root, 'packages', name)
      mkdirSync(directory, { recursive: true })
      const manifest = join(directory, 'package.json')
      writeJson(manifest, {
        name: `command-apply-${name}`,
        private: true,
        dependencies: { [dependency]: '^1.0.0' },
      })
      manifests.push(manifest)
    }
    return { root, manifests }
  }

  async function runCheck(
    cwd: string,
    output: 'json' | 'table',
  ): Promise<{
    exitCode: number
    output: string
    loadedPackages: number
    resolvedDependencies: number
    payload?: CheckPayload
  }> {
    const lines: string[] = []
    let loadedPackages = -1
    let resolvedDependencies = -1
    vi.spyOn(console, 'log').mockImplementation((...values) => lines.push(values.join(' ')))
    vi.spyOn(console, 'warn').mockImplementation((...values) => lines.push(values.join(' ')))
    vi.spyOn(console, 'error').mockImplementation((...values) => lines.push(values.join(' ')))
    const options: depfreshOptions = {
      ...(DEFAULT_OPTIONS as depfreshOptions),
      cwd,
      recursive: true,
      write: true,
      mode: 'patch',
      output,
      loglevel: output === 'json' ? 'silent' : 'info',
      timeout: 5_000,
      retries: 0,
      refreshCache: true,
      afterPackagesLoaded(packages) {
        loadedPackages = packages.length
      },
      afterPackagesEnd(packages) {
        resolvedDependencies = packages.reduce((total, pkg) => total + pkg.resolved.length, 0)
      },
    }
    const exitCode = await check(options)
    const rendered = lines.join('\n')
    return {
      exitCode,
      output: rendered,
      loadedPackages,
      resolvedDependencies,
      ...(output === 'json' ? { payload: JSON.parse(rendered) as CheckPayload } : {}),
    }
  }
})

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function readDependency(manifest: string, name: string): string | undefined {
  const raw = JSON.parse(readFileSync(manifest, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  return raw.dependencies?.[name]
}

function packageMeta(filepath: string, name: string): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath,
    deps: [],
    resolved: [],
    raw: JSON.parse(readFileSync(filepath, 'utf8')),
    indent: '  ',
  }
}

function resolvedChange(name: string): ResolvedDepChange {
  return {
    name,
    currentVersion: '^1.0.0',
    rawVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^1.0.1',
    diff: 'patch',
    pkgData: {
      name,
      versions: ['1.0.0', '1.0.1'],
      distTags: { latest: '1.0.1' },
    },
  }
}

function expectManifestBytes(manifests: readonly string[], expected: readonly Buffer[]): void {
  expect(manifests).toHaveLength(expected.length)
  for (let index = 0; index < manifests.length; index += 1) {
    expect(readFileSync(manifests[index]!)).toEqual(expected[index])
  }
}

function expectRetainedRecovery(root: string): void {
  expect(existsSync(join(root, '.depfresh', 'apply.lock', 'owner.json'))).toBe(true)
  const runs = join(root, '.depfresh', 'runs')
  const runId = readdirSync(runs)[0]
  expect(runId).toBeDefined()
  expect(existsSync(join(runs, runId!, 'journal.json'))).toBe(true)
}

function capturedApplyResult(): ApplyResult {
  expect(applyRuntime.result).toBeDefined()
  return applyRuntime.result as ApplyResult
}

function capturedAttempts(): boolean[] {
  return (applyRuntime.evidence as Array<{ replacementAttempted: boolean }>).map(
    ({ replacementAttempted }) => replacementAttempted,
  )
}

function initializeGit(git: string, root: string): void {
  for (const args of [
    ['init', '--quiet'],
    ['config', 'user.email', 'integration@example.invalid'],
    ['config', 'user.name', 'Integration Test'],
    ['add', '--', 'package.json', 'packages/a/package.json', 'packages/b/package.json'],
    ['commit', '--quiet', '-m', 'fixture'],
  ]) {
    execFileSync(git, args, { cwd: root, stdio: 'ignore' })
  }
}

function findExecutable(name: string): string {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, process.platform === 'win32' ? `${name}.exe` : name)
    if (existsSync(candidate)) return realpathSync.native(candidate)
  }
  throw new Error(`Missing executable: ${name}`)
}

async function startRegistry(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const name = decodeURIComponent(
      new URL(request.url ?? '/', 'http://registry.local').pathname.slice(1),
    )
    if (!['alpha', 'beta', 'gamma'].includes(name)) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    const latest = name === 'alpha' ? '1.0.2' : '1.0.1'
    response.end(
      JSON.stringify({
        name,
        versions: { '1.0.0': {}, '1.0.1': {}, ...(name === 'alpha' ? { '1.0.2': {} } : {}) },
        time: {
          '1.0.0': '2026-01-01T00:00:00.000Z',
          '1.0.1': '2026-01-02T00:00:00.000Z',
          ...(name === 'alpha' ? { '1.0.2': '2026-01-03T00:00:00.000Z' } : {}),
        },
        'dist-tags': { latest },
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Registry did not start')
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
