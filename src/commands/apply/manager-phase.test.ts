import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PlanResult } from '../../contracts/schemas'
import {
  diffRepositorySnapshots,
  lockfileDependencyOccurrencesMatch,
  snapshotRepositoryTree,
} from './manager-phase'

const operation = {
  id: 'operation-alpha',
  occurrenceId: 'occurrence-alpha',
  sourceFileId: 'source-root',
  file: 'package.json',
  path: ['dependencies', 'alpha'],
  name: 'alpha',
  sourceByteHash: 'a'.repeat(64),
  expectedValue: '1.0.0',
  requestedValue: '2.0.0',
} satisfies PlanResult['operations'][number]

const expectation = { operation, targetVersion: '2.0.0' }

describe('Plan 020 repository phase observation', () => {
  it('observes external Git metadata referenced by a gitdir pointer', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-manager-git-pointer-'))
    const gitDirectory = mkdtempSync(join(tmpdir(), 'depfresh-manager-git-directory-'))
    mkdirSync(join(gitDirectory, 'objects'))
    writeFileSync(join(gitDirectory, 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(gitDirectory, 'index'), 'before')
    writeFileSync(join(root, '.git'), `gitdir: ${gitDirectory}\n`)

    const before = snapshotRepositoryTree(root)
    writeFileSync(join(gitDirectory, 'index'), 'after')
    const after = snapshotRepositoryTree(root)

    expect(diffRepositorySnapshots(before, after)).toContain('.git-metadata/index')
  })

  it.each([
    [
      'npm' as const,
      '{"lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"2.0.0"}}}',
    ],
    [
      'pnpm' as const,
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alpha:\n        specifier: 2.0.0\n        version: 2.0.0\npackages:\n  alpha@2.0.0: {}\nsnapshots:\n  alpha@2.0.0: {}\n",
    ],
    [
      'bun' as const,
      '{"lockfileVersion":1,"workspaces":{"":{"dependencies":{"alpha":"2.0.0"}}},"packages":{"alpha":["alpha@2.0.0",""]}}',
    ],
  ])('reconciles %s lockfile dependency specifiers', (manager, lockfile) => {
    expect(
      lockfileDependencyOccurrencesMatch(manager, '.', [expectation], Buffer.from(lockfile)),
    ).toBe(true)
    expect(
      lockfileDependencyOccurrencesMatch(
        manager,
        '.',
        [{ operation: { ...operation, requestedValue: '3.0.0' }, targetVersion: '2.0.0' }],
        Buffer.from(lockfile),
      ),
    ).toBe(false)
  })

  it.each([
    [
      'npm' as const,
      '{"lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"2.0.0"}},"node_modules/alpha":{"version":"1.9.0"}}}',
    ],
    [
      'pnpm' as const,
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alpha:\n        specifier: 2.0.0\n        version: 1.9.0\n",
    ],
    [
      'bun' as const,
      '{"lockfileVersion":1,"workspaces":{"":{"dependencies":{"alpha":"2.0.0"}}},"packages":{"alpha":["alpha@1.9.0",""]}}',
    ],
  ])('rejects a stale resolved %s package behind a matching specifier', (manager, lockfile) => {
    expect(
      lockfileDependencyOccurrencesMatch(manager, '.', [expectation], Buffer.from(lockfile)),
    ).toBe(false)
  })

  it('reconciles a pnpm auto-installed peer from the dependencies importer field', () => {
    const peer = {
      operation: { ...operation, path: ['peerDependencies', 'alpha'] },
      targetVersion: '2.0.0',
    }
    const lockfile =
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alpha:\n        specifier: 2.0.0\n        version: 2.0.0\npackages:\n  alpha@2.0.0: {}\nsnapshots:\n  alpha@2.0.0: {}\n"

    expect(lockfileDependencyOccurrencesMatch('pnpm', '.', [peer], Buffer.from(lockfile))).toBe(
      true,
    )
  })

  it('requires pnpm package identity and package/snapshot resolution evidence', () => {
    const missingResolution =
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alpha:\n        specifier: 2.0.0\n        version: 2.0.0\n"
    const wrongIdentity =
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alpha:\n        specifier: 2.0.0\n        version: npm:evil@2.0.0\npackages:\n  evil@2.0.0: {}\nsnapshots:\n  evil@2.0.0: {}\n"

    expect(
      lockfileDependencyOccurrencesMatch(
        'pnpm',
        '.',
        [expectation],
        Buffer.from(missingResolution),
      ),
    ).toBe(false)
    expect(
      lockfileDependencyOccurrencesMatch('pnpm', '.', [expectation], Buffer.from(wrongIdentity)),
    ).toBe(false)
  })

  it('reconciles the exact pnpm npm-alias representation without accepting it for a direct dep', () => {
    const aliasExpectation = {
      operation: { ...operation, requestedValue: 'npm:semver@7.7.2' },
      targetVersion: '7.7.2',
    }
    const lockfile =
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alpha:\n        specifier: npm:semver@7.7.2\n        version: semver@7.7.2\npackages:\n  semver@7.7.2: {}\nsnapshots:\n  semver@7.7.2: {}\n"

    expect(
      lockfileDependencyOccurrencesMatch('pnpm', '.', [aliasExpectation], Buffer.from(lockfile)),
    ).toBe(true)
  })

  it('requires npm lockfile package identity for an npm alias', () => {
    const aliasExpectation = {
      operation: { ...operation, requestedValue: 'npm:semver@7.7.2' },
      targetVersion: '7.7.2',
    }
    const valid =
      '{"lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"npm:semver@7.7.2"}},"node_modules/alpha":{"name":"semver","version":"7.7.2"}}}'
    const wrongIdentity =
      '{"lockfileVersion":3,"packages":{"":{"dependencies":{"alpha":"npm:semver@7.7.2"}},"node_modules/alpha":{"name":"evil","version":"7.7.2"}}}'

    expect(
      lockfileDependencyOccurrencesMatch('npm', '.', [aliasExpectation], Buffer.from(valid)),
    ).toBe(true)
    expect(
      lockfileDependencyOccurrencesMatch(
        'npm',
        '.',
        [aliasExpectation],
        Buffer.from(wrongIdentity),
      ),
    ).toBe(false)
  })

  it('requires the Bun descriptor package identity as well as its target version', () => {
    const lockfile =
      '{"lockfileVersion":1,"workspaces":{"":{"dependencies":{"alpha":"2.0.0"}}},"packages":{"alpha":["evil-alpha@2.0.0",""]}}'

    expect(
      lockfileDependencyOccurrencesMatch('bun', '.', [expectation], Buffer.from(lockfile)),
    ).toBe(false)
  })

  it('never treats an unsupported occurrence kind as matched', () => {
    const unsupported = {
      operation: { ...operation, path: ['overrides', 'alpha'] },
      targetVersion: '2.0.0',
    }

    expect(
      lockfileDependencyOccurrencesMatch(
        'npm',
        '.',
        [unsupported],
        Buffer.from('{"lockfileVersion":3,"packages":{}}'),
      ),
    ).toBe(false)
  })
})
