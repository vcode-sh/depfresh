import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
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
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import semver from 'semver'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../contracts/canonical-json'
import {
  createPlanFingerprint,
  createRepositoryFingerprint,
  hashExactBytes,
} from '../../contracts/fingerprint'
import type { PlanResult } from '../../contracts/schemas'
import { validateApplyResult, validatePlanResult } from '../../contracts/validate'
import { createRepositoryId } from '../../repository/identity'
import type { InvocationAuthority } from '../../types'
import { applyPlanWithRuntime } from './engine'
import { apply } from './index'
import { acquireApplyLock, defaultApplyRuntime, releaseApplyLock } from './lock'
import type { ApplyCheckpoint } from './types'

const roots: string[] = []

const authority: InvocationAuthority = {
  write: true,
  install: false,
  update: false,
  execute: false,
  processExecute: false,
  lockfileWrite: false,
  verifyCommand: false,
  globalWrite: false,
}

function temporaryRoot(prefix = 'depfresh-apply-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (existsSync(path)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Timed out waiting for ${path}`)
}

function initializeGit(root: string): void {
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'apply@example.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Apply Test'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root })
}

interface PlanFile {
  file: string
  content: string
  path: string[]
  name: string
  expectedValue: string
  requestedValue: string
}

function makePlan(
  files: PlanFile[],
  vcs: PlanResult['vcs'] = {
    status: 'unavailable',
    targetFiles: [],
    unrelatedDirtyPaths: [],
    diagnostics: [{ code: 'VCS_NOT_REPOSITORY', path: '.' }],
  },
): PlanResult {
  const identity = createRepositoryId('repository', '.')
  const uniqueFiles = [
    ...new Map(
      files.map((file) => [file.file, { file: file.file, content: file.content }]),
    ).values(),
  ]
  const sources = uniqueFiles.map((file) => ({
    path: file.file,
    byteHash: hashExactBytes(file.content),
  }))
  const sourceFiles = uniqueFiles.map((file, index) => ({
    id: `source-${index}`,
    path: file.file,
    format: file.file.endsWith('.json') ? ('json' as const) : ('yaml' as const),
    byteHash: sources[index]!.byteHash,
    parseState: 'parsed' as const,
    indent: '  ',
    newline: file.content.includes('\r\n') ? ('crlf' as const) : ('lf' as const),
    trailingNewline: file.content.endsWith('\n'),
  }))
  const packages = uniqueFiles.map((file, index) => ({
    id: `package-${index}`,
    sourceFileId: `source-${uniqueFiles.findIndex((source) => source.file === file.file)}`,
    path: file.file,
    workspacePath: dirname(file.file) === '.' ? '.' : dirname(file.file),
    name: `fixture-${index}`,
    private: false,
  }))
  const occurrences = files.map((file, index) => ({
    id: `occurrence-${index}`,
    ownerId: `package-${uniqueFiles.findIndex((source) => source.file === file.file)}`,
    sourceFileId: `source-${uniqueFiles.findIndex((source) => source.file === file.file)}`,
    file: file.file,
    name: file.name,
    path: file.path,
    field: file.path[0] ?? 'dependencies',
    role: 'dependency' as const,
    protocol: 'semver' as const,
    declaredValue: file.expectedValue,
    writeable: true,
  }))
  const operations = files.map((file, index) => {
    const base = {
      occurrenceId: `occurrence-${index}`,
      sourceFileId: `source-${uniqueFiles.findIndex((source) => source.file === file.file)}`,
      file: file.file,
      path: file.path,
      name: file.name,
      sourceByteHash: sources.find((source) => source.path === file.file)!.byteHash,
      expectedValue: file.expectedValue,
      requestedValue: file.requestedValue,
    }
    return {
      id: `operation-${hashExactBytes(canonicalJson(base)).slice(0, 24)}`,
      ...base,
    }
  })
  const decisions = operations.map((operation) => ({
    occurrenceId: operation.occurrenceId,
    status: 'operation' as const,
    reason: 'TARGET_SELECTED',
    operationId: operation.id,
    policy: {
      status: 'selected' as const,
      reason: 'POLICY_DEFAULT_INCLUDED' as const,
      action: 'include' as const,
      mode: 'default' as const,
      matchedRuleIds: [],
      indeterminateRuleIds: [],
    },
  }))
  const repository = {
    identity,
    fingerprint: createRepositoryFingerprint({
      schemaVersion: 1,
      rootIdentity: identity,
      sources,
    }),
    modelSchemaVersion: 1 as const,
    sources,
    boundaries: [],
    sourceFiles,
    packages,
    catalogs: [],
    runtimeDeclarations: [],
    relationships: {
      workspaceMembers: [],
      catalogConsumers: [],
      boundaryPackages: [],
      lockfileBoundaries: [],
    },
  }
  const semantic = {
    contract: 'depfresh.plan' as const,
    schemaVersion: 1 as const,
    toolVersion: '1.2.0',
    repository,
    asOf: '1970-01-01T00:00:00.000Z',
    occurrences,
    decisions,
    operations,
    execution: {
      mode: 'file-only' as const,
      status: 'ready' as const,
      timeoutMs: 120_000,
      targets: [],
    },
    evidence: [],
    lockfiles: [],
    vcs,
    diagnostics: [],
    risks: [],
    errors: [],
    requiredCapabilities: [
      'filesystem-read' as const,
      'registry-read' as const,
      'file-write' as const,
    ],
    summary: {
      total: operations.length,
      operations: operations.length,
      unchanged: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      errors: 0,
    },
  }
  return { ...semantic, planFingerprint: createPlanFingerprint(semantic) }
}

