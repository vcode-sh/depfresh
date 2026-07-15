import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import YAML from 'yaml'
import type { CatalogSource, PackageMeta, RawDep, ResolvedDepChange } from '../../types'
import { writePackage } from './index'

interface ObservedOutcome {
  status: 'applied' | 'skipped' | 'conflicted' | 'reverted' | 'failed' | 'unknown'
  expectedValue: string
  requestedValue: string
  observedValue?: string
  occurrence: {
    file: string
    path: string[]
  }
}

type ChangeOverrides = Partial<ResolvedDepChange> & { rawVersion?: string }

function makeChange(overrides: ChangeOverrides = {}): ResolvedDepChange {
  return {
    name: 'shared',
    currentVersion: '^1.0.0',
    rawVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: { name: 'shared', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  } as ResolvedDepChange
}

function makePackage(
  filepath: string,
  type: PackageMeta['type'] = 'package.json',
  overrides: Partial<PackageMeta> = {},
): PackageMeta {
  return {
    name: 'fixture',
    type,
    filepath,
    deps: [],
    resolved: [],
    raw: {},
    indent: '  ',
    ...overrides,
  }
}

function asOutcomes(value: unknown): ObservedOutcome[] {
  return value as ObservedOutcome[]
}

describe('writePackage observed occurrence outcomes', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-observed-write-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates only the requested duplicate name and reports its canonical JSON path', () => {
    const filepath = join(tmpDir, 'package.json')
    writeFileSync(
      filepath,
      `${JSON.stringify(
        {
          name: 'fixture',
          dependencies: { shared: '^1.0.0' },
          devDependencies: { shared: '^1.0.0' },
        },
        null,
        2,
      )}\n`,
    )

    const outcomes = asOutcomes(
      writePackage(makePackage(filepath), [makeChange({ source: 'devDependencies' })], 'silent'),
    )
    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))

    expect(parsed.dependencies.shared).toBe('^1.0.0')
    expect(parsed.devDependencies.shared).toBe('^2.0.0')
    expect(outcomes).toEqual([
      expect.objectContaining({
        status: 'applied',
        expectedValue: '^1.0.0',
        requestedValue: '^2.0.0',
        observedValue: '^2.0.0',
        occurrence: {
          file: realpathSync(filepath),
          path: ['devDependencies', 'shared'],
        },
      }),
    ])
  })

  it('uses parents to update one exact nested override occurrence', () => {
    const filepath = join(tmpDir, 'package.json')
    writeFileSync(
      filepath,
      `${JSON.stringify(
        {
          overrides: {
            'parent-a': { shared: '1.0.0' },
            'parent-b': { shared: '1.0.0' },
          },
        },
        null,
        2,
      )}\n`,
    )

    const outcomes = asOutcomes(
      writePackage(
        makePackage(filepath),
        [
          makeChange({
            currentVersion: '1.0.0',
            rawVersion: '1.0.0',
            targetVersion: '2.0.0',
            source: 'overrides',
            parents: ['parent-b', 'shared'],
          }),
        ],
        'silent',
      ),
    )
    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))

    expect(parsed.overrides['parent-a'].shared).toBe('1.0.0')
    expect(parsed.overrides['parent-b'].shared).toBe('2.0.0')
    expect(outcomes[0]).toMatchObject({
      status: 'applied',
      occurrence: { path: ['overrides', 'parent-b', 'shared'] },
    })
  })

  it('returns conflicted and does not mutate when the expected raw value is stale', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = `${JSON.stringify({ dependencies: { shared: '^1.5.0' } }, null, 2)}\n`
    writeFileSync(filepath, content)

    const outcomes = asOutcomes(
      writePackage(makePackage(filepath), [makeChange({ rawVersion: '^1.0.0' })], 'silent'),
    )

    expect(readFileSync(filepath, 'utf-8')).toBe(content)
    expect(outcomes[0]).toMatchObject({
      status: 'conflicted',
      expectedValue: '^1.0.0',
      requestedValue: '^2.0.0',
      observedValue: '^1.5.0',
    })
  })

  it('returns skipped for a no-op without reserializing the file', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = '{"dependencies":{"shared":"1.0.0"}}\n'
    writeFileSync(filepath, content)

    const outcomes = asOutcomes(
      writePackage(
        makePackage(filepath),
        [makeChange({ currentVersion: '1.0.0', rawVersion: '1.0.0', targetVersion: '1.0.0' })],
        'silent',
      ),
    )

    expect(readFileSync(filepath, 'utf-8')).toBe(content)
    expect(outcomes[0]).toMatchObject({
      status: 'skipped',
      expectedValue: '1.0.0',
      requestedValue: '1.0.0',
      observedValue: '1.0.0',
    })
  })

  it('reports the physical file identity when invoked through a symlink', () => {
    const physicalFile = join(tmpDir, 'physical-package.json')
    const linkedFile = join(tmpDir, 'package.json')
    writeFileSync(physicalFile, '{"dependencies":{"shared":"1.0.0"}}\n')
    symlinkSync(physicalFile, linkedFile)

    const outcomes = asOutcomes(
      writePackage(
        makePackage(linkedFile),
        [makeChange({ currentVersion: '1.0.0', rawVersion: '1.0.0', targetVersion: '2.0.0' })],
        'silent',
      ),
    )

    expect(outcomes[0]?.occurrence.file).toBe(realpathSync(physicalFile))
  })

  it('keeps duplicate YAML fields separate and observes the requested field', () => {
    const filepath = join(tmpDir, 'package.yaml')
    writeFileSync(
      filepath,
      ['dependencies:', '  shared: ^1.0.0', 'devDependencies:', '  shared: ^1.0.0', ''].join('\n'),
    )

    const outcomes = asOutcomes(
      writePackage(
        makePackage(filepath, 'package.yaml'),
        [makeChange({ source: 'devDependencies' })],
        'silent',
      ),
    )
    const parsed = YAML.parse(readFileSync(filepath, 'utf-8'))

    expect(parsed.dependencies.shared).toBe('^1.0.0')
    expect(parsed.devDependencies.shared).toBe('^2.0.0')
    expect(outcomes[0]).toMatchObject({
      status: 'applied',
      occurrence: { path: ['devDependencies', 'shared'] },
      observedValue: '^2.0.0',
    })
  })

  it('updates only the exact named catalog owner when names repeat', () => {
    const filepath = join(tmpDir, 'package.json')
    const consumerFile = join(tmpDir, 'consumer-package.json')
    writeFileSync(
      filepath,
      `${JSON.stringify(
        {
          workspaces: {
            catalogs: {
              one: { shared: '^1.0.0' },
              two: { shared: '^1.0.0' },
            },
          },
        },
        null,
        2,
      )}\n`,
    )
    const consumerContent = '{"dependencies":{"shared":"catalog:two"}}\n'
    writeFileSync(consumerFile, consumerContent)

    const oneDep = {
      name: 'shared',
      currentVersion: '^1.0.0',
      rawVersion: '^1.0.0',
      source: 'catalog',
      update: true,
      parents: ['workspaces.catalogs.one'],
    } as RawDep
    const twoDep = {
      ...oneDep,
      parents: ['workspaces.catalogs.two'],
    } as RawDep
    const catalogs: CatalogSource[] = [
      { type: 'bun', name: 'one', filepath, deps: [oneDep], raw: {}, indent: '  ' },
      { type: 'bun', name: 'two', filepath, deps: [twoDep], raw: {}, indent: '  ' },
    ]
    const pkg = makePackage(filepath, 'bun-workspace', { catalogs })

    const outcomes = asOutcomes(
      writePackage(
        pkg,
        [makeChange({ source: 'catalog', parents: ['workspaces.catalogs.two'] })],
        'silent',
      ),
    )
    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))

    expect(parsed.workspaces.catalogs.one.shared).toBe('^1.0.0')
    expect(parsed.workspaces.catalogs.two.shared).toBe('^2.0.0')
    expect(readFileSync(consumerFile, 'utf-8')).toBe(consumerContent)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      status: 'applied',
      occurrence: { path: ['workspaces', 'catalogs', 'two', 'shared'] },
    })
  })

  it('itemizes a successful catalog write and a later physical writer failure', () => {
    const packageFile = join(tmpDir, 'package.json')
    const pnpmFile = join(tmpDir, 'pnpm-workspace.yaml')
    const missingYarnFile = join(tmpDir, 'missing', '.yarnrc.yml')
    writeFileSync(packageFile, '{"name":"fixture"}\n')
    writeFileSync(pnpmFile, 'catalog:\n  first: 1.0.0\n')

    const first = {
      name: 'first',
      currentVersion: '1.0.0',
      rawVersion: '1.0.0',
      source: 'catalog',
      update: true,
      parents: ['catalog'],
    } as RawDep
    const second = {
      name: 'second',
      currentVersion: '1.0.0',
      rawVersion: '1.0.0',
      source: 'catalog',
      update: true,
      parents: ['catalog'],
    } as RawDep
    const pkg = makePackage(packageFile, 'pnpm-workspace', {
      catalogs: [
        {
          type: 'pnpm',
          name: 'default',
          filepath: pnpmFile,
          deps: [first],
          raw: '',
          indent: '  ',
        },
        {
          type: 'yarn',
          name: 'default',
          filepath: missingYarnFile,
          deps: [second],
          raw: '',
          indent: '  ',
        },
      ],
    })

    const outcomes = asOutcomes(
      writePackage(
        pkg,
        [
          makeChange({
            name: 'first',
            currentVersion: '1.0.0',
            rawVersion: '1.0.0',
            targetVersion: '2.0.0',
            source: 'catalog',
            parents: ['catalog'],
          }),
          makeChange({
            name: 'second',
            currentVersion: '1.0.0',
            rawVersion: '1.0.0',
            targetVersion: '2.0.0',
            source: 'catalog',
            parents: ['catalog'],
          }),
        ],
        'silent',
      ),
    )

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['applied', 'failed'])
    expect(readFileSync(pnpmFile, 'utf-8')).toContain('first: 2.0.0')
  })
})
