import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadCatalogs } from './index'

const baseOptions: depfreshOptions = {
  ...(DEFAULT_OPTIONS as depfreshOptions),
  cwd: '/tmp',
  loglevel: 'silent',
}

describe('loadCatalogs', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-catalog-index-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads catalogs without triggering catalog/write import cycles', async () => {
    writeFileSync(
      join(tmpDir, 'pnpm-workspace.yaml'),
      ['packages:', "  - 'packages/*'", 'catalog:', '  react: ^19.0.0', ''].join('\n'),
      'utf-8',
    )

    const catalogs = await loadCatalogs(tmpDir, {
      ...baseOptions,
      cwd: tmpDir,
    })

    expect(catalogs).toHaveLength(1)
    expect(catalogs[0]?.type).toBe('pnpm')
    expect(catalogs[0]?.deps[0]?.name).toBe('react')
  })

  it('loads bun catalogs directly from nested subdirectories', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'root',
          workspaces: {
            catalog: {
              react: '^19.0.0',
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf-8',
    )
    mkdirSync(join(tmpDir, 'apps', 'web', 'src'), { recursive: true })

    const catalogs = await loadCatalogs(join(tmpDir, 'apps', 'web', 'src'), {
      ...baseOptions,
      cwd: join(tmpDir, 'apps', 'web', 'src'),
    })

    expect(catalogs).toHaveLength(1)
    expect(catalogs[0]?.type).toBe('bun')
    expect(catalogs[0]?.filepath).toBe(join(tmpDir, 'package.json'))
  })

  it('does not load catalogs from above the effective root', async () => {
    const parentDir = join(tmpDir, 'parent')
    const rootDir = join(parentDir, 'project')
    mkdirSync(rootDir, { recursive: true })

    writeFileSync(
      join(parentDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'parent',
          workspaces: {
            catalog: {
              react: '^19.0.0',
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf-8',
    )
    writeFileSync(
      join(parentDir, 'pnpm-workspace.yaml'),
      ['packages:', "  - 'packages/*'", 'catalog:', '  react: ^19.0.0', ''].join('\n'),
      'utf-8',
    )
    writeFileSync(
      join(parentDir, '.yarnrc.yml'),
      'nodeLinker: node-modules\ncatalog:\n  react: ^19.0.0\n',
      'utf-8',
    )
    writeFileSync(
      join(rootDir, 'package.json'),
      `${JSON.stringify({ name: 'project' }, null, 2)}\n`,
      'utf-8',
    )

    const catalogs = await loadCatalogs(rootDir, {
      ...baseOptions,
      cwd: rootDir,
      discoveryReport: {
        inputCwd: rootDir,
        effectiveRoot: rootDir,
        discoveryMode: 'direct-root',
        matchedManifests: [],
        loadedPackages: [],
        skippedManifests: [],
        loadedCatalogs: [],
      },
    })

    expect(catalogs).toEqual([])
  })
})
