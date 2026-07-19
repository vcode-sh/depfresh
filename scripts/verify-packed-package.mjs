import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { extractSinglePackEntry } from './pack-manifest.mjs'
import {
  readVisualPlusReplayReport,
  visualPlusReplayFailureMessage,
} from './visual-plus-replay-failure.mjs'

class PackageVerificationError extends Error {}

process.once('uncaughtException', (error) => {
  const message =
    error instanceof PackageVerificationError
      ? sanitizeFailureMessage(error.message)
      : 'Packed package verification failed'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const PACKED_COMMAND_TIMEOUT_MS = 120_000
const VISUAL_PLUS_REPLAY_TIMEOUT_MS = 15 * 60_000
const MAX_TARBALL_EXPANDED_BYTES = 50 * 1024 * 1024
const VISUAL_PLUS_PASSED_TESTS = 49
const command = parseCommand(process.argv.slice(2))
const manifestArgument = command.manifestPath
const explicitInstallSpec = command.installSpec
const visualPlus = command.visualPlus

if (!manifestArgument) fail('Usage: node scripts/verify-packed-package.mjs <pack.json> [--visual-plus] [--install-spec <exact-spec>]')

const manifestPath = resolve(manifestArgument)
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
let entry
try {
  entry = extractSinglePackEntry(manifest)
} catch (error) {
  fail(error instanceof Error ? error.message : 'Invalid npm pack manifest')
}
if (!isRecord(entry) || !Array.isArray(entry.files)) fail('Invalid npm pack manifest')
if (entry.name !== packageJson.name || entry.version !== packageJson.version) {
  fail('Packed package identity does not match package.json')
}

const expectedFilename = `${packageJson.name}-${packageJson.version}.tgz`
if (entry.filename !== expectedFilename || basename(entry.filename) !== entry.filename) {
  fail('Unexpected tarball filename')
}
if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity ?? '')) {
  fail('Missing exact SHA-512 integrity')
}
if (!/^[a-f0-9]{40}$/u.test(entry.shasum ?? '')) fail('Missing exact SHA-1 package checksum')
if (!Number.isSafeInteger(entry.size) || entry.size <= 0) fail('Invalid packed size')
if (!Number.isSafeInteger(entry.unpackedSize) || entry.unpackedSize <= 0) {
  fail('Invalid unpacked size')
}

const packedPaths = entry.files.map((file) => {
  if (!isRecord(file) || typeof file.path !== 'string') fail('Invalid packed file entry')
  return file.path
})
const requiredPaths = [
  'LICENSE',
  'README.md',
  'package.json',
  'dist/cli.mjs',
  'dist/index.d.ts',
  'dist/index.mjs',
  'dist/schemas/apply-v1.json',
  'dist/schemas/capabilities-v1.json',
  'dist/schemas/capabilities-v2.json',
  'dist/schemas/error-v1.json',
  'dist/schemas/global-apply-v1.json',
  'dist/schemas/global-plan-v1.json',
  'dist/schemas/inspect-v1.json',
  'dist/schemas/plan-v1.json',
  'dist/schemas/plan-v2.json',
  'skills/depfresh/SKILL.md',
  'skills/depfresh/examples/README.md',
  'skills/depfresh/examples/catalog-policy.json',
  'skills/depfresh/examples/protected-apply.yml',
  'skills/depfresh/examples/read-only-gate.yml',
  'skills/depfresh/recipes/ci.md',
  'skills/depfresh/recipes/manager-phases.md',
  'skills/depfresh/recipes/runners.md',
]
for (const path of requiredPaths) {
  if (!packedPaths.includes(path)) fail(`Missing packed asset: ${path}`)
}
for (const path of packedPaths) {
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').includes('..') ||
    !/^(?:LICENSE|README\.md|package\.json|dist\/|skills\/)/u.test(path)
  ) {
    fail(`Forbidden packed path: ${path}`)
  }
}

