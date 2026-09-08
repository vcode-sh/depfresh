import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { loadPackages } from '../io/packages/discovery'
import { DEFAULT_OPTIONS, type depfreshOptions } from '../types'
import { collectRepositoryEvidence } from './evidence'
import { inspectRepositoryWithProjection } from './inspect'

vi.mock('./evidence', async (importOriginal) => {
  const original = await importOriginal<typeof import('./evidence')>()
  return { ...original, collectRepositoryEvidence: vi.fn(original.collectRepositoryEvidence) }
})

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'depfresh-dependency-discovery-'))
  mkdirSync(join(root, 'packages/app'), { recursive: true })
  mkdirSync(join(root, 'unrelated/deep/tree'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'root',
      private: true,
      workspaces: { packages: ['packages/*'], catalogs: { ui: { react: '^19.0.0' } } },
      dependencies: { alias: 'npm:react@^18.0.0', ignored: '^1.0.0' },
    }),
  )
  writeFileSync(
    join(root, 'packages/app/package.json'),
    JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } }),
  )
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}')
  writeFileSync(join(root, 'yarn.lock'), '# yarn lockfile v1\n')
  vi.mocked(collectRepositoryEvidence).mockClear()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function options(extra: Partial<depfreshOptions> = {}): depfreshOptions {
  return {
    ...DEFAULT_OPTIONS,
    cwd: root,
    recursive: true,
    loglevel: 'silent',
    repositoryVcs: 'disabled',
    ...extra,
  } as depfreshOptions
}

it.each([false, true])(
  'keeps policy identities without repository evidence (exclude catalog: %s)',
  async (excludeCatalog) => {
    const selection = { workspaces: ['packages/app'], catalogs: excludeCatalog ? ['ui'] : [] }
    const normal = await loadPackages(
      options({ include: ['react', 'alias'], packageMode: { react: 'minor' } }),
      undefined,
      selection,
    )
    expect(collectRepositoryEvidence).not.toHaveBeenCalled()
    const facts = (packages: typeof normal) =>
      packages.flatMap((pkg) =>
        pkg.deps.map((dep) => ({
          file: relative(root, pkg.filepath),
          name: dep.name,
          alias: dep.aliasName,
          occurrence: dep.occurrenceId,
          decision: dep.policyDecision,
        })),
      )
    expect(facts(normal).map((dep) => [dep.name, dep.alias])).toEqual(
      excludeCatalog
        ? [['alias', 'react']]
        : [
            ['alias', 'react'],
            ['react', undefined],
          ],
    )
    const full = await inspectRepositoryWithProjection(
      options({ include: ['react', 'alias'], packageMode: { react: 'minor' } }),
      undefined,
      selection,
    )
    expect(collectRepositoryEvidence).toHaveBeenCalledOnce()
    expect(facts(normal)).toEqual(facts(full.packages))
  },
)

it('collects full evidence for manager policy and blocks ambiguous manager matches', async () => {
  const packages = await loadPackages(
    options({
      policyRules: [
        { id: 'npm-only', selectors: { dependencyName: 'alias', manager: 'npm' }, mode: 'major' },
      ],
    }),
  )
  expect(collectRepositoryEvidence).toHaveBeenCalledOnce()
  expect(packages.find((pkg) => pkg.name === 'root')?.deps.map((dep) => dep.name)).not.toContain(
    'alias',
  )
})

it.each([
  {
    signalRules: [{ id: 'runtime-warning', selectors: { family: 'runtime' }, effect: 'warn' }],
  },
  { cohorts: [{ id: 'react-family', members: ['react', 'react-dom'], strategy: 'same-major' }] },
] satisfies Partial<depfreshOptions>[])(
  'retains repository evidence for explicit signal configuration %j',
  async (configuration) => {
    await loadPackages(options(configuration))
    expect(collectRepositoryEvidence).toHaveBeenCalledOnce()
  },
)
