import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  InvocationAuthority,
  PackageMeta,
  RepositoryDiagnosticCode,
  ResolvedDepChange,
  WriteOutcome,
  WriteOutcomeReason,
  WriteOutcomeStatus,
} from '../../types'
import { applyLegacyPackageWrite, type LegacyWriteDiagnostic } from '../apply/legacy'
import type { WriteReceiptExit } from './write-receipt'
import { buildWriteReceipt, formatWriteReceipt } from './write-receipt'

const root = '/repo'

function exit(
  code: WriteReceiptExit['code'],
  overrides: Partial<Omit<WriteReceiptExit, 'code'>> = {},
): WriteReceiptExit {
  return {
    code,
    strictResolutionFailed: false,
    globalWriteFailed: false,
    strictPostWriteFailed: false,
    ...overrides,
  }
}

function diagnostic(code: RepositoryDiagnosticCode, file: string): LegacyWriteDiagnostic {
  return {
    code,
    target: {
      identity: join(root, file),
      display: file,
    },
  }
}

function outcome(
  file: string,
  index: number,
  status: WriteOutcomeStatus,
  reason: WriteOutcomeReason,
): WriteOutcome {
  return {
    name: `dependency-${index}`,
    occurrence: { file, path: ['dependencies', `dependency-${index}`] },
    expectedValue: '1.0.0',
    requestedValue: '2.0.0',
    status,
    reason,
  }
}

