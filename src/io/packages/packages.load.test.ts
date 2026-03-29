import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS } as depfreshOptions

describe('loadPackages', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-packages-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds package.json in given directory', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', dependencies: { lodash: '^4.0.0' } }, null, 2),
    )

    const packages = await loadPackages({ ...baseOptions, cwd: tmpDir, loglevel: 'silent' })
    expect(packages).toHaveLength(1)
    expect(packages[0]?.name).toBe('test-project')
  })

  it('finds nested package.json files with recursive option', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'packages', 'sub'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'sub', 'package.json'),
      JSON.stringify({ name: 'sub-pkg' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      recursive: true,
      loglevel: 'silent',
    })
    expect(packages).toHaveLength(2)
    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['root', 'sub-pkg'])
  })

  it('uses effectiveRoot for discovery when cwd points at a child directory', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2),
    )
    mkdirSync(join(tmpDir, 'packages', 'sub', 'src'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'sub', 'package.json'),
      JSON.stringify({ name: 'sub-pkg' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: join(tmpDir, 'packages', 'sub', 'src'),
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['root', 'sub-pkg'])
  })

  it('uses root workspaces from package.json to avoid scanning unrelated package trees', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2),
    )
    mkdirSync(join(tmpDir, 'packages', 'sub'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'sub', 'package.json'),
      JSON.stringify({ name: 'sub-pkg' }, null, 2),
    )
    mkdirSync(join(tmpDir, 'examples', 'demo'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'examples', 'demo', 'package.json'),
      JSON.stringify({ name: 'demo' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      recursive: true,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['root', 'sub-pkg'])
  })

  it('uses pnpm-workspace.yaml package patterns before falling back to blind globbing', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    mkdirSync(join(tmpDir, 'packages', 'sub'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'sub', 'package.json'),
      JSON.stringify({ name: 'sub-pkg' }, null, 2),
    )
    mkdirSync(join(tmpDir, 'examples', 'demo'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'examples', 'demo', 'package.json'),
      JSON.stringify({ name: 'demo' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      recursive: true,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['root', 'sub-pkg'])
  })

  it('loads only root package.json when recursive=false', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'packages', 'sub'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'sub', 'package.json'),
      JSON.stringify({ name: 'sub-pkg' }, null, 2),
    )

    writeFileSync(
      join(tmpDir, 'pnpm-workspace.yaml'),
      'catalog:\n  lodash: "^4.17.21"\npackages:\n  - "packages/*"\n',
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      recursive: false,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.name).toBe('root')
  })

  it('respects ignorePaths (skips node_modules)', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'node_modules', 'some-pkg', 'package.json'),
      JSON.stringify({ name: 'some-pkg' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })
    expect(packages).toHaveLength(1)
    expect(packages[0]?.name).toBe('root')
  })

  it('handles malformed package.json gracefully', async () => {
    writeFileSync(join(tmpDir, 'package.json'), '{invalid json!!!}')

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })
    expect(packages).toHaveLength(0)
  })

  it('detects indentation', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }, null, 4))

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })
    expect(packages).toHaveLength(1)
    expect(packages[0]?.indent).toBe('    ')
  })

  it('defaults to 2-space indent for minified JSON', async () => {
    writeFileSync(join(tmpDir, 'package.json'), '{"name":"test"}')

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })
    expect(packages).toHaveLength(1)
    expect(packages[0]?.indent).toBe('  ')
  })

  it('parses packageManager field from package.json', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@9.0.0' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })
    expect(packages[0]?.packageManager).toEqual({
      name: 'pnpm',
      version: '9.0.0',
      hash: undefined,
      raw: 'pnpm@9.0.0',
    })
  })

  it('populates discoveryReport when explainDiscovery is enabled', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'vendor', 'other', 'packages', 'b'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'vendor', 'other', 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'other', 'package.json'),
      JSON.stringify({ name: 'other' }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'other', 'packages', 'b', 'package.json'),
      JSON.stringify({ name: 'b' }, null, 2),
    )

    const options = {
      ...baseOptions,
      cwd: tmpDir,
      explainDiscovery: true,
      loglevel: 'silent',
    } as depfreshOptions

    const packages = await loadPackages(options)

    expect(packages.map((pkg) => pkg.name).sort()).toEqual(['other', 'root'])
    expect(options.discoveryReport).toBeDefined()
    expect(options.discoveryReport?.inputCwd).toBe(tmpDir)
    expect(options.discoveryReport?.effectiveRoot).toBe(tmpDir)
    expect(options.discoveryReport?.matchedManifests.length).toBeGreaterThan(0)
    expect(options.discoveryReport?.loadedPackages).toEqual(
      expect.arrayContaining([
        join(tmpDir, 'package.json'),
        join(tmpDir, 'vendor', 'other', 'package.json'),
      ]),
    )
    expect(options.discoveryReport?.skippedManifests).toEqual(
      expect.arrayContaining([
        {
          path: join(tmpDir, 'vendor', 'other', 'packages', 'b', 'package.json'),
          reason: 'nested-workspace-descendant',
        },
      ]),
    )
  })
})

describe('loadPackages with global flag', () => {
  it('returns global packages when global=true', async () => {
    vi.doMock('../global', () => ({
      loadGlobalPackages: () => [
        {
          name: 'Global packages',
          type: 'global',
          filepath: 'global:npm',
          deps: [
            {
              name: 'typescript',
              currentVersion: '5.3.3',
              source: 'dependencies',
              update: true,
              parents: [],
            },
          ],
          resolved: [],
          raw: {},
          indent: '  ',
        },
      ],
      loadGlobalPackagesAll: () => [],
    }))

    const packages = await loadPackages({
      ...baseOptions,
      global: true,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.type).toBe('global')
    expect(packages[0]?.name).toBe('Global packages')

    vi.doUnmock('../global')
  })

  it('skips filesystem scan when global=true', async () => {
    vi.doMock('../global', () => ({
      loadGlobalPackages: () => [],
      loadGlobalPackagesAll: () => [],
    }))

    const packages = await loadPackages({
      ...baseOptions,
      global: true,
      loglevel: 'silent',
    })

    expect(packages).toEqual([])

    vi.doUnmock('../global')
  })
})
