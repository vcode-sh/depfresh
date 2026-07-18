import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_PACK_OUTPUT_BYTES = 1024 * 1024
const MAX_VERIFIER_OUTPUT_BYTES = 1024 * 1024
const LOCAL_PACK_TIMEOUT_MS = 120_000
const PACKED_VERIFIER_TIMEOUT_MS = 30 * 60_000
const scriptPath = fileURLToPath(import.meta.url)
const defaultVerifierPath = join(dirname(scriptPath), 'verify-packed-package.mjs')

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const result = runLocalPackageVerification({
    repositoryRoot: process.cwd(),
    temporaryParent: tmpdir(),
    npmExecutable: platformNpmExecutable(),
    verifierPath: defaultVerifierPath,
    packTimeoutMs: LOCAL_PACK_TIMEOUT_MS,
    verifierTimeoutMs: PACKED_VERIFIER_TIMEOUT_MS,
  })
  if (result.output) process.stdout.write(result.output)
  if (result.failureMessage) process.stderr.write(`${result.failureMessage}\n`)
  process.exitCode = result.exitCode
}

export function runLocalPackageVerification(options) {
  let temporaryRoot
  let result = { exitCode: 1, failureMessage: 'Local package verification failed' }

  try {
    temporaryRoot = mkdtempSync(join(options.temporaryParent, 'depfresh-local-package-'))
    const manifestPath = join(temporaryRoot, 'pack.json')
    const pack = spawnSync(
      options.npmExecutable,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
      {
        cwd: options.repositoryRoot,
        encoding: 'utf8',
        killSignal: 'SIGKILL',
        maxBuffer: MAX_PACK_OUTPUT_BYTES,
        shell: false,
        timeout: options.packTimeoutMs,
      },
    )

    if (isTimedOut(pack.error)) {
      result = { exitCode: 1, failureMessage: 'Local package creation timed out' }
    } else if (pack.error || pack.status !== 0) {
      result = { exitCode: 1, failureMessage: 'Local package creation failed' }
    } else {
      writeFileSync(manifestPath, pack.stdout ?? '')
      const verifier = spawnSync(process.execPath, [options.verifierPath, manifestPath], {
        cwd: options.repositoryRoot,
        encoding: 'utf8',
        killSignal: 'SIGKILL',
        maxBuffer: MAX_VERIFIER_OUTPUT_BYTES,
        shell: false,
        timeout: options.verifierTimeoutMs,
      })

      if (isTimedOut(verifier.error)) {
        result = { exitCode: 1, failureMessage: 'Local package verifier timed out' }
      } else if (verifier.error || verifier.status === null) {
        result = { exitCode: 1, failureMessage: 'Local package verifier could not run' }
      } else if (verifier.status !== 0) {
        result = { exitCode: 1, failureMessage: 'Local package verification failed' }
      } else {
        result = { exitCode: 0, output: verifier.stdout ?? '' }
      }
    }
  } catch {
    result = { exitCode: 1, failureMessage: 'Local package verification failed' }
  } finally {
    if (temporaryRoot) {
      try {
        rmSync(temporaryRoot, { force: true, recursive: true })
      } catch {
        result = { exitCode: 1, failureMessage: 'Local package verification cleanup failed' }
      }
    }
  }

  return result
}

function isTimedOut(error) {
  return error && typeof error === 'object' && 'code' in error && error.code === 'ETIMEDOUT'
}

function platformNpmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}
