import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS, loglevel: 'silent' } as depfreshOptions

describe('loadPackages repository containment', () => {
  let parentDir: string
  let rootDir: string

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'depfresh-package-containment-'))
    rootDir = join(parentDir, 'project')
    mkdirSync(rootDir)
  })

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true })
  })

  it('blocks traversal and absolute workspace globs before reading external manifests', async () => {
    const externalDir = join(parentDir, 'external')
    mkdirSync(externalDir)
    writeFileSync(
      join(externalDir, 'package.json'),
      JSON.stringify({ name: 'external-secret', token: 'must-not-be-read' }),
    )
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        workspaces: ['../external', externalDir],
      }),
    )
    const options = { ...baseOptions, cwd: rootDir }

    const packages = await loadPackages(options)

    expect(packages.map((pkg) => pkg.name)).toEqual(['root'])
    expect(options.discoveryReport?.skippedManifests).toEqual(
      expect.arrayContaining([
        { path: '../external', reason: 'workspace-pattern:PARENT_TRAVERSAL' },
        { path: externalDir, reason: 'workspace-pattern:ABSOLUTE_PATTERN' },
      ]),
    )
  })

  it('stays root-only when every declared workspace pattern is blocked', async () => {
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['../external/*'] }),
    )
    const unrelatedDir = join(rootDir, 'unrelated')
    mkdirSync(unrelatedDir)
    writeFileSync(join(unrelatedDir, 'package.json'), JSON.stringify({ name: 'unrelated' }))

    const packages = await loadPackages({ ...baseOptions, cwd: rootDir })

    expect(packages.map((pkg) => pkg.name)).toEqual(['root'])
  })

  it('blocks a package symlink that resolves outside the selected root', async () => {
    const externalDir = join(parentDir, 'external')
    mkdirSync(externalDir)
    writeFileSync(join(externalDir, 'package.json'), JSON.stringify({ name: 'external' }))
    mkdirSync(join(rootDir, 'packages'))
    symlinkSync(externalDir, join(rootDir, 'packages', 'escape'))
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    )
    const options = { ...baseOptions, cwd: rootDir }

    const packages = await loadPackages(options)

    expect(packages.map((pkg) => pkg.name)).toEqual(['root'])
    expect(options.discoveryReport?.skippedManifests).toContainEqual({
      path: join(realpathSync(rootDir), 'packages', 'escape', 'package.json'),
      reason: 'containment:SYMLINK_ESCAPE',
    })
  })

  it('deduplicates in-root symlink spellings by physical identity', async () => {
    const targetDir = join(rootDir, 'packages', 'target')
    mkdirSync(targetDir, { recursive: true })
    const targetManifest = join(targetDir, 'package.json')
    writeFileSync(targetManifest, JSON.stringify({ name: 'target' }))
    symlinkSync(targetDir, join(rootDir, 'packages', 'alias'))
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    )
    const options = { ...baseOptions, cwd: rootDir }

    const packages = await loadPackages(options)

    expect(packages.map((pkg) => pkg.name).sort()).toEqual(['root', 'target'])
    expect(options.discoveryReport?.loadedPackages).toContain(realpathSync(targetManifest))
    expect(options.discoveryReport?.loadedPackages).not.toContain(
      join(rootDir, 'packages', 'alias', 'package.json'),
    )
  })

  it('reports nested roots but excludes them and their descendants from write candidates', async () => {
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: 'root' }))
    const nestedDir = join(rootDir, 'vendor', 'nested')
    mkdirSync(join(nestedDir, 'packages', 'child'), { recursive: true })
    writeFileSync(join(nestedDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    writeFileSync(join(nestedDir, 'package.json'), JSON.stringify({ name: 'nested' }))
    writeFileSync(
      join(nestedDir, 'packages', 'child', 'package.json'),
      JSON.stringify({ name: 'child' }),
    )
    const options = {
      ...baseOptions,
      cwd: rootDir,
      write: true,
      ignoreOtherWorkspaces: false,
    }

    const packages = await loadPackages(options)

    expect(packages.map((pkg) => pkg.name)).toEqual(['root'])
    expect(options.discoveryReport?.skippedManifests).toEqual(
      expect.arrayContaining([
        {
          path: join(realpathSync(nestedDir), 'package.json'),
          reason: 'nested-root:pnpm-workspace',
        },
        {
          path: join(realpathSync(nestedDir), 'packages', 'child', 'package.json'),
          reason: 'nested-descendant:pnpm-workspace',
        },
      ]),
    )
  })

  it('uses the same canonical root when invoked through a descendant symlink', async () => {
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    )
    const appDir = join(rootDir, 'packages', 'app')
    mkdirSync(join(appDir, 'src'), { recursive: true })
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'app' }))
    const rootAlias = join(parentDir, 'project-alias')
    symlinkSync(rootDir, rootAlias)
    const options = { ...baseOptions, cwd: join(rootAlias, 'packages', 'app', 'src') }

    const packages = await loadPackages(options)

    expect(packages.map((pkg) => pkg.name).sort()).toEqual(['app', 'root'])
    expect(options.discoveryReport?.effectiveRoot).toBe(realpathSync(rootDir))
  })
})