function withManagerExecution(
  plan: PlanResult,
  root: string,
  options: {
    mode?: 'sync-lockfile' | 'install'
    timeoutMs?: number
    verification?: { executable: string; args?: string[]; cwd?: string; timeoutMs?: number }
  } = {},
): PlanResult {
  const mode = options.mode ?? 'sync-lockfile'
  const boundaryId = 'boundary-root'
  const lockfileId = 'lockfile-root'
  const lockfilePath = 'package-lock.json'
  const lockfileHash = hashExactBytes(readFileSync(join(root, lockfilePath)))
  const adapter = {
    executable: 'npm' as const,
    args:
      mode === 'sync-lockfile'
        ? ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    lifecycle: 'disabled-by-flag' as const,
    permittedPaths: mode === 'sync-lockfile' ? [lockfilePath] : [lockfilePath, 'node_modules'],
    externalEffects:
      mode === 'sync-lockfile'
        ? (['package-manager-cache'] as const)
        : (['dependency-install-state', 'package-manager-cache'] as const),
  }
  const execution = {
    mode,
    status: 'ready' as const,
    timeoutMs: options.timeoutMs ?? 2_000,
    targets: [
      {
        boundaryId,
        boundaryPath: '.',
        manager: { name: 'npm' as const, version: '11.0.0' },
        lockfile: { id: lockfileId, path: lockfilePath, byteHash: lockfileHash },
        adapter: {
          ...adapter,
          externalEffects: [...adapter.externalEffects],
        },
      },
    ],
    ...(options.verification
      ? {
          verification: {
            executable: options.verification.executable,
            args: options.verification.args ?? [],
            cwd: options.verification.cwd ?? '.',
            timeoutMs: options.verification.timeoutMs ?? 2_000,
            permittedPaths: [],
          },
        }
      : {}),
  }
  const semantic = {
    ...plan,
    decisions: plan.decisions.map((decision) => {
      const operation = plan.operations.find((entry) => entry.id === decision.operationId)
      const targetVersion = operation ? semver.coerce(operation.requestedValue)?.version : undefined
      return targetVersion
        ? {
            ...decision,
            candidate: {
              reason: 'TARGET_SELECTED',
              eligibleVersions: [targetVersion],
              targetVersion,
            },
          }
        : decision
    }),
    repository: {
      ...plan.repository,
      boundaries: [
        { id: boundaryId, path: '.', classification: 'effective-root' as const, markers: [] },
      ],
    },
    execution,
    evidence: [
      {
        id: 'evidence-manager',
        kind: 'package-manager' as const,
        boundaryId,
        status: 'confirmed' as const,
        values: [{ name: 'npm', version: '11.0.0' }],
        sources: [],
        diagnostics: [],
      },
      {
        id: 'evidence-lockfile',
        kind: 'lockfile-selection' as const,
        boundaryId,
        status: 'confirmed' as const,
        values: [lockfileId],
        sources: [],
        diagnostics: [],
      },
    ],
    lockfiles: [
      {
        id: lockfileId,
        boundaryId,
        manager: 'npm' as const,
        path: lockfilePath,
        byteHash: lockfileHash,
        parseState: 'parsed' as const,
        formatVersion: '3',
      },
    ],
    requiredCapabilities: [
      'filesystem-read' as const,
      'registry-read' as const,
      'file-write' as const,
      'process-execute' as const,
      'lockfile-write' as const,
      ...(mode === 'install' ? (['install' as const] as const) : []),
      ...(options.verification ? (['verify-command' as const] as const) : []),
    ],
  }
  return { ...semantic, planFingerprint: createPlanFingerprint(semantic) }
}

