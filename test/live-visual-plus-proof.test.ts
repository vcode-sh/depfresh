import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseLiveVisualPlusProofCommand,
  runLiveVisualPlusProof,
} from '../scripts/live-visual-plus-proof.mjs'
import * as replayEvidence from '../scripts/visual-plus-replay-failure.mjs'

interface ReplayEvidenceApi {
  writeVisualPlusReplayEvidence(options: {
    cliPath: string
    cliSha256: string
    containmentRoot: string
    expected: { files: number; suites: number; tests: number }
    installedRoot: string
    outputPath: string
    packageVersion: string
    report: unknown
    tarballPath: string
    tarballSha256: string
  }): unknown
}

const replayEvidenceApi = replayEvidence as unknown as ReplayEvidenceApi
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('live Visual+ proof harness', () => {
  it('requires the exact artifact, repository, widths, and output arguments', () => {
    expect(
      parseLiveVisualPlusProofCommand([
        '--cwd',
        '/repository',
        '--pack-json',
        '/artifact/pack.json',
        '--replay-evidence',
        '/artifact/replay.json',
        '--columns',
        '80',
        '--columns',
        '118',
        '--include-long',
        '--output',
        '/artifact/live.json',
      ]),
    ).toEqual({
      columns: [80, 118],
      cwd: '/repository',
      includeLong: true,
      outputPath: '/artifact/live.json',
      packJsonPath: '/artifact/pack.json',
      replayEvidencePath: '/artifact/replay.json',
    })
    for (const arguments_ of [
      [],
      ['--columns', '80'],
      [
        '--cwd',
        '/repository',
        '--pack-json',
        '/artifact/pack.json',
        '--replay-evidence',
        '/artifact/replay.json',
        '--columns',
        '80',
        '--output',
        '/artifact/live.json',
      ],
    ]) {
      expect(() => parseLiveVisualPlusProofCommand(arguments_)).toThrow()
    }
  })

  it('binds fixed bunx PTY runs to the pack, replay, global CLI, and unchanged Git state', async () => {
    const fixture = liveProofFixture()

    const evidence = await runLiveVisualPlusProof(fixture.options)

    expect(JSON.parse(readFileSync(fixture.outputPath, 'utf8'))).toEqual(evidence)
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      kind: 'depfresh-live-visual-plus-proof',
      cwd: fixture.repository,
      bunx: {
        path: fixture.bunxPath,
        realpath: fixture.bunPath,
        launchIdentity: { method: 'inode-bound-bunx' },
      },
      bunGlobal: {
        binRealpath: fixture.globalBin,
        depfreshLink: fixture.globalLink,
        depfreshLinkTarget: fixture.globalCli,
        cliSha256: fixture.cliSha256,
      },
      artifact: {
        packJsonRealpath: fixture.packJsonPath,
        replayEvidenceRealpath: fixture.replayEvidencePath,
        tarballRealpath: fixture.tarballPath,
        tarballSha256: fixture.tarballSha256,
        packageVersion: '2.1.1',
      },
      repository: { unchanged: true },
    })
    expect(evidence.runs).toHaveLength(2)
    for (const run of evidence.runs) {
      expect(run.argv).toEqual(['--no-install', 'depfresh', 'major', '--cwd', fixture.repository])
      expect(run.exitCode).toBe(0)
      expect(run.finalCursorVisible).toBe(true)
      expect(run.rawControl).toEqual({
        beforeEscape: false,
        beforeOtherControl: false,
        beforeText: false,
        doubleCrlf: false,
        trailing: false,
      })
      expect(run.operationRows).toEqual({ declared: 3, rendered: 3, complete: true })
      expect(run.hierarchyTokens).toEqual([
        'context',
        'topology',
        'severity',
        'breaking-changes',
        'update-ledger',
      ])
      expect(run.finalScreen).toContain('spreadu')
      expect(run).not.toHaveProperty('rawTerminal')
      expect(run).not.toHaveProperty('diagnostics')
    }
    expect(evidence.longRuns).toHaveLength(2)
    for (const run of evidence.longRuns) {
      expect(run.argv).toEqual([
        '--no-install',
        'depfresh',
        'major',
        '--cwd',
        fixture.repository,
        '--long',
      ])
      expect(run.membership).toEqual({
        dependencies: 1,
        majorCards: 1,
        occurrences: 3,
        operations: 3,
        owners: 1,
        targets: 1,
      })
    }
    expect(evidence.repository.before).toEqual(evidence.repository.after)
    expect(
      readFileSync(fixture.invocationsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      ['pm', 'bin', '-g'],
      ['--no-install', 'depfresh', 'major', '--cwd', fixture.repository],
      ['--no-install', 'depfresh', 'major', '--cwd', fixture.repository],
      ['--no-install', 'depfresh', 'major', '--cwd', fixture.repository, '--long'],
      ['--no-install', 'depfresh', 'major', '--cwd', fixture.repository, '--long'],
    ])
  }, 30_000)

  it('fails closed on shadows, changed identities, and unsafe outputs without partial reports', async () => {
    for (const fault of [
      'local-shadow',
      'pack-mismatch',
      'global-cli-mismatch',
      'ambiguous-bunx',
      'repository-mutation',
      'second-width-failure',
      'existing-output',
      'symlink-output',
      'outside-output',
    ]) {
      const fixture = liveProofFixture()
      if (fault === 'local-shadow') {
        mkdirSync(join(fixture.repository, 'node_modules', '.bin'), { recursive: true })
        writeFileSync(join(fixture.repository, 'node_modules', '.bin', 'depfresh'), '')
      }
      if (fault === 'pack-mismatch') writeFileSync(fixture.tarballPath, 'changed tarball')
      if (fault === 'global-cli-mismatch') writeFileSync(fixture.globalCli, 'changed cli')
      if (fault === 'ambiguous-bunx') {
        const secondBin = join(fixture.root, 'second-bin')
        mkdirSync(secondBin)
        symlinkSync(fixture.bunPath, join(secondBin, 'bunx'))
        fixture.options.environment.PATH = `${secondBin}:${fixture.options.environment.PATH}`
      }
      if (fault === 'repository-mutation') {
        fixture.options.environment.DEPFRESH_LIVE_TEST_MUTATE = '1'
      }
      if (fault === 'second-width-failure') {
        fixture.options.environment.DEPFRESH_LIVE_TEST_FAIL_SECOND = '1'
      }
      if (fault === 'existing-output') writeFileSync(fixture.outputPath, 'existing')
      if (fault === 'symlink-output') symlinkSync(fixture.tarballPath, fixture.outputPath)
      if (fault === 'outside-output') {
        fixture.options.outputPath = join(temporaryRoot('depfresh-live-outside-'), 'live.json')
      }

      await expect(runLiveVisualPlusProof(fixture.options), fault).rejects.toThrow()
      if (!['existing-output', 'symlink-output'].includes(fault)) {
        expect(() => readFileSync(fixture.options.outputPath), fault).toThrow()
      }
      const invocationLines = readFileSync(fixture.invocationsPath, 'utf8').trim().split('\n')
      const defaultInvocation = JSON.stringify([
        '--no-install',
        'depfresh',
        'major',
        '--cwd',
        fixture.repository,
      ])
      expect(invocationLines.filter(Boolean), fault).toEqual(
        fault === 'global-cli-mismatch'
          ? ['["pm","bin","-g"]']
          : fault === 'repository-mutation'
            ? ['["pm","bin","-g"]', defaultInvocation]
            : fault === 'second-width-failure'
              ? ['["pm","bin","-g"]', defaultInvocation, defaultInvocation]
              : [],
      )
    }
  }, 30_000)
})

