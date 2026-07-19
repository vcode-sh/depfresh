import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryCache } from '../src/cache'
import { applyLegacyCommandWrite, createLegacyPlan } from '../src/commands/apply/legacy-plan'
import { createCheckRunState, reduceCheckRun } from '../src/commands/check/run-model'
import { buildVisualPlusInsights } from '../src/commands/check/visual-plus/insights'
import { createVisualPlusSelectionProjection } from '../src/commands/check/visual-plus/integration'
import { loadPackages } from '../src/io/packages'
import { createResolveContext, resolvePackage } from '../src/io/resolve'
import { createRepositoryId } from '../src/repository/identity'
import { DEFAULT_OPTIONS, type depfreshOptions } from '../src/types'
import { createVisualPlusFixture } from './helpers/visual-plus-fixture.mjs'

const AS_OF_MS = Date.parse('2026-07-19T00:00:00.000Z')
const EXPECTED_COUNTS = {
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
}

interface FixtureResult {
  readonly operationIds: readonly string[]
  readonly ownerIds: readonly string[]
  readonly sourceFileIds: readonly string[]
  readonly targetSourceIds: readonly string[]
  readonly versions: readonly string[]
  readonly targetHashes: Readonly<Record<string, string>>
}

describe('Visual+ practical fixture', () => {
  let baseline: FixtureResult | undefined

  it.each([1, 2, 3])(
    'derives the exact production inventory deterministically (run %i)',
    async (run) => {
      const parent = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-fixture-'))
      const root = join(realpathSync.native(parent), 'fixture')
      mkdirSync(root)
      let fixture: ReturnType<typeof createVisualPlusFixture> | undefined
      const server = createFixtureServer(() => fixture)
      try {
        const registryUrl = await listen(server)
        const realGit = findTestExecutable('git')
        const linkedBin = join(realpathSync.native(parent), 'linked-bin')
        const hostileGitConfig = join(realpathSync.native(parent), 'hostile-gitconfig')
        const externalGitDirectory = join(realpathSync.native(parent), 'external-git-directory')
        const externalIndex = join(realpathSync.native(parent), 'external-index')
        const externalSentinel = join(externalGitDirectory, 'sentinel')
        mkdirSync(linkedBin)
        mkdirSync(externalGitDirectory)
        symlinkSync(realGit, join(linkedBin, 'git'))
        writeFileSync(externalSentinel, 'external git sentinel\n')
        writeFileSync(externalIndex, 'external index sentinel\n')
        writeFileSync(
          hostileGitConfig,
          '[user]\n  name = Host User\n  email = host@example.invalid\n[commit]\n  gpgSign = true\n',
        )
        const inherited = {
          PATH: process.env.PATH,
          GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
          GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
          GIT_DIR: process.env.GIT_DIR,
          GIT_WORK_TREE: process.env.GIT_WORK_TREE,
          GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
        }
        try {
          process.env.PATH = `${linkedBin}${delimiter}${process.env.PATH ?? ''}`
          process.env.GIT_AUTHOR_NAME = 'Host User'
          process.env.GIT_CONFIG_GLOBAL = hostileGitConfig
          process.env.GIT_DIR = externalGitDirectory
          process.env.GIT_WORK_TREE = root
          process.env.GIT_INDEX_FILE = externalIndex
          fixture = createVisualPlusFixture(root, { asOfMs: AS_OF_MS, registryUrl })
        } finally {
          restoreProcessValue('PATH', inherited.PATH)
          restoreProcessValue('GIT_AUTHOR_NAME', inherited.GIT_AUTHOR_NAME)
          restoreProcessValue('GIT_CONFIG_GLOBAL', inherited.GIT_CONFIG_GLOBAL)
          restoreProcessValue('GIT_DIR', inherited.GIT_DIR)
          restoreProcessValue('GIT_WORK_TREE', inherited.GIT_WORK_TREE)
          restoreProcessValue('GIT_INDEX_FILE', inherited.GIT_INDEX_FILE)
        }
        expect(fixture.git).toBe(realGit)
        expect(readFileSync(externalSentinel, 'utf8')).toBe('external git sentinel\n')
        expect(readFileSync(externalIndex, 'utf8')).toBe('external index sentinel\n')
        expect(Object.isFrozen(fixture.gitEnvironment)).toBe(true)
        expect(
          Object.keys(fixture.gitEnvironment)
            .filter((name) => name.toLowerCase().startsWith('git_'))
            .sort(),
        ).toEqual(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'])
        expect(Object.isFrozen(fixture.registry.responses)).toBe(true)
        const responseCopy = fixture.registry.responses.get('nanoid')
        expect(responseCopy).toBeDefined()
        responseCopy![0] = 0
        expect(fixture.registry.responses.get('nanoid')?.[0]).not.toBe(0)
        const targetByteCopy = fixture.targets[0]!.beforeBytes
        targetByteCopy[0] = 0
        expect(fixture.targets[0]!.beforeBytes[0]).not.toBe(0)
        expect((await fetch(`${registryUrl}@fixture%2Fshared-ui`, { method: 'HEAD' })).status).toBe(
          200,
        )
        expect((await fetch(`${registryUrl}missing`)).status).toBe(404)
        expect((await fetch(`${registryUrl}nanoid`, { method: 'POST' })).status).toBe(405)
        for (const path of Object.values(fixture.runtimePaths)) {
          expect(path.startsWith(`${fixture.runtime}${sep}`)).toBe(true)
          expect(path.startsWith(`${fixture.repository}${sep}`)).toBe(false)
        }
        for (const variant of [fixture.variants.success, fixture.variants.safety]) {
          expect(variant.environment).toMatchObject({
            HOME: fixture.runtimePaths.home,
            XDG_CACHE_HOME: fixture.runtimePaths.xdgCache,
            XDG_CONFIG_HOME: fixture.runtimePaths.xdgConfig,
            COREPACK_HOME: fixture.runtimePaths.corepackHome,
            npm_config_cache: fixture.runtimePaths.npmCache,
            npm_config_userconfig: fixture.runtimePaths.npmConfig,
            PNPM_HOME: fixture.runtimePaths.pnpmHome,
            PNPM_STORE_DIR: fixture.runtimePaths.pnpmStore,
            GIT_CONFIG_GLOBAL: fixture.runtimePaths.gitConfig,
            GIT_CONFIG_NOSYSTEM: '1',
            LC_ALL: 'C',
            LANG: 'C',
            TZ: 'UTC',
          })
          expect(
            Object.keys(variant.environment).filter(
              (name) =>
                name.toLowerCase().startsWith('npm_config_') &&
                name !== 'npm_config_cache' &&
                name !== 'npm_config_userconfig',
            ),
          ).toEqual([])
          expect(
            Object.keys(variant.environment)
              .filter((name) => name.toLowerCase().startsWith('git_'))
              .sort(),
          ).toEqual(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'])
        }
        expect(
          runGitOutput(
            fixture.git,
            fixture.repository,
            fixture.gitEnvironment,
            'log',
            '-1',
            '--format=%an <%ae>',
          )
            .toString('utf8')
            .trim(),
        ).toBe('Visual Plus Fixture <fixture@example.invalid>')
        expect(
          runGitOutput(
            fixture.git,
            fixture.repository,
            fixture.gitEnvironment,
            'config',
            '--get',
            'commit.gpgSign',
          )
            .toString('utf8')
            .trim(),
        ).toBe('false')
        const options = fixtureOptions(fixture.repository)
        const packages = await loadPackages(options)
        const declared = packages.reduce((total, pkg) => total + pkg.deps.length, 0)
        const eligible = packages.reduce(
          (total, pkg) => total + pkg.deps.filter((dependency) => dependency.update).length,
          0,
        )
        expect(packages.filter((pkg) => pkg.type === 'package.json')).toHaveLength(64)
        expect(packages.filter((pkg) => pkg.type === 'pnpm-workspace')).toHaveLength(2)
        expect({ packages: packages.length, declared, eligible }).toEqual({
          packages: EXPECTED_COUNTS.packages,
          declared: EXPECTED_COUNTS.declared,
          eligible: EXPECTED_COUNTS.eligible,
        })

        const cache = createMemoryCache(() => AS_OF_MS)
        const context = createResolveContext(options, { now: AS_OF_MS })
        const npmrc = {
          registries: new Map(),
          defaultRegistry: registryUrl,
          strictSsl: true,
        }
        try {
          await Promise.all(
            packages.map(async (pkg) => {
              pkg.resolved = await resolvePackage(
                pkg,
                options,
                cache,
                npmrc,
                undefined,
                undefined,
                context,
              )
            }),
          )
        } finally {
          cache.close()
        }

        const resolved = packages.flatMap((pkg) => pkg.resolved)
        expect(resolved.filter((change) => change.diff === 'error')).toHaveLength(0)
        const selections = packages.flatMap((pkg, packageIndex) => {
          const changes = pkg.resolved.filter(
            (change) => change.diff !== 'none' && change.diff !== 'error',
          )
          return changes.length === 0 ? [] : [{ packageIndex, pkg, changes }]
        })
        const construction = createLegacyPlan(fixture.repository, selections)
        expect(construction.selectionEvidence.status).toBe('ready')
        if (construction.selectionEvidence.status !== 'ready') {
          throw new Error(
            `Selection evidence unavailable: ${construction.selectionEvidence.reason}`,
          )
        }
        const projection = createVisualPlusSelectionProjection(
          construction.selectionEvidence.evidence,
          AS_OF_MS,
        )
        let snapshot = createCheckRunState({ mode: 'major', write: false })
        snapshot = reduceCheckRun(snapshot, { type: 'packages-discovered', packages: 66, declared })
        snapshot = reduceCheckRun(snapshot, { type: 'repository-inspection-started' })
        snapshot = reduceCheckRun(snapshot, {
          type: 'repository-inspection-completed',
          status: 'passed',
        })
        snapshot = reduceCheckRun(snapshot, {
          type: 'resolution-completed',
          eligible,
          unresolved: 0,
          updates: projection.changes.length,
        })
        snapshot = reduceCheckRun(snapshot, {
          type: 'selection-completed',
          operations: projection.changes.length,
          targets: projection.targets.length,
          changes: projection.changes,
          selectedTargets: projection.targets,
        })
        const insights = buildVisualPlusInsights(snapshot)
        expect(insights.distribution).toEqual({ major: 3, minor: 37, patch: 36 })
        expect(insights.owners).toHaveLength(EXPECTED_COUNTS.owners)
        expect(insights.shared).toHaveLength(EXPECTED_COUNTS.repeatedDependencies)
        expect(
          insights.shared.reduce((total, shared) => total + shared.occurrences.length, 0),
        ).toBe(EXPECTED_COUNTS.repeatedOccurrences)
        expect(insights.majors).toHaveLength(EXPECTED_COUNTS.majorCards)
        expect(insights.majors.flatMap((major) => major.operationIds)).toHaveLength(
          EXPECTED_COUNTS.majorOperations,
        )
        expect(
          insights.shared.find((shared) => shared.name === 'react-dropzone')?.occurrences,
        ).toHaveLength(2)
        const reactMajor = insights.majors.find((major) => major.name === 'react-dropzone')
        expect(reactMajor).toMatchObject({
          current: '^15.0.0',
          target: '^17.0.0',
          age: { state: 'known', ageMs: 432_000_000 },
          compatibility: { compatible: 0, incompatible: 0, unknown: 2 },
        })
        expect(reactMajor?.owners.map((owner) => owner.label)).toEqual(['lab-editor', 'web'])
        const nanoidMajor = insights.majors.find((major) => major.name === 'nanoid')
        expect(nanoidMajor).toMatchObject({
          current: '^5.1.16',
          target: '^6.0.0',
          compatibility: { compatible: 0, incompatible: 0, unknown: 1 },
        })
        expect(nanoidMajor?.owners.map((owner) => owner.label)).toEqual(['root-catalog'])
        expect(nanoidMajor?.occurrences).toHaveLength(1)
        const catalogOwners = insights.owners.filter((owner) => owner.owner.role === 'catalog')
        expect(catalogOwners).toHaveLength(2)
        expect(new Set(catalogOwners.map((owner) => owner.owner.physicalTarget))).toEqual(
          new Set(['pnpm-workspace.yaml']),
        )
        expect(projection.changes).toHaveLength(EXPECTED_COUNTS.selected)
        expect(projection.targets).toHaveLength(EXPECTED_COUNTS.targets)
        expect(projection.targets.map((target) => target.path)).toEqual(
          fixture.targets.map((target) => target.path),
        )

        const safetyResult = await withProcessEnvironment(fixture.variants.safety.environment, () =>
          applyLegacyCommandWrite(fixture!.repository, selections, {
            write: true,
            install: false,
            update: false,
            execute: false,
            processExecute: false,
            lockfileWrite: false,
            verifyCommand: false,
            artifactVerify: false,
            networkAccess: false,
            globalWrite: false,
          }),
        )
        expect(safetyResult.status).toBe('executed')
        if (safetyResult.status !== 'executed') throw new Error('Expected executable safety proof')
        expect(safetyResult.attempts).toHaveLength(14)
        expect(safetyResult.attempts.every((attempt) => !attempt.replacementAttempted)).toBe(true)
        expect(readFileSync(fixture.variants.safety.counter, 'utf8')).toBe('2')
        expect(existsSync(join(fixture.repository, '.depfresh'))).toBe(false)

        const tracked = runGitOutput(
          fixture.git,
          fixture.repository,
          fixture.gitEnvironment,
          'ls-files',
          '-z',
          '--cached',
          '--full-name',
        )
        expect(tracked.at(-1)).toBe(0)
        expect(tracked.byteLength).toBeGreaterThan(1_250_160)
        expect(tracked.toString('utf8').split('\0').filter(Boolean)).toHaveLength(6_066)
        expect(
          runGitOutput(
            fixture.git,
            fixture.repository,
            fixture.gitEnvironment,
            'status',
            '--porcelain=v1',
            '-z',
          ),
        ).toHaveLength(0)
        expect(fixture.tracked.fillerCount).toBe(6_000)
        expect(fixture.tracked.filenameBodyLength).toBe(220)
        expect(fixture.tracked.maximumComponentBytes).toBeLessThanOrEqual(240)
        expect(fixture.tracked.maximumAbsolutePathBytes).toBeLessThan(1_024)
        expect(tracked.byteLength).toBeGreaterThan(Math.ceil(1_250_160 * 1.1))

        for (const target of fixture.targets) {
          expect(sha256(readFileSync(join(fixture.repository, target.path)))).toBe(
            target.beforeHash,
          )
          expect(target.beforeHash).not.toBe(target.expectedAfterHash)
        }
        const normalized = {
          operationIds: projection.changes.map((change) => change.id),
          ownerIds: insights.owners.map((owner) => owner.owner.id),
          sourceFileIds: projection.changes.map((change) => change.insight!.sourceFileId),
          targetSourceIds: projection.targets.map((target) =>
            createRepositoryId('source', target.path),
          ),
          versions: projection.changes.map(
            (change) => `${change.name}\0${change.current}\0${change.target}`,
          ),
          targetHashes: Object.fromEntries(
            fixture.targets.map((target) => [target.path, target.beforeHash]),
          ),
        }
        expect(new Set(normalized.sourceFileIds)).toEqual(new Set(normalized.targetSourceIds))
        expect(
          new Set(construction.plan.operations.map((operation) => operation.sourceFileId)),
        ).toEqual(new Set(normalized.targetSourceIds))
        if (baseline === undefined) baseline = normalized
        else expect(normalized, `success/safety identity drift on run ${run}`).toEqual(baseline)
      } finally {
        await close(server)
        rmSync(parent, { force: true, recursive: true })
      }
    },
    120_000,
  )

  it('rejects invalid roots, clocks, and registry authorities before writing', () => {
    const parent = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-validation-'))
    const canonicalParent = realpathSync.native(parent)
    try {
      const nonempty = join(canonicalParent, 'nonempty')
      mkdirSync(nonempty)
      writeFileSync(join(nonempty, 'keep'), 'keep')
      expect(() =>
        createVisualPlusFixture(nonempty, {
          asOfMs: AS_OF_MS,
          registryUrl: 'http://127.0.0.1:4873/',
        }),
      ).toThrow(/must be empty/u)
      expect(readFileSync(join(nonempty, 'keep'), 'utf8')).toBe('keep')

      const actual = join(canonicalParent, 'actual')
      const linked = join(canonicalParent, 'linked')
      mkdirSync(actual)
      symlinkSync(actual, linked, 'dir')
      expect(() =>
        createVisualPlusFixture(linked, {
          asOfMs: AS_OF_MS,
          registryUrl: 'http://127.0.0.1:4873/',
        }),
      ).toThrow(/not a symlink/u)
      expect(() =>
        createVisualPlusFixture('relative', {
          asOfMs: AS_OF_MS,
          registryUrl: 'http://127.0.0.1:4873/',
        }),
      ).toThrow(/canonical and absolute/u)

      for (const [name, overrides] of [
        ['missing clock', { registryUrl: 'http://127.0.0.1:4873/' }],
        ['remote registry', { asOfMs: AS_OF_MS, registryUrl: 'http://registry.example:4873/' }],
        ['credential registry', { asOfMs: AS_OF_MS, registryUrl: 'http://user@127.0.0.1:4873/' }],
        ['portless registry', { asOfMs: AS_OF_MS, registryUrl: 'http://127.0.0.1/' }],
      ] as const) {
        const root = join(canonicalParent, name.replaceAll(' ', '-'))
        mkdirSync(root)
        expect(() => createVisualPlusFixture(root, overrides), name).toThrow()
        expect(existsSync(join(root, 'repository'))).toBe(false)
      }
    } finally {
      rmSync(parent, { force: true, recursive: true })
    }
  })
})

function fixtureOptions(cwd: string): depfreshOptions {
  return {
    ...(DEFAULT_OPTIONS as depfreshOptions),
    cwd,
    inputCwd: cwd,
    effectiveRoot: cwd,
    recursive: true,
    mode: 'major',
    write: false,
    includeLocked: false,
    ignoreOtherWorkspaces: false,
    output: 'json',
    loglevel: 'silent',
    refreshCache: true,
  }
}

function createFixtureServer(
  readFixture: () => ReturnType<typeof createVisualPlusFixture> | undefined,
): Server {
  return createServer((request, response) => {
    const rawUrl = request.url ?? ''
    if (Buffer.byteLength(rawUrl) > 4_096) {
      response.writeHead(414).end()
      return
    }
    let bodyBytes = 0
    request.on('data', (chunk: Buffer) => {
      bodyBytes += chunk.byteLength
      if (bodyBytes > 1_024) request.destroy()
    })
    request.on('end', () => {
      if (bodyBytes > 1_024) return
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' }).end()
        return
      }
      let packageName: string
      try {
        const pathname = new URL(rawUrl, 'http://127.0.0.1').pathname
        packageName = decodeURIComponent(pathname.slice(1))
      } catch {
        response.writeHead(400).end()
        return
      }
      const body = readFixture()?.registry.responses.get(packageName)
      if (!body) {
        response
          .writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'not found' }))
        return
      }
      response.writeHead(200, {
        'content-type': 'application/vnd.npm.install-v1+json',
        'content-length': body.byteLength,
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    })
  })
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture registry did not listen')
  return `http://127.0.0.1:${address.port}/`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function runGitOutput(
  git: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  ...args: string[]
): Buffer {
  return execFileSync(git, args, {
    cwd,
    env: environment,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
}

async function withProcessEnvironment<T>(
  environment: NodeJS.ProcessEnv,
  callback: () => Promise<T>,
): Promise<T> {
  const original = { ...process.env }
  for (const name of Object.keys(process.env)) delete process.env[name]
  Object.assign(process.env, environment)
  try {
    return await callback()
  } finally {
    for (const name of Object.keys(process.env)) delete process.env[name]
    Object.assign(process.env, original)
  }
}

function findTestExecutable(name: string): string {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    try {
      const path = realpathSync.native(join(directory, name))
      if (!statSync(path).isFile()) continue
      accessSync(path, constants.X_OK)
      return path
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`Missing test executable: ${name}`)
}

function restoreProcessValue(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
