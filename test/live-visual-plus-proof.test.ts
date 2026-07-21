import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseLiveVisualPlusProofCommand,
  runLiveVisualPlusProof,
} from '../scripts/live-visual-plus-proof.mjs'
import { analyzeHybridRun } from '../scripts/live-visual-plus-proof-support.mjs'
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
    publicationHooks?: {
      afterPendingCreated?: (input: { parentPath: string; pendingPath: string }) => unknown
      beforeDescriptorClose?: (input: {
        parentDescriptor: number
        pendingDescriptor: number
      }) => void
      beforePendingCleanup?: () => void
    }
  }): unknown
}

const replayEvidenceApi = replayEvidence as unknown as ReplayEvidenceApi
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('live Visual+ proof harness', () => {
  it('loads under the pinned Node runtime without a TypeScript loader', () => {
    const result = spawnSync(process.execPath, ['scripts/live-visual-plus-proof.mjs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('Live Visual+ proof failed\n')
  })

  it('counts shared catalog owners as one physical file while retaining their contexts', () => {
    const transcript = sharedCatalogHybridScreen()
    const analyze = (value: string) =>
      analyzeHybridRun(
        {
          controls: {},
          evidence: { columns: 80 },
          exitCode: 0,
          finalCursorVisible: true,
          rawTerminal: Buffer.from(value.replaceAll('\n', '\r\n')),
          signal: null,
          transcript: value,
        },
        80,
        ['--no-install', 'depfresh', 'major'],
        'spreadu',
      )
    const result = analyze(transcript)

    expect(result.operationRows).toEqual({
      complete: true,
      declared: 2,
      files: 1,
      rendered: 2,
      severity: { major: 1, minor: 1, patch: 0 },
    })
    for (const malformed of [
      transcript.replace('catalog catalog-b:', 'catalog catalog-c:'),
      transcript.replace('catalog catalog-b:', 'compat unknown: catalog catalog-b:'),
      transcript.replace(
        'catalog catalog-b: pnpm-workspace.yaml',
        'catalog catalog-b: pnpm-workspace.yaml-extra',
      ),
    ]) {
      expect(() => analyze(malformed)).toThrow()
    }
  })

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

  it('uses only the required canonical directories in the fixture PATH', () => {
    const fixture = liveProofFixture()

    expect(fixture.options.environment.PATH.split(':')).toEqual([
      dirname(fixture.bunPath),
      dirname(process.execPath),
      '/usr/bin',
    ])
  })

  it('keeps an absent normal residue root fail closed while allowing relocation cleanup', () => {
    const root = temporaryRoot('depfresh-live-proof-residue-')
    const missingRoot = join(root, 'artifact-missing')

    expect(() => pendingNames(missingRoot)).toThrow()
    expect(pendingNames(missingRoot, { allowMissing: true })).toEqual([])
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
        launchIdentity: { method: 'inode-bound-bun-and-bunx' },
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
        packageVersion: '2.1.2',
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
      expect(run.operationRows).toEqual({
        declared: 3,
        rendered: 3,
        files: 1,
        severity: { major: 1, minor: 1, patch: 1 },
        complete: true,
      })
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
    expect(() => readFileSync(fixture.packageRunnerMarker)).toThrow()
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

  it.each([
    'missing-row-with-severity-note',
    'duplicate-row',
    'duplicate-row-different-age',
    'duplicate-row-inline-compatibility',
    'duplicate-row-continuation-compatibility',
    'default-topology-file-mismatch',
    'default-receipt-file-mismatch',
    'default-severity-mismatch',
    'default-physical-file-mismatch',
    'duplicate-long-ids',
    'long-owner-mismatch',
    'long-shared-mismatch',
    'long-occurrence-duplicate',
    'long-target-mismatch',
    'long-target-distribution-mismatch',
    'long-dependency-cardinality-mismatch',
    'long-dependency-owner-pair-mismatch',
    'long-operation-owner-mismatch',
    'long-empty-owner-id',
    'long-duplicate-section',
    'long-major-risk-mismatch',
    'long-duplicate-major-card',
  ])(
    'rejects malformed %s membership with unchanged summary counts',
    async (fault) => {
      const fixture = liveProofFixture()
      fixture.options.environment.DEPFRESH_LIVE_TEST_SCREEN_FAULT = fault

      await expect(runLiveVisualPlusProof(fixture.options), fault).rejects.toThrow()
      expect(() => readFileSync(fixture.outputPath), fault).toThrow()
    },
    30_000,
  )

  it.each([
    'regular-bunx-replacement',
    'global-link-replacement',
    'global-target-replacement',
    'index-same-bytes',
    'bun-lock-same-bytes',
  ])(
    'rejects %s identity replacement',
    async (fault) => {
      const fixture = liveProofFixture({ regularBunx: fault === 'regular-bunx-replacement' })
      fixture.options.environment.DEPFRESH_LIVE_TEST_IDENTITY_FAULT = fault

      await expect(runLiveVisualPlusProof(fixture.options), fault).rejects.toThrow()
      expect(() => readFileSync(fixture.outputPath), fault).toThrow()
    },
    30_000,
  )

  it('rejects artifact and report publication inside the repository before any invocation', async () => {
    const fixture = liveProofFixture({ artifactInRepository: true })

    await expect(runLiveVisualPlusProof(fixture.options)).rejects.toThrow()

    expect(readFileSync(fixture.invocationsPath, 'utf8')).toBe('')
    expect(() => readFileSync(fixture.outputPath)).toThrow()
    expect(pendingNames(fixture.artifactRoot)).toEqual([])
  })

  it('canonicalizes macOS temp aliases for repository, artifact inputs, PATH, and output', async () => {
    if (process.platform !== 'darwin') return
    const fixture = liveProofFixture({ aliasRoot: true })
    const alias = (path: string) => path.replace(/^\/private\/tmp\//u, '/tmp/')
    fixture.options.cwd = alias(fixture.repository)
    fixture.options.packJsonPath = alias(fixture.packJsonPath)
    fixture.options.replayEvidencePath = alias(fixture.replayEvidencePath)
    fixture.options.outputPath = alias(fixture.outputPath)
    fixture.options.environment.PATH = fixture.options.environment.PATH.split(':')
      .map(alias)
      .join(':')

    const evidence = await runLiveVisualPlusProof(fixture.options)

    expect(evidence.cwd).toBe(fixture.repository)
    expect(JSON.parse(readFileSync(fixture.outputPath, 'utf8'))).toEqual(evidence)
  }, 30_000)

  it('rejects output-parent replacement without report or pending residue', async () => {
    const replaced = liveProofFixture()
    const relocated = `${replaced.artifactRoot}-relocated`
    roots.push(relocated)
    replaced.options.publicationHooks = {
      afterPendingCreated: ({ parentPath }) => {
        renameSync(parentPath, relocated)
        mkdirSync(parentPath)
        return { relocatedParentPath: relocated }
      },
    }

    await expect(runLiveVisualPlusProof(replaced.options)).rejects.toThrow()
    expect(() => readFileSync(replaced.outputPath)).toThrow()
    expect(pendingNames(replaced.artifactRoot)).toEqual([])
    expect(pendingNames(relocated, { allowMissing: true })).toEqual([])
  }, 30_000)

  it('exposes output cleanup faults without report or pending residue', async () => {
    const cleanupFault = liveProofFixture()
    cleanupFault.options.publicationHooks = {
      afterPendingCreated: () => {
        throw new Error('deterministic primary fault')
      },
      beforePendingCleanup: () => {
        throw new Error('deterministic cleanup fault')
      },
    }
    await expect(runLiveVisualPlusProof(cleanupFault.options)).rejects.toThrow(/cleanup/u)
    expect(() => readFileSync(cleanupFault.outputPath)).toThrow()
    expect(pendingNames(cleanupFault.artifactRoot)).toEqual([])
  }, 30_000)

  it('removes the live report when descriptor cleanup fails', async () => {
    const cleanupFault = liveProofFixture()
    cleanupFault.options.publicationHooks = {
      beforeDescriptorClose: ({ pendingDescriptor }) => {
        closeSync(pendingDescriptor)
      },
    }

    await expect(runLiveVisualPlusProof(cleanupFault.options)).rejects.toThrow(/cleanup/u)
    expect(() => readFileSync(cleanupFault.outputPath)).toThrow()
    expect(pendingNames(cleanupFault.artifactRoot)).toEqual([])
  }, 30_000)

  it('keeps the repository snapshot authoritative through publication', async () => {
    const publicationMutation = liveProofFixture()
    publicationMutation.options.publicationHooks = {
      afterPendingCreated: () => {
        replaceSameBytes(join(publicationMutation.repository, 'bun.lock'))
      },
    }
    await expect(runLiveVisualPlusProof(publicationMutation.options)).rejects.toThrow()
    expect(() => readFileSync(publicationMutation.outputPath)).toThrow()
    expect(pendingNames(publicationMutation.artifactRoot)).toEqual([])
  }, 30_000)
})

function liveProofFixture(
  options: { aliasRoot?: boolean; artifactInRepository?: boolean; regularBunx?: boolean } = {},
) {
  const root = options.aliasRoot
    ? temporaryAliasRoot('depfresh-live-proof-alias-')
    : temporaryRoot('depfresh-live-proof-')
  const repository = join(root, 'spreadoo')
  const artifactRoot = options.artifactInRepository
    ? join(repository, 'proof-artifact')
    : join(root, 'artifact')
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
  const packageRunnerMarker = join(root, 'package-runner-attempted')
  const packJsonPath = join(artifactRoot, 'pack.json')
  const replayEvidencePath = join(artifactRoot, 'installed-replay.json')
  const outputPath = join(artifactRoot, 'spreadoo-live.json')
  const tarballPath = join(artifactRoot, 'depfresh-2.1.2.tgz')
  const cliBytes = Buffer.from('#!/usr/bin/env node\n')
  const tarballBytes = Buffer.from('packed depfresh 2.1.2')
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
        version: '2.1.2',
        filename: 'depfresh-2.1.2.tgz',
        size: tarballBytes.byteLength,
      },
    ]),
  )
  writeFileSync(join(installedRoot, 'package.json'), '{"name":"depfresh","version":"2.1.2"}\n')
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
    packageVersion: '2.1.2',
    report: completeReplayReport(),
    tarballPath,
    tarballSha256,
  })
  writeFileSync(invocationsPath, '')
  writeFileSync(
    bunPath,
    `#!${process.execPath}
import { appendFileSync, chmodSync, copyFileSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
const args = process.argv.slice(2)
const launcherName = basename(process.argv[1])
appendFileSync(${JSON.stringify(invocationsPath)}, JSON.stringify(args) + '\\n')
const invocationCount = readFileSync(${JSON.stringify(invocationsPath)}, 'utf8').trim().split('\\n').length
const replaceSameBytes = (path) => {
  const oldPath = path + '.old'
  const mode = statSync(path).mode & 0o777
  renameSync(path, oldPath)
  copyFileSync(oldPath, path)
  chmodSync(path, mode)
  unlinkSync(oldPath)
}
if (launcherName === 'bunx' && args[0] === 'pm') {
  writeFileSync(${JSON.stringify(packageRunnerMarker)}, 'package runner mode was invoked')
  process.exitCode = 17
} else if (launcherName === 'bun' && JSON.stringify(args) === JSON.stringify(['pm', 'bin', '-g'])) {
  process.stdout.write(${JSON.stringify(`${globalBin}\n`)})
} else if (launcherName === 'bunx' && args[0] === '--no-install' && args[1] === 'depfresh' && args[2] === 'major' && args[3] === '--cwd' && args[4] === ${JSON.stringify(repository)}) {
  if (process.env.DEPFRESH_LIVE_TEST_MUTATE === '1') writeFileSync(${JSON.stringify(join(repository, 'bun.lock'))}, 'changed\\n')
  if (invocationCount === 2 && process.env.DEPFRESH_LIVE_TEST_IDENTITY_FAULT === 'regular-bunx-replacement') replaceSameBytes(${JSON.stringify(bunxPath)})
  if (invocationCount === 2 && process.env.DEPFRESH_LIVE_TEST_IDENTITY_FAULT === 'global-link-replacement') {
    unlinkSync(${JSON.stringify(globalLink)})
    symlinkSync('../install/global/node_modules/depfresh/dist/cli.mjs', ${JSON.stringify(globalLink)})
  }
  if (invocationCount === 2 && process.env.DEPFRESH_LIVE_TEST_IDENTITY_FAULT === 'global-target-replacement') replaceSameBytes(${JSON.stringify(globalCli)})
  if (invocationCount === 2 && process.env.DEPFRESH_LIVE_TEST_IDENTITY_FAULT === 'index-same-bytes') replaceSameBytes(${JSON.stringify(join(repository, '.git', 'index'))})
  if (invocationCount === 2 && process.env.DEPFRESH_LIVE_TEST_IDENTITY_FAULT === 'bun-lock-same-bytes') replaceSameBytes(${JSON.stringify(join(repository, 'bun.lock'))})
  if (process.env.DEPFRESH_LIVE_TEST_FAIL_SECOND === '1' && invocationCount === 3) process.exitCode = 17
  else if (args[5] === '--long') {
    const fault = process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT
    if (fault === 'duplicate-long-ids') process.stdout.write(${JSON.stringify(longScreen('duplicate-ids'))})
    else if (fault === 'long-owner-mismatch') process.stdout.write(${JSON.stringify(longScreen('owner-mismatch'))})
    else if (fault === 'long-shared-mismatch') process.stdout.write(${JSON.stringify(longScreen('shared-mismatch'))})
    else if (fault === 'long-occurrence-duplicate') process.stdout.write(${JSON.stringify(longScreen('occurrence-duplicate'))})
    else if (fault === 'long-target-mismatch') process.stdout.write(${JSON.stringify(longScreen('target-mismatch'))})
    else if (fault === 'long-target-distribution-mismatch') process.stdout.write(${JSON.stringify(crossRelationshipLongScreen('target-distribution'))})
    else if (fault === 'long-dependency-cardinality-mismatch') process.stdout.write(${JSON.stringify(crossRelationshipLongScreen('dependency-cardinality'))})
    else if (fault === 'long-dependency-owner-pair-mismatch') process.stdout.write(${JSON.stringify(crossRelationshipLongScreen('dependency-owner-pair'))})
    else if (fault === 'long-operation-owner-mismatch') process.stdout.write(${JSON.stringify(crossRelationshipLongScreen('operation-owner'))})
    else if (fault === 'long-empty-owner-id') process.stdout.write(${JSON.stringify(longScreen('empty-owner-id'))})
    else if (fault === 'long-duplicate-section') process.stdout.write(${JSON.stringify(longScreen('duplicate-section'))})
    else if (fault === 'long-major-risk-mismatch') process.stdout.write(${JSON.stringify(majorRiskMismatchScreen())})
    else if (fault === 'long-duplicate-major-card') process.stdout.write(${JSON.stringify(duplicateMajorCardScreen())})
    else process.stdout.write(${JSON.stringify(longScreen())})
  }
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'missing-row-with-severity-note') process.stdout.write(${JSON.stringify(hybridScreen('missing-row-with-severity-note'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'duplicate-row') process.stdout.write(${JSON.stringify(hybridScreen('duplicate-row'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'duplicate-row-different-age') process.stdout.write(${JSON.stringify(hybridScreen('duplicate-row-different-age'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'duplicate-row-inline-compatibility') process.stdout.write(${JSON.stringify(hybridScreen('duplicate-row-inline-compatibility'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'duplicate-row-continuation-compatibility') process.stdout.write(${JSON.stringify(hybridScreen('duplicate-row-continuation-compatibility'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'default-topology-file-mismatch') process.stdout.write(${JSON.stringify(hybridScreen('topology-file-mismatch'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'default-receipt-file-mismatch') process.stdout.write(${JSON.stringify(hybridScreen('receipt-file-mismatch'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'default-severity-mismatch') process.stdout.write(${JSON.stringify(hybridScreen('severity-mismatch'))})
  else if (process.env.DEPFRESH_LIVE_TEST_SCREEN_FAULT === 'default-physical-file-mismatch') process.stdout.write(${JSON.stringify(hybridScreen('physical-file-mismatch'))})
  else process.stdout.write(process.stdout.columns >= 100 ? ${JSON.stringify(hybridScreen('wide'))} : ${JSON.stringify(hybridScreen())})
} else {
  process.exitCode = 17
}
`,
  )
  chmodSync(bunPath, 0o755)
  if (options.regularBunx) {
    copyFileSync(bunPath, bunxPath)
    chmodSync(bunxPath, 0o755)
  } else {
    symlinkSync('bun', bunxPath)
  }
  const environment = {
    HOME: root,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: [fakeBin, dirname(process.execPath), '/usr/bin'].join(':'),
    TERM: 'xterm-256color',
  }
  return {
    root,
    repository,
    artifactRoot,
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
    packageRunnerMarker,
    options: {
      columns: [80, 118],
      cwd: repository,
      environment,
      includeLong: true,
      outputPath,
      packJsonPath,
      publicationHooks: undefined,
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

function hybridScreen(
  fault?:
    | 'duplicate-row'
    | 'duplicate-row-continuation-compatibility'
    | 'duplicate-row-different-age'
    | 'duplicate-row-inline-compatibility'
    | 'missing-row-with-severity-note'
    | 'physical-file-mismatch'
    | 'receipt-file-mismatch'
    | 'severity-mismatch'
    | 'topology-file-mismatch'
    | 'wide',
) {
  const rows =
    fault === 'duplicate-row'
      ? `alpha       ^1.0.0 → ^2.0.0   Major     ~1d
beta        ^1.0.0 → ^1.1.0   Minor     ~1d
alpha       ^1.0.0 → ^2.0.0   Major     ~1d`
      : fault === 'duplicate-row-different-age'
        ? `alpha       ^1.0.0 → ^2.0.0   Major     ~1d
beta        ^1.0.0 → ^1.1.0   Minor     ~1d
alpha       ^1.0.0 → ^2.0.0   Major     ~2d`
        : fault === 'duplicate-row-inline-compatibility'
          ? `alpha [compat unknown: first]   ^1.0.0 → ^2.0.0   Major     ~1d
beta                             ^1.0.0 → ^1.1.0   Minor     ~1d
alpha [compat unknown: second]  ^1.0.0 → ^2.0.0   Major     ~2d`
          : fault === 'duplicate-row-continuation-compatibility'
            ? `alpha       ^1.0.0 → ^2.0.0   Major     ~1d
  compat unknown: first
beta        ^1.0.0 → ^1.1.0   Minor     ~1d
alpha       ^1.0.0 → ^2.0.0   Major     ~2d
  compat unknown: second`
            : fault === 'missing-row-with-severity-note'
              ? `alpha       ^1.0.0 → ^2.0.0   Major     ~1d
beta        ^1.0.0 → ^1.1.0   Minor     ~1d
Release note Major migration`
              : fault === 'wide'
                ? `alpha       ^1.0.0  ^2.0.0  Major     ~1d
beta        ^1.0.0  ^1.1.0  Minor     ~1d
gamma       ^1.0.0  ^1.0.1  Patch     ~1d`
                : `alpha       ^1.0.0 → ^2.0.0   Major     ~1d
beta        ^1.0.0 → ^1.1.0   Minor     ~1d
gamma       ^1.0.0 → ^1.0.1   Patch     ~1d`
  const heading =
    fault === 'wide'
      ? 'dependency  current  target  severity  age'
      : 'dependency  current → target  severity  age'
  const topologyFiles = fault === 'topology-file-mismatch' ? 2 : 1
  const receiptFiles = fault === 'receipt-file-mismatch' ? 2 : 1
  const severity =
    fault === 'severity-mismatch'
      ? 'Major 2 · Minor 0 · Patch 1'
      : [
            'duplicate-row-continuation-compatibility',
            'duplicate-row-different-age',
            'duplicate-row-inline-compatibility',
          ].includes(fault ?? '')
        ? 'Major 2 · Minor 1 · Patch 0'
        : 'Major 1 · Minor 1 · Patch 1'
  const ledger =
    fault === 'physical-file-mismatch'
      ? `spreadu-a · packages/a/package.json
  dependencies
${heading}
alpha       ^1.0.0 → ^2.0.0   Major     ~1d
beta        ^1.0.0 → ^1.1.0   Minor     ~1d

spreadu-b · packages/b/package.json
  dependencies
${heading}
gamma       ^1.0.0 → ^1.0.1   Patch     ~1d`
      : `spreadu · package.json
  dependencies
${heading}
${rows}`
  return `spreadu · bun 1.3.14 · workspace · major · read-only
1 packages · 3 declared · 3 eligible · 3 updates · ${topologyFiles} files

${severity}
████████████████████████████████████████

Breaking changes
alpha
  ^1.0.0 → ^2.0.0 · root

${ledger}
Review complete · 3 updates across ${receiptFiles} files · write not attempted
Exit 0
`
}

function longScreen(
  fault?:
    | 'duplicate-ids'
    | 'duplicate-section'
    | 'empty-owner-id'
    | 'occurrence-duplicate'
    | 'owner-mismatch'
    | 'shared-mismatch'
    | 'target-mismatch',
) {
  const riskHeading = fault === 'duplicate-section' ? 'Risk focus\nRisk focus' : 'Risk focus'
  const ownerId = fault === 'empty-owner-id' ? '' : 'owner-1'
  const ownerUpdates = fault === 'owner-mismatch' ? 2 : 3
  const secondOccurrencePath =
    fault === 'occurrence-duplicate' ? 'dependencies / alpha-1' : 'dependencies / alpha-2'
  const thirdOccurrenceOwner = fault === 'shared-mismatch' ? 'unknown-owner' : 'spreadu'
  const targetUpdates = fault === 'target-mismatch' ? 2 : 3
  return `spreadu · bun 1.3.14 · workspace · major · read-only
1 packages → 3 declared → 3 eligible → 3 updates → 1 files
${riskHeading}
Major card
Dependency alpha
Transition ^1.0.0 → ^2.0.0
Occurrences 1
Age ~1d
Compatibility compatible 0 · incompatible 0 · unknown 1
├ Owner spreadu
├ Target package.json
Owner impact
Owner ID ${ownerId}
Owner spreadu
Target package.json
├ Updates ${ownerUpdates} · Major 1 · Minor 1 · Patch 1
Shared dependencies
Dependency ID dependency-1
Dependency alpha
Occurrence
├ Owner spreadu
├ Source dependencies
├ Path dependencies / alpha-1
Occurrence
├ Owner spreadu
├ Source dependencies
├ Path ${secondOccurrencePath}
Occurrence
├ Owner ${thirdOccurrenceOwner}
├ Source dependencies
├ Path dependencies / alpha-3
Complete change list
Owner spreadu · package.json
Operation ID operation-1
Dependency alpha
Diff major
Operation ID operation-2
Dependency alpha
Diff minor
Operation ID ${fault === 'duplicate-ids' ? 'operation-2' : 'operation-3'}
Dependency alpha
Diff patch
Reviewed physical targets
Target package.json · ${targetUpdates} updates
Review complete
3 updates reviewed across 1 targets.
Exit 0
`
}

function crossRelationshipLongScreen(
  fault:
    | 'dependency-cardinality'
    | 'dependency-owner-pair'
    | 'operation-owner'
    | 'target-distribution',
) {
  const operationDependencies =
    fault === 'dependency-cardinality' ? ['alpha', 'beta', 'beta'] : ['alpha', 'alpha', 'beta']
  const targetUpdates = fault === 'target-distribution' ? [1, 2] : [2, 1]
  const firstOperationOwner = fault === 'operation-owner' ? 'owner-b' : 'owner-a'
  return `spreadu · bun 1.3.14 · workspace · major · read-only
1 packages → 3 declared → 3 eligible → 3 updates → 2 files
Risk focus
Major card
Dependency alpha
Transition ^1.0.0 → ^2.0.0
Occurrences 1
Age ~1d
Compatibility compatible 0 · incompatible 0 · unknown 1
├ Owner owner-a
├ Target a.json
Owner impact
Owner ID owner-1
Owner owner-a
Target a.json
├ Updates 2 · Major 1 · Minor 1 · Patch 0
Owner ID owner-2
Owner owner-b
Target b.json
├ Updates 1 · Major 0 · Minor 0 · Patch 1
Shared dependencies
Dependency ID dependency-1
Dependency alpha
Occurrence
├ Owner owner-a
├ Source dependencies
├ Path dependencies / alpha-1
Occurrence
├ Owner owner-b
├ Source dependencies
├ Path dependencies / alpha-2
Complete change list
Owner ${firstOperationOwner} · a.json
Operation ID operation-1
Dependency ${operationDependencies[0]}
Diff major
Operation ID operation-2
Dependency ${operationDependencies[1]}
Diff minor
Owner owner-b · b.json
Operation ID operation-3
Dependency ${operationDependencies[2]}
Diff patch
Reviewed physical targets
Target a.json · ${targetUpdates[0]} updates
Target b.json · ${targetUpdates[1]} update
Review complete
3 updates reviewed across 2 targets.
Exit 0
`
}

function majorRiskMismatchScreen() {
  return `spreadu · bun 1.3.14 · workspace · major · read-only
1 packages → 3 declared → 3 eligible → 3 updates → 1 files
Risk focus
Major card
Dependency beta
Transition ^1.0.0 → ^2.0.0
Occurrences 1
Age ~1d
Compatibility compatible 0 · incompatible 0 · unknown 1
├ Owner spreadu
├ Target package.json
Owner impact
Owner ID owner-1
Owner spreadu
Target package.json
├ Updates 3 · Major 1 · Minor 1 · Patch 1
Shared dependencies
Dependency ID dependency-1
Dependency beta
Occurrence
├ Owner spreadu
├ Source dependencies
├ Path dependencies / beta-1
Occurrence
├ Owner spreadu
├ Source dependencies
├ Path dependencies / beta-2
Complete change list
Owner spreadu · package.json
Operation ID operation-1
Dependency alpha
Diff major
Operation ID operation-2
Dependency beta
Diff minor
Operation ID operation-3
Dependency beta
Diff patch
Reviewed physical targets
Target package.json · 3 updates
Review complete
3 updates reviewed across 1 targets.
Exit 0
`
}

function duplicateMajorCardScreen() {
  return `spreadu · bun 1.3.14 · workspace · major · read-only
1 packages → 3 declared → 3 eligible → 3 updates → 1 files
Risk focus
Major card
Dependency alpha
Transition ^1.0.0 → ^2.0.0
Occurrences 1
Age ~1d
Compatibility compatible 0 · incompatible 0 · unknown 1
├ Owner spreadu
├ Target package.json
Major card
Dependency alpha
Transition ^1.0.0 → ^2.0.0
Occurrences 1
Age ~1d
Compatibility compatible 0 · incompatible 0 · unknown 1
├ Owner spreadu
├ Target package.json
Owner impact
Owner ID owner-1
Owner spreadu
Target package.json
├ Updates 3 · Major 2 · Minor 0 · Patch 1
Shared dependencies
Dependency ID dependency-1
Dependency alpha
Occurrence
├ Owner spreadu
├ Source dependencies
├ Path dependencies / alpha-1
Occurrence
├ Owner spreadu
├ Source dependencies
├ Path dependencies / alpha-2
Complete change list
Owner spreadu · package.json
Operation ID operation-1
Dependency alpha
Diff major
Operation ID operation-2
Dependency alpha
Diff major
Operation ID operation-3
Dependency beta
Diff patch
Reviewed physical targets
Target package.json · 3 updates
Review complete
3 updates reviewed across 1 targets.
Exit 0
`
}

function sharedCatalogHybridScreen() {
  return `spreadu · bun 1.3.14 · workspace · major · read-only
1 packages · 2 declared · 2 eligible · 2 updates · 1 files

Major 1 · Minor 1 · Patch 0
████████████████████████████████████████

Breaking changes
alpha
  ^1.0.0 → ^2.0.0 · root

catalog-a · pnpm-workspace.yaml
  catalog
dependency  current → target  severity  age
alpha [compat unknown]  ^1.0.0 → ^2.0.0   Major     ~1d
  catalog catalog-a: pnpm-workspace.yaml

catalog-b · pnpm-workspace.yaml
  catalog
dependency  current → target  severity  age
beta        ^1.0.0 → ^1.1.0   Minor     ~1d
  compat incompatible: requires Node 24
  catalog catalog-b: pnpm-workspace.yaml
Review complete · 2 updates across 1 file · write not attempted
Exit 0
`
}

function pendingNames(root: string, options: { allowMissing?: boolean } = {}): string[] {
  try {
    return readdirSync(root).filter((name) => name.includes('.pending-'))
  } catch (error) {
    if (options.allowMissing === true && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function replaceSameBytes(path: string): void {
  const oldPath = `${path}.old`
  renameSync(path, oldPath)
  copyFileSync(oldPath, path)
  rmSync(oldPath)
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const canonicalRoot = realpathSync(root)
  roots.push(canonicalRoot)
  return canonicalRoot
}

function temporaryAliasRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join('/tmp', prefix)))
  roots.push(root)
  return root
}
