import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CatalogSource, UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { yarnCatalogLoader } from './yarn'

const baseOptions: UpgrOptions = {
  ...(DEFAULT_OPTIONS as UpgrOptions),
  cwd: '/tmp',
  loglevel: 'silent',
}

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `upgr-yarn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('yarnCatalogLoader.detect', () => {
  it('returns true when .yarnrc.yml exists', async () => {
    writeFileSync(
      join(testDir, '.yarnrc.yml'),
      'nodeLinker: node-modules\ncatalog:\n  react: ^18.0.0\n',
      'utf-8',
    )

    expect(await yarnCatalogLoader.detect(testDir)).toBe(true)
  })

  it('returns false when no .yarnrc.yml exists', async () => {
    expect(await yarnCatalogLoader.detect(testDir)).toBe(false)
  })
})

describe('yarnCatalogLoader.load', () => {
  it('loads catalog from .yarnrc.yml', async () => {
    writeFileSync(
      join(testDir, '.yarnrc.yml'),
      'nodeLinker: node-modules\ncatalog:\n  react: ^18.0.0\n  typescript: ^5.0.0\n',
      'utf-8',
    )

    const sources = await yarnCatalogLoader.load(testDir, baseOptions)

    expect(sources).toHaveLength(1)
    expect(sources[0]!.type).toBe('yarn')
    expect(sources[0]!.name).toBe('default')
    expect(sources[0]!.deps).toHaveLength(2)
    expect(sources[0]!.deps[0]!.name).toBe('react')
    expect(sources[0]!.deps[0]!.currentVersion).toBe('^18.0.0')
    expect(sources[0]!.deps[0]!.source).toBe('catalog')
    expect(sources[0]!.deps[0]!.parents).toEqual(['catalog'])
  })

  it('returns empty when no catalog section', async () => {
    writeFileSync(join(testDir, '.yarnrc.yml'), 'nodeLinker: node-modules\n', 'utf-8')

    const sources = await yarnCatalogLoader.load(testDir, baseOptions)
    expect(sources).toHaveLength(0)
  })

  it('returns empty when no .yarnrc.yml exists', async () => {
    const sources = await yarnCatalogLoader.load(testDir, baseOptions)
    expect(sources).toHaveLength(0)
  })

  it('marks locked versions as update=false', async () => {
    writeFileSync(
      join(testDir, '.yarnrc.yml'),
      'nodeLinker: node-modules\ncatalog:\n  react: 18.2.0\n  typescript: ^5.0.0\n',
      'utf-8',
    )

    const sources = await yarnCatalogLoader.load(testDir, baseOptions)

    const reactDep = sources[0]!.deps.find((d) => d.name === 'react')!
    const tsDep = sources[0]!.deps.find((d) => d.name === 'typescript')!
    expect(reactDep.update).toBe(false)
    expect(tsDep.update).toBe(true)
  })
})

describe('yarnCatalogLoader.write', () => {
  it('writes updates to catalog', () => {
    const filepath = join(testDir, '.yarnrc.yml')
    writeFileSync(
      filepath,
      'nodeLinker: node-modules\ncatalog:\n  react: ^18.0.0\n  typescript: ^5.0.0\n',
      'utf-8',
    )

    // Load first to get the YAML Document as raw
    const YAML = require('yaml')
    const doc = YAML.parseDocument(readFileSync(filepath, 'utf-8'))

    const catalog: CatalogSource = {
      type: 'yarn',
      name: 'default',
      filepath,
      deps: [],
      raw: doc,
      indent: '  ',
    }

    yarnCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const content = readFileSync(filepath, 'utf-8')
    expect(content).toContain('react: ^19.0.0')
    expect(content).toContain('typescript: ^5.0.0')
  })

  it('preserves other yaml content when writing', () => {
    const filepath = join(testDir, '.yarnrc.yml')
    writeFileSync(
      filepath,
      'nodeLinker: node-modules\ncatalog:\n  react: ^18.0.0\nyarnPath: .yarn/releases/yarn-4.0.0.cjs\n',
      'utf-8',
    )

    const YAML = require('yaml')
    const doc = YAML.parseDocument(readFileSync(filepath, 'utf-8'))

    const catalog: CatalogSource = {
      type: 'yarn',
      name: 'default',
      filepath,
      deps: [],
      raw: doc,
      indent: '  ',
    }

    yarnCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const content = readFileSync(filepath, 'utf-8')
    expect(content).toContain('react: ^19.0.0')
    expect(content).toContain('nodeLinker: node-modules')
    expect(content).toContain('yarnPath: .yarn/releases/yarn-4.0.0.cjs')
  })
})