const tarballPath = resolve(dirname(manifestPath), entry.filename)
const tarballStat = lstatSync(tarballPath)
if (!tarballStat.isFile() || tarballStat.isSymbolicLink()) fail('Tarball is not a regular file')
if (tarballStat.size !== entry.size) fail('Tarball size does not match pack manifest')
const tarballBytes = readFileSync(tarballPath)
const integrity = `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`
if (integrity !== entry.integrity) fail('Tarball integrity does not match pack manifest')

const temporaryRoot = mkdtempSync(join(tmpdir(), 'depfresh-packed-'))
try {
  const project = join(temporaryRoot, 'consumer')
  const home = join(temporaryRoot, 'home')
  const cache = join(temporaryRoot, 'cache')
  const emptyUserConfig = join(temporaryRoot, 'empty-user.npmrc')
  const emptyGlobalConfig = join(temporaryRoot, 'empty-global.npmrc')
  mkdirSync(project, { recursive: true })
  mkdirSync(home)
  mkdirSync(cache)
  writeFileSync(emptyUserConfig, '')
  writeFileSync(emptyGlobalConfig, '')
  writeFileSync(join(project, 'package.json'), '{"private":true,"type":"module"}\n')

  const installSpec = explicitInstallSpec ?? realpathSync(tarballPath)
  if (explicitInstallSpec) {
    if (explicitInstallSpec !== `${packageJson.name}@${packageJson.version}`) {
      fail('Registry verification requires the exact package version')
    }
    const observedIntegrity = run(
      npmExecutable(),
      ['view', explicitInstallSpec, 'dist.integrity', `--registry=${PUBLIC_REGISTRY}`],
      {
        cwd: project,
        env: isolatedEnvironment(home, cache, emptyUserConfig, emptyGlobalConfig),
      },
    ).stdout.trim()
    if (observedIntegrity !== entry.integrity) fail('Published package integrity mismatch')
  }

  run(
    npmExecutable(),
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      `--registry=${PUBLIC_REGISTRY}`,
      `--userconfig=${emptyUserConfig}`,
      `--globalconfig=${emptyGlobalConfig}`,
      `--cache=${cache}`,
      installSpec,
    ],
    {
      cwd: project,
      env: isolatedEnvironment(home, cache, emptyUserConfig, emptyGlobalConfig),
    },
  )

  const installedRoot = join(project, 'node_modules', packageJson.name)
  const installedIndex = readFileSync(join(installedRoot, 'dist', 'index.mjs'), 'utf8')
  if (!installedIndex.includes('node:sqlite')) fail('Packed library does not retain node:sqlite')
  if (installedIndex.includes('better-sqlite3')) fail('Packed library contains an obsolete cache')
  const installedDeclarations = readFileSync(join(installedRoot, 'dist', 'index.d.ts'), 'utf8')
  for (const typeName of [
    'ArtifactTrustDimensionResult',
    'ArtifactTrustResult',
    'ArtifactVerificationTarget',
    'PlanResultV1',
    'PlanResultV2',
    'SelectionReceipt',
  ]) {
    if (!installedDeclarations.includes(typeName)) fail(`Missing public declaration: ${typeName}`)
  }
  const cliPath = join(installedRoot, 'dist', 'cli.mjs')
  const cliVersion = run(process.execPath, [cliPath, '--version'], {
    cwd: project,
    env: isolatedEnvironment(home, cache, emptyUserConfig, emptyGlobalConfig),
  })
  if (cliVersion.stderr !== '' || cliVersion.stdout.trim() !== packageJson.version) {
    fail('Packed CLI version mismatch')
  }
  const capabilitiesRun = run(process.execPath, [cliPath, 'capabilities', '--json'], {
    cwd: project,
    env: isolatedEnvironment(home, cache, emptyUserConfig, emptyGlobalConfig),
  })
  if (capabilitiesRun.stderr !== '') fail('Packed capabilities command wrote stderr')
  const visualPlusEvidence = visualPlus
    ? verifyVisualPlusReplay({ cliPath, installedRoot, tarballBytes, temporaryRoot })
    : undefined

  const runPackedCli = (label, cwd, args, expectedStatus) => {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf8',
      env: isolatedEnvironment(home, cache, emptyUserConfig, emptyGlobalConfig),
      killSignal: 'SIGKILL',
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      shell: false,
      timeout: PACKED_COMMAND_TIMEOUT_MS,
    })
    if (result.error || result.status !== expectedStatus || result.stderr !== '') {
      fail(`Packed ${label} selection command failed`)
    }
    try {
      return JSON.parse(result.stdout ?? '')
    } catch {
      fail(`Packed ${label} selection command returned invalid JSON`)
    }
  }

  const workspaceFixture = join(project, 'workspace-selection')
  mkdirSync(join(workspaceFixture, 'apps', 'admin'), { recursive: true })
  writeFileSync(
    join(workspaceFixture, 'package.json'),
    '{"name":"root","private":true}\n',
  )
  writeFileSync(join(workspaceFixture, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
  writeFileSync(
    join(workspaceFixture, 'apps', 'admin', 'package.json'),
    '{"name":"admin","private":true,"dependencies":{"workspace-probe":"1.0.0"}}\n',
  )
  const workspaceSelection = runPackedCli(
    'workspace',
    workspaceFixture,
    ['--output', 'json', '--exclude-workspace', 'apps/admin'],
    0,
  )
  if (
    workspaceSelection.selection?.summary?.matchedWorkspaces !== 1 ||
    workspaceSelection.selection?.summary?.excludedOccurrences !== 1
  ) {
    fail('Packed workspace selection receipt mismatch')
  }
  const workspaceManifestPath = join(workspaceFixture, 'apps', 'admin', 'package.json')
  const workspaceManifestBefore = readFileSync(workspaceManifestPath)
  const workspaceWrite = runPackedCli(
    'workspace write',
    workspaceFixture,
    ['--write', '--output', 'json', '--exclude-workspace', 'apps/admin'],
    0,
  )
  if (
    workspaceWrite.selection?.summary?.excludedOccurrences !== 1 ||
    !readFileSync(workspaceManifestPath).equals(workspaceManifestBefore)
  ) {
    fail('Packed workspace write changed an excluded manifest')
  }

  const catalogFixture = join(project, 'catalog-selection')
  mkdirSync(join(catalogFixture, 'apps', 'admin'), { recursive: true })
  writeFileSync(
    join(catalogFixture, 'package.json'),
    '{"name":"root","private":true,"dependencies":{"catalog-probe":"file:./catalog-probe.tgz"}}\n',
  )
  writeFileSync(
    join(catalogFixture, 'pnpm-workspace.yaml'),
    "packages:\n  - 'apps/*'\ncatalogs:\n  payments:\n    catalog-probe: 1.0.0\n",
  )
  writeFileSync(
    join(catalogFixture, 'apps', 'admin', 'package.json'),
    '{"name":"admin","private":true,"dependencies":{"catalog-probe":"catalog:payments","direct-probe":"file:./direct-probe.tgz"}}\n',
  )
  const catalogManifestPath = join(catalogFixture, 'pnpm-workspace.yaml')
  const catalogConsumerPath = join(catalogFixture, 'apps', 'admin', 'package.json')
  const catalogManifestBefore = readFileSync(catalogManifestPath)
  const catalogConsumerBefore = readFileSync(catalogConsumerPath)
  const catalogWrite = runPackedCli(
    'catalog write',
    catalogFixture,
    ['--write', '--output', 'json', '--exclude-catalog', 'payments'],
    0,
  )
  if (
    catalogWrite.selection?.summary?.excludedOccurrences !== 2 ||
    !readFileSync(catalogManifestPath).equals(catalogManifestBefore) ||
    !readFileSync(catalogConsumerPath).equals(catalogConsumerBefore)
  ) {
    fail('Packed catalog write changed excluded catalog bytes')
  }
  const catalogSelection = runPackedCli(
    'catalog',
    catalogFixture,
    ['plan', '--json', '--exclude-catalog', 'payments'],
    1,
  )
  if (
    catalogSelection.schemaVersion !== 2 ||
    catalogSelection.selection?.summary?.matchedCatalogOwners !== 1 ||
    catalogSelection.selection?.summary?.excludedOccurrences !== 2
  ) {
    fail('Packed catalog selection receipt mismatch')
  }
  const combinedSelection = runPackedCli(
    'combined',
    catalogFixture,
    [
      'plan',
      '--json',
      '--exclude-workspace',
      'apps/admin',
      '--exclude-catalog',
      'payments',
    ],
    1,
  )
  if (
    combinedSelection.selection?.summary?.requestedWorkspaces !== 1 ||
    combinedSelection.selection?.summary?.requestedCatalogs !== 1 ||
    combinedSelection.selection?.summary?.excludedOccurrences !== 3
  ) {
    fail('Packed combined selection receipt mismatch')
  }
  const combinedPlanPath = join(catalogFixture, 'selection-plan.json')
  writeFileSync(combinedPlanPath, `${JSON.stringify(combinedSelection, null, 2)}\n`)
  const combinedApply = runPackedCli(
    'combined apply',
    catalogFixture,
    ['apply', '--json', '--write', '--plan-file', combinedPlanPath],
    0,
  )
  if (
    combinedApply.status !== 'noop' ||
    combinedApply.planFingerprint !== combinedSelection.planFingerprint ||
    !readFileSync(catalogManifestPath).equals(catalogManifestBefore) ||
    !readFileSync(catalogConsumerPath).equals(catalogConsumerBefore)
  ) {
    fail('Packed apply did not retain the fingerprinted selection plan')
  }

  const malformedSelection = runPackedCli(
    'malformed',
    catalogFixture,
    ['--output', 'json', '--exclude-catalog', '/private/catalog'],
    2,
  )
  if (malformedSelection.error?.reason !== 'SELECTION_TARGET_UNPROVEN') {
    fail('Packed malformed selection did not fail closed')
  }
  const missingSelection = runPackedCli(
    'missing',
    catalogFixture,
    ['plan', '--json', '--exclude-workspace', 'apps/missing'],
    2,
  )
  if (missingSelection.errors?.[0]?.reason !== 'SELECTION_TARGET_UNPROVEN') {
    fail('Packed missing selection did not fail closed')
  }

  const probePath = join(project, 'probe.mjs')
  writeFileSync(
    probePath,
    `import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as depfresh from 'depfresh'
const packageJson = JSON.parse(readFileSync(process.env.DEPFRESH_PACKAGE_JSON, 'utf8'))
const capabilities = JSON.parse(process.env.DEPFRESH_CAPABILITIES)
if (packageJson.version !== process.env.DEPFRESH_VERSION) throw new Error('package version mismatch')
if (capabilities.version !== process.env.DEPFRESH_VERSION) throw new Error('capabilities version mismatch')
if (!depfresh.validateCapabilities(capabilities)) throw new Error('invalid capabilities')
for (const name of ['apply', 'check', 'inspect', 'plan', 'validateApplyResult', 'validateCapabilities', 'validateCapabilitiesV1', 'validateCapabilitiesV2', 'validateInspectResult', 'validatePlanResult', 'validatePlanResultV1', 'validatePlanResultV2']) {
  if (typeof depfresh[name] !== 'function') throw new Error('missing runtime export: ' + name)
}
for (const subpath of ${JSON.stringify(Object.keys(packageJson.exports))}) {
  const specifier = subpath === '.' ? 'depfresh' : 'depfresh/' + subpath.slice(2)
  const resolved = fileURLToPath(import.meta.resolve(specifier))
  if (!existsSync(resolved)) throw new Error('missing export target: ' + specifier)
}
for (const asset of capabilities.assets) {
  const resolved = fileURLToPath(import.meta.resolve(asset))
  if (!existsSync(resolved)) throw new Error('missing capability asset: ' + asset)
}
`,
  )
  run(process.execPath, [probePath], {
    cwd: project,
    env: {
      ...isolatedEnvironment(home, cache, emptyUserConfig, emptyGlobalConfig),
      DEPFRESH_CAPABILITIES: capabilitiesRun.stdout,
      DEPFRESH_PACKAGE_JSON: join(installedRoot, 'package.json'),
      DEPFRESH_VERSION: packageJson.version,
    },
  })

  process.stdout.write(
    `${JSON.stringify({
      version: packageJson.version,
      filename: entry.filename,
      integrity: entry.integrity,
      files: packedPaths.length,
      size: entry.size,
      unpackedSize: entry.unpackedSize,
      installSource: explicitInstallSpec ? 'public-registry' : 'tarball',
      ...(visualPlusEvidence === undefined ? {} : { visualPlus: visualPlusEvidence }),
    })}\n`,
  )
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true })
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function isolatedEnvironment(home, cache, userconfig, globalconfig) {
  const env = {}
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  return {
    ...env,
    HOME: home,
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_GLOBALCONFIG: globalconfig,
    NPM_CONFIG_REGISTRY: PUBLIC_REGISTRY,
    NPM_CONFIG_USERCONFIG: userconfig,
    npm_config_cache: cache,
    npm_config_globalconfig: globalconfig,
    npm_config_registry: PUBLIC_REGISTRY,
    npm_config_userconfig: userconfig,
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    shell: false,
    timeout: PACKED_COMMAND_TIMEOUT_MS,
  })
  if (result.error || result.status !== 0) {
    fail(`Verification command failed: ${basename(command)}`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function verifyVisualPlusReplay(options) {
  const canonicalInstalledRoot = realpathSync(options.installedRoot)
  const cliStat = lstatSync(options.cliPath)
  if (cliStat.isSymbolicLink() || !cliStat.isFile()) fail('Installed Visual+ CLI is not a regular file')
  const canonicalCliPath = realpathSync(options.cliPath)
  const containment = relative(canonicalInstalledRoot, canonicalCliPath)
  if (containment === '' || containment.startsWith('..') || isAbsolute(containment)) {
    fail('Installed Visual+ CLI is outside the exact installation root')
  }
  const tarballCli = extractTarGzipEntry(options.tarballBytes, 'package/dist/cli.mjs')
  const cliSha256 = createHash('sha256').update(readFileSync(canonicalCliPath)).digest('hex')
  if (createHash('sha256').update(tarballCli).digest('hex') !== cliSha256) {
    fail('Installed Visual+ CLI does not match the verified tarball')
  }

  const fakeCliPath = join(options.temporaryRoot, 'visual-plus-distinct-cli.mjs')
  const environmentRoot = join(options.temporaryRoot, 'visual-plus-environment')
  mkdirSync(environmentRoot)
  writeFileSync(fakeCliPath, 'throw new Error("distinct Visual+ identity control")\n')
  const testEnvironment = {
    DEPFRESH_VISUAL_PLUS_CLI_PATH: canonicalCliPath,
    DEPFRESH_VISUAL_PLUS_INSTALL_ROOT: canonicalInstalledRoot,
  }
  const negative = runVisualPlusVitest(
    [
      'run',
      'test/visual-plus-cli.test.ts',
      '--testNamePattern',
      'executes the selected CLI artifact',
    ],
    createVisualPlusEnvironment(environmentRoot, {
      ...testEnvironment,
      DEPFRESH_VISUAL_PLUS_CLI_PATH: fakeCliPath,
    }),
    { timeoutMs: PACKED_COMMAND_TIMEOUT_MS },
  )
  if (negative.error || negative.status === null) fail('Visual+ identity control could not run')
  if (negative.status === 0) fail('Visual+ identity control unexpectedly passed')

  const reportPath = join(options.temporaryRoot, 'visual-plus-report.json')
  const replay = runVisualPlusVitest(
    [
      'run',
      'test/visual-plus-cli.test.ts',
      '--retry=0',
      '--reporter=json',
      '--outputFile',
      reportPath,
    ],
    createVisualPlusEnvironment(environmentRoot, testEnvironment),
    { timeoutMs: VISUAL_PLUS_REPLAY_TIMEOUT_MS },
  )
  if (replay.error) fail('Installed Visual+ replay failed')
  if (replay.status !== 0) fail(visualPlusReplayFailureMessage(reportPath))
  const report = readVisualPlusReplayReport(reportPath)
  if (report === undefined) fail('Installed Visual+ replay did not produce machine evidence')
  if (
    !isRecord(report) ||
    report.numFailedTests !== 0 ||
    report.numFailedTestSuites !== 0 ||
    report.numPassedTests !== VISUAL_PLUS_PASSED_TESTS
  ) {
    fail('Installed Visual+ replay evidence is incomplete')
  }
  return {
    cliPath: canonicalCliPath,
    cliSha256,
    passedTests: report.numPassedTests,
  }
}

function runVisualPlusVitest(args, environment, options) {
  return spawnSync(
    process.execPath,
    [join(resolve(process.cwd()), 'node_modules', 'vitest', 'vitest.mjs'), ...args],
    {
      cwd: resolve(process.cwd()),
      encoding: 'utf8',
      env: environment,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      shell: false,
      timeout: options.timeoutMs,
    },
  )
}

function createVisualPlusEnvironment(root, additions) {
  const home = join(root, 'home')
  const temporary = join(root, 'tmp')
  const cache = join(root, 'cache')
  mkdirSync(home, { recursive: true })
  mkdirSync(temporary, { recursive: true })
  mkdirSync(cache, { recursive: true })
  const inherited = {}
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL']) {
    if (process.env[name]) inherited[name] = process.env[name]
  }
  return {
    ...inherited,
    ...additions,
    HOME: home,
    NPM_CONFIG_CACHE: cache,
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    XDG_CACHE_HOME: cache,
  }
}

function extractTarGzipEntry(tarball, targetPath) {
  let archive
  try {
    archive = gunzipSync(tarball, { maxOutputLength: MAX_TARBALL_EXPANDED_BYTES })
  } catch {
    fail('Could not extract the verified tarball')
  }
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const size = parseTarSize(header.subarray(124, 136))
    const name = tarString(header.subarray(0, 100))
    const prefix = tarString(header.subarray(345, 500))
    const path = prefix ? `${prefix}/${name}` : name
    const contentStart = offset + 512
    const contentEnd = contentStart + size
    if (contentEnd > archive.length) fail('Could not extract the verified tarball')
    if (path === targetPath) return Buffer.from(archive.subarray(contentStart, contentEnd))
    offset = contentStart + Math.ceil(size / 512) * 512
  }
  fail('Verified tarball is missing the Visual+ CLI')
}

function parseTarSize(input) {
  const value = tarString(input).trim()
  if (!/^[0-7]+$/u.test(value)) fail('Could not extract the verified tarball')
  const size = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(size) || size < 0) fail('Could not extract the verified tarball')
  return size
}

function tarString(input) {
  return input.toString('utf8').replace(/\0.*$/u, '')
}

function parseCommand(arguments_) {
  const manifestPath = arguments_[0]
  if (typeof manifestPath !== 'string') return {}
  let installSpec
  let visualPlus = false
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--visual-plus' && !visualPlus) {
      visualPlus = true
      continue
    }
    if (argument === '--install-spec' && installSpec === undefined) {
      const value = arguments_[index + 1]
      if (typeof value !== 'string' || value.startsWith('--')) return {}
      installSpec = value
      index += 1
      continue
    }
    return {}
  }
  return { installSpec, manifestPath, visualPlus }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message) {
  throw new PackageVerificationError(message)
}

function sanitizeFailureMessage(message) {
  return message
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, ' ')
    .slice(0, 500)
}
