import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BumpOptions, CatalogSource } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { bunCatalogLoader } from './bun'

const baseOptions: BumpOptions = {
  ...(DEFAULT_OPTIONS as BumpOptions),
  cwd: '/tmp',
  loglevel: 'silent',
}

let testDir: string

function writePackageJson(dir: string, content: Record<string, unknown>): void {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
}

beforeEach(() => {
  testDir = join(tmpdir(), `bump-bun-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('bunCatalogLoader.detect', () => {
  it('returns true when workspaces.catalog exists', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalog: { react: '^18.0.0' },
      },
    })

    expect(await bunCatalogLoader.detect(testDir)).toBe(true)
  })

  it('returns true when workspaces.catalogs (plural) exists', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalogs: {
          ui: { react: '^18.0.0' },
        },
      },
    })

    expect(await bunCatalogLoader.detect(testDir)).toBe(true)
  })

  it('returns true when both catalog and catalogs exist', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalog: { lodash: '^4.0.0' },
        catalogs: {
          ui: { react: '^18.0.0' },
        },
      },
    })

    expect(await bunCatalogLoader.detect(testDir)).toBe(true)
  })

  it('returns false when no catalog present', async () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: ['packages/*'],
    })

    expect(await bunCatalogLoader.detect(testDir)).toBe(false)
  })

  it('returns false when no package.json exists', async () => {
    expect(await bunCatalogLoader.detect(`${testDir}/nonexistent`)).toBe(false)
  })

  it('returns false for malformed JSON', async () => {
    writeFileSync(join(testDir, 'package.json'), 'not json', 'utf-8')

    expect(await bunCatalogLoader.detect(testDir)).toBe(false)
  })
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

describe('bunCatalogLoader.write', () => {
  it('writes updates to default catalog', () => {
    writePackageJson(testDir, {
      name: 'my-monorepo',
      workspaces: {
        catalog: {
          react: '^18.0.0',
          typescript: '^5.0.0',
        },
      },
    })

    const filepath = join(testDir, 'package.json')
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [],
      raw: JSON.parse(readFileSync(filepath, 'utf-8')),
      indent: '  ',
    }

    const changes = new Map([['react', '^19.0.0']])
    bunCatalogLoader.write(catalog, changes)

    const updated = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(updated.workspaces.catalog.react).toBe('^19.0.0')
    expect(updated.workspaces.catalog.typescript).toBe('^5.0.0')
  })

  it('writes updates to named catalog', () => {
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

    const filepath = join(testDir, 'package.json')
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'ui',
      filepath,
      deps: [],
      raw: JSON.parse(readFileSync(filepath, 'utf-8')),
      indent: '  ',
    }

    const changes = new Map([['react', '^19.0.0']])
    bunCatalogLoader.write(catalog, changes)

    const updated = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(updated.workspaces.catalogs.ui.react).toBe('^19.0.0')
    expect(updated.workspaces.catalogs.ui['react-dom']).toBe('^18.0.0')
    expect(updated.workspaces.catalogs.tooling.vitest).toBe('^1.0.0')
  })

  it('preserves other catalogs when writing to one', () => {
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

    const filepath = join(testDir, 'package.json')

    // Write to default catalog
    const defaultCatalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [],
      raw: JSON.parse(readFileSync(filepath, 'utf-8')),
      indent: '  ',
    }
    bunCatalogLoader.write(defaultCatalog, new Map([['lodash', '^5.0.0']]))

    const updated = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(updated.workspaces.catalog.lodash).toBe('^5.0.0')
    expect(updated.workspaces.catalogs.ui.react).toBe('^18.0.0')
  })

  it('preserves trailing newline', () => {
    writePackageJson(testDir, {
      name: 'test',
      workspaces: { catalog: { react: '^18.0.0' } },
    })

    const filepath = join(testDir, 'package.json')
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [],
      raw: JSON.parse(readFileSync(filepath, 'utf-8')),
      indent: '  ',
    }

    bunCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const content = readFileSync(filepath, 'utf-8')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('skips write when dep not found in section', () => {
    writePackageJson(testDir, {
      name: 'test',
      workspaces: { catalog: { react: '^18.0.0' } },
    })

    const filepath = join(testDir, 'package.json')
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [],
      raw: JSON.parse(readFileSync(filepath, 'utf-8')),
      indent: '  ',
    }

    bunCatalogLoader.write(catalog, new Map([['nonexistent', '^1.0.0']]))

    const updated = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(updated.workspaces.catalog.react).toBe('^18.0.0')
    expect(updated.workspaces.catalog.nonexistent).toBeUndefined()
  })

  it('preserves CRLF line endings when writing', () => {
    const filepath = join(testDir, 'package.json')
    const content =
      '{\r\n  "name": "test",\r\n  "workspaces": {\r\n    "catalog": {\r\n      "react": "^18.0.0"\r\n    }\r\n  }\r\n}\r\n'
    writeFileSync(filepath, content, 'utf-8')

    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [],
      raw: JSON.parse(content),
      indent: '  ',
    }

    bunCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('\r\n')
    expect(result).not.toMatch(/[^\r]\n/)
    const parsed = JSON.parse(result)
    expect(parsed.workspaces.catalog.react).toBe('^19.0.0')
  })

  it('keeps LF when input has LF', () => {
    const filepath = join(testDir, 'package.json')
    const raw = { name: 'test', workspaces: { catalog: { react: '^18.0.0' } } }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content, 'utf-8')

    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [],
      raw,
      indent: '  ',
    }

    bunCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const result = readFileSync(filepath, 'utf-8')
    expect(result).not.toContain('\r\n')
    const parsed = JSON.parse(result)
    expect(parsed.workspaces.catalog.react).toBe('^19.0.0')
  })

  it('skips write when catalog section is missing', () => {
    writePackageJson(testDir, {
      name: 'test',
      workspaces: ['packages/*'],
    })

    const filepath = join(testDir, 'package.json')
    const catalog: CatalogSource = {
      type: 'bun',
      name: 'default',
      filepath,
      deps: [],
      raw: {},
      indent: '  ',
    }

    // Should not throw
    bunCatalogLoader.write(catalog, new Map([['react', '^19.0.0']]))

    const updated = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(updated.workspaces).toEqual(['packages/*'])
  })
})
