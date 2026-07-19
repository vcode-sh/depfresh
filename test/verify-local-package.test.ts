import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runLocalPackageVerification } from '../scripts/verify-local-package.mjs'

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

    expect(packedVerifier).toContain("'--visual-plus'")
    expect(packedVerifier).toContain("'package/dist/cli.mjs'")
    expect(packedVerifier).toContain('DEPFRESH_VISUAL_PLUS_CLI_PATH')
    expect(packedVerifier).toContain('DEPFRESH_VISUAL_PLUS_INSTALL_ROOT')
    expect(packedVerifier).toContain('executes the selected CLI artifact')
    expect(packedVerifier).toContain('test/visual-plus-cli.test.ts')
    expect(packedVerifier).toContain("'--retry=0'")
    expect(packedVerifier).toContain('readVisualPlusReplayReport')
    expect(packedVerifier).toContain('visualPlusReplayFailureMessage')
    expect(replayFailure).toContain('MAX_VISUAL_PLUS_REPORT_BYTES = 256 * 1024')
    expect(replayFailure).toContain('lstatSync(reportPath)')
    expect(replayFailure).toContain(['classification: $', '{classification}'].join(''))
    expect(packedVerifier).toContain('cliSha256')
    expect(packedVerifier).toContain('passedTests')
    expect(packedVerifier).toContain('VISUAL_PLUS_REPLAY_TIMEOUT_MS = 15 * 60_000')
    expect(packedVerifier).toContain('timeoutMs: PACKED_COMMAND_TIMEOUT_MS')
    expect(packedVerifier).toContain('timeoutMs: VISUAL_PLUS_REPLAY_TIMEOUT_MS')
    expect(packedVerifier).toContain('createVisualPlusEnvironment')
    expect(packedVerifier).toContain('visual-plus-environment')
    expect(packedVerifier).toContain('XDG_CACHE_HOME')
    expect(packedVerifier).not.toContain('env: { ...process.env')
    expect(packedVerifier).not.toContain('shell: true')
  })
})

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function writeExecutable(root: string, name: string, content: string): string {
  const path = join(root, name)
  writeFileSync(path, content)
  chmodSync(path, 0o755)
  return path
}
