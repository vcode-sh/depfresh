import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS } as UpgrOptions

describe('loadPackages with ignoreOtherWorkspaces', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upgr-ignore-ws-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('filters out packages from nested pnpm workspaces', async () => {
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