function liveProofFixture() {
  const root = temporaryRoot('depfresh-live-proof-')
  const repository = join(root, 'spreadoo')
  const artifactRoot = join(root, 'artifact')
  const installedRoot = join(root, 'replay-install', 'node_modules', 'depfresh')
  const replayCli = join(installedRoot, 'dist', 'cli.mjs')
  const globalRoot = join(root, 'bun-global')
  const globalBin = join(globalRoot, 'bin')
  const globalCli = join(
    globalRoot,
    'install',
    'global',
    'node_modules',
    'depfresh',
    'dist',
    'cli.mjs',
  )
  const globalLink = join(globalBin, 'depfresh')
  const fakeBin = join(root, 'fake-bin')
  const bunPath = join(fakeBin, 'bun')
  const bunxPath = join(fakeBin, 'bunx')
  const invocationsPath = join(root, 'invocations.jsonl')
  const packJsonPath = join(artifactRoot, 'pack.json')
  const replayEvidencePath = join(artifactRoot, 'installed-replay.json')
  const outputPath = join(artifactRoot, 'spreadoo-live.json')
  const tarballPath = join(artifactRoot, 'depfresh-2.1.1.tgz')
  const cliBytes = Buffer.from('#!/usr/bin/env node\n')
  const tarballBytes = Buffer.from('packed depfresh 2.1.1')
  for (const path of [
    repository,
    artifactRoot,
    join(installedRoot, 'dist'),
    dirname(globalCli),
    globalBin,
    fakeBin,
  ]) {
    mkdirSync(path, { recursive: true })
  }
  writeFileSync(join(repository, 'package.json'), '{"name":"spreadu","private":true}\n')
  writeFileSync(join(repository, 'bun.lock'), '{"lockfileVersion":1}\n')
  execFileSync('/usr/bin/git', ['init', '--quiet'], { cwd: repository })
  execFileSync('/usr/bin/git', ['add', 'package.json', 'bun.lock'], { cwd: repository })
  execFileSync(
    '/usr/bin/git',
    [
      '-c',
      'user.name=Proof',
      '-c',
      'user.email=proof@example.test',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: repository },
  )
  writeFileSync(tarballPath, tarballBytes)
  const tarballSha256 = createHash('sha256').update(tarballBytes).digest('hex')
  writeFileSync(
    packJsonPath,
    JSON.stringify([
      {
        name: 'depfresh',
        version: '2.1.1',
        filename: 'depfresh-2.1.1.tgz',
        size: tarballBytes.byteLength,
      },
    ]),
  )
  writeFileSync(join(installedRoot, 'package.json'), '{"name":"depfresh","version":"2.1.1"}\n')
  writeFileSync(replayCli, cliBytes)
  writeFileSync(globalCli, cliBytes)
  chmodSync(globalCli, 0o755)
  symlinkSync('../install/global/node_modules/depfresh/dist/cli.mjs', globalLink)
  const cliSha256 = createHash('sha256').update(cliBytes).digest('hex')
  replayEvidenceApi.writeVisualPlusReplayEvidence({
    cliPath: replayCli,
    cliSha256,
    containmentRoot: artifactRoot,
    expected: { files: 1, suites: 5, tests: 69 },
    installedRoot,
    outputPath: replayEvidencePath,
    packageVersion: '2.1.1',
    report: completeReplayReport(),
    tarballPath,
    tarballSha256,
  })
  writeFileSync(invocationsPath, '')
  writeFileSync(
    bunPath,
    `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(invocationsPath)}, JSON.stringify(args) + '\\n')
const invocationCount = readFileSync(${JSON.stringify(invocationsPath)}, 'utf8').trim().split('\\n').length
if (JSON.stringify(args) === JSON.stringify(['pm', 'bin', '-g'])) {
  process.stdout.write(${JSON.stringify(`${globalBin}\n`)})
} else if (args[0] === '--no-install' && args[1] === 'depfresh' && args[2] === 'major' && args[3] === '--cwd' && args[4] === ${JSON.stringify(repository)}) {
  if (process.env.DEPFRESH_LIVE_TEST_MUTATE === '1') writeFileSync(${JSON.stringify(join(repository, 'bun.lock'))}, 'changed\\n')
  if (process.env.DEPFRESH_LIVE_TEST_FAIL_SECOND === '1' && invocationCount === 3) process.exitCode = 17
  else process.stdout.write(args[5] === '--long' ? ${JSON.stringify(longScreen())} : ${JSON.stringify(hybridScreen())})
} else {
  process.exitCode = 17
}
`,
  )
  chmodSync(bunPath, 0o755)
  symlinkSync('bun', bunxPath)
  const environment = {
    HOME: root,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: [fakeBin, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    TERM: 'xterm-256color',
  }
  return {
    root,
    repository,
    packJsonPath,
    replayEvidencePath,
    outputPath,
    tarballPath,
    tarballSha256,
    cliSha256,
    globalBin,
    globalCli,
    globalLink,
    bunPath,
    bunxPath,
    invocationsPath,
    options: {
      columns: [80, 118],
      cwd: repository,
      environment,
      includeLong: true,
      outputPath,
      packJsonPath,
      replayEvidencePath,
    },
  }
}

function completeReplayReport() {
  return {
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPassedTests: 69,
    numPassedTestSuites: 5,
    numPendingTests: 0,
    numPendingTestSuites: 0,
    numTodoTests: 0,
    numTotalTests: 69,
    numTotalTestSuites: 5,
    testResults: [
      {
        assertionResults: Array.from({ length: 69 }, () => ({ status: 'passed' })),
        status: 'passed',
      },
    ],
  }
}

function hybridScreen() {
  return `spreadu · bun 1.3.14 · workspace · major · read-only
1 packages · 3 declared · 3 eligible · 3 updates · 1 files

Major 1 · Minor 1 · Patch 1
████████████████████████████████████████

Breaking changes
alpha
  ^1.0.0 → ^2.0.0 · root

spreadu · package.json
  dependencies
dependency  current → target  severity  age
alpha       ^1.0.0 → ^2.0.0   Major     ~1d
beta        ^1.0.0 → ^1.1.0   Minor     ~1d
gamma       ^1.0.0 → ^1.0.1   Patch     ~1d
Review complete · 3 updates across 1 files · write not attempted
Exit 0
`
}

function longScreen() {
  return `spreadu · bun 1.3.14 · workspace · major · read-only
Owner impact
Owner ID owner-1
Shared dependencies
Dependency ID dependency-1
Major card
Complete change list
Operation ID operation-1
Occurrence
Operation ID operation-2
Occurrence
Operation ID operation-3
Occurrence
Reviewed physical targets
Target package.json · 3 updates
Review complete
Exit 0
`
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const canonicalRoot = realpathSync(root)
  roots.push(canonicalRoot)
  return canonicalRoot
}
