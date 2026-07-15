import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RepositoryVcsTargetState } from '../types/repository'
import { inspectRepository } from './inspect'
import { collectVcsEvidence } from './vcs'

const roots: string[] = []

function temporaryRoot(prefix = 'depfresh-vcs-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function write(filepath: string, content: string): void {
  mkdirSync(dirname(filepath), { recursive: true })
  writeFileSync(filepath, content)
}

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Evidence Test',
      GIT_AUTHOR_EMAIL: 'evidence@example.test',
      GIT_COMMITTER_NAME: 'Evidence Test',
      GIT_COMMITTER_EMAIL: 'evidence@example.test',
    },
  })
}

function initialize(root: string): void {
  runGit(root, 'init', '--quiet', '--initial-branch=main')
  write(join(root, 'package.json'), '{"name":"root"}\n')
}

function stateByPath(
  states: RepositoryVcsTargetState[],
  path: string,
): RepositoryVcsTargetState | undefined {
  return states.find((candidate) => candidate.path === path)
}

function porcelainStatus(root: string): Buffer {
  return execFileSync(
    'git',
    [
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ],
    { cwd: root, encoding: 'buffer', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  )
}

function relevantIndexStat(root: string): {
  mode: number
  size: number
  ino: number
  mtimeMs: number
  ctimeMs: number
} {
  const stat = statSync(indexPath(root))
  return {
    mode: stat.mode,
    size: stat.size,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  }
}

function indexPath(root: string): string {
  return runGit(root, 'rev-parse', '--path-format=absolute', '--git-path', 'index').trimEnd()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('read-only repository VCS evidence', () => {
  it('distinguishes a non-repository, missing Git binary, and shallow repository', async () => {
    const plain = temporaryRoot()
    write(join(plain, 'package.json'), '{"name":"plain"}\n')

    const nonRepository = await inspectRepository({ cwd: plain })
    const missingBinary = collectVcsEvidence(plain, ['package.json'], {
      gitBinary: join(plain, 'missing-git'),
    })

    expect(nonRepository.vcs).toMatchObject({ status: 'unavailable' })
    expect(nonRepository.vcs).not.toHaveProperty('shallow')
    expect(nonRepository.evidence?.find((entry) => entry.kind === 'vcs')?.value).toEqual([
      expect.not.objectContaining({ shallow: expect.anything() }),
    ])
    expect(nonRepository.vcs!.diagnostics.map((entry) => entry.code)).toEqual([
      'VCS_NOT_REPOSITORY',
    ])
    expect(missingBinary).toMatchObject({ status: 'unavailable' })
    expect(missingBinary.diagnostics.map((entry) => entry.code)).toEqual(['VCS_EXECUTABLE_MISSING'])

    const source = temporaryRoot('depfresh-vcs-source-')
    initialize(source)
    runGit(source, 'add', '--', 'package.json')
    runGit(source, 'commit', '--quiet', '-m', 'first')
    write(join(source, 'package.json'), '{"name":"second"}\n')
    runGit(source, 'commit', '--quiet', '-am', 'second')
    const shallow = temporaryRoot('depfresh-vcs-shallow-')
    rmSync(shallow, { recursive: true, force: true })
    runGit(tmpdir(), 'clone', '--quiet', '--depth=1', `file://${source}`, shallow)

    const shallowModel = await inspectRepository({ cwd: shallow })

    expect(shallowModel.vcs).toMatchObject({ status: 'confirmed', shallow: true })
  })

  it('distinguishes a failed Git probe from a non-repository', () => {
    const root = temporaryRoot()
    const failingGit = join(root, 'failing-git')
    write(failingGit, '#!/bin/sh\nexit 7\n')
    chmodSync(failingGit, 0o755)

    const vcs = collectVcsEvidence(root, [], { gitBinary: failingGit })

    expect(vcs).toMatchObject({ status: 'unavailable' })
    expect(vcs.diagnostics.map((entry) => entry.code)).toEqual(['VCS_PROBE_FAILED'])
  })

  it('classifies corrupt exit-128 probes as failures without serializing stderr', () => {
    const root = temporaryRoot()
    initialize(root)
    write(join(root, '.git', 'config'), '[broken\n')

    const vcs = collectVcsEvidence(root, ['package.json'])

    expect(vcs).toMatchObject({ status: 'unavailable' })
    expect(vcs.diagnostics.map((entry) => entry.code)).toEqual(['VCS_PROBE_FAILED'])
    expect(JSON.stringify(vcs)).not.toContain('bad config')
    expect(JSON.stringify(vcs)).not.toContain(root)
  })

  it('recognizes a corrupt outer Git marker when probing from a nested package root', () => {
    const outer = temporaryRoot('depfresh-vcs-corrupt-outer-')
    initialize(outer)
    const nested = join(outer, 'packages', 'app')
    write(join(nested, 'package.json'), '{"name":"app"}\n')
    write(join(outer, '.git', 'config'), '[broken\n')

    const vcs = collectVcsEvidence(nested, ['package.json'])

    expect(vcs.diagnostics.map((entry) => entry.code)).toEqual(['VCS_PROBE_FAILED'])
  })

  it('sanitizes inherited Git routing, object, config, and trace environment variables', async () => {
    const root = temporaryRoot()
    initialize(root)
    runGit(root, 'add', '--', 'package.json')
    runGit(root, 'commit', '--quiet', '-m', 'base')
    write(join(root, 'package.json'), '{"name":"changed"}\n')
    const hostile = temporaryRoot('depfresh-vcs-hostile-')
    initialize(hostile)
    runGit(hostile, 'add', '--', 'package.json')
    runGit(hostile, 'commit', '--quiet', '-m', 'hostile')
    const trace = join(hostile, 'trace.log')
    const helper = join(hostile, 'fsmonitor-helper')
    const invoked = join(hostile, 'helper-invoked')
    write(helper, `#!/bin/sh\ntouch '${invoked}'\nexit 1\n`)
    chmodSync(helper, 0o755)
    const poisoned: Record<string, string> = {
      GIT_DIR: join(hostile, '.git'),
      GIT_WORK_TREE: hostile,
      GIT_INDEX_FILE: join(hostile, '.git', 'index'),
      GIT_COMMON_DIR: join(hostile, '.git'),
      GIT_OBJECT_DIRECTORY: join(hostile, '.git', 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(root, 'missing-objects'),
      GIT_CONFIG_GLOBAL: join(root, 'missing-global-config'),
      GIT_CONFIG_SYSTEM: join(root, 'missing-system-config'),
      GIT_CONFIG_NOSYSTEM: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: helper,
      GIT_TRACE: trace,
      GIT_TRACE_SETUP: trace,
      GIT_TRACE_PERFORMANCE: trace,
      GIT_TRACE_PACKET: trace,
      GIT_TRACE2: trace,
      GIT_TRACE2_EVENT: trace,
      GIT_TRACE2_PERF: trace,
    }
    const vcs = collectVcsEvidence(root, ['package.json'], {
      cleanTargetPaths: ['package.json'],
      environment: { ...process.env, ...poisoned },
    })

    expect(stateByPath(vcs.targetFiles, 'package.json')?.state).toBe('unstaged')
    expect(vcs.status).toBe('confirmed')
    expect(readFileSync(join(hostile, 'package.json'), 'utf-8')).toBe('{"name":"root"}\n')
    expect(() => readFileSync(trace)).toThrow()
    expect(() => readFileSync(invoked)).toThrow()
  })

  it('probes nested Git boundaries and never infers their dirty targets clean from the outer repo', async () => {
    const root = temporaryRoot()
    initialize(root)
    write(join(root, 'package.json'), '{"name":"root","workspaces":["vendor"]}\n')
    const nested = join(root, 'vendor')
    mkdirSync(nested, { recursive: true })
    initialize(nested)
    runGit(nested, 'add', '--', 'package.json')
    runGit(nested, 'commit', '--quiet', '-m', 'nested-base')
    runGit(root, 'add', '--', 'package.json')
    runGit(root, 'commit', '--quiet', '-m', 'outer-base')
    write(join(nested, 'package.json'), '{"name":"nested-changed"}\n')
    const outerIndexPath = indexPath(root)
    const nestedIndexPath = indexPath(nested)
    const outerBefore = {
      status: porcelainStatus(root),
      bytes: readFileSync(outerIndexPath),
      stat: relevantIndexStat(root),
    }
    const nestedBefore = {
      status: porcelainStatus(nested),
      bytes: readFileSync(nestedIndexPath),
      stat: relevantIndexStat(nested),
    }

    const model = await inspectRepository({ cwd: root })

    expect(stateByPath(model.vcs!.targetFiles, 'vendor/package.json')).toMatchObject({
      state: 'unstaged',
    })
    expect(model.vcs!.targetFiles).not.toContainEqual({
      path: 'vendor/package.json',
      state: 'clean',
    })
    expect(model.vcs?.repositories).toEqual([
      expect.objectContaining({ path: '.', status: 'confirmed', shallow: false }),
      expect.objectContaining({ path: 'vendor', status: 'confirmed', shallow: false }),
    ])
    expect(porcelainStatus(root)).toEqual(outerBefore.status)
    expect(readFileSync(outerIndexPath)).toEqual(outerBefore.bytes)
    expect(relevantIndexStat(root)).toEqual(outerBefore.stat)
    expect(existsSync(`${outerIndexPath}.lock`)).toBe(false)
    expect(porcelainStatus(nested)).toEqual(nestedBefore.status)
    expect(readFileSync(nestedIndexPath)).toEqual(nestedBefore.bytes)
    expect(relevantIndexStat(nested)).toEqual(nestedBefore.stat)
    expect(existsSync(`${nestedIndexPath}.lock`)).toBe(false)
  })

  it('preserves confirmed root VCS data when a nested Git probe is unavailable', async () => {
    const root = temporaryRoot()
    initialize(root)
    runGit(root, 'add', '--', 'package.json')
    runGit(root, 'commit', '--quiet', '-m', 'base')
    write(join(root, 'vendor', 'package.json'), '{"name":"nested"}\n')
    write(join(root, 'vendor', '.git'), 'gitdir: missing-git-directory\n')

    const model = await inspectRepository({ cwd: root })
    const vcsConclusion = model.evidence?.find((entry) => entry.kind === 'vcs')

    expect(model.vcs).toMatchObject({
      status: 'unavailable',
      shallow: false,
      targetFiles: expect.arrayContaining([{ path: 'package.json', state: 'clean' }]),
      repositories: [
        expect.objectContaining({ path: '.', status: 'confirmed', shallow: false }),
        expect.objectContaining({ path: 'vendor', status: 'unavailable' }),
      ],
    })
    expect(vcsConclusion).toMatchObject({
      status: 'unavailable',
      value: [
        expect.objectContaining({
          shallow: false,
          targetFiles: expect.arrayContaining([{ path: 'package.json', state: 'clean' }]),
          repositories: [
            expect.objectContaining({ path: '.', status: 'confirmed' }),
            expect.objectContaining({ path: 'vendor', status: 'unavailable' }),
          ],
        }),
      ],
    })
  })

  it('keeps effective-root and nested shallow state separate', async () => {
    const root = temporaryRoot()
    initialize(root)
    write(join(root, 'package.json'), '{"name":"root","workspaces":["vendor"]}\n')
    runGit(root, 'add', '--', 'package.json')
    runGit(root, 'commit', '--quiet', '-m', 'outer-base')
    const source = temporaryRoot('depfresh-vcs-nested-source-')
    initialize(source)
    runGit(source, 'add', '--', 'package.json')
    runGit(source, 'commit', '--quiet', '-m', 'nested-base')
    const nested = join(root, 'vendor')
    runGit(root, 'clone', '--quiet', '--depth=1', `file://${source}`, nested)

    const model = await inspectRepository({ cwd: root })

    expect(model.vcs?.shallow).toBe(false)
    expect(model.vcs?.repositories).toEqual([
      expect.objectContaining({ path: '.', shallow: false }),
      expect.objectContaining({ path: 'vendor', shallow: true }),
    ])
  })

  it('models clean, staged, unstaged, combined, added, deleted, renamed, and untracked targets', async () => {
    const root = temporaryRoot()
    initialize(root)
    write(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
    write(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    write(join(root, 'yarn.lock'), '# yarn lockfile v1\n')
    write(join(root, 'bun.lockb'), 'legacy')
    write(join(root, '.nvmrc'), '24.15.0\n')
    runGit(root, 'add', '--', '.')
    runGit(root, 'commit', '--quiet', '-m', 'base')

    write(join(root, 'package-lock.json'), '{"lockfileVersion":2}\n')
    runGit(root, 'add', '--', 'package-lock.json')
    write(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '8.0'\n")
    write(join(root, 'yarn.lock'), '# yarn lockfile v2\n')
    runGit(root, 'add', '--', 'yarn.lock')
    write(join(root, 'yarn.lock'), '# yarn lockfile v3\n')
    write(join(root, 'bun.lock'), '{"lockfileVersion":1}\n')
    runGit(root, 'add', '--', 'bun.lock')
    rmSync(join(root, 'bun.lockb'))
    runGit(root, 'mv', '--', '.nvmrc', '.tool-versions')
    write(join(root, '.node-version'), '24.16.0\n')

    const model = await inspectRepository({ cwd: root })
    const states = model.vcs!.targetFiles

    expect(stateByPath(states, 'package.json')?.state).toBe('clean')
    expect(stateByPath(states, 'package-lock.json')?.state).toBe('staged')
    expect(stateByPath(states, 'pnpm-lock.yaml')?.state).toBe('unstaged')
    expect(stateByPath(states, 'yarn.lock')?.state).toBe('staged-plus-unstaged')
    expect(stateByPath(states, 'bun.lock')?.state).toBe('added')
    expect(stateByPath(states, 'bun.lockb')?.state).toBe('deleted')
    expect(stateByPath(states, '.tool-versions')).toMatchObject({
      state: 'renamed',
      originalPath: '.nvmrc',
    })
    expect(stateByPath(states, '.node-version')?.state).toBe('untracked')
  })

  it('does not emit absent boundary candidates as phantom clean targets', async () => {
    const root = temporaryRoot()
    initialize(root)
    runGit(root, 'add', '--', 'package.json')
    runGit(root, 'commit', '--quiet', '-m', 'base')

    const model = await inspectRepository({ cwd: root })

    expect(model.vcs!.targetFiles).toEqual([{ path: 'package.json', state: 'clean' }])
  })

  it('keeps ignored dirty manifests unrelated and does not promote their boundaries', async () => {
    const root = temporaryRoot()
    initialize(root)
    write(join(root, 'ignored', 'package.json'), '{"name":"ignored"}\n')
    runGit(root, 'add', '--', '.')
    runGit(root, 'commit', '--quiet', '-m', 'base')
    write(join(root, 'ignored', 'package.json'), '{"name":"ignored","workspaces":["packages/*"]}\n')

    const model = await inspectRepository({ cwd: root, ignorePaths: ['ignored/**'] })

    expect(model.sourceFiles.map((source) => source.path)).toEqual(['package.json'])
    expect(model.boundaries?.map((boundary) => boundary.path)).toEqual(['.'])
    expect(model.vcs!.unrelatedDirtyPaths).toEqual(['ignored/package.json'])
  })

  it('reports an ignored modeled target explicitly instead of inferring it clean', async () => {
    const root = temporaryRoot()
    runGit(root, 'init', '--quiet', '--initial-branch=main')
    write(join(root, '.gitignore'), 'package.json\n')
    write(join(root, 'package.json'), '{"name":"ignored-target"}\n')

    const model = await inspectRepository({ cwd: root })

    expect(stateByPath(model.vcs!.targetFiles, 'package.json')?.state).toBe('ignored')
  })

  it('preserves both paths when a target is renamed away or renamed into place', async () => {
    const away = temporaryRoot('depfresh-vcs-rename-away-')
    initialize(away)
    runGit(away, 'add', '--', 'package.json')
    runGit(away, 'commit', '--quiet', '-m', 'base')
    runGit(away, 'mv', '--', 'package.json', 'notes.json')

    const awayModel = await inspectRepository({ cwd: away })

    expect(awayModel.vcs!.targetFiles).toContainEqual({
      path: 'notes.json',
      originalPath: 'package.json',
      state: 'renamed',
    })

    const into = temporaryRoot('depfresh-vcs-rename-into-')
    runGit(into, 'init', '--quiet', '--initial-branch=main')
    write(join(into, 'notes.json'), '{"name":"future-target"}\n')
    runGit(into, 'add', '--', 'notes.json')
    runGit(into, 'commit', '--quiet', '-m', 'base')
    runGit(into, 'mv', '--', 'notes.json', 'package.json')

    const intoModel = await inspectRepository({ cwd: into })

    expect(intoModel.vcs!.targetFiles).toContainEqual({
      path: 'package.json',
      originalPath: 'notes.json',
      state: 'renamed',
    })
  })

  it('disables configured filesystem monitors and leaves their helpers unexecuted', async () => {
    const root = temporaryRoot()
    initialize(root)
    runGit(root, 'add', '--', 'package.json')
    runGit(root, 'commit', '--quiet', '-m', 'base')
    const marker = join(root, 'fsmonitor-invoked')
    const helper = join(root, 'fsmonitor-helper')
    write(helper, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`)
    chmodSync(helper, 0o755)
    runGit(root, 'config', 'core.fsmonitor', helper)
    runGit(root, 'config', 'core.untrackedCache', 'true')

    const model = await inspectRepository({ cwd: root })

    expect(model.vcs?.status).toBe('confirmed')
    expect(() => readFileSync(marker)).toThrow()
  })

  it('models conflicts, unusual target paths, and unrelated dirty paths without changing bytes', async () => {
    const root = temporaryRoot()
    initialize(root)
    write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "odd\\nname"\n')
    const unusualTarget = 'odd\nname/package.json'
    const unrelated = 'notes\nprivate.txt'
    write(join(root, unusualTarget), '{"name":"odd"}\n')
    write(join(root, unrelated), 'private-before\n')
    runGit(root, 'add', '--', '.')
    runGit(root, 'commit', '--quiet', '-m', 'base')

    runGit(root, 'checkout', '--quiet', '-b', 'topic')
    write(join(root, 'package.json'), '{"name":"topic"}\n')
    runGit(root, 'commit', '--quiet', '-am', 'topic')
    runGit(root, 'checkout', '--quiet', 'main')
    write(join(root, 'package.json'), '{"name":"main"}\n')
    runGit(root, 'commit', '--quiet', '-am', 'main')
    try {
      runGit(root, 'merge', '--quiet', 'topic')
    } catch {
      // The real conflict is the fixture state under test.
    }
    write(join(root, unusualTarget), '{"name":"changed"}\n')
    write(join(root, unrelated), 'private-after\n')

    const repositoryIndexPath = indexPath(root)
    const statusBefore = porcelainStatus(root)
    const indexBytes = readFileSync(repositoryIndexPath)
    const indexStat = relevantIndexStat(root)
    const unrelatedBytes = readFileSync(join(root, unrelated))

    const model = await inspectRepository({ cwd: root })

    expect(stateByPath(model.vcs!.targetFiles, 'package.json')?.state).toBe('conflicted')
    expect(stateByPath(model.vcs!.targetFiles, unusualTarget)?.state).toBe('unstaged')
    expect(model.vcs!.unrelatedDirtyPaths).toEqual([unrelated])
    expect(readFileSync(repositoryIndexPath)).toEqual(indexBytes)
    expect(relevantIndexStat(root)).toEqual(indexStat)
    expect(existsSync(`${repositoryIndexPath}.lock`)).toBe(false)
    expect(porcelainStatus(root)).toEqual(statusBefore)
    expect(readFileSync(join(root, unrelated))).toEqual(unrelatedBytes)
  })
})
