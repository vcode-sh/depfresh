import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveDiscoveryContext } from './root-detection'

describe('resolveDiscoveryContext', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-root-detection-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns direct-root for a package root cwd', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))

    const context = resolveDiscoveryContext(tmpDir)

    expect(context).toEqual({
      inputCwd: tmpDir,
      effectiveRoot: tmpDir,
      discoveryMode: 'direct-root',
    })
  })

  it('resolves to the nearest package root when inside a plain package', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2))
    mkdirSync(join(tmpDir, 'src', 'deep'), { recursive: true })

    const subdir = join(tmpDir, 'src', 'deep')
    const context = resolveDiscoveryContext(subdir)

    expect(context).toEqual({
      inputCwd: subdir,
      effectiveRoot: tmpDir,
      discoveryMode: 'inside-project',
    })
  })

  it('prefers the workspace root over a nested package root', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'workspace-root', workspaces: ['packages/*'] }, null, 2),
    )
    mkdirSync(join(tmpDir, 'packages', 'app', 'src'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'app', 'package.json'),
      JSON.stringify({ name: 'app' }, null, 2),
    )

    const subdir = join(tmpDir, 'packages', 'app', 'src')
    const context = resolveDiscoveryContext(subdir)

    expect(context).toEqual({
      inputCwd: subdir,
      effectiveRoot: tmpDir,
      discoveryMode: 'inside-project',
    })
  })

  it('treats a plain parent folder as parent-folder mode', () => {
    mkdirSync(join(tmpDir, 'children', 'app'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'children', 'app', 'package.json'),
      JSON.stringify({ name: 'app' }, null, 2),
    )

    const context = resolveDiscoveryContext(tmpDir)

    expect(context).toEqual({
      inputCwd: tmpDir,
      effectiveRoot: tmpDir,
      discoveryMode: 'parent-folder',
    })
  })
})
