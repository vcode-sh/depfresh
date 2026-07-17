import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashExactBytes } from './contracts/fingerprint'
import { compilePolicy } from './policy/compiler'
import { evaluateRepositoryPolicy } from './policy/repository'
import { inspectRepositoryWithProjection } from './repository/inspect'
import { bindInvocationSelection, createSelectionReceipt } from './selection'
import { DEFAULT_OPTIONS, type depfreshOptions, type RepositoryModel } from './types'

function fixtureModel(): { root: string; model: RepositoryModel } {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-selection-'))
  const packageBytes = '{"name":"root"}'
  const catalogBytes = 'catalog:\n  alpha: 1.0.0\n'
  writeFileSync(join(root, 'package.json'), packageBytes)
  writeFileSync(join(root, 'pnpm-workspace.yaml'), catalogBytes)
  return {
    root,
    model: {
      schemaVersion: 1,
      rootId: 'root',
      sourceFiles: [
        {
          id: 'source-package',
          path: 'package.json',
          format: 'json',
          byteHash: hashExactBytes(packageBytes),
          parseState: 'parsed',
          indent: '  ',
          newline: 'none',
          trailingNewline: false,
        },
        {
          id: 'source-catalog',
          path: 'pnpm-workspace.yaml',
          format: 'yaml',
          byteHash: hashExactBytes(catalogBytes),
          parseState: 'parsed',
          indent: '  ',
          newline: 'lf',
          trailingNewline: true,
        },
      ],
      packages: [
        {
          id: 'package-root',
          sourceFileId: 'source-package',
          path: 'package.json',
          workspacePath: '.',
          name: 'root',
          private: true,
        },
      ],
      catalogs: [
        {
          id: 'catalog-a',
          sourceFileId: 'source-catalog',
          manager: 'pnpm',
          format: 'yaml',
          name: 'default',
          entries: [{ name: 'alpha', occurrenceId: 'owner-a' }],
        },
        {
          id: 'catalog-b',
          sourceFileId: 'source-catalog',
          manager: 'pnpm',
          format: 'yaml',
          name: 'default',
          entries: [{ name: 'beta', occurrenceId: 'owner-b' }],
        },
      ],
      occurrences: [
        {
          id: 'direct',
          ownerId: 'package-root',
          sourceFileId: 'source-package',
          name: 'default',
          path: ['dependencies', 'default'],
          field: 'dependencies',
          role: 'dependency',
          protocol: 'semver',
          declaredText: '1.0.0',
          writeable: true,
        },
        {
          id: 'consumer-a',
          ownerId: 'package-root',
          sourceFileId: 'source-package',
          name: 'alpha',
          path: ['dependencies', 'alpha'],
          field: 'dependencies',
          role: 'catalog-consumer',
          protocol: 'catalog',
          declaredText: 'catalog:',
          catalogId: 'catalog-a',
          writeable: false,
        },
        {
          id: 'owner-a',
          ownerId: 'catalog-a',
          sourceFileId: 'source-catalog',
          name: 'alpha',
          path: ['catalog', 'alpha'],
          field: 'catalog',
          role: 'catalog-owner',
          protocol: 'semver',
          declaredText: '1.0.0',
          catalogId: 'catalog-a',
          writeable: true,
        },
        {
          id: 'owner-b',
          ownerId: 'catalog-b',
          sourceFileId: 'source-catalog',
          name: 'beta',
          path: ['catalog', 'beta'],
          field: 'catalog',
          role: 'catalog-owner',
          protocol: 'semver',
          declaredText: '1.0.0',
          catalogId: 'catalog-b',
          writeable: true,
        },
      ],
      relationships: {
        workspaceMembers: [],
        catalogConsumers: [{ catalogId: 'catalog-a', occurrenceId: 'consumer-a' }],
      },
      diagnostics: [],
      evidenceRefs: [],
    },
  }
}