function withForgedRequestedValue(plan: PlanResult, requestedValue: string): PlanResult {
  const operation = plan.operations[0]!
  const { id: _id, ...base } = operation
  const operationBase = { ...base, requestedValue }
  const forgedOperation = {
    id: `operation-${hashExactBytes(canonicalJson(operationBase)).slice(0, 24)}`,
    ...operationBase,
  }
  const semantic = {
    ...plan,
    operations: [forgedOperation],
    decisions: plan.decisions.map((decision) =>
      decision.operationId === operation.id
        ? { ...decision, operationId: forgedOperation.id }
        : decision,
    ),
  }
  return { ...semantic, planFingerprint: createPlanFingerprint(semantic) }
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${source}\n`)
  chmodSync(path, 0o755)
}

function managerAuthority(overrides: Partial<InvocationAuthority> = {}): InvocationAuthority {
  return {
    ...authority,
    processExecute: true,
    lockfileWrite: true,
    ...overrides,
  }
}

function withoutOperations(plan: PlanResult): PlanResult {
  const decisions = plan.decisions.map((entry) => {
    const { operationId: _operationId, candidate: _candidate, ...decision } = entry
    return { ...decision, status: 'unchanged' as const, reason: 'CURRENT_VALUE_SELECTED' }
  })
  const semantic = {
    ...plan,
    decisions,
    operations: [],
    requiredCapabilities: ['filesystem-read' as const, 'registry-read' as const],
    summary: {
      ...plan.summary,
      operations: 0,
      unchanged: decisions.length,
    },
  }
  return { ...semantic, planFingerprint: createPlanFingerprint(semantic) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('apply', () => {
  it('requires fresh matching manager-phase authority before touching files', async () => {
    const root = temporaryRoot('depfresh-apply-manager-authority-')
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )

    await expect(apply(plan, { cwd: root }, authority)).rejects.toMatchObject({
      reason: 'AUTHORITY_REQUIRED',
    })
    await expect(
      apply(plan, { cwd: root }, managerAuthority({ install: true })),
    ).rejects.toMatchObject({ reason: 'AUTHORITY_MISMATCH' })
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
    expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
  })

  it('rejects a self-fingerprinted manager plan for an unsupported occurrence protocol', async () => {
    const root = temporaryRoot('depfresh-apply-manager-protocol-forged-')
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    const ready = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const semantic = {
      ...ready,
      occurrences: ready.occurrences.map((occurrence) => ({
        ...occurrence,
        protocol: 'jsr' as const,
      })),
    }
    const forged = { ...semantic, planFingerprint: createPlanFingerprint(semantic) }

    await expect(apply(forged, { cwd: root }, managerAuthority())).rejects.toMatchObject({
      code: 'ERR_CONTRACT_VALIDATION',
    })
    expect(existsSync(join(root, '.depfresh')) ? readdirSync(join(root, '.depfresh')) : []).toEqual(
      [],
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
    expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
  })

  it('rejects self-fingerprinted protocol text and npm alias identity swaps', async () => {
    const root = temporaryRoot('depfresh-apply-manager-protocol-text-forged-')
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    const ready = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )

    for (const requestedValue of [
      'file:../outside',
      'workspace:^2.0.0',
      'jsr:@scope/alpha@^2.0.0',
    ]) {
      const forged = withForgedRequestedValue(ready, requestedValue)
      await expect(apply(forged, { cwd: root }, managerAuthority())).rejects.toMatchObject({
        code: 'ERR_CONTRACT_VALIDATION',
      })
    }

    const aliasContent = '{"name":"fixture","dependencies":{"alias":"npm:semver@7.6.0"}}\n'
    writeFileSync(join(root, 'package.json'), aliasContent)
    const aliasBase = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content: aliasContent,
          path: ['dependencies', 'alias'],
          name: 'alias',
          expectedValue: 'npm:semver@7.6.0',
          requestedValue: 'npm:semver@7.7.2',
        },
      ]),
      root,
    )
    const aliasSemantic = {
      ...aliasBase,
      occurrences: aliasBase.occurrences.map((occurrence) => ({
        ...occurrence,
        protocol: 'npm' as const,
      })),
    }
    const aliasReady = {
      ...aliasSemantic,
      planFingerprint: createPlanFingerprint(aliasSemantic),
    }
    expect(validatePlanResult(aliasReady)).toBe(true)

    const aliasSwap = withForgedRequestedValue(aliasReady, 'npm:evil@7.7.2')
    await expect(apply(aliasSwap, { cwd: root }, managerAuthority())).rejects.toMatchObject({
      code: 'ERR_CONTRACT_VALIDATION',
    })
    expect(existsSync(join(root, '.depfresh')) ? readdirSync(join(root, '.depfresh')) : []).toEqual(
      [],
    )
  })

  it('returns schema-valid manager phase evidence when an early stale source blocks apply', async () => {
    const root = temporaryRoot('depfresh-apply-manager-stale-source-')
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    writeFileSync(join(root, 'package.json'), '{"name":"changed"}\n')

    const result = await apply(plan, { cwd: root }, managerAuthority())

    expect(validateApplyResult(result)).toBe(true)
    expect(result.status).toBe('conflicted')
    expect(result.phases).toContainEqual(
      expect.objectContaining({ name: 'sync-lockfile', status: 'skipped' }),
    )
  })

  it('returns schema-valid manager phase evidence when the apply lock is held', async () => {
    const root = temporaryRoot('depfresh-apply-manager-held-lock-')
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const lock = acquireApplyLock(root, realpathSync.native(root), plan.planFingerprint, {
      ...defaultApplyRuntime,
      pid: process.pid,
    })
    expect('reason' in lock).toBe(false)
    if ('reason' in lock) return
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(validateApplyResult(result)).toBe(true)
      expect(result.status).toBe('conflicted')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ name: 'sync-lockfile', status: 'skipped' }),
      )
    } finally {
      releaseApplyLock(lock)
    }
  })

  it('blocks a wrong manager version before source replacement or lock creation', async () => {
    const root = temporaryRoot('depfresh-apply-manager-version-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(join(bin, 'npm'), `printf '10.9.0'`)
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).toBe('conflicted')
      expect(result.phases).toContainEqual(
        expect.objectContaining({
          name: 'manager-preflight',
          status: 'failed',
          reason: 'MANAGER_VERSION_MISMATCH',
        }),
      )
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
      expect(existsSync(join(root, '.depfresh'))).toBe(false)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('blocks lockfile drift before source replacement', async () => {
    const root = temporaryRoot('depfresh-apply-lockfile-drift-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(join(bin, 'npm'), `printf '11.0.0'`)
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    writeFileSync(join(root, 'package-lock.json'), '{"changed":true}\n')
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).toBe('conflicted')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ reason: 'LOCKFILE_PRECONDITION_MISMATCH' }),
      )
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
      expect(existsSync(join(root, '.depfresh'))).toBe(false)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('fails before source replacement when the manager version probe mutates the repository', async () => {
    const root = temporaryRoot('depfresh-apply-manager-version-mutation-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(join(bin, 'npm'), `printf 'mutated' > preflight-marker\nprintf '11.0.0'`)
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).not.toBe('applied')
      expect(result.phases).toContainEqual(
        expect.objectContaining({
          name: 'manager-preflight',
          status: 'failed',
          reason: 'MANAGER_PREFLIGHT_MUTATED_REPOSITORY',
        }),
      )
      expect(result.recovery.unrecoveredPaths).toContain('preflight-marker')
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('runs an exact lifecycle-disabled manager adapter while holding the apply transaction', async () => {
    const root = temporaryRoot('depfresh-apply-manager-success-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf '%s\\n' '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}},"synced":true}' > package-lock.json`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(validateApplyResult(result)).toBe(true)
      expect(result.status).toBe('applied')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ name: 'sync-lockfile', status: 'passed' }),
      )
      expect(result.requiredCapabilities).toEqual([
        'filesystem-read',
        'file-write',
        'process-execute',
        'lockfile-write',
      ])
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        dependencies: { alpha: '2.0.0' },
      })
      expect(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))).toMatchObject({
        synced: true,
      })
      expect(existsSync(join(root, '.depfresh'))).toBe(false)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('restores source and lockfile bytes when the manager exits nonzero', async () => {
    const root = temporaryRoot('depfresh-apply-manager-failure-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf 'partial' > package-lock.json
exit 19`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(validateApplyResult(result)).toBe(true)
      expect(result.status).toBe('unknown')
      expect(result.recovery).toMatchObject({
        status: 'unknown',
        restoredPaths: ['package-lock.json'],
        externalEffects: ['package-manager-cache'],
      })
      const phaseNames = result.phases.map((entry) => entry.name)
      expect(phaseNames.indexOf('sync-lockfile')).toBeLessThan(phaseNames.indexOf('recovery'))
      expect(phaseNames.indexOf('recovery')).toBeLessThan(phaseNames.indexOf('inspect'))
      expect(phaseNames.indexOf('inspect')).toBeLessThan(phaseNames.indexOf('cleanup'))
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
      expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
      expect(existsSync(join(root, '.depfresh'))).toBe(true)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('bounds the manager phase timeout and confirms process-group termination before recovery', async () => {
    const root = temporaryRoot('depfresh-apply-manager-timeout-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
while :; do sleep 1; done`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
      { timeoutMs: 200 },
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).toBe('unknown')
      expect(result.phases).toContainEqual(
        expect.objectContaining({
          name: 'sync-lockfile',
          status: 'failed',
          commands: [
            expect.objectContaining({
              termination: 'timeout',
              terminationConfirmed: true,
            }),
          ],
        }),
      )
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
      expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('runs only the fingerprinted verification argv and recovers when it fails', async () => {
    const root = temporaryRoot('depfresh-apply-verification-failure-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf '%s\\n' '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}},"synced":true}' > package-lock.json`,
    )
    writeExecutable(
      join(bin, 'verify-tool'),
      `[ "\${1:-}" = 'literal;not-a-shell' ] || exit 91
exit 7`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
      { verification: { executable: 'verify-tool', args: ['literal;not-a-shell'] } },
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority({ verifyCommand: true }))

      expect(validateApplyResult(result)).toBe(true)
      expect(result.status).toBe('unknown')
      expect(result.phases).toContainEqual(
        expect.objectContaining({
          name: 'verify',
          status: 'failed',
          commands: [
            expect.objectContaining({
              executable: 'verify-tool',
              args: ['literal;not-a-shell'],
              termination: 'exit',
              exitCode: 7,
            }),
          ],
        }),
      )
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
      expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('never reports success when a manager mutates an unplanned repository path', async () => {
    const root = temporaryRoot('depfresh-apply-manager-hostile-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf '%s\\n' '{"name":"fixture","dependencies":{"alpha":"2.0.0"},"hostileMutation":true}' > package.json`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(validateApplyResult(result)).toBe(true)
      expect(result.status).toBe('failed')
      expect(result.recovery.status).toBe('partial')
      expect(result.phases).toContainEqual(
        expect.objectContaining({
          name: 'sync-lockfile',
          status: 'failed',
          reason: 'UNEXPECTED_REPOSITORY_MUTATION',
        }),
      )
      expect(result.recovery.unrecoveredPaths).toContain('package.json')
      expect(existsSync(join(root, '.depfresh'))).toBe(true)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('never reports success when a manager mutates Git metadata', async () => {
    const root = temporaryRoot('depfresh-apply-manager-git-mutation-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
mkdir .git
printf 'hostile' > .git/depfresh-hostile`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).not.toBe('applied')
      expect(result.recovery.unrecoveredPaths).toContain('.git/depfresh-hostile')
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('rejects a malformed final lockfile even when the manager exits zero', async () => {
    const root = temporaryRoot('depfresh-apply-manager-malformed-lockfile-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf 'not a lockfile' > package-lock.json`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).not.toBe('applied')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ reason: 'LOCKFILE_FINAL_STATE_INVALID' }),
      )
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('rejects a parsed but unsynchronized lockfile when the manager exits zero', async () => {
    const root = temporaryRoot('depfresh-apply-manager-stale-lockfile-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile =
      '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"1.0.0"}}}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
exit 0`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).not.toBe('applied')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ reason: 'LOCKFILE_FINAL_STATE_INVALID' }),
      )
      expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('restores an atomically replaced lockfile when its observed identity remains unchanged', async () => {
    const root = temporaryRoot('depfresh-apply-lockfile-identity-recovery-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
rm package-lock.json
printf 'foreign replacement' > package-lock.json
exit 17`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).toBe('unknown')
      expect(result.recovery.restoredPaths).toContain('package-lock.json')
      expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toContain('lockfileVersion')
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('fails unknown and retains evidence when a manager removes apply ownership', async () => {
    const root = temporaryRoot('depfresh-apply-manager-lock-loss-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
rm -rf .depfresh/apply.lock`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(result.status).toBe('unknown')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ reason: 'APPLY_OWNERSHIP_LOST', status: 'unknown' }),
      )
      expect(existsSync(join(root, '.depfresh', 'runs'))).toBe(true)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('blocks install when the dependency tree root escapes through a symlink', async () => {
    const root = temporaryRoot('depfresh-apply-install-symlink-')
    const outside = temporaryRoot('depfresh-apply-install-outside-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    symlinkSync(outside, join(root, 'node_modules'))
    writeExecutable(join(bin, 'npm'), `printf '11.0.0'`)
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
      { mode: 'install' },
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority({ install: true }))

      expect(result.status).toBe('unknown')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ reason: 'INSTALL_STATE_UNSAFE' }),
      )
      expect(readdirSync(outside)).toEqual([])
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('fails unknown when install creates an escaping dependency-tree symlink', async () => {
    const root = temporaryRoot('depfresh-apply-install-created-symlink-')
    const outside = temporaryRoot('depfresh-apply-install-created-outside-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
ln -s ${JSON.stringify(outside)} node_modules
printf 'escaped' > node_modules/marker
printf '%s\\n' '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}}}' > package-lock.json`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
      { mode: 'install' },
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority({ install: true }))

      expect(result.status).toBe('unknown')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ reason: 'INSTALL_STATE_UNSAFE', status: 'unknown' }),
      )
      expect(readFileSync(join(outside, 'marker'), 'utf8')).toBe('escaped')
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('observes late repository mutation from a detached manager descendant', async () => {
    const root = temporaryRoot('depfresh-apply-manager-detached-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    const lateScript = `setTimeout(() => require('node:fs').writeFileSync('late-marker', 'late'), 1500)`
    const detachScript = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(lateScript)}], { detached: true, stdio: 'ignore' }).unref()`,
    ].join(';')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
node -e ${JSON.stringify(detachScript)}
printf '%s\\n' '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}}}' > package-lock.json`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_700))

      expect(result.status).not.toBe('applied')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ reason: 'MANAGER_PHASE_PROCESS_DESCENDANTS_SURVIVED' }),
      )
      expect(existsSync(join(root, 'late-marker'))).toBe(false)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('recovers an atomic lockfile update after exact verification fails', async () => {
    const root = temporaryRoot('depfresh-apply-atomic-lockfile-recovery-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf '%s\\n' '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}}}' > next-lock
