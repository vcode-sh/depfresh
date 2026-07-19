import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'

const PROCESS_TIMEOUT_MS = 30_000
const PROCESS_OUTPUT_LIMIT = 8 * 1024 * 1024
const FILLER_COUNT = 6_000
const FILLER_BODY = 'x'.repeat(220)
const MAJOR_AGE_MS = 432_000_000
const OWNER_CAPACITIES = [6, ...Array.from({ length: 14 }, () => 5)]

export function createVisualPlusFixture(root, options) {
  const canonicalRoot = requireEmptyCanonicalRoot(root)
  const asOfMs = requireAsOfMs(options?.asOfMs)
  const registryUrl = requireRegistryUrl(options?.registryUrl)
  const git = findExecutable('git')
  const repository = join(canonicalRoot, 'repository')
  const runtime = join(canonicalRoot, 'runtime')
  const runtimePaths = createRuntimePaths(runtime)
  mkdirSync(repository)
  for (const path of [
    runtimePaths.home,
    runtimePaths.xdgCache,
    runtimePaths.xdgConfig,
    runtimePaths.corepackHome,
    runtimePaths.npmCache,
    runtimePaths.pnpmHome,
    runtimePaths.pnpmStore,
    runtimePaths.wrapperBin,
  ]) {
    mkdirSync(path, { recursive: true })
  }

  const assignment = createSelectedAssignment()
  const gitEnvironment = createIsolatedGitEnvironment(runtimePaths)
  const manifests = createManifests(repository, assignment)
  const workspace = createWorkspace(repository, assignment)
  const selectedDeclarations = [...manifests.selected, ...workspace.selected]
  const targetTemplates = new Map([
    ...manifests.targets,
    [workspace.path, { before: workspace.before, after: workspace.after }],
  ])
  writeFileSync(join(repository, '.npmrc'), `registry=${registryUrl.href}\n`, 'utf8')
  const filler = createTrackedFiller(repository)
  initializeGit(git, repository, runtimePaths, gitEnvironment)

  const trackedOutput = run(git, ['ls-files', '-z', '--cached', '--full-name'], {
    cwd: repository,
    encoding: 'buffer',
    env: gitEnvironment,
    maxBuffer: PROCESS_OUTPUT_LIMIT,
  })
  const trackedEntries = trackedOutput.toString('utf8').split('\0')
  if (trackedEntries.at(-1) !== '') throw new Error('Tracked file output must end in NUL')
  trackedEntries.pop()
  if (trackedEntries.length !== FILLER_COUNT + 66) {
    throw new Error(`Unexpected tracked entry count: ${trackedEntries.length}`)
  }
  if (trackedOutput.byteLength <= 1_250_160) {
    throw new Error(`Tracked file output is too small: ${trackedOutput.byteLength}`)
  }
  assertClean(git, repository, gitEnvironment)

  const targets = [...targetTemplates]
    .sort(([left], [right]) => compareText(left, right))
    .map(([path, template]) => targetEvidence(repository, path, template))
  const exactPathspecs = targets.map(({ path }) => `:(top,literal)${path}`)
  const wrapper = createSafetyWrapper({
    git,
    exactPathspecs,
    runtimePaths,
  })
  const registry = createRegistryResponses(selectedDeclarations, asOfMs)
  const successEnvironment = childEnvironment(runtimePaths, git, gitEnvironment)
  const safetyEnvironment = {
    ...successEnvironment,
    PATH: `${runtimePaths.wrapperBin}${delimiter}${dirname(git)}${delimiter}${process.env.PATH ?? ''}`,
  }

  return Object.freeze({
    root: canonicalRoot,
    repository,
    runtime,
    asOfMs,
    registryUrl: registryUrl.href,
    registry,
    git,
    gitEnvironment,
    manifests: Object.freeze([...manifests.paths]),
    selectedDeclarations: Object.freeze(selectedDeclarations.map((value) => Object.freeze(value))),
    targets: Object.freeze(targets.map((value) => Object.freeze(value))),
    variants: Object.freeze({
      success: Object.freeze({ environment: Object.freeze(successEnvironment) }),
      safety: Object.freeze({
        environment: Object.freeze(safetyEnvironment),
        wrapper,
        counter: runtimePaths.counter,
      }),
    }),
    runtimePaths: Object.freeze(runtimePaths),
    tracked: Object.freeze({
      bytes: trackedOutput.byteLength,
      entries: trackedEntries.length,
      trailingNul: true,
      fillerCount: filler.count,
      filenameBodyLength: FILLER_BODY.length,
      maximumComponentBytes: filler.maximumComponentBytes,
      maximumAbsolutePathBytes: filler.maximumAbsolutePathBytes,
    }),
    inventory: Object.freeze({
      manifests: 64,
      catalogs: 2,
      packages: 66,
      declared: 616,
      eligible: 612,
      selected: 76,
      unresolved: 0,
      owners: 15,
      targets: 14,
      repeatedDependencies: 18,
      repeatedOccurrences: 39,
      majorCards: 2,
      majorOperations: 3,
    }),
  })
}

function requireEmptyCanonicalRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root) {
    throw new Error('Visual+ fixture root must be canonical and absolute')
  }
  const stats = lstatSync(root)
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync.native(root) !== root) {
    throw new Error('Visual+ fixture root must be a canonical directory, not a symlink')
  }
  if (readdirSync(root).length !== 0) throw new Error('Visual+ fixture root must be empty')
  return root
}

function requireAsOfMs(value) {
  if (!(Number.isSafeInteger(value) && value >= MAJOR_AGE_MS)) {
    throw new Error('Visual+ fixture asOfMs must be a nonnegative safe integer')
  }
  return value
}

function requireRegistryUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Visual+ fixture registry URL must be valid')
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
  if (
    parsed.protocol !== 'http:' ||
    !loopback ||
    parsed.port.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.pathname !== '/'
  ) {
    throw new Error('Visual+ fixture registry URL must be credential-free loopback HTTP')
  }
  return parsed
}

function createRuntimePaths(runtime) {
  return {
    home: join(runtime, 'home'),
    xdgCache: join(runtime, 'xdg-cache'),
    xdgConfig: join(runtime, 'xdg-config'),
    corepackHome: join(runtime, 'corepack'),
    npmCache: join(runtime, 'npm-cache'),
    pnpmHome: join(runtime, 'pnpm-home'),
    pnpmStore: join(runtime, 'pnpm-store'),
    wrapperBin: join(runtime, 'git-wrapper-bin'),
    counter: join(runtime, 'git-ls-files-count'),
    gitConfig: join(runtime, 'gitconfig'),
    npmConfig: join(runtime, 'npmrc'),
  }
}

function selectedNames() {
  const assigned = Array.from({ length: 15 }, () => [])
  for (let repeated = 0; repeated < 18; repeated += 1) {
    const name =
      repeated === 0
        ? 'react-dropzone'
        : repeated === 1
          ? '@fixture/shared-ui'
          : repeated <= 3
            ? `shared-triple-${repeated}`
            : `shared-pair-${repeated}`
    assigned[repeated % 13].push(name)
    assigned[(repeated + 1) % 13].push(name)
    if (repeated >= 1 && repeated <= 3) assigned[(repeated + 2) % 13].push(name)
  }
  let unique = 0
  for (let owner = 0; owner < assigned.length; owner += 1) {
    if (owner === 14) assigned[owner].push('nanoid')
    while (assigned[owner].length < OWNER_CAPACITIES[owner]) {
      assigned[owner].push(`unique-${String(unique).padStart(2, '0')}`)
      unique += 1
    }
  }
  return assigned
}

function createSelectedAssignment() {
  const names = selectedNames()
  return names.map((ownerNames, owner) =>
    ownerNames.map((name) => {
      const major = name === 'react-dropzone' || name === 'nanoid'
      const repeated =
        name === '@fixture/shared-ui' ||
        name.startsWith('shared-triple-') ||
        name.startsWith('shared-pair-')
      const diff = major ? 'major' : repeated ? 'minor' : 'patch'
      return {
        owner,
        name,
        current: name === 'react-dropzone' ? '^15.0.0' : name === 'nanoid' ? '^5.1.16' : '^1.0.0',
        target:
          name === 'react-dropzone'
            ? '^17.0.0'
            : name === 'nanoid'
              ? '^6.0.0'
              : diff === 'minor'
                ? '^1.1.0'
                : '^1.0.1',
        currentVersion:
          name === 'react-dropzone' ? '15.0.0' : name === 'nanoid' ? '5.1.16' : '1.0.0',
        targetVersion:
          name === 'react-dropzone'
            ? '17.0.0'
            : name === 'nanoid'
              ? '6.0.0'
              : diff === 'minor'
                ? '1.1.0'
                : '1.0.1',
        diff,
      }
    }),
  )
}