describe('buildWriteReceipt', () => {
  it('groups a partial legacy run by physical target and exact preflight cause', () => {
    const blocked = Array.from({ length: 41 }, (_, index) =>
      outcome(join(root, 'package.json'), index, 'unknown', 'VCS_UNAVAILABLE'),
    )
    const applied = Array.from({ length: 35 }, (_, index) =>
      outcome(
        join(root, 'packages', `package-${index % 13}`, 'package.json'),
        index + 41,
        'applied',
        'APPLIED',
      ),
    )

    const receipt = buildWriteReceipt({
      outcomes: [...applied, ...blocked],
      diagnostics: [diagnostic('VCS_OUTPUT_LIMIT_EXCEEDED', 'package.json')],
      cwd: root,
    })

    expect(receipt.verdict).toBe('partial')
    expect(receipt.operations).toMatchObject({ applied: 35, unknown: 41, planned: 76 })
    expect(receipt.files).toMatchObject({ planned: 14, applied: 13, blocked: 1, unknown: 1 })
    expect(receipt.groups).toHaveLength(1)
    expect(receipt.groups[0]).toMatchObject({
      file: 'package.json',
      status: 'unknown',
      occurrences: 41,
      reason: 'VCS_UNAVAILABLE',
      diagnostic: 'VCS_OUTPUT_LIMIT_EXCEEDED',
      replacementAttempted: false,
    })
    expect(receipt.groups[0]?.details).toHaveLength(41)
  })

  it('recognizes a clean preflight safety block without claiming command atomicity', () => {
    const receipt = buildWriteReceipt({
      outcomes: [outcome(join(root, 'package.json'), 0, 'unknown', 'VCS_UNAVAILABLE')],
      diagnostics: [diagnostic('VCS_NOT_REPOSITORY', 'package.json')],
      cwd: root,
    })

    expect(receipt.verdict).toBe('safety-block')
    expect(receipt.noFilesChanged).toBe(true)
    expect(receipt.groups[0]?.replacementAttempted).toBe(false)

    const afterRecovery = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'package.json'), 0, 'reverted', 'RESTORE_FAILED'),
        outcome(join(root, 'other.json'), 1, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [diagnostic('VCS_NOT_REPOSITORY', 'other.json')],
      cwd: root,
    })

    expect(afterRecovery.verdict).toBe('partial')
    expect(afterRecovery.noFilesChanged).toBe(false)
  })

  it('treats a reverted-only result as partial and reports recovery totals', () => {
    const receipt = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'package.json'), 0, 'reverted', 'WRITE_FAILED'),
        outcome(join(root, 'package.json'), 1, 'reverted', 'WRITE_FAILED'),
      ],
      diagnostics: [],
      cwd: root,
    })

    expect(receipt.verdict).toBe('partial')
    expect(receipt.files).toMatchObject({ applied: 0, reverted: 1, blocked: 0 })
    expect(formatWriteReceipt(receipt, exit(2))).toEqual([
      'Partial result · 0 updates applied across 0 files; 2 updates reverted across 1 file',
      'package.json · 2 updates reverted',
      'Write reverted (WRITE_FAILED)',
      'Exit 2 · inspect the changed files before rerunning',
    ])
  })

  it('reports applied, reverted, and blocked physical totals in one partial headline', () => {
    const receipt = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'applied.json'), 0, 'applied', 'APPLIED'),
        outcome(join(root, 'reverted.json'), 1, 'reverted', 'WRITE_FAILED'),
        outcome(join(root, 'blocked.json'), 2, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [diagnostic('VCS_NOT_REPOSITORY', 'blocked.json')],
      cwd: root,
    })

    expect(receipt.verdict).toBe('partial')
    expect(formatWriteReceipt(receipt, exit(2))[0]).toBe(
      'Partial result · 1 update applied across 1 file; 1 update reverted across 1 file; 1 file blocked',
    )
    expect(formatWriteReceipt(receipt, exit(2)).at(-1)).toBe(
      'Exit 2 · inspect the changed files, fix the Git evidence problem, then rerun',
    )
  })

  it('sanitizes hostile labels and withholds absolute paths outside the repository', () => {
    const hostileName = `unsafe\u001B]8;;https://example.com\u0007name\nnext`
    const receipt = buildWriteReceipt({
      outcomes: [
        {
          ...outcome(join(root, `pkg-${hostileName}.json`), 0, 'failed', 'WRITE_FAILED'),
          name: hostileName,
          occurrence: {
            file: join(root, `pkg-${hostileName}.json`),
            path: ['dependencies', hostileName],
          },
        },
        outcome('/private/secret/package.json', 1, 'failed', 'WRITE_FAILED'),
        outcome('/another/private/package.json', 2, 'failed', 'WRITE_FAILED'),
      ],
      diagnostics: [],
      cwd: root,
    })

    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain('\u001B')
    expect(serialized).not.toContain('/private/secret')
    expect(receipt.files.planned).toBe(3)
    expect(receipt.groups.filter((group) => group.file === '[outside repository]')).toHaveLength(2)
    expect(receipt.groups[0]?.details[0]).toMatchObject({
      name: 'unsafename next',
      path: ['dependencies', 'unsafename next'],
    })
  })

  it('binds real unavailable adapter evidence to exact root and nested targets', async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'depfresh-receipt-binding-'))
    const wrapperRoot = mkdtempSync(join(tmpdir(), 'depfresh-receipt-git-'))
    const nestedRoot = join(repositoryRoot, 'packages', 'nested')
    const rootManifest = join(repositoryRoot, 'package.json')
    const nestedManifest = join(nestedRoot, 'package.json')
    const originalPath = process.env.PATH
    const git = findExecutable('git')

    try {
      mkdirSync(nestedRoot, { recursive: true })
      writeFileSync(rootManifest, '{"dependencies":{"root-dep":"1.0.0"}}\n')
      writeFileSync(nestedManifest, '{"dependencies":{"nested-dep":"1.0.0"}}\n')
      runGit(git, repositoryRoot, 'init', '--quiet')
      runGit(git, repositoryRoot, 'config', 'user.email', 'receipt@example.invalid')
      runGit(git, repositoryRoot, 'config', 'user.name', 'Receipt Test')
      runGit(git, repositoryRoot, 'add', '--', 'package.json', 'packages/nested/package.json')
      runGit(git, repositoryRoot, 'commit', '--quiet', '-m', 'fixture')

      const wrapper = join(wrapperRoot, process.platform === 'win32' ? 'git.cmd' : 'git')
      writeFileSync(
        wrapper,
        `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { writeSync } from 'node:fs'
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
      process.env.PATH = `${wrapperRoot}${delimiter}${originalPath ?? ''}`

      const rootResult = await applyLegacyPackageWrite(
        packageMeta('root', rootManifest),
        [resolvedChange('root-dep')],
        'silent',
        writeAuthority,
      )
      const nestedResult = await applyLegacyPackageWrite(
        packageMeta('nested', nestedManifest),
        [resolvedChange('nested-dep')],
        'silent',
        writeAuthority,
      )
      const receipt = buildWriteReceipt({
        outcomes: [...rootResult.outcomes, ...nestedResult.outcomes],
        diagnostics: [...rootResult.diagnostics, ...nestedResult.diagnostics],
        cwd: realpathSync.native(repositoryRoot),
      })

      expect(rootResult.outcomes[0]).toMatchObject({
        status: 'unknown',
        reason: 'VCS_UNAVAILABLE',
      })
      expect(nestedResult.outcomes[0]).toMatchObject({
        status: 'unknown',
        reason: 'VCS_UNAVAILABLE',
      })
      expect(rootResult.diagnostics).toMatchObject([
        {
          code: 'VCS_OUTPUT_LIMIT_EXCEEDED',
          target: { display: 'package.json' },
        },
      ])
      expect(nestedResult.diagnostics).toMatchObject([
        {
          code: 'VCS_OUTPUT_LIMIT_EXCEEDED',
          target: { display: 'package.json' },
        },
      ])
      expect(receipt.groups).toMatchObject([
        { file: 'package.json', diagnostic: 'VCS_OUTPUT_LIMIT_EXCEEDED' },
        { file: 'packages/nested/package.json', diagnostic: 'VCS_OUTPUT_LIMIT_EXCEEDED' },
      ])
      expect(JSON.stringify(receipt)).not.toContain(repositoryRoot)
    } finally {
      process.env.PATH = originalPath
      rmSync(repositoryRoot, { recursive: true, force: true })
      rmSync(wrapperRoot, { recursive: true, force: true })
    }
  })
})

describe('formatWriteReceipt', () => {
  it('uses the actual command exit code for an otherwise complete write receipt', () => {
    const complete = buildWriteReceipt({
      outcomes: [outcome(join(root, 'package.json'), 0, 'applied', 'APPLIED')],
      diagnostics: [],
      cwd: root,
    })

    expect(formatWriteReceipt(complete, exit(2)).at(-1)).toBe(
      'Exit 2 · inspect the errors above before rerunning',
    )
  })

  it('pluralizes partial and safety-block receipts and gives the safe next action', () => {
    const partial = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'packages', 'one.json'), 0, 'applied', 'APPLIED'),
        outcome(join(root, 'package.json'), 1, 'unknown', 'VCS_UNAVAILABLE'),
        outcome(join(root, 'package.json'), 2, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [diagnostic('VCS_OUTPUT_LIMIT_EXCEEDED', 'package.json')],
      cwd: root,
    })

    expect(formatWriteReceipt(partial, exit(2))).toEqual([
      'Partial result · 1 update applied across 1 file; 1 file blocked',
      'package.json · 2 updates not attempted',
      'Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_OUTPUT_LIMIT_EXCEEDED)',
      'Exit 2 · inspect the changed files, fix the Git evidence problem, then rerun',
    ])

    const safetyBlock = buildWriteReceipt({
      outcomes: [outcome(join(root, 'package.json'), 0, 'unknown', 'VCS_UNAVAILABLE')],
      diagnostics: [diagnostic('VCS_NOT_REPOSITORY', 'package.json')],
      cwd: root,
    })

    expect(formatWriteReceipt(safetyBlock, exit(2))).toEqual([
      'Safety block · no files were changed',
      'package.json · 1 update not attempted',
      'Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_NOT_REPOSITORY)',
      'Exit 2 · fix the Git evidence problem, then rerun',
    ])
  })

  it('reserves Git rerun guidance for receipts blocked only by VCS evidence', () => {
    const mixed = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'package.json'), 0, 'unknown', 'VCS_UNAVAILABLE'),
        outcome(join(root, 'other.json'), 1, 'conflicted', 'EXPECTED_VALUE_MISMATCH'),
      ],
      diagnostics: [diagnostic('VCS_OUTPUT_LIMIT_EXCEEDED', 'package.json')],
      cwd: root,
    })

    expect(formatWriteReceipt(mixed, exit(2)).at(-1)).toBe(
      'Exit 2 · inspect and correct each blocked target before rerunning',
    )

    const mixedPartial = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'applied.json'), 2, 'applied', 'APPLIED'),
        outcome(join(root, 'package.json'), 3, 'unknown', 'VCS_UNAVAILABLE'),
        outcome(join(root, 'other.json'), 4, 'conflicted', 'EXPECTED_VALUE_MISMATCH'),
      ],
      diagnostics: [diagnostic('VCS_OUTPUT_LIMIT_EXCEEDED', 'package.json')],
      cwd: root,
    })
    expect(formatWriteReceipt(mixedPartial, exit(2)).at(-1)).toBe(
      'Exit 2 · inspect the changed files and correct each blocked target before rerunning',
    )
  })

  it('does not give Git-only guidance when a global write also blocks the exit', () => {
    const partial = buildWriteReceipt({
      outcomes: [
        outcome(join(root, 'applied.json'), 0, 'applied', 'APPLIED'),
        outcome(join(root, 'package.json'), 1, 'unknown', 'VCS_UNAVAILABLE'),
      ],
      diagnostics: [diagnostic('VCS_NOT_REPOSITORY', 'package.json')],
      cwd: root,
    })

    expect(formatWriteReceipt(partial, exit(2, { globalWriteFailed: true })).at(-1)).toBe(
      'Exit 2 · review all reported errors and changed files, then correct each blocked target before rerunning',
    )
  })

  it('does not give Git-only guidance when strict post-write verification also blocks the exit', () => {
    const safetyBlock = buildWriteReceipt({
      outcomes: [outcome(join(root, 'package.json'), 0, 'unknown', 'VCS_UNAVAILABLE')],
      diagnostics: [diagnostic('VCS_NOT_REPOSITORY', 'package.json')],
      cwd: root,
    })

    expect(formatWriteReceipt(safetyBlock, exit(2, { strictPostWriteFailed: true })).at(-1)).toBe(
      'Exit 2 · review all reported errors and correct each blocked target before rerunning',
    )
  })
})

const writeAuthority: InvocationAuthority = {
  write: true,
  install: false,
  update: false,
  execute: false,
  processExecute: false,
  lockfileWrite: false,
  verifyCommand: false,
  artifactVerify: false,
  networkAccess: false,
  globalWrite: false,
}

function packageMeta(name: string, filepath: string): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath,
    deps: [],
    resolved: [],
    raw: {},
    indent: '  ',
  }
}

function resolvedChange(name: string): ResolvedDepChange {
  return {
    name,
    currentVersion: '1.0.0',
    rawVersion: '1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '2.0.0',
    diff: 'major',
    pkgData: { name, versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
  }
}

function findExecutable(name: string): string {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, process.platform === 'win32' ? `${name}.exe` : name)
    if (existsSync(candidate)) return realpathSync.native(candidate)
  }
  throw new Error(`Missing test executable: ${name}`)
}

function runGit(git: string, cwd: string, ...args: string[]): void {
  execFileSync(git, args, { cwd, stdio: 'ignore' })
}