describe('bindInvocationSelection', () => {
  it('excludes a root workspace direct and consumer occurrences but never catalog owners', () => {
    const { root, model } = fixtureModel()
    const bound = bindInvocationSelection(root, model, { workspaces: ['.'], catalogs: [] })
    const policy = bound.appendToPolicy(compilePolicy([{ source: 'defaults', mode: 'minor' }]))
    const decisions = evaluateRepositoryPolicy(model, policy)

    expect(decisions.find((decision) => decision.occurrenceId === 'direct')?.status).toBe('skipped')
    expect(decisions.find((decision) => decision.occurrenceId === 'consumer-a')?.status).toBe(
      'skipped',
    )
    expect(decisions.find((decision) => decision.occurrenceId === 'owner-a')?.status).toBe(
      'selected',
    )
    expect(decisions.every((decision) => decision.mode === 'minor')).toBe(true)
  })

  it('binds every physical same-name catalog without excluding a direct same-name dependency', () => {
    const { root, model } = fixtureModel()
    const bound = bindInvocationSelection(root, model, { workspaces: [], catalogs: ['default'] })
    const decisions = evaluateRepositoryPolicy(
      model,
      bound.appendToPolicy(compilePolicy([{ source: 'defaults', mode: 'default' }])),
    )

    expect(bound.requests[0]?.entityIds).toEqual(['catalog-a', 'catalog-b'])
    expect(decisions.find((decision) => decision.occurrenceId === 'owner-a')?.status).toBe(
      'skipped',
    )
    expect(decisions.find((decision) => decision.occurrenceId === 'owner-b')?.status).toBe(
      'skipped',
    )
    expect(decisions.find((decision) => decision.occurrenceId === 'consumer-a')?.status).toBe(
      'skipped',
    )
    expect(decisions.find((decision) => decision.occurrenceId === 'direct')?.status).toBe(
      'selected',
    )
  })

  it('fails closed when a requested target is not modeled', () => {
    const { root, model } = fixtureModel()

    expect(() =>
      bindInvocationSelection(root, model, { workspaces: ['missing'], catalogs: [] }),
    ).toThrowError(expect.objectContaining({ reason: 'SELECTION_TARGET_UNPROVEN' }))
    expect(() =>
      bindInvocationSelection(root, model, { workspaces: [], catalogs: ['missing'] }),
    ).toThrowError(expect.objectContaining({ reason: 'SELECTION_TARGET_UNPROVEN' }))
  })

  it('fails closed when source bytes change during binding', () => {
    const { root, model } = fixtureModel()
    writeFileSync(join(root, 'package.json'), '{"name":"changed"}')

    expect(() =>
      bindInvocationSelection(root, model, { workspaces: ['.'], catalogs: [] }),
    ).toThrowError(expect.objectContaining({ reason: 'SELECTION_TARGET_UNPROVEN' }))
  })

  it('does not treat an unresolved same-name consumer as a physical catalog', () => {
    const { root, model } = fixtureModel()
    model.catalogs = []
    model.relationships.catalogConsumers = []
    model.occurrences = model.occurrences.map((occurrence) => {
      const { catalogId: _catalogId, ...unlinked } = occurrence
      return unlinked
    })

    expect(() =>
      bindInvocationSelection(root, model, { workspaces: [], catalogs: ['default'] }),
    ).toThrowError(expect.objectContaining({ reason: 'SELECTION_TARGET_UNPROVEN' }))
  })

  it('keeps configured traces and mode while overlapping exclusions count occurrences once', () => {
    const { root, model } = fixtureModel()
    const bound = bindInvocationSelection(root, model, {
      workspaces: ['.'],
      catalogs: ['default'],
    })
    const policy = bound.appendToPolicy(
      compilePolicy([
        { source: 'defaults', mode: 'minor' },
        {
          source: 'config',
          policyRules: [
            {
              id: 'configured-include',
              selectors: { workspacePath: '^\\.$' },
              action: 'include',
              mode: 'patch',
            },
          ],
        },
      ]),
    )
    const decisions = evaluateRepositoryPolicy(model, policy)
    const receipt = createSelectionReceipt(bound, model, decisions)
    const direct = decisions.find((decision) => decision.occurrenceId === 'direct')
    const consumer = decisions.find((decision) => decision.occurrenceId === 'consumer-a')

    expect(direct).toMatchObject({ action: 'exclude', mode: 'patch' })
    expect(direct?.matchedRuleIds).toContain('configured-include')
    expect(consumer?.matchedRuleIds.filter((id) => id.startsWith('$cli:exclude-'))).toHaveLength(2)
    expect(receipt.summary).toMatchObject({
      requestedWorkspaces: 1,
      requestedCatalogs: 1,
      matchedCatalogOwners: 2,
      excludedOccurrences: 4,
      eligibleSharedCatalogOwners: 0,
    })
  })
})

function repositoryOptions(root: string): depfreshOptions {
  return { ...(DEFAULT_OPTIONS as depfreshOptions), cwd: root }
}

