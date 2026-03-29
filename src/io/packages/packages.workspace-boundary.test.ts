import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS } as depfreshOptions

describe('loadPackages with ignoreOtherWorkspaces', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-ignore-ws-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps nested pnpm workspace roots while filtering out their descendants', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'packages', 'a'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'a', 'package.json'),
      JSON.stringify({ name: 'a', dependencies: { lodash: '^4.0.0' } }, null, 2),
    )

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
    expect(names).toEqual(['a', 'other-mono', 'root'])
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

  it('keeps nested npm workspace roots defined in package.json while filtering descendants', async () => {
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
    expect(names).toEqual(['lib-root', 'root'])
  })

  it('keeps nested npm workspace roots defined by package.yaml while filtering descendants', async () => {
    writeFileSync(join(tmpDir, 'package.yaml'), 'name: root\n')

    mkdirSync(join(tmpDir, 'external', 'yaml-lib', 'packages', 'd'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'external', 'yaml-lib', 'package.yaml'),
      ['name: yaml-lib', 'workspaces:', '  - packages/*', ''].join('\n'),
    )
    writeFileSync(
      join(tmpDir, 'external', 'yaml-lib', 'packages', 'd', 'package.yaml'),
      ['name: d', 'dependencies:', '  lodash: ^4.17.21', ''].join('\n'),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      ignoreOtherWorkspaces: true,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['root', 'yaml-lib'])
  })

  it('keeps nested package.yaml workspaces when filtering is disabled', async () => {
    writeFileSync(join(tmpDir, 'package.yaml'), 'name: root\n')

    mkdirSync(join(tmpDir, 'external', 'yaml-lib', 'packages', 'd'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'external', 'yaml-lib', 'package.yaml'),
      ['name: yaml-lib', 'workspaces:', '  - packages/*', ''].join('\n'),
    )
    writeFileSync(
      join(tmpDir, 'external', 'yaml-lib', 'packages', 'd', 'package.yaml'),
      ['name: d', 'dependencies:', '  lodash: ^4.17.21', ''].join('\n'),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      ignoreOtherWorkspaces: false,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['d', 'root', 'yaml-lib'])
  })

  it('keeps a nested pnpm workspace root while excluding its descendants', async () => {
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
    expect(names).toEqual(['other-mono'])
  })

  it('keeps a nested git repo root while excluding its descendants', async () => {
    mkdirSync(join(tmpDir, 'vendor', 'nested-repo', '.git'), { recursive: true })
    mkdirSync(join(tmpDir, 'vendor', 'nested-repo', 'packages', 'b'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'vendor', 'nested-repo', 'package.json'),
      JSON.stringify({ name: 'nested-repo' }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'nested-repo', 'packages', 'b', 'package.json'),
      JSON.stringify({ name: 'b' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      ignoreOtherWorkspaces: true,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['nested-repo'])
  })

  it('keeps a nested git worktree root file while excluding its descendants', async () => {
    mkdirSync(join(tmpDir, 'vendor', 'nested-worktree', 'packages', 'b'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'vendor', 'nested-worktree', '.git'),
      'gitdir: ../.git/worktrees/repo\n',
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'nested-worktree', 'package.json'),
      JSON.stringify({ name: 'nested-worktree' }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'vendor', 'nested-worktree', 'packages', 'b', 'package.json'),
      JSON.stringify({ name: 'b' }, null, 2),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      ignoreOtherWorkspaces: true,
      loglevel: 'silent',
    })

    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['nested-worktree'])
  })
})
