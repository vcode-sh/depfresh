import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
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
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runLocalPackageVerification } from '../scripts/verify-local-package.mjs'
import * as replayEvidence from '../scripts/visual-plus-replay-failure.mjs'

interface ReplayEvidenceApi {
  readStableRegularFile?: (
    path: string,
    options: {
      label: string
      maxBytes: number
      hooks?: { afterLstat?: () => void }
    },
  ) => { bytes: Buffer; identity: { device: string; inode: string; sha256: string } }
  isCompleteVisualPlusReplayReport?: (
    report: unknown,
    expected: { files: number; suites: number; tests: number },
  ) => boolean
  writeVisualPlusReplayEvidence?: (options: {
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
      beforePendingChmod?: (input: { pendingDescriptor: number; pendingPath: string }) => void
      beforeDescriptorClose?: (input: {
        parentDescriptor: number
        pendingDescriptor: number
      }) => void
      beforePendingInitialStat?: (input: { pendingDescriptor: number; pendingPath: string }) => void
      beforePendingCleanup?: () => void
    }
  }) => unknown
}

const replayEvidenceApi = replayEvidence as unknown as ReplayEvidenceApi

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('local package verification deadlines', () => {
  it('times out hanging pack and verifier children and removes every owned temp root', () => {
    if (process.platform === 'win32') return

    const fixture = temporaryRoot('depfresh-verifier-deadline-')
    const repositoryRoot = join(fixture, 'repository')
    const temporaryParent = join(fixture, 'owned-temporary-roots')
    const hangingNpm = writeExecutable(
      fixture,
      'hanging-npm',
      `#!/usr/bin/env node
process.stdout.write('raw-pack-secret')
setInterval(() => {}, 1_000)
`,
    )
    const successfulNpm = writeExecutable(
      fixture,
      'successful-npm',
      `#!/usr/bin/env node
process.stdout.write('[{"filename":"unused.tgz"}]')
`,
    )
    const hangingVerifier = writeExecutable(
      fixture,
      'hanging-verifier',
      `#!/usr/bin/env node
process.stderr.write('raw-verifier-secret')
setInterval(() => {}, 1_000)
`,
    )
    mkdirSync(repositoryRoot)
    mkdirSync(temporaryParent)
    const startedAt = Date.now()

    const packResult = runLocalPackageVerification({
      repositoryRoot,
      temporaryParent,
      npmExecutable: hangingNpm,
      verifierPath: hangingVerifier,
      packTimeoutMs: 100,
      verifierTimeoutMs: 100,
    })
    expect(packResult).toEqual({
      exitCode: 1,
      failureMessage: 'Local package creation timed out',
    })
    expect(readdirSync(temporaryParent)).toEqual([])

    const verifierResult = runLocalPackageVerification({
      repositoryRoot,
      temporaryParent,
      npmExecutable: successfulNpm,
      verifierPath: hangingVerifier,
      packTimeoutMs: 100,
      verifierTimeoutMs: 100,
    })
    expect(verifierResult).toEqual({
      exitCode: 1,
      failureMessage: 'Local package verifier timed out',
    })
    expect(readdirSync(temporaryParent)).toEqual([])
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(JSON.stringify([packResult, verifierResult])).not.toMatch(
      /raw-pack-secret|raw-verifier-secret|Error:/u,
    )
  })

  it('keeps production deadlines fixed across the wrapper and packed verifier', () => {
    const localVerifier = readFileSync('scripts/verify-local-package.mjs', 'utf8')
    const packedVerifier = readFileSync('scripts/verify-packed-package.mjs', 'utf8')

    expect(localVerifier).toContain('LOCAL_PACK_TIMEOUT_MS')
    expect(localVerifier).toContain('PACKED_VERIFIER_TIMEOUT_MS')
    expect(localVerifier).not.toMatch(/process\.env\..*TIMEOUT|--timeout/u)
    expect(
      packedVerifier.match(/timeout: PACKED_COMMAND_TIMEOUT_MS/gu).length,
    ).toBeGreaterThanOrEqual(2)
    expect(packedVerifier).not.toMatch(/process\.env\..*TIMEOUT|--timeout/u)
  })

  it('keeps the installed-artifact Visual+ replay fixed, path-bound, and private', () => {
    const packedVerifier = readFileSync('scripts/verify-packed-package.mjs', 'utf8')
    const replayFailure = readFileSync('scripts/visual-plus-replay-failure.mjs', 'utf8')
    const visualPlusTest = readFileSync('test/visual-plus-cli.test.ts', 'utf8')

    expect(packedVerifier).toContain("'--visual-plus'")
    expect(packedVerifier).toContain("'--evidence'")
    expect(packedVerifier).toContain("'package/dist/cli.mjs'")
    expect(packedVerifier).toContain('DEPFRESH_VISUAL_PLUS_CLI_PATH')
    expect(packedVerifier).toContain('DEPFRESH_VISUAL_PLUS_INSTALL_ROOT')
    expect(packedVerifier).toContain('executes the selected CLI artifact')
    expect(packedVerifier).toContain('test/visual-plus-cli.test.ts')
    expect(packedVerifier).toContain("'--retry=0'")
    expect(packedVerifier).toContain('readVisualPlusReplayReport')
    expect(packedVerifier).toContain('visualPlusReplayFailureMessage')
    expect(packedVerifier).toContain('writeVisualPlusReplayEvidence')
    expect(packedVerifier).toContain('readInstalledDistribution')
    expect(packedVerifier).toContain("name.endsWith('.mjs')")
    expect(replayFailure).toContain('MAX_VISUAL_PLUS_REPORT_BYTES = 256 * 1024')
    expect(replayFailure).toContain('lstatSync(reportPath)')
    expect(replayFailure).toContain(['classification: $', '{classification}'].join(''))
    expect(packedVerifier).toContain('cliSha256')
    expect(packedVerifier).toContain('passedTests')
    expect(packedVerifier).toContain('const VISUAL_PLUS_PASSED_TESTS = 69')
    expect(packedVerifier).toContain('VISUAL_PLUS_REPLAY_TIMEOUT_MS = 15 * 60_000')
    expect(packedVerifier).toContain('timeoutMs: PACKED_COMMAND_TIMEOUT_MS')
    expect(packedVerifier).toContain('timeoutMs: VISUAL_PLUS_REPLAY_TIMEOUT_MS')
    expect(packedVerifier).toContain('createVisualPlusEnvironment')
    expect(packedVerifier).toContain('visual-plus-environment')
    expect(packedVerifier).toContain('XDG_CACHE_HOME')
    expect(packedVerifier).not.toContain('env: { ...process.env')
    expect(packedVerifier).not.toContain('shell: true')
    expect(visualPlusTest).toContain("describe.sequential('CI constrained PTY fallback'")
    expect(visualPlusTest).toContain("describe.sequential('TERM=dumb constrained PTY fallback'")
    expect(visualPlusTest).toContain(
      "it('classifies raw terminal transport without exposing capture data'",
    )
    expect(replayFailure).toContain("'fallback-ci-transport'")
    for (const readiness of [
      'journeyReady',
      'executionReady',
      'semanticsReady',
      'rawTransportReady',
      'controlsReady',
      'transitionsReady',
    ]) {
      expect(visualPlusTest, readiness).toContain(`let ${readiness} = false`)
    }
    for (const readiness of ['captureReady', 'transportReady', 'lineEndingReady']) {
      expect(visualPlusTest, readiness).toContain(`let ${readiness} = false`)
    }
    expect(visualPlusTest).toContain('expect(journeyReady).toBe(true)')
    expect(visualPlusTest).toContain('catch {}')
    expect(visualPlusTest).not.toContain('let runError: unknown')
  })

  it('requires exact complete installed Visual+ test and suite totals', () => {
    const validate = replayEvidenceApi.isCompleteVisualPlusReplayReport
    expect(validate).toBeTypeOf('function')
    if (!validate) return

    const complete = {
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

    expect(validate(complete, { files: 1, suites: 5, tests: 69 })).toBe(true)
    for (const incomplete of [
      { ...complete, numFailedTests: 1 },
      { ...complete, numFailedTestSuites: 1 },
      { ...complete, numPassedTests: 57 },
      { ...complete, numPassedTestSuites: 4 },
      { ...complete, numPendingTests: 1 },
      { ...complete, numPendingTestSuites: 1 },
      { ...complete, numTodoTests: 1 },
      { ...complete, numTotalTests: 59 },
      { ...complete, numTotalTestSuites: 6 },
      { ...complete, testResults: [] },
      {
        ...complete,
        testResults: [{ ...complete.testResults[0], status: 'failed' }],
      },
      {
        ...complete,
        testResults: [
          {
            ...complete.testResults[0],
            assertionResults: complete.testResults[0].assertionResults.slice(1),
          },
        ],
      },
      {
        ...complete,
        testResults: [
          {
            ...complete.testResults[0],
            assertionResults: [
              ...complete.testResults[0].assertionResults.slice(1),
              { status: 'failed' },
            ],
          },
        ],
      },
    ]) {
      expect(
        validate(incomplete, { files: 1, suites: 5, tests: 69 }),
        JSON.stringify(incomplete),
      ).toBe(false)
    }
    expect(validate({}, { files: 1, suites: 5, tests: 69 })).toBe(false)
    expect(validate(complete, { files: 0, suites: 5, tests: 69 })).toBe(false)
    expect(validate(complete, { files: 1, suites: 0, tests: 69 })).toBe(false)
    expect(validate(complete, { files: 1, suites: 5, tests: 0 })).toBe(false)
  })

  it('atomically writes a contained schema-versioned installed replay identity', () => {
    const writeEvidence = replayEvidenceApi.writeVisualPlusReplayEvidence
    expect(writeEvidence).toBeTypeOf('function')
    if (!writeEvidence) return
    const fixture = replayFixture()

    const evidence = writeEvidence(fixture.options)

    expect(JSON.parse(readFileSync(fixture.outputPath, 'utf8'))).toEqual(evidence)
    expect(evidence).toEqual({
      schemaVersion: 1,
      kind: 'depfresh-installed-visual-plus-replay',
      packageVersion: '2.1.2',
      tarball: {
        realpath: fixture.tarballPath,
        sha256: fixture.tarballSha256,
      },
      extractedPackage: { realpath: fixture.installedRoot },
      cli: {
        realpath: fixture.cliPath,
        sha256: fixture.cliSha256,
      },
      passed: { files: 1, suites: 5, tests: 69 },
    })
    expect(readdirSync(fixture.root).filter((name) => name.includes('.pending-'))).toEqual([])
  })

  it('rejects unsafe replay outputs, incomplete runs, and changed identities without residue', () => {
    const writeEvidence = replayEvidenceApi.writeVisualPlusReplayEvidence
    expect(writeEvidence).toBeTypeOf('function')
    if (!writeEvidence) return

    for (const fault of [
      'existing-output',
      'symlink-output',
      'outside-output',
      'incomplete-run',
      'tarball-mismatch',
      'cli-mismatch',
      'version-mismatch',
    ]) {
      const fixture = replayFixture()
      const outsidePath = join(temporaryRoot('depfresh-evidence-outside-'), 'evidence.json')
      const options = { ...fixture.options }
      if (fault === 'existing-output') writeFileSync(fixture.outputPath, 'existing')
      if (fault === 'symlink-output') symlinkSync(fixture.tarballPath, fixture.outputPath)
      if (fault === 'outside-output') options.outputPath = outsidePath
      if (fault === 'incomplete-run') {
        options.report = { ...fixture.completeReport, numPassedTests: 57 }
      }
      if (fault === 'tarball-mismatch') options.tarballSha256 = '0'.repeat(64)
      if (fault === 'cli-mismatch') options.cliSha256 = '0'.repeat(64)
      if (fault === 'version-mismatch') options.packageVersion = '2.1.0'

      expect(() => writeEvidence(options), fault).toThrow()
      if (!['existing-output', 'symlink-output'].includes(fault)) {
        expect(() => readFileSync(options.outputPath), fault).toThrow()
      }
      expect(
        readdirSync(fixture.root).filter((name) => name.includes('.pending-')),
        fault,
      ).toEqual([])
    }
  })

  it('canonicalizes macOS temp aliases for every existing input and the absent output', () => {
    if (process.platform !== 'darwin') return
    const writeEvidence = replayEvidenceApi.writeVisualPlusReplayEvidence
    expect(writeEvidence).toBeTypeOf('function')
    if (!writeEvidence) return
    const fixture = replayFixture(temporaryAliasRoot('depfresh-installed-replay-alias-'))
    const alias = (path: string) => path.replace(/^\/private\/tmp\//u, '/tmp/')

    const evidence = writeEvidence({
      ...fixture.options,
      cliPath: alias(fixture.cliPath),
      containmentRoot: alias(fixture.root),
      installedRoot: alias(fixture.installedRoot),
      outputPath: alias(fixture.outputPath),
      tarballPath: alias(fixture.tarballPath),
    }) as { cli: { realpath: string }; tarball: { realpath: string } }

    expect(evidence.cli.realpath).toBe(fixture.cliPath)
    expect(evidence.tarball.realpath).toBe(fixture.tarballPath)
    expect(JSON.parse(readFileSync(fixture.outputPath, 'utf8'))).toEqual(evidence)
  })

  it('rejects parent replacement without report or pending residue', () => {
    const writeEvidence = replayEvidenceApi.writeVisualPlusReplayEvidence
    expect(writeEvidence).toBeTypeOf('function')
    if (!writeEvidence) return

    const replaced = replayFixture()
    const relocated = `${replaced.root}-relocated`
    roots.push(relocated)
    expect(() =>
      writeEvidence({
        ...replaced.options,
        publicationHooks: {
          afterPendingCreated: ({ parentPath }) => {
            renameSync(parentPath, relocated)
            mkdirSync(parentPath)
            return { relocatedParentPath: relocated }
          },
        },
      }),
    ).toThrow()
    expect(() => readFileSync(replaced.outputPath)).toThrow()
    expect(pendingNames(replaced.root)).toEqual([])
    expect(pendingNames(relocated)).toEqual([])
  })

  it('reports cleanup faults without report or pending residue', () => {
    const writeEvidence = replayEvidenceApi.writeVisualPlusReplayEvidence
    expect(writeEvidence).toBeTypeOf('function')
    if (!writeEvidence) return
    const cleanupFault = replayFixture()
    expect(() =>
      writeEvidence({
        ...cleanupFault.options,
        publicationHooks: {
          afterPendingCreated: () => {
            throw new Error('deterministic primary fault')
          },
          beforePendingCleanup: () => {
            throw new Error('deterministic cleanup fault')
          },
        },
      }),
    ).toThrow(/cleanup/u)
    expect(() => readFileSync(cleanupFault.outputPath)).toThrow()
    expect(pendingNames(cleanupFault.root)).toEqual([])
  })

  it('removes a published report when descriptor cleanup fails', () => {
    const writeEvidence = replayEvidenceApi.writeVisualPlusReplayEvidence
    expect(writeEvidence).toBeTypeOf('function')
    if (!writeEvidence) return
    const cleanupFault = replayFixture()

    expect(() =>
      writeEvidence({
        ...cleanupFault.options,
        publicationHooks: {
          beforeDescriptorClose: ({ pendingDescriptor }) => {
            closeSync(pendingDescriptor)
          },
        },
      }),
    ).toThrow(/cleanup/u)
    expect(() => readFileSync(cleanupFault.outputPath)).toThrow()
    expect(pendingNames(cleanupFault.root)).toEqual([])
  })

  it.each(['initial-stat', 'chmod'] as const)(
    'removes the pending file when early %s setup fails',
    (fault) => {
      const writeEvidence = replayEvidenceApi.writeVisualPlusReplayEvidence
      expect(writeEvidence).toBeTypeOf('function')
      if (!writeEvidence) return
      const cleanupFault = replayFixture()
      const closePending = ({ pendingDescriptor }: { pendingDescriptor: number }) => {
        closeSync(pendingDescriptor)
      }

      expect(() =>
        writeEvidence({
          ...cleanupFault.options,
          publicationHooks:
            fault === 'initial-stat'
              ? { beforePendingInitialStat: closePending }
              : { beforePendingChmod: closePending },
        }),
      ).toThrow()
      expect(() => readFileSync(cleanupFault.outputPath)).toThrow()
      expect(pendingNames(cleanupFault.root)).toEqual([])
    },
  )

  it('rejects lstat-to-open replacement even when replacement bytes are identical', () => {
    const readStable = replayEvidenceApi.readStableRegularFile
    expect(readStable).toBeTypeOf('function')
    if (!readStable) return
    const root = temporaryRoot('depfresh-stable-read-')
    const path = join(root, 'identity.bin')
    const oldPath = join(root, 'identity.old')
    writeFileSync(path, 'identical bytes')

    expect(() =>
      readStable(path, {
        label: 'identity fixture',
        maxBytes: 1024,
        hooks: {
          afterLstat: () => {
            renameSync(path, oldPath)
            writeFileSync(path, readFileSync(oldPath))
          },
        },
      }),
    ).toThrow()
  })
})

function pendingNames(root: string): string[] {
  return readdirSync(root).filter((name) => name.includes('.pending-'))
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const canonicalRoot = realpathSync(root)
  roots.push(canonicalRoot)
  return canonicalRoot
}

function writeExecutable(root: string, name: string, content: string): string {
  const path = join(root, name)
  writeFileSync(path, content)
  chmodSync(path, 0o755)
  return path
}

function temporaryAliasRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join('/tmp', prefix)))
  roots.push(root)
  return root
}

