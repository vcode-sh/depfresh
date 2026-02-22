import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { bunCatalogLoader } from './bun'

const baseOptions: UpgrOptions = {
  ...(DEFAULT_OPTIONS as UpgrOptions),
  cwd: '/tmp',
  loglevel: 'silent',
}

let testDir: string

function writePackageJson(dir: string, content: Record<string, unknown>): void {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
}

beforeEach(() => {
  testDir = join(tmpdir(), `upgr-bun-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('bunCatalogLoader.load', () => {
  it('loads default catalog (singular workspaces.catalog)', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalog: {
          react: '^18.0.0',
          typescript: '^5.0.0',
        },
      },
    })

    const sources = await bunCatalogLoader.load(testDir, baseOptions)

    expect(sources).toHaveLength(1)
    expect(sources[0]!.type).toBe('bun')
    expect(sources[0]!.name).toBe('default')
    expect(sources[0]!.deps).toHaveLength(2)
    expect(sources[0]!.deps[0]!.name).toBe('react')
    expect(sources[0]!.deps[0]!.currentVersion).toBe('^18.0.0')
    expect(sources[0]!.deps[0]!.source).toBe('catalog')
    expect(sources[0]!.deps[0]!.parents).toEqual(['workspaces.catalog'])
    expect(sources[0]!.deps[1]!.name).toBe('typescript')
  })

  it('loads named catalogs (plural workspaces.catalogs)', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalogs: {
          ui: {
            react: '^18.0.0',
            'react-dom': '^18.0.0',
          },
          tooling: {
            vitest: '^1.0.0',
          },
        },
      },
    })

    const sources = await bunCatalogLoader.load(testDir, baseOptions)

    expect(sources).toHaveLength(2)

    const ui = sources.find((s) => s.name === 'ui')!
    expect(ui.type).toBe('bun')
    expect(ui.deps).toHaveLength(2)
    expect(ui.deps[0]!.name).toBe('react')
    expect(ui.deps[0]!.parents).toEqual(['workspaces.catalogs.ui'])

    const tooling = sources.find((s) => s.name === 'tooling')!
    expect(tooling.deps).toHaveLength(1)
    expect(tooling.deps[0]!.name).toBe('vitest')
    expect(tooling.deps[0]!.parents).toEqual(['workspaces.catalogs.tooling'])
  })

  it('loads both singular and plural catalogs', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalog: {
          lodash: '^4.17.0',
        },
        catalogs: {
          ui: {
            react: '^18.0.0',
          },
        },
      },
    })

    const sources = await bunCatalogLoader.load(testDir, baseOptions)

    expect(sources).toHaveLength(2)
    expect(sources[0]!.name).toBe('default')
    expect(sources[0]!.deps[0]!.name).toBe('lodash')
    expect(sources[1]!.name).toBe('ui')
    expect(sources[1]!.deps[0]!.name).toBe('react')
  })

  it('returns empty when no catalogs present', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: ['packages/*'],
    })

    const sources = await bunCatalogLoader.load(testDir, baseOptions)
    expect(sources).toHaveLength(0)
  })

  it('marks locked versions as update=false', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalog: {
          react: '18.2.0',
          typescript: '^5.0.0',
        },
      },
    })

    const sources = await bunCatalogLoader.load(testDir, baseOptions)

    const reactDep = sources[0]!.deps.find((d) => d.name === 'react')!
    const tsDep = sources[0]!.deps.find((d) => d.name === 'typescript')!
    expect(reactDep.update).toBe(false)
    expect(tsDep.update).toBe(true)
  })

  it('respects includeLocked option', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalog: {
          react: '18.2.0',
        },
      },
    })

    const sources = await bunCatalogLoader.load(testDir, { ...baseOptions, includeLocked: true })

    expect(sources[0]!.deps[0]!.update).toBe(true)
  })

  it('preserves indent style', async () => {
    const content = JSON.stringify(
      { name: 'test', workspaces: { catalog: { react: '^18.0.0' } } },
      null,
      4,
    )
    writeFileSync(join(testDir, 'package.json'), `${content}\n`, 'utf-8')

    const sources = await bunCatalogLoader.load(testDir, baseOptions)

    expect(sources[0]!.indent).toBe('    ')
  })
})