function createManifests(repository, assignment) {
  const paths = []
  const selected = []
  const targets = new Map()
  for (let index = 0; index < 64; index += 1) {
    const relativePath =
      index === 0 ? 'package.json' : `packages/${String(index).padStart(2, '0')}/package.json`
    const path = join(repository, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    const selectedForOwner = index < 13 ? assignment[index] : []
    const dependencies = {}
    for (const declaration of selectedForOwner) {
      dependencies[declaration.name] = declaration.current
      selected.push({ ...declaration, ownerType: 'manifest', physicalTarget: relativePath })
    }
    const currentCount = index < 24 ? 9 : 8
    for (let item = 0; item < currentCount; item += 1) {
      dependencies[`current-${String(item).padStart(2, '0')}`] = '^1.0.0'
    }
    if (index < 4) dependencies[`locked-${index}`] = '1.0.0'
    const beforeObject = {
      name:
        index === 0
          ? 'lab-editor'
          : index === 1
            ? 'web'
            : `fixture-package-${String(index).padStart(2, '0')}`,
      private: true,
      dependencies,
    }
    const afterObject = structuredClone(beforeObject)
    for (const declaration of selectedForOwner) {
      afterObject.dependencies[declaration.name] = declaration.target
    }
    const before = jsonBytes(beforeObject)
    const after = jsonBytes(afterObject)
    writeFileSync(path, before)
    paths.push(relativePath)
    if (index < 13) targets.set(relativePath, { before, after })
  }
  return { paths, selected, targets }
}

function createWorkspace(repository, assignment) {
  const path = 'pnpm-workspace.yaml'
  const catalogs = [
    ['auxiliary-catalog', assignment[13]],
    ['root-catalog', assignment[14]],
  ]
  const render = (after) => {
    const lines = ['packages:', "  - 'packages/*'", 'catalogs:']
    for (const [name, declarations] of catalogs) {
      lines.push(`  ${name}:`)
      for (const declaration of declarations) {
        lines.push(
          `    ${yamlKey(declaration.name)}: ${after ? declaration.target : declaration.current}`,
        )
      }
    }
    return Buffer.from(`${lines.join('\n')}\n`)
  }
  const before = render(false)
  const after = render(true)
  writeFileSync(join(repository, path), before)
  return {
    path,
    before,
    after,
    selected: catalogs.flatMap(([catalogName, declarations]) =>
      declarations.map((declaration) => ({
        ...declaration,
        ownerType: 'catalog',
        catalogName,
        physicalTarget: path,
      })),
    ),
  }
}

function yamlKey(value) {
  return value.startsWith('@') ? `'${value}'` : value
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function createTrackedFiller(repository) {
  const directory = join(repository, 'filler')
  mkdirSync(directory)
  let maximumComponentBytes = 0
  let maximumAbsolutePathBytes = 0
  for (let index = 0; index < FILLER_COUNT; index += 1) {
    const filename = `${String(index).padStart(4, '0')}-${FILLER_BODY}`
    const path = join(directory, filename)
    maximumComponentBytes = Math.max(maximumComponentBytes, Buffer.byteLength(filename))
    maximumAbsolutePathBytes = Math.max(maximumAbsolutePathBytes, Buffer.byteLength(path))
    writeFileSync(path, '')
  }
  if (maximumComponentBytes > 240 || maximumAbsolutePathBytes >= 1_024) {
    throw new Error('Visual+ fixture filler path exceeds portability bounds')
  }
  return { count: FILLER_COUNT, maximumComponentBytes, maximumAbsolutePathBytes }
}

function initializeGit(git, repository, runtimePaths, gitEnvironment) {
  const environment = {
    ...gitEnvironment,
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    LC_ALL: 'C',
    LANG: 'C',
    TZ: 'UTC',
  }
  run(git, ['init', '--quiet'], { cwd: repository, env: environment })
  run(git, ['config', 'user.email', 'fixture@example.invalid'], {
    cwd: repository,
    env: environment,
  })
  run(git, ['config', 'user.name', 'Visual Plus Fixture'], { cwd: repository, env: environment })
  run(git, ['config', 'commit.gpgSign', 'false'], { cwd: repository, env: environment })
  run(git, ['config', 'tag.gpgSign', 'false'], { cwd: repository, env: environment })
  run(git, ['config', 'core.hooksPath', runtimePaths.wrapperBin], {
    cwd: repository,
    env: environment,
  })
  run(git, ['add', '-A'], { cwd: repository, env: environment })
  run(git, ['commit', '--quiet', '-m', 'fixture'], { cwd: repository, env: environment })
}

function targetEvidence(repository, path, template) {
  const actual = readFileSync(join(repository, path))
  if (!actual.equals(template.before)) throw new Error(`Fixture template drifted for ${path}`)
  const beforeBytes = Buffer.from(template.before)
  const expectedAfterBytes = Buffer.from(template.after)
  return Object.freeze({
    path,
    get beforeBytes() {
      return Buffer.from(beforeBytes)
    },
    get expectedAfterBytes() {
      return Buffer.from(expectedAfterBytes)
    },
    beforeHash: sha256(beforeBytes),
    expectedAfterHash: sha256(expectedAfterBytes),
  })
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function createRegistryResponses(declarations, asOfMs) {
  const definitions = new Map()
  for (const declaration of declarations) {
    definitions.set(declaration.name, {
      current: declaration.currentVersion,
      target: declaration.targetVersion,
      major: declaration.diff === 'major',
    })
  }
  for (let item = 0; item < 9; item += 1) {
    definitions.set(`current-${String(item).padStart(2, '0')}`, {
      current: '1.0.0',
      target: '1.0.0',
      major: false,
    })
  }
  const responses = new Map()
  for (const [name, definition] of [...definitions].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const versions = [...new Set([definition.current, definition.target])]
    const publishedAt = new Date(
      definition.major ? asOfMs - MAJOR_AGE_MS : asOfMs - 86_400_000,
    ).toISOString()
    const metadata = {
      name,
      versions: Object.fromEntries(versions.map((version) => [version, {}])),
      time: Object.fromEntries(versions.map((version) => [version, publishedAt])),
      'dist-tags': { latest: definition.target },
    }
    responses.set(name, Buffer.from(JSON.stringify(metadata)))
  }
  const readonlyResponses = Object.freeze({
    get(name) {
      const bytes = responses.get(name)
      return bytes === undefined ? undefined : Buffer.from(bytes)
    },
    get size() {
      return responses.size
    },
  })
  return Object.freeze({
    responses: readonlyResponses,
    names: Object.freeze([...responses.keys()]),
    maxRequestUrlBytes: 4_096,
    maxRequestBodyBytes: 1_024,
  })
}

function createSafetyWrapper({ git, exactPathspecs, runtimePaths }) {
  const wrapper = join(runtimePaths.wrapperBin, 'git')
  const expected = ['ls-files', '-z', '--cached', '--full-name', '--', ...exactPathspecs]
  writeFileSync(
    wrapper,
    `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync, writeSync } = require('node:fs')
const args = process.argv.slice(2)
const commandIndex = args.indexOf('ls-files')
const command = commandIndex === -1 ? [] : args.slice(commandIndex)
const expected = ${JSON.stringify(expected)}
const matches = command.length === expected.length && command.every((value, index) => value === expected[index])
if (matches) {
  const counter = ${JSON.stringify(runtimePaths.counter)}
  const count = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) + 1 : 1
  writeFileSync(counter, String(count))
  if (count === 2) {
    writeSync(1, Buffer.alloc(1100000, 97))
    process.exit(0)
  }
}
const result = spawnSync(${JSON.stringify(git)}, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
`,
  )
  chmodSync(wrapper, 0o755)
  return wrapper
}

function childEnvironment(paths, git, gitEnvironment) {
  writeFileSync(paths.npmConfig, '')
  return {
    ...gitEnvironment,
    COREPACK_HOME: paths.corepackHome,
    npm_config_cache: paths.npmCache,
    npm_config_userconfig: paths.npmConfig,
    PNPM_HOME: paths.pnpmHome,
    PNPM_STORE_DIR: paths.pnpmStore,
    PATH: `${dirname(git)}${delimiter}${process.env.PATH ?? ''}`,
  }
}

function assertClean(git, repository, gitEnvironment) {
  const porcelain = run(git, ['status', '--porcelain=v1', '-z'], {
    cwd: repository,
    encoding: 'buffer',
    env: gitEnvironment,
  })
  if (porcelain.byteLength !== 0) throw new Error('Visual+ fixture Git worktree is not clean')
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, name)
    try {
      const resolved = realpathSync.native(candidate)
      if (!lstatSync(resolved).isFile()) continue
      accessSync(resolved, constants.X_OK)
      return resolved
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`Missing fixture executable: ${name}`)
}

function stripSensitiveEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => {
      const normalized = name.toLowerCase()
      return !(normalized.startsWith('npm_config_') || normalized.startsWith('git_'))
    }),
  )
}

function createIsolatedGitEnvironment(paths) {
  writeFileSync(paths.gitConfig, '')
  return Object.freeze({
    ...stripSensitiveEnvironment(process.env),
    HOME: paths.home,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_CONFIG_HOME: paths.xdgConfig,
    GIT_CONFIG_GLOBAL: paths.gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    LC_ALL: 'C',
    LANG: 'C',
    TZ: 'UTC',
  })
}

function run(command, args, options) {
  return execFileSync(command, args, {
    timeout: PROCESS_TIMEOUT_MS,
    maxBuffer: PROCESS_OUTPUT_LIMIT,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function compareText(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
