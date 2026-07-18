import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_PACK_OUTPUT_BYTES = 1024 * 1024
const repositoryRoot = process.cwd()
const verifierPath = join(dirname(fileURLToPath(import.meta.url)), 'verify-packed-package.mjs')

let temporaryRoot
let exitCode = 1
let failureMessage

try {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'depfresh-local-package-'))
  const manifestPath = join(temporaryRoot, 'pack.json')
  const pack = spawnSync(
    npmExecutable(),
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: MAX_PACK_OUTPUT_BYTES,
      shell: false,
    },
  )

  if (pack.error || pack.status !== 0) {
    failureMessage = 'Local package creation failed'
  } else {
    writeFileSync(manifestPath, pack.stdout ?? '')
    const verifier = spawnSync(process.execPath, [verifierPath, manifestPath], {
      cwd: repositoryRoot,
      shell: false,
      stdio: 'inherit',
    })

    if (verifier.error || verifier.status === null) {
      failureMessage = 'Local package verifier could not run'
    } else {
      exitCode = verifier.status
    }
  }
} catch {
  failureMessage = 'Local package verification failed'
} finally {
  if (temporaryRoot) {
    try {
      rmSync(temporaryRoot, { force: true, recursive: true })
    } catch {
      failureMessage ??= 'Local package verification cleanup failed'
      if (exitCode === 0) exitCode = 1
    }
  }
}

if (failureMessage) process.stderr.write(`${failureMessage}\n`)
process.exitCode = exitCode

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}
