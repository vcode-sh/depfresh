import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BumpOptions } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import { belongsToNestedWorkspace, loadPackages, parsePackageManagerField } from './packages'

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

describe('loadPackages with global flag', () => {
  it('returns global packages when global=true', async () => {
    vi.doMock('./global', () => ({
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

    vi.doUnmock('./global')
  })

  it('skips filesystem scan when global=true', async () => {
    vi.doMock('./global', () => ({
      loadGlobalPackages: () => [],
    }))

    const packages = await loadPackages({
      ...baseOptions,
      global: true,
      loglevel: 'silent',
    })

    // Should return empty from global, not scan filesystem
    expect(packages).toEqual([])

    vi.doUnmock('./global')
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

describe('belongsToNestedWorkspace', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-nested-ws-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns false for package at root', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }))
    expect(belongsToNestedWorkspace(join(tmpDir, 'package.json'), tmpDir)).toBe(false)
  })

  it('returns false for direct child without workspace markers', () => {
    mkdirSync(join(tmpDir, 'packages', 'a'), { recursive: true })
    writeFileSync(join(tmpDir, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }))
    expect(belongsToNestedWorkspace(join(tmpDir, 'packages', 'a', 'package.json'), tmpDir)).toBe(
      false,
    )
  })

  it('detects nested pnpm workspace', () => {
    // Root has its own workspace, but nested-mono has pnpm-workspace.yaml
    mkdirSync(join(tmpDir, 'nested-mono', 'packages', 'x'), { recursive: true })
    writeFileSync(join(tmpDir, 'nested-mono', 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    writeFileSync(
      join(tmpDir, 'nested-mono', 'packages', 'x', 'package.json'),
      JSON.stringify({ name: 'x' }),
    )
    expect(
      belongsToNestedWorkspace(
        join(tmpDir, 'nested-mono', 'packages', 'x', 'package.json'),
        tmpDir,
      ),
    ).toBe(true)
  })

  it('detects nested yarn workspace via .yarnrc.yml', () => {
    mkdirSync(join(tmpDir, 'nested-yarn', 'packages', 'y'), { recursive: true })
    writeFileSync(join(tmpDir, 'nested-yarn', '.yarnrc.yml'), 'nodeLinker: node-modules\n')
    writeFileSync(
      join(tmpDir, 'nested-yarn', 'packages', 'y', 'package.json'),
      JSON.stringify({ name: 'y' }),
    )
    expect(
      belongsToNestedWorkspace(
        join(tmpDir, 'nested-yarn', 'packages', 'y', 'package.json'),
        tmpDir,
      ),
    ).toBe(true)
  })

  it('detects nested npm workspace via package.json with workspaces field', () => {
    mkdirSync(join(tmpDir, 'nested-npm', 'packages', 'z'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'nested-npm', 'package.json'),
      JSON.stringify({ name: 'nested-root', workspaces: ['packages/*'] }),
    )
    writeFileSync(
      join(tmpDir, 'nested-npm', 'packages', 'z', 'package.json'),
      JSON.stringify({ name: 'z' }),
    )
    expect(
      belongsToNestedWorkspace(join(tmpDir, 'nested-npm', 'packages', 'z', 'package.json'), tmpDir),
    ).toBe(true)
  })

  it('detects nested .git directory as repo boundary', () => {
    mkdirSync(join(tmpDir, 'nested-repo', '.git'), { recursive: true })
    mkdirSync(join(tmpDir, 'nested-repo', 'packages', 'w'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'nested-repo', 'packages', 'w', 'package.json'),
      JSON.stringify({ name: 'w' }),
    )
    expect(
      belongsToNestedWorkspace(
        join(tmpDir, 'nested-repo', 'packages', 'w', 'package.json'),
        tmpDir,
      ),
    ).toBe(true)
  })

  it('detects deeply nested workspace (4+ levels deep)', () => {
    mkdirSync(join(tmpDir, 'deep', 'nested', 'mono', 'packages', 'x'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'deep', 'nested', 'mono', 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeFileSync(
      join(tmpDir, 'deep', 'nested', 'mono', 'packages', 'x', 'package.json'),
      JSON.stringify({ name: 'deep-x' }),
    )
    expect(
      belongsToNestedWorkspace(
        join(tmpDir, 'deep', 'nested', 'mono', 'packages', 'x', 'package.json'),
        tmpDir,
      ),
    ).toBe(true)
  })

  it('returns false when workspace markers exist only at root', () => {
    // pnpm-workspace.yaml at root should not cause child packages to be flagged
    writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    mkdirSync(join(tmpDir, 'packages', 'a'), { recursive: true })
    writeFileSync(join(tmpDir, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }))
    expect(belongsToNestedWorkspace(join(tmpDir, 'packages', 'a', 'package.json'), tmpDir)).toBe(
      false,
    )
  })

  it('ignores package.json without workspaces field', () => {
    mkdirSync(join(tmpDir, 'sub', 'deep'), { recursive: true })
    // sub/package.json has no workspaces — not a workspace root
    writeFileSync(join(tmpDir, 'sub', 'package.json'), JSON.stringify({ name: 'sub-root' }))
    writeFileSync(join(tmpDir, 'sub', 'deep', 'package.json'), JSON.stringify({ name: 'deep' }))
    expect(belongsToNestedWorkspace(join(tmpDir, 'sub', 'deep', 'package.json'), tmpDir)).toBe(
      false,
    )
  })
})

describe('loadPackages with ignoreOtherWorkspaces', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-ignore-ws-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('filters out packages from nested pnpm workspaces', async () => {
    // Root workspace
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'packages', 'a'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'a', 'package.json'),
      JSON.stringify({ name: 'a', dependencies: { lodash: '^4.0.0' } }, null, 2),
    )

    // Nested monorepo
    mkdirSync(join(tmpDir, 'vendor', 'other-mono', 'packages', 'b'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'vendor', 'other-mono', 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'other-mono', 'package.json'),
      JSON.stringify({ name: 'other-mono' }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'other-mono', 'packages', 'b', 'package.json'),
      JSON.stringify({ name: 'b' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      ignoreOtherWorkspaces: true,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['a', 'root'])
  })

  it('keeps nested workspace packages when disabled', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'vendor', 'other-mono', 'packages', 'b'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'vendor', 'other-mono', 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'other-mono', 'package.json'),
      JSON.stringify({ name: 'other-mono' }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'other-mono', 'packages', 'b', 'package.json'),
      JSON.stringify({ name: 'b' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      ignoreOtherWorkspaces: false,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['b', 'other-mono', 'root'])
  })

  it('filters nested npm workspaces (package.json with workspaces field)', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))

    mkdirSync(join(tmpDir, 'external', 'lib', 'packages', 'c'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'external', 'lib', 'package.json'),
      JSON.stringify({ name: 'lib-root', workspaces: ['packages/*'] }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'external', 'lib', 'packages', 'c', 'package.json'),
      JSON.stringify({ name: 'c' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      ignoreOtherWorkspaces: true,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['root'])
  })
})
