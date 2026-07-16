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
import { basename, dirname, join, resolve } from 'node:path'
import { extractSinglePackEntry } from './pack-manifest.mjs'

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'
const manifestArgument = process.argv[2]
const installSpecIndex = process.argv.indexOf('--install-spec')
const explicitInstallSpec = installSpecIndex < 0 ? undefined : process.argv[installSpecIndex + 1]

if (!manifestArgument || (installSpecIndex >= 0 && !explicitInstallSpec)) {
  fail('Usage: node scripts/verify-packed-package.mjs <pack.json> [--install-spec <exact-spec>]')
}

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
  'dist/schemas/error-v1.json',
  'dist/schemas/global-apply-v1.json',
  'dist/schemas/global-plan-v1.json',
  'dist/schemas/inspect-v1.json',
  'dist/schemas/plan-v1.json',
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
for (const name of ['apply', 'check', 'inspect', 'plan', 'validateApplyResult', 'validateCapabilities', 'validateInspectResult', 'validatePlanResult']) {
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
  const result = spawnSync(command, args, { ...options, encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    fail(`Verification command failed: ${basename(command)}`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
