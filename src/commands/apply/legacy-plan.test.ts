import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRepositoryId } from '../../repository/identity'
import type {
  CatalogSource,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
} from '../../types'
import { applyLegacyCommandWrite, createLegacyPlan } from './legacy-plan'

const roots: string[] = []

const authority: InvocationAuthority = {
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
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-legacy-plan-'))
  roots.push(root)
  return realpathSync.native(root)
}

function change(name: string, current = '1.0.0', target = '2.0.0'): ResolvedDepChange {
  return {
    name,
    currentVersion: current,
    rawVersion: current,
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: target,
    diff: 'major',
    pkgData: { name, versions: [current, target], distTags: { latest: target } },
  }
}

function manifest(filepath: string, name: string): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath,
    deps: [],
    resolved: [],
    raw: {},
    indent: '  ',
  }
}

function catalogPackage(filepath: string, catalog: CatalogSource, name: string): PackageMeta {
  return {
    name,
    type: 'bun-workspace',
    filepath,
    deps: catalog.deps,
    resolved: [],
    raw: catalog.raw,
    indent: catalog.indent,
    catalogs: [catalog],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('command-level legacy plan', () => {
  it('builds one deterministic plan and deduplicates one shared Bun catalog occurrence', () => {
    const root = temporaryRoot()
    const firstPath = join(root, 'packages', 'a', 'package.json')
    const secondPath = join(root, 'packages', 'b', 'package.json')
    const catalogPath = join(root, 'package.json')
    mkdirSync(join(root, 'packages', 'a'), { recursive: true })
    mkdirSync(join(root, 'packages', 'b'), { recursive: true })
    writeFileSync(firstPath, '{"dependencies":{"alpha":"1.0.0"}}\n')
    writeFileSync(secondPath, '{"dependencies":{"beta":"1.0.0"}}\n')
    writeFileSync(catalogPath, '{"workspaces":{"catalog":{"shared":"1.0.0"}},"private":true}\n')
    const sharedChange = change('shared')
    const sharedCatalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath: catalogPath,
      deps: [
        {
          name: 'shared',
          currentVersion: '1.0.0',
          rawVersion: '1.0.0',
          source: 'catalog',
          update: true,
          parents: [],
        },
      ],
      raw: {},
      indent: '  ',
    }
    const selections = [
      {
        packageIndex: 2,
        pkg: catalogPackage(catalogPath, sharedCatalog, 'catalog one'),
        changes: [sharedChange],
      },
      { packageIndex: 0, pkg: manifest(firstPath, 'a'), changes: [change('alpha')] },
      {
        packageIndex: 3,
        pkg: catalogPackage(catalogPath, sharedCatalog, 'catalog two'),
        changes: [sharedChange],
      },
      { packageIndex: 1, pkg: manifest(secondPath, 'b'), changes: [change('beta')] },
    ]

    const first = createLegacyPlan(root, selections)
    const second = createLegacyPlan(root, [...selections].reverse())

    expect(first.plan.repository.identity).toBe(second.plan.repository.identity)
    expect(first.plan.planFingerprint).toBe(second.plan.planFingerprint)
    expect(first.plan.operations.map((operation) => [operation.file, operation.path])).toEqual([
      ['package.json', ['workspaces', 'catalog', 'shared']],
      ['packages/a/package.json', ['dependencies', 'alpha']],
      ['packages/b/package.json', ['dependencies', 'beta']],
    ])
    expect(first.projections.map((projection) => projection.operationId)).toEqual([
      first.plan.operations[0]?.id,
      first.plan.operations[1]?.id,
      first.plan.operations[0]?.id,
      first.plan.operations[2]?.id,
    ])
  })

  it('applies all targets once and projects a shared operation to each package selection', async () => {
    const root = temporaryRoot()
    const manifestPath = join(root, 'package.json')
    writeFileSync(manifestPath, '{"dependencies":{"alpha":"1.0.0","shared":"1.0.0"}}\n')
    const pkg = manifest(manifestPath, 'root')
    const selections = [
      { packageIndex: 8, pkg, changes: [change('alpha'), change('shared')] },
      { packageIndex: 9, pkg, changes: [change('shared')] },
    ]

    const result = await applyLegacyCommandWrite(root, selections, authority)

    expect(result.status).toBe('executed')
    if (result.status !== 'executed') throw new Error('Expected an executed legacy command result')
    expect(result.applyResult.status).toBe('applied')
    expect(result.packages).toMatchObject([
      {
        packageIndex: 8,
        outcomes: [
          { name: 'alpha', status: 'applied' },
          { name: 'shared', status: 'applied' },
        ],
      },
      { packageIndex: 9, outcomes: [{ name: 'shared', status: 'applied' }] },
    ])
    expect(result.attempts).toEqual([
      {
        targetPath: 'package.json',
        operationIds: result.applyResult.operations.map((operation) => operation.operationId),
        replacementAttempted: true,
      },
    ])
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies).toEqual({
      alpha: '2.0.0',
      shared: '2.0.0',
    })
  })

  it('blocks all projections deterministically when physical requests conflict', async () => {
    const root = temporaryRoot()
    const manifestPath = join(root, 'package.json')
    writeFileSync(manifestPath, '{"dependencies":{"shared":"1.0.0"}}\n')
    const pkg = manifest(manifestPath, 'root')

    const selections = [
      { packageIndex: 0, pkg, changes: [change('shared', '1.0.0', '2.0.0')] },
      { packageIndex: 1, pkg, changes: [change('shared', '1.0.0', '3.0.0')] },
    ]
    const construction = createLegacyPlan(root, selections)
    const reversed = createLegacyPlan(root, [...selections].reverse())
    const result = await applyLegacyCommandWrite(root, selections, authority)

    expect(construction.plan.operations).toEqual([])
    expect(construction.projections.map((projection) => projection.operationId)).toEqual([
      expect.stringMatching(/^operation-/u),
      construction.projections[0]?.operationId,
    ])
    expect(reversed.projections.map((projection) => projection.operationId)).toEqual([
      construction.projections[0]?.operationId,
      construction.projections[0]?.operationId,
    ])

    expect(result.packages.map((entry) => entry.outcomes[0])).toMatchObject([
      { status: 'conflicted', reason: 'AMBIGUOUS_OCCURRENCE' },
      { status: 'conflicted', reason: 'AMBIGUOUS_OCCURRENCE' },
    ])
    expect(result.status).toBe('blocked')
    expect('applyResult' in result).toBe(false)
    expect(result.attempts).toEqual([
      {
        targetPath: 'package.json',
        operationIds: [construction.projections[0]?.operationId],
        replacementAttempted: false,
      },
    ])
    expect(readFileSync(manifestPath, 'utf8')).toBe('{"dependencies":{"shared":"1.0.0"}}\n')
  })

  it('retains every blocked physical operation when one target has mixed requests', async () => {
    const root = temporaryRoot()
    const manifestPath = join(root, 'package.json')
    const initial = '{"dependencies":{"alpha":"1.0.0","beta":"1.0.0","gamma":"1.0.0"}}\n'
    writeFileSync(manifestPath, initial)
    const pkg = manifest(manifestPath, 'root')
    const selections = [
      {
        packageIndex: 0,
        pkg,
        changes: [
          change('alpha', '1.0.0', '2.0.0'),
          change('beta', '1.0.0', '2.0.0'),
          change('gamma', '1.0.0', '2.0.0'),
        ],
      },
      {
        packageIndex: 1,
        pkg,
        changes: [change('alpha', '1.0.0', '3.0.0'), change('beta', '1.0.0', '3.0.0')],
      },
    ]
    const construction = createLegacyPlan(root, selections)
    const result = await applyLegacyCommandWrite(root, selections, authority)
    const operationIds = new Map(
      construction.projections.map((projection) => [
        projection.change.name,
        projection.operationId,
      ]),
    )

    expect(construction.plan.operations.map((operation) => operation.name)).toEqual(['gamma'])
    expect(construction.projections.map((projection) => projection.operationId)).toEqual([
      operationIds.get('alpha'),
      operationIds.get('beta'),
      construction.plan.operations[0]?.id,
      operationIds.get('alpha'),
      operationIds.get('beta'),
    ])
    expect(new Set(operationIds.values()).size).toBe(3)
    expect(result.status).toBe('blocked')
    expect(result.attempts).toEqual([
      {
        targetPath: 'package.json',
        operationIds: [
          operationIds.get('alpha'),
          operationIds.get('beta'),
          operationIds.get('gamma'),
        ],
        replacementAttempted: false,
      },
    ])
    expect(readFileSync(manifestPath, 'utf8')).toBe(initial)
  })

  it('rejects a target outside the explicit effective root without mutation', async () => {
    const root = temporaryRoot()
    const outsideRoot = temporaryRoot()
    const filepath = join(outsideRoot, 'package.json')
    writeFileSync(filepath, '{"dependencies":{"shared":"1.0.0"}}\n')

    const result = await applyLegacyCommandWrite(
      root,
      [{ packageIndex: 0, pkg: manifest(filepath, 'outside'), changes: [change('shared')] }],
      authority,
    )

    expect(result.packages[0]?.outcomes[0]).toMatchObject({
      status: 'failed',
      reason: 'UNSUPPORTED_WRITE_SOURCE',
    })
    expect(readFileSync(filepath, 'utf8')).toBe('{"dependencies":{"shared":"1.0.0"}}\n')
  })

  it('returns a schema-valid empty apply result', async () => {
    const root = temporaryRoot()
    const result = await applyLegacyCommandWrite(root, [], authority)
    expect(result.status).toBe('executed')
    if (result.status !== 'executed') throw new Error('Expected an executed legacy command result')
    expect(result.applyResult).toMatchObject({ status: 'noop', operations: [] })
    expect(result.packages).toEqual([])
    expect(result.attempts).toEqual([])
  })

  it('rejects relative roots and duplicate or negative package indexes', () => {
    const root = temporaryRoot()
    const filepath = join(root, 'package.json')
    writeFileSync(filepath, '{"dependencies":{"shared":"1.0.0"}}\n')
    const pkg = manifest(filepath, 'root')
    const selected = { packageIndex: 0, pkg, changes: [change('shared')] }

    expect(() => createLegacyPlan('.', [])).toThrow(/canonical directory/u)
    expect(() => createLegacyPlan(root, [selected, selected])).toThrow(/unique non-negative/u)
    expect(() => createLegacyPlan(root, [{ ...selected, packageIndex: -1 }])).toThrow(
      /unique non-negative/u,
    )
  })

  it('rejects an original lexical manifest symlink before canonicalization', async () => {
    const root = temporaryRoot()
    const target = join(root, 'target.json')
    const link = join(root, 'package.json')
    writeFileSync(target, '{"dependencies":{"shared":"1.0.0"}}\n')
    symlinkSync(target, link)

    const result = await applyLegacyCommandWrite(
      root,
      [{ packageIndex: 0, pkg: manifest(link, 'linked'), changes: [change('shared')] }],
      authority,
    )

    expect(result.status).toBe('blocked')
    expect(result.packages[0]?.outcomes[0]).toMatchObject({
      status: 'failed',
      reason: 'UNSUPPORTED_WRITE_SOURCE',
    })
    expect(readFileSync(target, 'utf8')).toBe('{"dependencies":{"shared":"1.0.0"}}\n')
  })

  it('deduplicates duplicate catalog objects by canonical source and exact path', async () => {
    const root = temporaryRoot()
    const filepath = join(root, 'package.json')
    writeFileSync(filepath, '{"workspaces":{"catalog":{"shared":"1.0.0"}}}\n')
    const shared = change('shared')
    const source: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [
        {
          name: 'shared',
          currentVersion: '1.0.0',
          rawVersion: '1.0.0',
          source: 'catalog',
          update: true,
          parents: [],
        },
      ],
      raw: {},
      indent: '  ',
    }
    const pkg = catalogPackage(filepath, source, 'duplicate catalogs')
    pkg.catalogs = [source, { ...source }]

    const result = await applyLegacyCommandWrite(
      root,
      [{ packageIndex: 0, pkg, changes: [shared] }],
      authority,
    )

    expect(result.status).toBe('executed')
    expect(result.attempts).toMatchObject([
      {
        targetPath: 'package.json',
        operationIds: [expect.any(String)],
        replacementAttempted: true,
      },
    ])
    expect(JSON.parse(readFileSync(filepath, 'utf8')).workspaces.catalog.shared).toBe('2.0.0')
  })

  it('scopes ambiguity to its occurrence and preserves an unrelated unsupported cause', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot()
    const filepath = join(root, 'package.json')
    const outsidePath = join(outside, 'package.json')
    writeFileSync(filepath, '{"dependencies":{"alpha":"1.0.0","shared":"1.0.0"}}\n')
    writeFileSync(outsidePath, '{"dependencies":{"outside":"1.0.0"}}\n')
    const pkg = manifest(filepath, 'root')

    const result = await applyLegacyCommandWrite(
      root,
      [
        {
          packageIndex: 0,
          pkg,
          changes: [change('alpha'), change('shared', '1.0.0', '2.0.0')],
        },
        {
          packageIndex: 1,
          pkg,
          changes: [change('shared', '1.0.0', '3.0.0')],
        },
        {
          packageIndex: 2,
          pkg: manifest(outsidePath, 'outside'),
          changes: [change('outside')],
        },
      ],
      authority,
    )

    expect(result.status).toBe('blocked')
    expect(
      result.packages.flatMap((entry) => entry.outcomes).map((outcome) => outcome.reason),
    ).toEqual([
      'WRITE_FAILED',
      'AMBIGUOUS_OCCURRENCE',
      'AMBIGUOUS_OCCURRENCE',
      'UNSUPPORTED_WRITE_SOURCE',
    ])
    expect(result.attempts).toMatchObject([
      {
        targetPath: 'package.json',
        operationIds: [expect.any(String), expect.any(String)],
        replacementAttempted: false,
      },
    ])
    expect(JSON.parse(readFileSync(filepath, 'utf8')).dependencies.alpha).toBe('1.0.0')
  })

  it('retains protocol spelling in an unsupported projection', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot()
    const filepath = join(outside, 'package.json')
    writeFileSync(filepath, '{"dependencies":{"alias":"npm:real@^1.0.0"}}\n')
    const alias = change('alias', '1.0.0', '2.0.0')
    alias.rawVersion = 'npm:real@^1.0.0'

    const result = await applyLegacyCommandWrite(
      root,
      [{ packageIndex: 0, pkg: manifest(filepath, 'outside'), changes: [alias] }],
      authority,
    )

    expect(result.packages[0]?.outcomes[0]).toMatchObject({
      expectedValue: 'npm:real@^1.0.0',
      requestedValue: 'npm:real@2.0.0',
    })
  })

  it('derives mixed newlines, tabs, and missing final newline from exact source bytes', () => {
    const root = temporaryRoot()
    const filepath = join(root, 'package.json')
    writeFileSync(filepath, '{\r\n\t"dependencies": {\n\t\t"shared": "1.0.0"\r\n\t}\r\n}')

    const construction = createLegacyPlan(root, [
      { packageIndex: 0, pkg: manifest(filepath, 'root'), changes: [change('shared')] },
    ])

    expect(construction.plan.repository.sourceFiles[0]).toMatchObject({
      indent: '\t',
      newline: 'mixed',
      trailingNewline: false,
    })
  })

  it('exposes deeply frozen physical selection evidence with canonical shared ownership', () => {
    const root = temporaryRoot()
    const firstPath = join(root, 'packages', 'a', 'package.json')
    const secondPath = join(root, 'packages', 'b', 'package.json')
    const catalogPath = join(root, 'package.json')
    mkdirSync(join(root, 'packages', 'a'), { recursive: true })
    mkdirSync(join(root, 'packages', 'b'), { recursive: true })
    writeFileSync(firstPath, '{"dependencies":{"alpha":"1.0.0"}}\n')
    writeFileSync(secondPath, '{"dependencies":{"beta":"1.0.0"}}\n')
    writeFileSync(catalogPath, '{"workspaces":{"catalog":{"shared":"1.0.0"}}}\n')
    const shared = change('shared')
    shared.publishedAt = '2025-01-01T00:00:00.000Z'
    shared.nodeCompatible = false
    shared.nodeCompat = '<24'
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath: catalogPath,
      deps: [
        {
          name: 'shared',
          currentVersion: '1.0.0',
          rawVersion: '1.0.0',
          source: 'catalog',
          update: true,
          parents: [],
        },
      ],
      raw: {},
      indent: '  ',
    }

    const construction = createLegacyPlan(root, [
      {
        packageIndex: 4,
        pkg: catalogPackage(catalogPath, catalog, 'later'),
        changes: [{ ...shared }],
      },
      {
        packageIndex: 1,
        pkg: catalogPackage(catalogPath, catalog, '\u001B[31m owner '),
        changes: [{ ...shared }],
      },
      { packageIndex: 2, pkg: manifest(firstPath, 'a'), changes: [change('alpha')] },
      { packageIndex: 3, pkg: manifest(secondPath, ''), changes: [change('beta')] },
    ])

    const catalogSourceId = createRepositoryId('source', 'package.json')
    const catalogId = createRepositoryId('catalog', 'package.json\0bun\0default')
    const alphaSourceId = createRepositoryId('source', 'packages/a/package.json')
    const betaSourceId = createRepositoryId('source', 'packages/b/package.json')
    expect(construction.selectionEvidence).toEqual({
      status: 'ready',
      evidence: {
        operations: [
          {
            operationId: construction.plan.operations[0]?.id,
            packageIndex: 1,
            changeIndex: 0,
            dependencyId: createRepositoryId('dependency', 'shared'),
            rawName: 'shared',
            source: 'dependencies',
            sourceFileId: catalogSourceId,
            sourcePath: 'package.json',
            owner: {
              id: catalogId,
              role: 'catalog',
              label: 'default',
              path: 'package.json',
              physicalTarget: 'package.json',
            },
            physicalTarget: 'package.json',
            occurrencePath: ['workspaces', 'catalog', 'shared'],
            name: 'shared',
            current: '1.0.0',
            target: '2.0.0',
            diff: 'major',
            publishedAt: '2025-01-01T00:00:00.000Z',
            nodeCompatible: false,
            nodeCompat: '<24',
            catalog: {
              role: 'owner',
              id: catalogId,
              manager: 'bun',
              name: 'default',
              sourceFileId: catalogSourceId,
              sourcePath: 'package.json',
            },
          },
          expect.objectContaining({
            operationId: construction.plan.operations[1]?.id,
            packageIndex: 2,
            dependencyId: createRepositoryId('dependency', 'alpha'),
            rawName: 'alpha',
            sourceFileId: alphaSourceId,
            sourcePath: 'packages/a/package.json',
            owner: {
              id: createRepositoryId('package', 'packages/a/package.json'),
              role: 'manifest',
              label: 'a',
              path: 'packages/a/package.json',
              physicalTarget: 'packages/a/package.json',
            },
            catalog: { role: 'direct' },
            physicalTarget: 'packages/a/package.json',
            name: 'alpha',
          }),
          expect.objectContaining({
            operationId: construction.plan.operations[2]?.id,
            packageIndex: 3,
            dependencyId: createRepositoryId('dependency', 'beta'),
            rawName: 'beta',
            sourceFileId: betaSourceId,
            sourcePath: 'packages/b/package.json',
            owner: {
              id: createRepositoryId('package', 'packages/b/package.json'),
              role: 'manifest',
              label: 'packages/b/package.json',
              path: 'packages/b/package.json',
              physicalTarget: 'packages/b/package.json',
            },
            catalog: { role: 'direct' },
            physicalTarget: 'packages/b/package.json',
            name: 'beta',
          }),
        ],
        targets: [
          { path: 'package.json', operationIds: [construction.plan.operations[0]?.id] },
          { path: 'packages/a/package.json', operationIds: [construction.plan.operations[1]?.id] },
          { path: 'packages/b/package.json', operationIds: [construction.plan.operations[2]?.id] },
        ],
      },
    })
    expect(Object.isFrozen(construction.selectionEvidence)).toBe(true)
    if (construction.selectionEvidence.status !== 'ready') throw new Error('Expected evidence')
    expect(Object.isFrozen(construction.selectionEvidence.evidence)).toBe(true)
    expect(Object.isFrozen(construction.selectionEvidence.evidence.operations)).toBe(true)
    expect(Object.isFrozen(construction.selectionEvidence.evidence.operations[0])).toBe(true)
    expect(Object.isFrozen(construction.selectionEvidence.evidence.operations[0]?.owner)).toBe(true)
    expect(Object.isFrozen(construction.selectionEvidence.evidence.operations[0]?.catalog)).toBe(
      true,
    )
    expect(Object.isFrozen(construction.selectionEvidence.evidence.targets[0]?.operationIds)).toBe(
      true,
    )
  })

  it('fails selection evidence closed for unsupported, unbound, and inconsistent truth', () => {
    const root = temporaryRoot()
    const outside = temporaryRoot()
    const filepath = join(root, 'package.json')
    const outsidePath = join(outside, 'package.json')
    writeFileSync(filepath, '{"dependencies":{"shared":"1.0.0"}}\n')
    writeFileSync(outsidePath, '{"dependencies":{"outside":"1.0.0"}}\n')
    const pkg = manifest(filepath, 'root')
    const first = change('shared')
    const second = change('shared')
    first.publishedAt = '2025-01-01T00:00:00.000Z'
    second.publishedAt = '2025-01-02T00:00:00.000Z'
    const missingCatalog = catalogPackage(
      filepath,
      {
        type: 'bun',
        name: 'default',
        filepath,
        deps: [],
        raw: {},
        indent: '  ',
      },
      'catalog',
    )

    expect(
      createLegacyPlan(root, [
        { packageIndex: 0, pkg: manifest(outsidePath, 'outside'), changes: [change('outside')] },
      ]).selectionEvidence,
    ).toEqual({ status: 'unavailable', reason: 'UNSUPPORTED_WRITE_SOURCE' })
    expect(
      createLegacyPlan(root, [
        { packageIndex: 0, pkg: missingCatalog, changes: [change('missing')] },
      ]).selectionEvidence,
    ).toEqual({ status: 'unavailable', reason: 'UNBOUND_OPERATION' })
    expect(
      createLegacyPlan(root, [
        { packageIndex: 0, pkg, changes: [first] },
        { packageIndex: 1, pkg, changes: [second] },
      ]).selectionEvidence,
    ).toEqual({ status: 'unavailable', reason: 'INCONSISTENT_SELECTION_EVIDENCE' })

    const sourceDisagreementCatalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [
        {
          name: 'shared',
          currentVersion: '1.0.0',
          rawVersion: '1.0.0',
          source: 'catalog',
          update: true,
          parents: [],
        },
      ],
      raw: {},
      indent: '  ',
    }
    const catalogPkg = catalogPackage(filepath, sourceDisagreementCatalog, 'catalog')
    first.publishedAt = undefined
    second.publishedAt = undefined
    first.source = 'catalog'
    second.source = 'dependencies'
    expect(
      createLegacyPlan(root, [
        { packageIndex: 0, pkg: catalogPkg, changes: [first] },
        { packageIndex: 1, pkg: catalogPkg, changes: [second] },
      ]).selectionEvidence,
    ).toEqual({ status: 'unavailable', reason: 'INCONSISTENT_SELECTION_EVIDENCE' })
  })

  it('uses the physical catalog owner when a consumer source is outside the root', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot()
    const catalogPath = join(root, 'package.json')
    const consumerPath = join(outside, 'package.json')
    writeFileSync(catalogPath, '{"workspaces":{"catalog":{"shared":"1.0.0"}}}\n')
    writeFileSync(consumerPath, '{"name":"outside-consumer"}\n')
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath: catalogPath,
      deps: [
        {
          name: 'shared',
          currentVersion: '1.0.0',
          rawVersion: '1.0.0',
          source: 'catalog',
          update: true,
          parents: [],
        },
      ],
      raw: {},
      indent: '  ',
    }
    const selection = {
      packageIndex: 0,
      pkg: catalogPackage(consumerPath, catalog, '\u001B[31m'),
      changes: [change('shared')],
    }

    const construction = createLegacyPlan(root, [selection])
    expect(construction.blocked).toBe(false)
    expect(construction.plan.operations).toHaveLength(1)
    expect(construction.selectionEvidence).toMatchObject({
      status: 'ready',
      evidence: {
        operations: [
          {
            owner: { role: 'catalog', path: 'package.json', label: 'default' },
            catalog: { role: 'owner', manager: 'bun', sourcePath: 'package.json' },
          },
        ],
      },
    })

    const result = await applyLegacyCommandWrite(root, [selection], authority)
    expect(result.status).toBe('executed')
    expect(JSON.parse(readFileSync(catalogPath, 'utf8')).workspaces.catalog.shared).toBe('2.0.0')
  })

  it('uses the physical catalog owner for a lexical symlink consumer', () => {
    const root = temporaryRoot()
    const catalogPath = join(root, 'package.json')
    const consumerTarget = join(root, 'consumer.json')
    const consumerLink = join(root, 'consumer-link.json')
    writeFileSync(catalogPath, '{"workspaces":{"catalog":{"shared":"1.0.0"}}}\n')
    writeFileSync(consumerTarget, '{"name":"consumer"}\n')
    symlinkSync(consumerTarget, consumerLink)
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath: catalogPath,
      deps: [
        {
          name: 'shared',
          currentVersion: '1.0.0',
          rawVersion: '1.0.0',
          source: 'catalog',
          update: true,
          parents: [],
        },
      ],
      raw: {},
      indent: '  ',
    }

    const construction = createLegacyPlan(root, [
      {
        packageIndex: 0,
        pkg: catalogPackage(consumerLink, catalog, ''),
        changes: [change('shared')],
      },
    ])

    expect(construction.blocked).toBe(false)
    expect(construction.plan.operations).toHaveLength(1)
    expect(construction.selectionEvidence).toMatchObject({
      status: 'ready',
      evidence: {
        operations: [
          {
            owner: { role: 'catalog', path: 'package.json', label: 'default' },
            catalog: { role: 'owner', manager: 'bun', sourcePath: 'package.json' },
          },
        ],
      },
    })
  })

  it('calls the frozen evidence observer before blocked apply and aborts mutation on throw', async () => {
    const root = temporaryRoot()
    const filepath = join(root, 'package.json')
    const initial = '{"dependencies":{"shared":"1.0.0"}}\n'
    writeFileSync(filepath, initial)
    const observed: unknown[] = []

    await expect(
      applyLegacyCommandWrite(
        root,
        [{ packageIndex: 0, pkg: manifest(filepath, 'root'), changes: [change('shared')] }],
        authority,
        (evidence) => {
          observed.push(evidence)
          expect(Object.isFrozen(evidence)).toBe(true)
          throw new Error('observer stopped apply')
        },
      ),
    ).rejects.toThrow('observer stopped apply')

    expect(observed).toHaveLength(1)
    expect(readFileSync(filepath, 'utf8')).toBe(initial)
  })

  it('notifies the observer before returning a blocked command result', async () => {
    const root = temporaryRoot()
    const filepath = join(root, 'package.json')
    const initial = '{"dependencies":{"shared":"1.0.0"}}\n'
    writeFileSync(filepath, initial)
    const pkg = manifest(filepath, 'root')
    const observed: unknown[] = []

    const result = await applyLegacyCommandWrite(
      root,
      [
        { packageIndex: 0, pkg, changes: [change('shared', '1.0.0', '2.0.0')] },
        { packageIndex: 1, pkg, changes: [change('shared', '1.0.0', '3.0.0')] },
      ],
      authority,
      (evidence) => observed.push(evidence),
    )

    expect(observed).toEqual([{ status: 'unavailable', reason: 'INCONSISTENT_SELECTION_EVIDENCE' }])
    expect(result.status).toBe('blocked')
    expect(readFileSync(filepath, 'utf8')).toBe(initial)
  })
})
