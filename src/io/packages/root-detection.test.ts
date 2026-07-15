import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPathWithinBoundary, resolveDiscoveryContext } from './root-detection'

describe('isPathWithinBoundary', () => {
  it.each([
    ['/repo', '/repo', true],
    ['/repo/package', '/repo', true],
    ['/repo-sibling', '/repo', false],
    ['C:\\repo', 'C:/repo', true],
    ['C:\\repo\\package', 'C:/repo', true],
    ['C:\\repo-sibling', 'C:/repo', false],
    ['D:\\repo\\package', 'C:/repo', false],
  ])('classifies candidate %s against boundary %s', (candidate, boundary, expected) => {
    expect(isPathWithinBoundary(candidate, boundary)).toBe(expected)
  })
})

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
      effectiveRoot: realpathSync(tmpDir),
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
      effectiveRoot: realpathSync(tmpDir),
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
      effectiveRoot: realpathSync(tmpDir),
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
      effectiveRoot: realpathSync(tmpDir),
      discoveryMode: 'parent-folder',
    })
  })

  it('returns one canonical root when invoked through a descendant symlink', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2),
    )
    mkdirSync(join(tmpDir, 'packages', 'app', 'src'), { recursive: true })
    const alias = `${tmpDir}-alias`
    symlinkSync(tmpDir, alias)

    try {
      const inputCwd = join(alias, 'packages', 'app', 'src')
      const context = resolveDiscoveryContext(inputCwd)

      expect(context).toEqual({
        inputCwd,
        effectiveRoot: realpathSync(tmpDir),
        discoveryMode: 'inside-project',
      })
    } finally {
      rmSync(alias, { force: true })
    }
  })

  it('does not use an external symlinked manifest as root evidence', () => {
    const externalManifest = `${tmpDir}-external-package.json`
    writeFileSync(
      externalManifest,
      JSON.stringify({ name: 'external', workspaces: ['packages/*'] }),
    )
    symlinkSync(externalManifest, join(tmpDir, 'package.json'))

    try {
      expect(resolveDiscoveryContext(tmpDir)).toEqual({
        inputCwd: tmpDir,
        effectiveRoot: realpathSync(tmpDir),
        discoveryMode: 'parent-folder',
      })
    } finally {
      rmSync(externalManifest, { force: true })
    }
  })
})
