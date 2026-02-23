import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CatalogSource, PackageMeta, RawDep, ResolvedDepChange } from '../../types'
import { writePackage } from './index'

function makeChange(overrides: Partial<ResolvedDepChange>): ResolvedDepChange {
  const name = overrides.name ?? 'test-pkg'
  const currentVersion = overrides.currentVersion ?? '^1.0.0'
  const targetVersion = overrides.targetVersion ?? '^2.0.0'

  return {
    name,
    currentVersion,
    source: overrides.source ?? 'dependencies',
    update: true,
    parents: [],
    targetVersion,
    diff: 'minor',
    pkgData: {
      name,
      versions: [currentVersion, targetVersion],
      distTags: { latest: targetVersion },
    },
    ...overrides,
  }
}

function makePackageMeta(filepath: string, raw: Record<string, unknown>): PackageMeta {
  return {
    name: (raw.name as string) ?? 'root',
    type: 'package.json',
    filepath,
    deps: [],
    resolved: [],
    raw,
    indent: '  ',
  }
}

function makeBunCatalogMeta(
  filepath: string,
  raw: Record<string, unknown>,
  deps: RawDep[],
  catalogName = 'default',
): PackageMeta {
  const catalog: CatalogSource = {
    type: 'bun',
    name: catalogName,
    filepath,
    deps,
    raw,
    indent: '  ',
  }

  return {
    name: 'bun catalog',
    type: 'bun-workspace',
    filepath,
    deps,
    resolved: [],
    raw,
    indent: '  ',
    catalogs: [catalog],
  }
}

function createFixture(filepath: string): Record<string, unknown> {
  const raw = {
    name: 'bun-workspace',
    dependencies: {
      react: '^18.2.0',
      eslint: '^9.0.0',
    },
    devDependencies: {
      vitest: '^1.0.0',
    },
    workspaces: {
      catalog: {
        typescript: '^5.0.0',
        prettier: '^3.0.0',
      },
    },
  }

  writeFileSync(filepath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8')
  return raw
}

describe('writePackage bun catalog clobber regression', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-bun-clobber-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps bun catalog updates when package.json is written after catalog write', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = createFixture(filepath)
    const pkgMeta = makePackageMeta(filepath, raw)
    const catalogDeps: RawDep[] = [
      {
        name: 'typescript',
        currentVersion: '^5.0.0',
        source: 'catalog',
        update: true,
        parents: ['workspaces.catalog'],
      },
      {
        name: 'prettier',
        currentVersion: '^3.0.0',
        source: 'catalog',
        update: true,
        parents: ['workspaces.catalog'],
      },
    ]
    const bunCatalogMeta = makeBunCatalogMeta(filepath, raw, catalogDeps)

    const catalogChange = makeChange({
      name: 'typescript',
      source: 'catalog',
      currentVersion: '^5.0.0',
      targetVersion: '^5.9.3',
      diff: 'minor',
      parents: ['workspaces.catalog'],
    })
    const dependencyChange = makeChange({
      name: 'react',
      source: 'dependencies',
      currentVersion: '^18.2.0',
      targetVersion: '^19.2.4',
      diff: 'major',
    })

    // Regression flow from taze#238: catalog write first, then regular package write.
    writePackage(bunCatalogMeta, [catalogChange], 'silent')
    writePackage(pkgMeta, [dependencyChange], 'silent')

    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(parsed.dependencies.react).toBe('^19.2.4')
    expect(parsed.dependencies.eslint).toBe('^9.0.0')
    expect(parsed.workspaces.catalog.typescript).toBe('^5.9.3')
    expect(parsed.workspaces.catalog.prettier).toBe('^3.0.0')
    expect(parsed.devDependencies.vitest).toBe('^1.0.0')
  })

  it('keeps regular dependency updates when catalog write runs after package.json write', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = createFixture(filepath)
    const pkgMeta = makePackageMeta(filepath, raw)
    const catalogDeps: RawDep[] = [
      {
        name: 'typescript',
        currentVersion: '^5.0.0',
        source: 'catalog',
        update: true,
        parents: ['workspaces.catalog'],
      },
    ]
    const bunCatalogMeta = makeBunCatalogMeta(filepath, raw, catalogDeps)

    const catalogChange = makeChange({
      name: 'typescript',
      source: 'catalog',
      currentVersion: '^5.0.0',
      targetVersion: '^5.9.3',
      diff: 'minor',
      parents: ['workspaces.catalog'],
    })
    const dependencyChange = makeChange({
      name: 'react',
      source: 'dependencies',
      currentVersion: '^18.2.0',
      targetVersion: '^19.2.4',
      diff: 'major',
    })

    writePackage(pkgMeta, [dependencyChange], 'silent')
    writePackage(bunCatalogMeta, [catalogChange], 'silent')

    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(parsed.dependencies.react).toBe('^19.2.4')
    expect(parsed.workspaces.catalog.typescript).toBe('^5.9.3')
  })

  it('keeps named bun catalog updates when package.json is written after catalog write', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'bun-workspace',
      dependencies: {
        react: '^18.2.0',
      },
      workspaces: {
        catalog: {
          prettier: '^3.0.0',
        },
        catalogs: {
          react18: {
            react: '^18.2.0',
            'react-dom': '^18.2.0',
          },
        },
      },
    }
    writeFileSync(filepath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8')

    const pkgMeta = makePackageMeta(filepath, raw)
    const namedCatalogDeps: RawDep[] = [
      {
        name: 'react',
        currentVersion: '^18.2.0',
        source: 'catalog',
        update: true,
        parents: ['workspaces.catalogs.react18'],
      },
      {
        name: 'react-dom',
        currentVersion: '^18.2.0',
        source: 'catalog',
        update: true,
        parents: ['workspaces.catalogs.react18'],
      },
    ]
    const bunNamedCatalogMeta = makeBunCatalogMeta(filepath, raw, namedCatalogDeps, 'react18')

    const catalogChange = makeChange({
      name: 'react',
      source: 'catalog',
      currentVersion: '^18.2.0',
      targetVersion: '^19.2.4',
      diff: 'major',
      parents: ['workspaces.catalogs.react18'],
    })
    const dependencyChange = makeChange({
      name: 'react',
      source: 'dependencies',
      currentVersion: '^18.2.0',
      targetVersion: '^19.2.4',
      diff: 'major',
    })

    writePackage(bunNamedCatalogMeta, [catalogChange], 'silent')
    writePackage(pkgMeta, [dependencyChange], 'silent')

    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(parsed.dependencies.react).toBe('^19.2.4')
    expect(parsed.workspaces.catalogs.react18.react).toBe('^19.2.4')
    expect(parsed.workspaces.catalogs.react18['react-dom']).toBe('^18.2.0')
    expect(parsed.workspaces.catalog.prettier).toBe('^3.0.0')
  })
})