function writeManagerFixture(manager: 'pnpm' | 'bun' | 'yarn'): {
  root: string
  catalogName: string
} {
  const root = mkdtempSync(join(tmpdir(), `depfresh-selection-${manager}-`))
  mkdirSync(join(root, 'apps', 'admin'), { recursive: true })
  const catalogName = manager === 'yarn' ? 'default' : 'payments'
  const rootManifest: Record<string, unknown> = {
    name: 'root',
    private: true,
    dependencies: { shared: '^1.0.0' },
  }
  if (manager === 'bun') {
    rootManifest.workspaces = {
      packages: ['apps/*'],
      catalogs: { payments: { shared: '^1.0.0' } },
    }
  } else {
    rootManifest.workspaces = ['apps/*']
  }
  if (manager === 'yarn') rootManifest.packageManager = 'yarn@4.0.0'
  writeFileSync(join(root, 'package.json'), JSON.stringify(rootManifest))
  writeFileSync(
    join(root, 'apps', 'admin', 'package.json'),
    JSON.stringify({
      name: 'admin',
      private: true,
      dependencies: { shared: manager === 'yarn' ? 'catalog:' : 'catalog:payments' },
    }),
  )
  if (manager === 'pnpm') {
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'apps/*'\ncatalogs:\n  payments:\n    shared: ^1.0.0\n",
    )
  }
  if (manager === 'yarn') {
    writeFileSync(join(root, '.yarnrc.yml'), 'catalog:\n  shared: ^1.0.0\n')
  }
  return { root, catalogName }
}

describe.each(['pnpm', 'bun', 'yarn'] as const)('%s repository-backed selection', (manager) => {
  it('proves workspace-only, catalog-only, and combined physical ownership', async () => {
    const { root, catalogName } = writeManagerFixture(manager)
    const workspace = await inspectRepositoryWithProjection(repositoryOptions(root), undefined, {
      workspaces: ['apps/admin'],
      catalogs: [],
    })
    const workspaceOwner = workspace.decisions.find((decision) => {
      const occurrence = workspace.model.occurrences.find(
        (candidate) => candidate.id === decision.occurrenceId,
      )
      return occurrence?.role === 'catalog-owner'
    })
    const rootPackageId = workspace.model.packages.find((pkg) => pkg.workspacePath === '.')?.id
    const rootDirect = workspace.decisions.find((decision) => {
      const occurrence = workspace.model.occurrences.find(
        (candidate) => candidate.id === decision.occurrenceId,
      )
      return occurrence?.role === 'dependency' && occurrence.ownerId === rootPackageId
    })
    expect(workspace.selection?.summary).toMatchObject({
      matchedWorkspaces: 1,
      excludedOccurrences: 1,
      eligibleSharedCatalogOwners: 1,
    })
    expect(workspaceOwner?.status).toBe('selected')
    expect(rootDirect?.status).toBe('selected')

    const catalog = await inspectRepositoryWithProjection(repositoryOptions(root), undefined, {
      workspaces: [],
      catalogs: [catalogName],
    })
    expect(catalog.selection?.summary).toMatchObject({
      matchedCatalogNames: 1,
      matchedCatalogOwners: 1,
      excludedOccurrences: 2,
    })

    const combined = await inspectRepositoryWithProjection(repositoryOptions(root), undefined, {
      workspaces: ['apps/admin'],
      catalogs: [catalogName],
    })
    expect(combined.selection?.summary).toMatchObject({
      requestedWorkspaces: 1,
      requestedCatalogs: 1,
      excludedOccurrences: 2,
      eligibleSharedCatalogOwners: 0,
    })
  })
})

describe('multi-owner and ignored repository evidence', () => {
  it('binds every same-name physical owner without claiming an ambiguous consumer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-selection-multi-owner-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'root',
        private: true,
        workspaces: {
          packages: [],
          catalogs: { payments: { bunOnly: '^1.0.0' } },
        },
        dependencies: { unresolved: 'catalog:payments' },
      }),
    )
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages: []\ncatalogs:\n  payments:\n    pnpmOnly: ^1.0.0\n',
    )

    const inspection = await inspectRepositoryWithProjection(repositoryOptions(root), undefined, {
      workspaces: [],
      catalogs: ['payments'],
    })
    const unresolved = inspection.model.occurrences.find(
      (occurrence) => occurrence.name === 'unresolved',
    )
    const unresolvedDecision = inspection.decisions.find(
      (decision) => decision.occurrenceId === unresolved?.id,
    )

    expect(inspection.selection?.summary).toMatchObject({
      matchedCatalogNames: 1,
      matchedCatalogOwners: 2,
      excludedOccurrences: 2,
    })
    expect(unresolved?.catalogId).toBeUndefined()
    expect(unresolvedDecision?.status).toBe('selected')
  })

  it('fails when a requested workspace was removed by discovery ignores', async () => {
    const { root } = writeManagerFixture('pnpm')
    const options = repositoryOptions(root)
    options.ignorePaths = [...(options.ignorePaths ?? []), 'apps/admin/**']

    await expect(
      inspectRepositoryWithProjection(options, undefined, {
        workspaces: ['apps/admin'],
        catalogs: [],
      }),
    ).rejects.toMatchObject({ reason: 'SELECTION_TARGET_UNPROVEN' })
  })
})
