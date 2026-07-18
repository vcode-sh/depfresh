import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILD_RUNS = 3
const BUILD_TIMEOUT_MS = 3 * 60_000
const MAX_BUILD_OUTPUT_BYTES = 4 * 1024 * 1024
const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(dirname(scriptPath), '..')
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const packageManagerEntrypoint = process.env.npm_execpath
if (!packageManagerEntrypoint) {
  fail('Declaration verification must run through the package-manager script.')
}
const declarationPaths = [
  'dist/cli.d.mts',
  'dist/cli.d.ts',
  'dist/index.d.mts',
  'dist/index.d.ts',
]
const publishedHashesByVersion = {
  '2.0.2': {
    'dist/cli.d.mts': '4bd5186f89b856606fcd365feda2e5daa184651613339dcbc297e371b26dd169',
    'dist/cli.d.ts': '4bd5186f89b856606fcd365feda2e5daa184651613339dcbc297e371b26dd169',
    'dist/index.d.mts': '20b09bde761af43f1c40f5d3ea7996e7f84b65acf5d7011999af0900c3889785',
    'dist/index.d.ts': '20b09bde761af43f1c40f5d3ea7996e7f84b65acf5d7011999af0900c3889785',
  },
}

const publishedHashes = publishedHashesByVersion[packageJson.version]
if (!publishedHashes) {
  fail(`No published declaration baseline is recorded for depfresh ${packageJson.version}`)
}

const observedHashes = []
for (let run = 1; run <= BUILD_RUNS; run++) {
  runBuild(run)
  const hashes = Object.fromEntries(
    declarationPaths.map((path) => [path, hashFile(join(repositoryRoot, path))]),
  )
  observedHashes.push(hashes)
  process.stdout.write(
    `Declaration build ${run}/${BUILD_RUNS}: ${declarationPaths
      .map((path) => `${path}=${hashes[path]}`)
      .join(' ')}\n`,
  )
}

const failures = []
for (const path of declarationPaths) {
  const hashes = observedHashes.map((run) => run[path])
  if (new Set(hashes).size !== 1) {
    failures.push(`${path} was not byte-stable: ${hashes.join(', ')}`)
  }
  if (hashes.some((hash) => hash !== publishedHashes[path])) {
    failures.push(`${path} did not match the published ${packageJson.version} declaration`)
  }
}

if (failures.length > 0) fail(failures.join('\n'))
process.stdout.write(
  `Declaration stability verification passed for ${declarationPaths.length} files across ${BUILD_RUNS} builds.\n`,
)

function runBuild(run) {
  const build = spawnSync(process.execPath, [packageManagerEntrypoint, 'build'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    maxBuffer: MAX_BUILD_OUTPUT_BYTES,
    shell: false,
    timeout: BUILD_TIMEOUT_MS,
  })

  if (build.error || build.status !== 0) {
    const detail = build.error?.code === 'ETIMEDOUT' ? 'timed out' : `exited ${build.status ?? 'null'}`
    const output = `${build.stdout ?? ''}${build.stderr ?? ''}`.trim()
    fail(`Declaration build ${run}/${BUILD_RUNS} ${detail}${output ? `\n${output}` : ''}`)
  }
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
