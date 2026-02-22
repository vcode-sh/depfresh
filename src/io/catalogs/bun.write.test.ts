import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CatalogSource } from '../../types'
import { bunCatalogLoader } from './bun'

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
