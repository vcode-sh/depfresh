import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryReport, PackageMeta } from '../types'
import { inspectRepository } from './inspect'
import { buildRepositoryModel } from './model'

function writeJson(filepath: string, value: unknown): void {
  writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`)
}

describe('inspectRepository model core', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-repository-model-'))
    mkdirSync(join(root, 'packages', 'app'), { recursive: true })
    writeJson(join(root, 'package.json'), {
      name: 'root',
      private: true,
      workspaces: {
        packages: ['packages/*'],
        catalogs: {
          ui: { react: '^19.0.0', shared: '^2.0.0' },
          peers: { react: '^19.0.0' },
        },
      },
      dependencies: {
        shared: '^1.0.0',
        react: 'catalog:ui',
      },
      devDependencies: { shared: '^1.1.0' },
      overrides: {
        parent: { shared: '1.0.0' },
      },
    })
    writeFileSync(
      join(root, 'packages', 'app', 'package.yaml'),
      [
        'name: app',
        'private: false',
        'dependencies:',
        '  shared: workspace:^1.0.0',
        '  alias: npm:shared@^1.0.0',
        '  jsr-package: jsr:@scope/name@^1.0.0',
        '',
      ].join('\r\n'),
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('is versioned, deterministic, relative, and hashes exact source bytes', async () => {
    const first = await inspectRepository({ cwd: root })
    const second = await inspectRepository({ cwd: root })
    const serialized = JSON.stringify(first)

    expect(first.schemaVersion).toBe(1)
    expect(JSON.stringify(second)).toBe(serialized)
    expect(serialized).not.toContain(root)
    expect(serialized).not.toMatch(/"(?:timestamp|createdAt|inode)"/)
    expect(first.sourceFiles.map((source) => source.path)).toEqual([
      'package.json',
      'packages/app/package.yaml',
    ])

    const yamlSource = first.sourceFiles.find(
      (source) => source.path === 'packages/app/package.yaml',
    )
    const yamlBytes = readFileSync(join(root, 'packages', 'app', 'package.yaml'))
    expect(yamlSource).toMatchObject({
      format: 'yaml',
      parseState: 'parsed',
      newline: 'crlf',
      trailingNewline: true,
    })
    expect(yamlSource?.byteHash).toBe(createHash('sha256').update(yamlBytes).digest('hex'))
  })

  it('produces identical IDs and JSON at different absolute roots', async () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'depfresh-repository-copy-'))
    try {
      mkdirSync(join(otherRoot, 'packages', 'app'), { recursive: true })
      writeFileSync(join(otherRoot, 'package.json'), readFileSync(join(root, 'package.json')))
      writeFileSync(
        join(otherRoot, 'packages', 'app', 'package.yaml'),
        readFileSync(join(root, 'packages', 'app', 'package.yaml')),
      )

      const first = await inspectRepository({ cwd: root })
      const second = await inspectRepository({ cwd: otherRoot })

      expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  it('keeps repeated declarations separate by exact owner and path', async () => {
    const model = await inspectRepository({ cwd: root })
    const shared = model.occurrences.filter((occurrence) => occurrence.name === 'shared')

    expect(shared.map((occurrence) => occurrence.path)).toEqual(
      expect.arrayContaining([
        ['dependencies', 'shared'],
        ['devDependencies', 'shared'],
        ['overrides', 'parent', 'shared'],
        ['workspaces', 'catalogs', 'ui', 'shared'],
        ['dependencies', 'shared'],
      ]),
    )
    expect(new Set(shared.map((occurrence) => occurrence.id)).size).toBe(shared.length)
    expect(new Set(shared.map((occurrence) => occurrence.ownerId)).size).toBeGreaterThan(1)
  })

  it('characterizes supported protocols, packageManager, and nested resolution paths', async () => {
    const filepath = join(root, 'package.json')
    const raw = JSON.parse(readFileSync(filepath, 'utf-8'))
    raw.packageManager = 'pnpm@10.0.0+sha512.example'
    raw.dependencies = {
      ...raw.dependencies,
      npmAlias: 'npm:shared@^1.0.0',
      jsrAlias: 'jsr:@scope/name@^1.0.0',
      githubTag: 'github:owner/repo#v1.2.3',
      workspaceDep: 'workspace:^1.0.0',
      localFile: 'file:../archive.tgz',
      localLink: 'link:../linked',
      gitDep: 'git+ssh://example.test/repository.git',
      httpDep: 'https://example.test/archive.tgz',
    }
    raw.resolutions = { 'shared@^1': '1.2.0' }
    raw.pnpm = { overrides: { parent: { shared: '1.3.0' } } }
    writeJson(filepath, raw)

    const model = await inspectRepository({ cwd: root })
    const byName = (name: string) =>
      model.occurrences.find((occurrence) => occurrence.name === name)

    expect(byName('npmAlias')).toMatchObject({ protocol: 'npm', writeable: true })
    expect(byName('jsrAlias')).toMatchObject({ protocol: 'jsr', writeable: true })
    expect(byName('githubTag')).toMatchObject({ protocol: 'github', writeable: true })
    expect(byName('workspaceDep')).toMatchObject({ protocol: 'workspace', writeable: true })
    expect(byName('localFile')).toMatchObject({ protocol: 'file', writeable: false })
    expect(byName('localLink')).toMatchObject({ protocol: 'link', writeable: false })
    expect(byName('gitDep')).toMatchObject({ protocol: 'git', writeable: false })
    expect(byName('httpDep')).toMatchObject({ protocol: 'http', writeable: false })
    expect(model.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'package-manager',
          path: ['packageManager'],
          declaredText: 'pnpm@10.0.0+sha512.example',
        }),
        expect.objectContaining({
          role: 'override',
          name: 'shared',
          path: ['resolutions', 'shared@^1'],
        }),
        expect.objectContaining({
          role: 'override',
          name: 'shared',
          path: ['pnpm', 'overrides', 'parent', 'shared'],
        }),
      ]),
    )
  })

  it('links catalog owners and consumers without conflating direct declarations', async () => {
    const model = await inspectRepository({ cwd: root })
    const catalog = model.catalogs.find((candidate) => candidate.name === 'ui')
    expect(catalog).toBeDefined()

    const owner = model.occurrences.find(
      (occurrence) =>
        occurrence.catalogId === catalog?.id &&
        occurrence.role === 'catalog-owner' &&
        occurrence.name === 'react',
    )
    const consumer = model.occurrences.find(
      (occurrence) => occurrence.role === 'catalog-consumer' && occurrence.name === 'react',
    )
    const direct = model.occurrences.find(
      (occurrence) => occurrence.role === 'dependency' && occurrence.name === 'shared',
    )

    expect(owner).toBeDefined()
    expect(consumer).toMatchObject({ catalogId: catalog?.id, declaredText: 'catalog:ui' })
    expect(direct?.catalogId).toBeUndefined()
    expect(model.relationships.catalogConsumers).toContainEqual({
      catalogId: catalog?.id,
      occurrenceId: consumer?.id,
    })
  })

  it('models peer catalogs even when the compatibility projection filters them', async () => {
    const model = await inspectRepository({ cwd: root })

    expect(model.catalogs).toEqual(
      expect.arrayContaining([expect.objectContaining({ manager: 'bun', name: 'peers' })]),
    )
    expect(model.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'catalog-owner',
          path: ['workspaces', 'catalogs', 'peers', 'react'],
        }),
      ]),
    )
  })

  it('links a default Yarn catalog through the same catalog model', async () => {
    writeFileSync(join(root, '.yarnrc.yml'), 'catalog:\n  gamma: ^1.0.0\n')
    const filepath = join(root, 'package.json')
    const raw = JSON.parse(readFileSync(filepath, 'utf-8'))
    raw.dependencies.gamma = 'catalog:'
    writeJson(filepath, raw)

    const model = await inspectRepository({ cwd: root })
    const catalog = model.catalogs.find(
      (candidate) => candidate.manager === 'yarn' && candidate.name === 'default',
    )
    const owner = model.occurrences.find(
      (occurrence) => occurrence.catalogId === catalog?.id && occurrence.role === 'catalog-owner',
    )
    const consumer = model.occurrences.find(
      (occurrence) => occurrence.name === 'gamma' && occurrence.role === 'catalog-consumer',
    )

    expect(catalog?.entries).toEqual([{ name: 'gamma', occurrenceId: owner?.id }])
    expect(consumer?.catalogId).toBe(catalog?.id)
  })

  it('sorts reversed discovery projections into byte-identical model JSON', () => {
    const firstFile = join(root, 'package.json')
    const secondFile = join(root, 'packages', 'app', 'package.yaml')
    const makePackage = (
      filepath: string,
      name: string,
      type: PackageMeta['type'],
    ): PackageMeta => ({
      name,
      type,
      filepath,
      deps: [],
      resolved: [],
      raw: {},
      indent: '  ',
    })
    const first = makePackage(firstFile, 'root', 'package.json')
    const second = makePackage(secondFile, 'app', 'package.yaml')
    const report = (matchedManifests: string[]): DiscoveryReport => ({
      inputCwd: root,
      effectiveRoot: root,
      discoveryMode: 'direct-root',
      matchedManifests,
      loadedPackages: matchedManifests,
      skippedManifests: [],
      loadedCatalogs: [],
    })

    const forward = buildRepositoryModel(root, [first, second], report([firstFile, secondFile]))
    const reversed = buildRepositoryModel(root, [second, first], report([secondFile, firstFile]))

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward))
  })

  it('diagnoses same-named catalogs instead of guessing a consumer owner', async () => {
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      ['packages:', "  - 'packages/*'", 'catalogs:', '  ui:', '    react: ^19.0.0', ''].join('\n'),
    )

    const model = await inspectRepository({ cwd: root })
    const consumer = model.occurrences.find(
      (occurrence) => occurrence.role === 'catalog-consumer' && occurrence.name === 'react',
    )

    expect(model.catalogs.filter((catalog) => catalog.name === 'ui')).toHaveLength(2)
    expect(consumer?.catalogId).toBeUndefined()
    expect(model.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'CATALOG_REFERENCE_AMBIGUOUS' }),
    )
  })

  it('does not write files, contact fetch, or execute a package manager', async () => {
    const before = readFileSync(join(root, 'package.json'), 'utf-8')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    const bin = join(root, 'bin')
    const processMarker = join(root, 'process-invoked')
    mkdirSync(bin)
    for (const command of ['npm', 'pnpm', 'bun', 'yarn']) {
      const executable = join(bin, command)
      writeFileSync(executable, `#!/bin/sh\ntouch '${processMarker}'\nexit 1\n`)
      chmodSync(executable, 0o755)
    }
    const originalPath = process.env.PATH
    process.env.PATH = bin

    try {
      const model = await inspectRepository({ cwd: root })

      expect(model.packages).toHaveLength(2)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(existsSync(processMarker)).toBe(false)
      expect(readFileSync(join(root, 'package.json'), 'utf-8')).toBe(before)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('keeps malformed supported sources as parse-error evidence', async () => {
    const badDir = join(root, 'packages', 'bad')
    mkdirSync(badDir)
    writeFileSync(join(badDir, 'package.json'), '{ invalid json')

    const model = await inspectRepository({ cwd: root })

    expect(model.sourceFiles).toContainEqual(
      expect.objectContaining({ path: 'packages/bad/package.json', parseState: 'error' }),
    )
    expect(model.packages.some((pkg) => pkg.path === 'packages/bad/package.json')).toBe(false)
    expect(model.diagnostics).toContainEqual({
      code: 'SOURCE_PARSE_FAILED',
      path: 'packages/bad/package.json',
    })
  })

  it('emits a diagnostic instead of crossing a catalog symlink outside the root', async () => {
    const external = mkdtempSync(join(tmpdir(), 'depfresh-repository-external-'))
    writeFileSync(join(external, 'pnpm-workspace.yaml'), 'catalog:\n  escaped: 1.0.0\n')
    try {
      const { symlinkSync } = await import('node:fs')
      symlinkSync(join(external, 'pnpm-workspace.yaml'), join(root, 'pnpm-workspace.yaml'))

      const model = await inspectRepository({ cwd: root })

      expect(
        model.catalogs.some((catalog) => catalog.entries.some((entry) => entry.name === 'escaped')),
      ).toBe(false)
      expect(model.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'SOURCE_OUTSIDE_ROOT', path: 'pnpm-workspace.yaml' }),
        ]),
      )
    } finally {
      rmSync(external, { recursive: true, force: true })
    }
  })

  it('returns a root diagnostic for a missing inspection target', async () => {
    const emptyParent = mkdtempSync(join(tmpdir(), 'depfresh-repository-missing-'))
    const missing = join(emptyParent, 'does-not-exist')

    try {
      const model = await inspectRepository({ cwd: missing })

      expect(model.sourceFiles).toEqual([])
      expect(model.diagnostics).toContainEqual({ code: 'ROOT_NOT_FOUND', path: '.' })
    } finally {
      rmSync(emptyParent, { recursive: true, force: true })
    }
  })
})
