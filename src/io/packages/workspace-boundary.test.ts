import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belongsToNestedWorkspace } from './workspace-boundary'

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