mv next-lock package-lock.json`,
    )
    writeExecutable(join(bin, 'verify-tool'), `exit 7`)
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
      { verification: { executable: 'verify-tool' } },
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority({ verifyCommand: true }))

      expect(result.status).toBe('unknown')
      expect(result.recovery.restoredPaths).toContain('package-lock.json')
      expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('recovers the exact lockfile identity written by a failing verification command', async () => {
    const root = temporaryRoot('depfresh-apply-verification-lockfile-recovery-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    const lockfile = '{"name":"fixture","lockfileVersion":3}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), lockfile)
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf '%s\\n' '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}}}' > package-lock.json`,
    )
    writeExecutable(
      join(bin, 'verify-tool'),
      `printf '%s\\n' '{"name":"foreign","lockfileVersion":3}' > verification-lock
mv verification-lock package-lock.json
exit 7`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
      { verification: { executable: 'verify-tool' } },
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority({ verifyCommand: true }))

      expect(result.status).toBe('unknown')
      expect(result.recovery.restoredPaths).toContain('package-lock.json')
      expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lockfile)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('never executes verification from a symlinked working directory outside the repository', async () => {
    const root = temporaryRoot('depfresh-apply-verification-cwd-')
    const outside = temporaryRoot('depfresh-apply-verification-outside-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    symlinkSync(outside, join(root, 'outside-link'))
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
printf '%s\\n' '{"name":"fixture","lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}},"synced":true}' > package-lock.json`,
    )
    writeExecutable(join(bin, 'verify-tool'), `printf 'escaped' > marker`)
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
      { verification: { executable: 'verify-tool', cwd: 'outside-link' } },
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority({ verifyCommand: true }))

      expect(result.status).not.toBe('applied')
      expect(existsSync(join(outside, 'marker'))).toBe(false)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('retains recovery evidence when a hostile lockfile replacement cannot be restored safely', async () => {
    const root = temporaryRoot('depfresh-apply-lockfile-recovery-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const outside = join(tmpdir(), `depfresh-lockfile-outside-${process.pid}-${Date.now()}`)
    writeFileSync(outside, 'outside')
    const content = '{"name":"fixture","dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(root, 'package.json'), content)
    writeFileSync(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n')
    writeExecutable(
      join(bin, 'npm'),
      `if [ "\${1:-}" = '--version' ]; then printf '11.0.0'; exit 0; fi
rm package-lock.json
ln -s ${JSON.stringify(outside)} package-lock.json
exit 17`,
    )
    const plan = withManagerExecution(
      makePlan([
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ]),
      root,
    )
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    try {
      const result = await apply(plan, { cwd: root }, managerAuthority())

      expect(validateApplyResult(result)).toBe(true)
      expect(result.status).toBe('unknown')
      expect(result.recovery.unrecoveredPaths).toContain('package-lock.json')
      expect(result.phases).toContainEqual(
        expect.objectContaining({ name: 'recovery', status: 'unknown' }),
      )
      expect(lstatSync(join(root, 'package-lock.json')).isSymbolicLink()).toBe(true)
      expect(readFileSync(outside, 'utf8')).toBe('outside')
      expect(existsSync(join(root, '.depfresh'))).toBe(true)
    } finally {
      process.env.PATH = originalPath
      rmSync(outside, { force: true })
    }
  })

  it('applies an immutable plan and reports only observed final values', async () => {
    const root = temporaryRoot()
    const content =
      '{\r\n  "name": "fixture",\r\n  "dependencies": {\r\n    "alpha": "^1.0.0"\r\n  }\r\n}\r\n'
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '^1.0.0',
        requestedValue: '^1.1.0',
      },
    ])

    const result = await apply(plan, { cwd: root }, authority)

    expect(validateApplyResult(result)).toBe(true)
    expect(result).toMatchObject({
      contract: 'depfresh.apply',
      status: 'applied',
      planFingerprint: plan.planFingerprint,
      summary: { planned: 1, applied: 1, conflicted: 0, unknown: 0 },
      operations: [
        {
          operationId: plan.operations[0]!.id,
          status: 'applied',
          reason: 'APPLIED',
          observedValue: '^1.1.0',
        },
      ],
      recovery: { status: 'not-needed' },
    })
    const final = readFileSync(join(root, 'package.json'), 'utf8')
    expect(final).toContain('\r\n')
    expect(final).toContain('"alpha": "^1.1.0"')
    expect(final.endsWith('\r\n')).toBe(true)
  })

  it('rejects missing invocation authority before creating state or changing bytes', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    await expect(apply(plan, { cwd: root }, { ...authority, write: false })).rejects.toMatchObject({
      reason: 'AUTHORITY_REQUIRED',
    })
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
  })

  it('validates the root and repository identity even for an operation-free plan', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    const base = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    const noOperations = withoutOperations(base)

    await expect(
      apply(noOperations, { cwd: join(root, 'missing') }, authority),
    ).rejects.toMatchObject({ reason: 'INVALID_CONFIG' })

    const forgedRepository = {
      ...noOperations.repository,
      identity: 'forged-repository',
      fingerprint: createRepositoryFingerprint({
        schemaVersion: noOperations.repository.modelSchemaVersion,
        rootIdentity: 'forged-repository',
        sources: noOperations.repository.sources,
      }),
    }
    const forgedSemantic = { ...noOperations, repository: forgedRepository }
    const forged = {
      ...forgedSemantic,
      planFingerprint: createPlanFingerprint(forgedSemantic),
    }
    await expect(apply(forged, { cwd: root }, authority)).rejects.toMatchObject({
      reason: 'INVALID_CONFIG',
    })
  })

  it('treats any stale target as a run-level conflict with zero replacements', async () => {
    const root = temporaryRoot()
    const first = '{"dependencies":{"alpha":"1.0.0"}}'
    const second = '{"dependencies":{"beta":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), first)
    mkdirSync(join(root, 'packages', 'b'), { recursive: true })
    writeFileSync(join(root, 'packages', 'b', 'package.json'), second)
    const plan = makePlan([
      {
        file: 'package.json',
        content: first,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
      {
        file: 'packages/b/package.json',
        content: second,
        path: ['dependencies', 'beta'],
        name: 'beta',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    writeFileSync(join(root, 'packages', 'b', 'package.json'), second.replace('1.0.0', '1.0.1'))

    const result = await apply(plan, { cwd: root }, authority)

    expect(result.status).toBe('conflicted')
    expect(result.summary.applied).toBe(0)
    expect(result.summary.conflicted).toBe(2)
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(first)
  })

  it('blocks a dirty target but ignores and preserves unrelated dirt', async () => {
    const cleanRoot = temporaryRoot('depfresh-apply-unrelated-')
    const content = '{"dependencies":{"alpha":"1.0.0"}}\n'
    writeFileSync(join(cleanRoot, 'package.json'), content)
    writeFileSync(join(cleanRoot, 'notes.txt'), 'clean\n')
    initializeGit(cleanRoot)
    const cleanPlan = makePlan(
      [
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ],
      {
        status: 'confirmed',
        shallow: false,
        targetFiles: [{ path: 'package.json', state: 'clean' }],
        unrelatedDirtyPaths: [],
        diagnostics: [],
      },
    )
    writeFileSync(join(cleanRoot, 'notes.txt'), 'dirty but unrelated\n')

    const applied = await apply(cleanPlan, { cwd: cleanRoot }, authority)

    expect(applied.status).toBe('applied')
    expect(readFileSync(join(cleanRoot, 'notes.txt'), 'utf8')).toBe('dirty but unrelated\n')

    const dirtyRoot = temporaryRoot('depfresh-apply-dirty-')
    writeFileSync(join(dirtyRoot, 'package.json'), content)
    initializeGit(dirtyRoot)
    const dirtyPlan = makePlan(
      [
        {
          file: 'package.json',
          content,
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
        },
      ],
      {
        status: 'confirmed',
        shallow: false,
        targetFiles: [{ path: 'package.json', state: 'clean' }],
        unrelatedDirtyPaths: [],
        diagnostics: [],
      },
    )
    chmodSync(join(dirtyRoot, 'package.json'), 0o755)

    const blocked = await apply(dirtyPlan, { cwd: dirtyRoot }, authority)

    expect(blocked.status).toBe('conflicted')
    expect(blocked.operations[0]?.reason).toBe('TARGET_DIRTY')
    expect(readFileSync(join(dirtyRoot, 'package.json'), 'utf8')).toBe(content)
  })

  it('blocks a target whose physical path escapes through a symlink', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot('depfresh-apply-outside-')
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(outside, 'package.json'), content)
    symlinkSync(outside, join(root, 'linked'))
    const plan = makePlan([
      {
        file: 'linked/package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await apply(plan, { cwd: root }, authority)

    expect(result.status).toBe('conflicted')
    expect(result.operations[0]?.reason).toBe('TARGET_NOT_CONTAINED')
    expect(readFileSync(join(outside, 'package.json'), 'utf8')).toBe(content)
  })

  it('rejects forged fingerprints and non-public operation data before lock acquisition', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"token=supersecret"}}'
    writeFileSync(join(root, 'package.json'), content)
    const sensitive = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: 'token=supersecret',
        requestedValue: '2.0.0',
      },
    ])

    await expect(apply(sensitive, { cwd: root }, authority)).rejects.toMatchObject({
      reason: 'INVALID_CONFIG',
    })
    const safeContent = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), safeContent)
    const safe = makePlan([
      {
        file: 'package.json',
        content: safeContent,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    await expect(
      apply({ ...safe, planFingerprint: '0'.repeat(64) }, { cwd: root }, authority),
    ).rejects.toMatchObject({ code: 'ERR_CONTRACT_VALIDATION' })
    expect(existsSync(join(root, '.depfresh')) ? readdirSync(join(root, '.depfresh')) : []).toEqual(
      [],
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(safeContent)
  })

  it('renders multiple operations for one physical file exactly once', async () => {
    const root = temporaryRoot()
    const content = `${JSON.stringify(
      { dependencies: { alpha: '1.0.0', beta: '1.0.0' } },
      null,
      4,
    )}\n`
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'beta'],
        name: 'beta',
        expectedValue: '1.0.0',
        requestedValue: '3.0.0',
      },
    ])

    const result = await apply(plan, { cwd: root }, authority)

    expect(result.summary).toMatchObject({ planned: 2, applied: 2 })
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies).toEqual({
      alpha: '2.0.0',
      beta: '3.0.0',
    })
    expect(existsSync(join(root, '.depfresh')) ? readdirSync(join(root, '.depfresh')) : []).toEqual(
      [],
    )
    expect(readdirSync(root).filter((name) => name.includes('.depfresh-'))).toEqual([])
  })

  it('preserves YAML comments, line endings, and trailing newline', async () => {
    const root = temporaryRoot()
    const content = '# keep this\r\ndependencies:\r\n  alpha: 1.0.0\r\n'
    const path = join(root, 'package.yaml')
    writeFileSync(path, content, { mode: 0o640 })
    const plan = makePlan([
      {
        file: 'package.yaml',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await apply(plan, { cwd: root }, authority)
    const final = readFileSync(path, 'utf8')

    expect(result.status).toBe('applied')
    expect(final).toContain('# keep this\r\n')
    expect(final).toContain('alpha: 2.0.0\r\n')
    expect(final.endsWith('\r\n')).toBe(true)
  })

  it('blocks hard-linked targets whose physical identity is ambiguous', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    linkSync(target, join(root, 'alias.json'))
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await apply(plan, { cwd: root }, authority)

    expect(result.status).toBe('conflicted')
    expect(result.operations[0]?.reason).toBe('TARGET_IDENTITY_AMBIGUOUS')
    expect(readFileSync(target, 'utf8')).toBe(content)
  })

  it('blocks a hard link introduced after staging with zero replacements', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name === 'before-precommit') linkSync(target, join(root, 'late-alias.json'))
      },
    })

    expect(result.status).toBe('conflicted')
    expect(result.operations[0]?.reason).toBe('SOURCE_CHANGED')
    expect(readFileSync(target, 'utf8')).toBe(content)
  })

  it('rejects a pre-existing symlinked journal root without writing outside the repository', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot('depfresh-apply-journal-outside-')
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    mkdirSync(join(root, '.depfresh'))
    symlinkSync(outside, join(root, '.depfresh', 'runs'))
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await apply(plan, { cwd: root }, authority)

    expect(result.status).toBe('unknown')
    expect(result.operations[0]?.reason).toBe('RECOVERY_REQUIRED')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
    expect(readdirSync(outside)).toEqual([])
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(false)
  })

  it('rechecks every target after staging and performs zero replacements on an inode swap', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let swapped = false

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name !== 'before-precommit' || swapped) return
        swapped = true
        const replacement = join(root, 'replacement.json')
        writeFileSync(replacement, content)
        renameSync(replacement, target)
      },
    })

    expect(result.status).toBe('conflicted')
    expect(result.operations[0]?.reason).toBe('SOURCE_CHANGED')
    expect(readFileSync(target, 'utf8')).toBe(content)
    expect(existsSync(join(root, '.depfresh'))).toBe(false)
  })

  it('rejects tampered staged bytes before the replacement boundary', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let replacements = 0

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name !== 'before-precommit') return
        const stage = readdirSync(root).find((entry) => entry.endsWith('.stage'))
        if (!stage) throw new Error('stage fixture missing')
        writeFileSync(join(root, stage), '{"dependencies":{"alpha":"9.9.9"}}')
      },
      rename(source, destination) {
        if (destination === target) replacements += 1
        renameSync(source, destination)
      },
    })

    expect(result.status).toBe('conflicted')
    expect(result.operations[0]?.reason).toBe('STAGED_SOURCE_CHANGED')
    expect(replacements).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(content)
  })

  it('does not overwrite a target changed at the final before-replace boundary', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const external = '{"dependencies":{"alpha":"1.0.1"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let targetRenames = 0

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name === 'before-replace') writeFileSync(target, external)
      },
      rename(source, destination) {
        if (destination === target) targetRenames += 1
        renameSync(source, destination)
      },
    })

    expect(result.status).toBe('conflicted')
    expect(result.operations[0]?.reason).toBe('SOURCE_CHANGED')
    expect(targetRenames).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(external)
    expect(existsSync(join(root, '.depfresh'))).toBe(false)
  })

  it('retains evidence when a zero-replacement conflict cannot clean an unowned backup', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const external = '{"dependencies":{"alpha":"1.0.1"}}'
    const unowned = 'unowned-backup-bytes'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let backupPath = ''
    let targetRenames = 0

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name !== 'before-replace') return
        writeFileSync(target, external)
        const backup = readdirSync(root).find((entry) => entry.endsWith('.backup'))
        if (!backup) throw new Error('backup fixture missing')
        backupPath = join(root, backup)
        renameSync(backupPath, `${backupPath}.displaced`)
        writeFileSync(backupPath, unowned)
      },
      rename(source, destination) {
        if (destination === target) targetRenames += 1
        renameSync(source, destination)
      },
    })

    expect(result.status).toBe('unknown')
    expect(result.operations[0]?.reason).toBe('CLEANUP_INCOMPLETE')
    expect(result.recovery.status).toBe('unknown')
    expect(result.recovery.journalId).toBeDefined()
    expect(targetRenames).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(external)
    expect(readFileSync(backupPath, 'utf8')).toBe(unowned)
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(true)
    expect(
      existsSync(join(root, '.depfresh', 'runs', result.recovery.journalId!, 'journal.json')),
    ).toBe(true)
  })

  it('never reports success when the committed target becomes a symlink before observation', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot('depfresh-apply-observation-outside-')
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const requested = JSON.stringify({ dependencies: { alpha: '2.0.0' } }, null, 2)
    const target = join(root, 'package.json')
    const outsideTarget = join(outside, 'package.json')
    writeFileSync(target, content)
    writeFileSync(outsideTarget, requested)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let swapped = false

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name !== 'before-final-observation' || swapped) return
        swapped = true
        renameSync(target, join(root, 'displaced.json'))
        symlinkSync(outsideTarget, target)
      },
    })

    expect(result.status).toBe('unknown')
    expect(result.summary.applied).toBe(0)
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
    expect(readFileSync(outsideTarget, 'utf8')).toBe(requested)
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(true)
  })

  it('redacts hostile observed values after a final-state race', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let changed = false

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name !== 'before-final-observation' || changed) return
        changed = true
        writeFileSync(target, '{"dependencies":{"alpha":"NPM_TOKEN=do-not-leak"}}')
      },
    })
    const serialized = JSON.stringify(result)

    expect(result.status).toBe('failed')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('do-not-leak')
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(true)
  })

  it('retains lock and backup evidence when the journal inode changes before cleanup', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const unowned = '{"unowned":true}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let journalPath = ''
    let backupPath = ''

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name !== 'before-final-observation') return
        const runs = join(root, '.depfresh', 'runs')
        const runId = readdirSync(runs)[0]
        if (!runId) throw new Error('run fixture missing')
        journalPath = join(runs, runId, 'journal.json')
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          targets: Array<{ backup: string }>
        }
        backupPath = join(root, journal.targets[0]!.backup)
        renameSync(journalPath, `${journalPath}.displaced`)
        writeFileSync(journalPath, unowned)
      },
    })

    expect(result.status).toBe('unknown')
    expect(result.operations[0]?.reason).toBe('CLEANUP_INCOMPLETE')
    expect(result.recovery.journalId).toBeDefined()
    expect(readFileSync(journalPath, 'utf8')).toBe(unowned)
    expect(existsSync(backupPath)).toBe(true)
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf8')).dependencies.alpha).toBe('2.0.0')
  })

  it.each([
    'after-stage-write',
    'after-stage-fsync',
    'after-stage-validation',
    'after-backup-fsync',
    'after-journal-prepared',
  ] as ApplyCheckpoint[])('cleans every staged artifact when %s fails', async (fault) => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name === fault) throw new Error('injected stage failure')
      },
    })

    expect(result.status).toBe('failed')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
    expect(existsSync(join(root, '.depfresh'))).toBe(false)
    expect(readdirSync(root).filter((name) => name.includes('.depfresh-'))).toEqual([])
  })

  it.each([
    'after-replace',
    'after-directory-fsync',
    'after-journal-replaced',
  ] as ApplyCheckpoint[])('recovers exact bytes when %s fails', async (fault) => {
    const root = temporaryRoot()
    const first = '{"dependencies":{"alpha":"1.0.0"}}'
    const second = '{"dependencies":{"beta":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), first)
    mkdirSync(join(root, 'packages'))
    writeFileSync(join(root, 'packages', 'package.json'), second)
    const plan = makePlan([
      {
        file: 'package.json',
        content: first,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
      {
        file: 'packages/package.json',
        content: second,
        path: ['dependencies', 'beta'],
        name: 'beta',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name, context) {
        if (name === fault && context.index === 0) throw new Error('injected commit failure')
      },
    })

    expect(result.summary.applied).toBe(0)
    expect(result.recovery.status).toBe('completed')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(first)
    expect(readFileSync(join(root, 'packages', 'package.json'), 'utf8')).toBe(second)
    expect(existsSync(join(root, '.depfresh'))).toBe(false)
  })

  it('blocks live and malformed locks but reclaims a definitely dead owner without a journal', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    const lockPath = join(root, '.depfresh', 'apply.lock')
    mkdirSync(lockPath, { recursive: true })
    const owner = {
      version: 1,
      runId: 'existing-run',
      token: 'existing-token',
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
      rootHash: hashExactBytes(realpathSync.native(root)),
      planFingerprint: plan.planFingerprint,
      journal: 'runs/existing-run/journal.json',
    }
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify(owner))

    const live = await apply(plan, { cwd: root }, authority)
    expect(live.status).toBe('conflicted')
    expect(live.operations[0]?.reason).toBe('LOCK_HELD')

    writeFileSync(join(lockPath, 'owner.json'), '{}')
    const malformed = await apply(plan, { cwd: root }, authority)
    expect(malformed.status).toBe('unknown')
    expect(malformed.operations[0]?.reason).toBe('LOCK_OWNER_UNKNOWN')

    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ ...owner, pid: 999_999 }))
    const reclaimed = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      isProcessAlive: () => 'dead',
    })
    expect(reclaimed.status).toBe('applied')
    expect(existsSync(join(root, '.depfresh'))).toBe(false)
  })

  it('never deletes a successor lock installed during stale-owner reclamation', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    const stateRoot = join(root, '.depfresh')
    const lockPath = join(stateRoot, 'apply.lock')
    mkdirSync(lockPath, { recursive: true })
    const owner = (runId: string, token: string, pid: number) => ({
      version: 1,
      runId,
      token,
      pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
      rootHash: hashExactBytes(realpathSync.native(root)),
      planFingerprint: plan.planFingerprint,
      journal: `runs/${runId}/journal.json`,
    })
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify(owner('dead-run', 'dead-token', 99)))
    let installed = false

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      isProcessAlive() {
        if (!installed) {
          installed = true
          const displaced = join(stateRoot, 'displaced-dead-lock')
          renameSync(lockPath, displaced)
          mkdirSync(lockPath)
          writeFileSync(
            join(lockPath, 'owner.json'),
            JSON.stringify(owner('successor-run', 'successor-token', process.pid)),
          )
          rmSync(displaced, { recursive: true })
        }
        return 'dead'
      },
    })

    expect(result.status).toBe('unknown')
    expect(result.operations[0]?.reason).toBe('LOCK_OWNER_UNKNOWN')
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'))).toMatchObject({
      runId: 'successor-run',
      token: 'successor-token',
    })
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
  })

  it('treats a symlinked lock directory as unknown and never reclaims its owner', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot('depfresh-apply-lock-outside-')
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    mkdirSync(join(root, '.depfresh'))
    const owner = {
      version: 1,
      runId: 'outside-run',
      token: 'outside-token',
      pid: 999_999,
      host: hostname(),
      startedAt: new Date().toISOString(),
      rootHash: hashExactBytes(realpathSync.native(root)),
      planFingerprint: plan.planFingerprint,
      journal: 'runs/outside-run/journal.json',
    }
    writeFileSync(join(outside, 'owner.json'), JSON.stringify(owner))
    symlinkSync(outside, join(root, '.depfresh', 'apply.lock'))

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      isProcessAlive: () => 'dead',
    })

    expect(result.status).toBe('unknown')
    expect(result.operations[0]?.reason).toBe('LOCK_OWNER_UNKNOWN')
    expect(lstatSync(join(root, '.depfresh', 'apply.lock')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(outside, 'owner.json'), 'utf8')).toBe(JSON.stringify(owner))
  })

  it('recovers an already replaced file after a later commit boundary fails', async () => {
    const root = temporaryRoot()
    const first = '{"dependencies":{"alpha":"1.0.0"}}'
    const second = '{"dependencies":{"beta":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), first)
    mkdirSync(join(root, 'packages'))
    writeFileSync(join(root, 'packages', 'package.json'), second)
    const plan = makePlan([
      {
        file: 'package.json',
        content: first,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
      {
        file: 'packages/package.json',
        content: second,
        path: ['dependencies', 'beta'],
        name: 'beta',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name, context) {
        if (name === 'after-replace' && context.index === 0)
          throw new Error('injected commit failure')
      },
    })

    expect(result.status).toBe('failed')
    expect(result.operations.map((operation) => operation.status)).toEqual(['reverted', 'failed'])
    expect(result.recovery.status).toBe('completed')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(first)
    expect(readFileSync(join(root, 'packages', 'package.json'), 'utf8')).toBe(second)
    expect(existsSync(join(root, '.depfresh'))).toBe(false)
  })

  it('does not overwrite an external target change during recovery', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const external = '{"dependencies":{"alpha":"7.7.7"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let backupRenames = 0

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name === 'after-replace') throw new Error('force recovery')
        if (name === 'before-recover') writeFileSync(target, external)
      },
      rename(source, destination) {
        if (source.endsWith('.backup') && destination === target) backupRenames += 1
        renameSync(source, destination)
      },
    })

    expect(result.status).toBe('failed')
    expect(result.operations[0]?.reason).toBe('RECOVERY_FAILED')
    expect(result.recovery.status).toBe('partial')
    expect(backupRenames).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(external)
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(true)
  })

  it('retains recovery evidence when the restored target gains a hard link before observation', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name === 'after-replace') throw new Error('force recovery')
        if (name === 'before-final-observation') linkSync(target, join(root, 'late-alias.json'))
      },
    })

    expect(result.status).toBe('unknown')
    expect(result.operations[0]?.reason).toBe('TARGET_IDENTITY_AMBIGUOUS')
    expect(result.recovery.status).toBe('unknown')
    expect(readFileSync(target, 'utf8')).toBe(content)
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(true)
  })

  it('retains relative recovery evidence and reports unknown final state honestly', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    let removeBeforeObservation = false

    const result = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      checkpoint(name) {
        if (name === 'after-replace') throw new Error('injected commit failure')
        if (name === 'before-final-observation' && removeBeforeObservation) unlinkSync(target)
      },
      rename(source, destination) {
        if (source.endsWith('.backup')) {
          removeBeforeObservation = true
          throw new Error('injected recovery failure')
        }
        renameSync(source, destination)
      },
    })

    expect(result.status).toBe('unknown')
    expect(result.operations[0]?.status).toBe('unknown')
    expect(result.recovery.status).toBe('partial')
    expect(result.recovery.journalId).toBeDefined()
    const journalPath = join(root, '.depfresh', 'runs', result.recovery.journalId!, 'journal.json')
    const journal = readFileSync(journalPath, 'utf8')
    expect(journal).not.toContain(root)
    expect(journal).toContain('"file": "package.json"')
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(true)
  })

  it('leaves durable crash evidence, blocks a second apply, and supports byte-exact manual recovery', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    const planPath = join(root, 'plan.json')
    const childPath = join(root, 'crash-apply.mjs')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    writeFileSync(planPath, JSON.stringify(plan))
    const engineUrl = pathToFileURL(fileURLToPath(new URL('./engine.ts', import.meta.url))).href
    writeFileSync(
      childPath,
      `import { readFileSync } from 'node:fs'
import { applyPlanWithRuntime } from ${JSON.stringify(engineUrl)}
const plan = JSON.parse(readFileSync(${JSON.stringify(planPath)}, 'utf8'))
const authority = { write: true, install: false, update: false, execute: false, verifyCommand: false, globalWrite: false }
await applyPlanWithRuntime(plan, { cwd: ${JSON.stringify(root)} }, authority, {
  checkpoint(name) { if (name === 'after-replace') process.exit(91) },
})
`,
    )

    const crashed = spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), childPath],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, HOME: join(root, 'home') },
      },
    )

    expect(crashed.status, crashed.stderr).toBe(91)
    expect(JSON.parse(readFileSync(target, 'utf8')).dependencies.alpha).toBe('2.0.0')
    const blocked = await applyPlanWithRuntime(plan, { cwd: root }, authority, {
      isProcessAlive: () => 'dead',
    })
    expect(blocked.status).toBe('unknown')
    expect(blocked.operations[0]?.reason).toBe('RECOVERY_REQUIRED')

    const runsRoot = join(root, '.depfresh', 'runs')
    const runId = readdirSync(runsRoot)[0]!
    const journal = JSON.parse(readFileSync(join(runsRoot, runId, 'journal.json'), 'utf8')) as {
      targets: Array<{ backup: string; sourceHash: string }>
    }
    const recovery = journal.targets[0]!
    expect(recovery.backup.startsWith('/')).toBe(false)
    expect(hashExactBytes(readFileSync(join(root, recovery.backup)))).toBe(recovery.sourceHash)
    renameSync(join(root, recovery.backup), target)
    expect(readFileSync(target, 'utf8')).toBe(content)
  })

  it('blocks orphan recovery evidence for mutating and operation-free plans', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    writeFileSync(join(root, 'package.json'), content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    const orphan = join(root, '.depfresh', 'runs', 'orphan-run')
    mkdirSync(orphan, { recursive: true })
    writeFileSync(join(orphan, 'journal.json'), '{}')

    const blocked = await apply(plan, { cwd: root }, authority)

    expect(blocked.status).toBe('unknown')
    expect(blocked.operations[0]?.reason).toBe('RECOVERY_REQUIRED')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content)
    expect(existsSync(join(root, '.depfresh', 'apply.lock'))).toBe(false)
    const operationFree = await apply(withoutOperations(plan), { cwd: root }, authority)
    expect(operationFree.status).toBe('unknown')
    expect(operationFree.phases).toContainEqual({
      name: 'preflight',
      status: 'unknown',
      reason: 'RECOVERY_REQUIRED',
    })
  })

  it('allows exactly one cross-process lock owner to replace files', async () => {
    const root = temporaryRoot()
    const content = '{"dependencies":{"alpha":"1.0.0"}}'
    const target = join(root, 'package.json')
    const planPath = join(root, 'plan.json')
    const childPath = join(root, 'slow-apply.mjs')
    const marker = join(root, 'locked')
    writeFileSync(target, content)
    const plan = makePlan([
      {
        file: 'package.json',
        content,
        path: ['dependencies', 'alpha'],
        name: 'alpha',
        expectedValue: '1.0.0',
        requestedValue: '2.0.0',
      },
    ])
    writeFileSync(planPath, JSON.stringify(plan))
    const engineUrl = pathToFileURL(fileURLToPath(new URL('./engine.ts', import.meta.url))).href
    writeFileSync(
      childPath,
      `import { readFileSync, writeFileSync } from 'node:fs'
import { applyPlanWithRuntime } from ${JSON.stringify(engineUrl)}
const plan = JSON.parse(readFileSync(${JSON.stringify(planPath)}, 'utf8'))
const authority = { write: true, install: false, update: false, execute: false, verifyCommand: false, globalWrite: false }
await applyPlanWithRuntime(plan, { cwd: ${JSON.stringify(root)} }, authority, {
  checkpoint(name) {
    if (name !== 'after-lock') return
    writeFileSync(${JSON.stringify(marker)}, 'locked')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200)
  },
})
`,
    )
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), childPath], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, HOME: join(root, 'home') },
    })
    const childExitPromise = new Promise<number | null>((resolvePromise) => {
      child.once('exit', (code) => resolvePromise(code))
    })
    await waitForFile(marker)

    const blocked = await apply(plan, { cwd: root }, authority)
    const childExit = await childExitPromise

    expect(blocked.status).toBe('conflicted')
    expect(blocked.operations[0]?.reason).toBe('LOCK_HELD')
    expect(childExit).toBe(0)
    expect(JSON.parse(readFileSync(target, 'utf8')).dependencies.alpha).toBe('2.0.0')
    expect(existsSync(join(root, '.depfresh'))).toBe(false)
  }, 30_000)
})