function replayFixture(root = temporaryRoot('depfresh-installed-replay-')) {
  const tarballPath = join(root, 'depfresh-2.1.2.tgz')
  const installedRoot = join(root, 'node_modules', 'depfresh')
  const cliPath = join(installedRoot, 'dist', 'cli.mjs')
  const outputPath = join(root, 'installed-replay.json')
  const tarballBytes = Buffer.from('exact packed artifact')
  const cliBytes = Buffer.from('#!/usr/bin/env node\n')
  mkdirSync(join(installedRoot, 'dist'), { recursive: true })
  writeFileSync(tarballPath, tarballBytes)
  writeFileSync(join(installedRoot, 'package.json'), '{"name":"depfresh","version":"2.1.2"}\n')
  writeFileSync(cliPath, cliBytes)
  const completeReport = {
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
  const tarballSha256 = createHash('sha256').update(tarballBytes).digest('hex')
  const cliSha256 = createHash('sha256').update(cliBytes).digest('hex')
  return {
    root,
    tarballPath,
    installedRoot,
    cliPath,
    outputPath,
    tarballSha256,
    cliSha256,
    completeReport,
    options: {
      cliPath,
      cliSha256,
      containmentRoot: root,
      expected: { files: 1, suites: 5, tests: 69 },
      installedRoot,
      outputPath,
      packageVersion: '2.1.2',
      report: completeReport,
      tarballPath,
      tarballSha256,
    },
  }
}
