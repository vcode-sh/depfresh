import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CatalogSource, depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { pnpmCatalogLoader } from './pnpm'

const baseOptions: depfreshOptions = {
  ...(DEFAULT_OPTIONS as depfreshOptions),
  cwd: '/tmp',
  loglevel: 'silent',
}

let testDir: string

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `depfresh-pnpm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('pnpmCatalogLoader.detect', () => {
  it('returns true when pnpm-workspace.yaml exists', async () => {
    writeFileSync(
      join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\ncatalog:\n  react: ^18.0.0\n',
      'utf-8',
    )

    expect(await pnpmCatalogLoader.detect(testDir)).toBe(true)
  })

  it('returns false when no pnpm-workspace.yaml exists', async () => {
    expect(await pnpmCatalogLoader.detect(testDir)).toBe(false)
  })
})

describe('pnpmCatalogLoader.load', () => {
  it('loads default catalog', async () => {
    writeFileSync(
      join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\ncatalog:\n  react: ^18.0.0\n  typescript: ^5.0.0\n',
      'utf-8',
    )

    const sources = await pnpmCatalogLoader.load(testDir, baseOptions)

    expect(sources).toHaveLength(1)
    expect(sources[0]!.type).toBe('pnpm')
    expect(sources[0]!.name).toBe('default')
    expect(sources[0]!.deps).toHaveLength(2)
    expect(sources[0]!.deps[0]!.name).toBe('react')
    expect(sources[0]!.deps[0]!.currentVersion).toBe('^18.0.0')
    expect(sources[0]!.deps[0]!.source).toBe('catalog')
    expect(sources[0]!.deps[0]!.parents).toEqual(['catalog'])
  })

  it('loads named catalogs', async () => {
    writeFileSync(
      join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\ncatalogs:\n  ui:\n    react: ^18.0.0\n  tooling:\n    vitest: ^1.0.0\n',
      'utf-8',
    )

    const sources = await pnpmCatalogLoader.load(testDir, baseOptions)

    expect(sources).toHaveLength(2)

    const ui = sources.find((s) => s.name === 'ui')!
    expect(ui.deps).toHaveLength(1)
    expect(ui.deps[0]!.name).toBe('react')
    expect(ui.deps[0]!.parents).toEqual(['catalogs.ui'])

    const tooling = sources.find((s) => s.name === 'tooling')!
    expect(tooling.deps).toHaveLength(1)
    expect(tooling.deps[0]!.name).toBe('vitest')
  })

  it('loads both default and named catalogs', async () => {
    writeFileSync(
      join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\ncatalog:\n  lodash: ^4.17.0\ncatalogs:\n  ui:\n    react: ^18.0.0\n',
      'utf-8',
    )

    const sources = await pnpmCatalogLoader.load(testDir, baseOptions)

    expect(sources).toHaveLength(2)
    expect(sources[0]!.name).toBe('default')
    expect(sources[0]!.deps[0]!.name).toBe('lodash')
    expect(sources[1]!.name).toBe('ui')
    expect(sources[1]!.deps[0]!.name).toBe('react')
  })

  it('skips peers catalog by default when --peer is disabled', async () => {
    writeFileSync(
      join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\ncatalogs:\n  peers:\n    react: ^18.0.0\n  tooling:\n    vitest: ^1.0.0\n',
      'utf-8',
    )

    const sources = await pnpmCatalogLoader.load(testDir, { ...baseOptions, peer: false })

    expect(sources).toHaveLength(1)
    expect(sources[0]!.name).toBe('tooling')
    expect(sources[0]!.deps.map((d) => d.name)).toEqual(['vitest'])
  })

  it('includes peers catalog when --peer is enabled', async () => {
    writeFileSync(
      join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\ncatalogs:\n  peers:\n    react: ^18.0.0\n  tooling:\n    vitest: ^1.0.0\n',
      'utf-8',
    )

    const sources = await pnpmCatalogLoader.load(testDir, { ...baseOptions, peer: true })

    expect(sources).toHaveLength(2)
    expect(sources.some((s) => s.name === 'peers')).toBe(true)
    expect(sources.some((s) => s.name === 'tooling')).toBe(true)
  })

  it('returns empty when no pnpm-workspace.yaml exists', async () => {
    const sources = await pnpmCatalogLoader.load(testDir, baseOptions)
    expect(sources).toHaveLength(0)
  })

  it('marks locked versions as update=false', async () => {
    writeFileSync(
      join(testDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\ncatalog:\n  react: 18.2.0\n  typescript: ^5.0.0\n',
      'utf-8',
    )

    const sources = await pnpmCatalogLoader.load(testDir, baseOptions)

    const reactDep = sources[0]!.deps.find((d) => d.name === 'react')!
    const tsDep = sources[0]!.deps.find((d) => d.name === 'typescript')!
    expect(reactDep.update).toBe(false)
    expect(tsDep.update).toBe(true)
  })
})

describe('pnpmCatalogLoader.write', () => {
  it('writes updates to default catalog', () => {
    const filepath = join(testDir, 'pnpm-workspace.yaml')
    writeFileSync(
      filepath,
      'packages:\n  - "packages/*"\ncatalog:\n  react: ^18.0.0\n  typescript: ^5.0.0\n',
      'utf-8',
    )

    const catalog: CatalogSource = {
      type: 'pnpm',
      name: 'default',
      filepath,
      deps: [],
      raw: readFileSync(filepath, 'utf-8'),
      indent: '  ',
    }

    pnpmCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const content = readFileSync(filepath, 'utf-8')
    expect(content).toContain('react: ^19.0.0')
    expect(content).toContain('typescript: ^5.0.0')
  })

  it('writes updates to named catalog', () => {
    const filepath = join(testDir, 'pnpm-workspace.yaml')
    writeFileSync(
      filepath,
      'packages:\n  - "packages/*"\ncatalogs:\n  ui:\n    react: ^18.0.0\n  tooling:\n    vitest: ^1.0.0\n',
      'utf-8',
    )

    const catalog: CatalogSource = {
      type: 'pnpm',
      name: 'ui',
      filepath,
      deps: [],
      raw: readFileSync(filepath, 'utf-8'),
      indent: '  ',
    }

    pnpmCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const content = readFileSync(filepath, 'utf-8')
    expect(content).toContain('react: ^19.0.0')
    expect(content).toContain('vitest: ^1.0.0')
  })
})
