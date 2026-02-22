import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS } as UpgrOptions

describe('loadPackages', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upgr-packages-'))
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
