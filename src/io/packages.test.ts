import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadPackages, parsePackageManagerField } from './packages'
import type { BumpOptions } from '../types'
import { DEFAULT_OPTIONS } from '../types'

const baseOptions = { ...DEFAULT_OPTIONS } as BumpOptions

describe('loadPackages', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-packages-'))
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

describe('parsePackageManagerField', () => {
  it('parses pnpm@9.0.0', () => {
    const result = parsePackageManagerField('pnpm@9.0.0')
    expect(result).toEqual({
      name: 'pnpm',
      version: '9.0.0',
      hash: undefined,
      raw: 'pnpm@9.0.0',
    })
  })

  it('parses npm@10.0.0+sha512.abc', () => {
    const result = parsePackageManagerField('npm@10.0.0+sha512.abc')
    expect(result).toEqual({
      name: 'npm',
      version: '10.0.0',
      hash: 'sha512.abc',
      raw: 'npm@10.0.0+sha512.abc',
    })
  })

  it('returns undefined for invalid format', () => {
    const result = parsePackageManagerField('invalid-format')
    expect(result).toBeUndefined()
  })

  it('handles all PM names: npm, pnpm, yarn, bun', () => {
    for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) {
      const result = parsePackageManagerField(`${pm}@1.0.0`)
      expect(result?.name).toBe(pm)
      expect(result?.version).toBe('1.0.0')
    }
  })

  it('returns undefined for unsupported package manager name', () => {
    const result = parsePackageManagerField('deno@1.0.0')
    expect(result).toBeUndefined()
  })

  it('parses version with prerelease suffix', () => {
    const result = parsePackageManagerField('pnpm@9.0.0-beta.1')
    expect(result?.version).toBe('9.0.0-beta.1')
  })
})
