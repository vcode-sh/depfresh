import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
