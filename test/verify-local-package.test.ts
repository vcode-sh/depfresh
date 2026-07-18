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
    expect(packedVerifier.match(/timeout: PACKED_COMMAND_TIMEOUT_MS/gu)).toHaveLength(2)
    expect(packedVerifier).not.toMatch(/process\.env\..*TIMEOUT|--timeout/u)
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
