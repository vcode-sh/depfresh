import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveContainedPath } from './containment'

describe('resolveContainedPath', () => {
  let parentDir: string
  let rootDir: string

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'depfresh-containment-'))
    rootDir = join(parentDir, 'project')
    mkdirSync(rootDir)
  })

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true })
  })

  it('allows an existing path inside the canonical root', () => {
    const manifest = join(rootDir, 'package.json')
    writeFileSync(manifest, '{}')

    expect(resolveContainedPath(rootDir, manifest)).toEqual({
      allowed: true,
      root: realpathSync(rootDir),
      path: realpathSync(manifest),
    })
  })

  it('blocks path-prefix collisions by component', () => {
    const collisionDir = join(parentDir, 'project-copy')
    mkdirSync(collisionDir)
    const manifest = join(collisionDir, 'package.json')
    writeFileSync(manifest, '{}')

    expect(resolveContainedPath(rootDir, manifest)).toMatchObject({
      allowed: false,
      reason: 'OUTSIDE_ROOT',
    })
  })

  it('allows child components whose names merely start with two dots', () => {
    const cacheDir = join(rootDir, '..cache')
    mkdirSync(cacheDir)
    const manifest = join(cacheDir, 'package.json')
    writeFileSync(manifest, '{}')

    expect(resolveContainedPath(rootDir, manifest)).toEqual({
      allowed: true,
      root: realpathSync(rootDir),
      path: realpathSync(manifest),
    })
  })

  it('blocks parent traversal even when normalization would return inside the root', () => {
    const manifest = join(rootDir, 'package.json')
    writeFileSync(manifest, '{}')

    expect(resolveContainedPath(rootDir, 'nested/../package.json')).toMatchObject({
      allowed: false,
      reason: 'PARENT_TRAVERSAL',
    })
  })

  it('blocks an absolute external path', () => {
    const manifest = join(parentDir, 'external.json')
    writeFileSync(manifest, '{}')

    expect(resolveContainedPath(rootDir, manifest)).toMatchObject({
      allowed: false,
      reason: 'OUTSIDE_ROOT',
    })
  })

  it('blocks a missing candidate with a stable reason', () => {
    expect(resolveContainedPath(rootDir, 'missing/package.json')).toMatchObject({
      allowed: false,
      reason: 'PATH_NOT_FOUND',
    })
  })

  it('blocks a symlink that resolves outside the root', () => {
    const externalDir = join(parentDir, 'external')
    mkdirSync(externalDir)
    writeFileSync(join(externalDir, 'package.json'), '{}')
    symlinkSync(externalDir, join(rootDir, 'escape'))

    expect(resolveContainedPath(rootDir, join(rootDir, 'escape', 'package.json'))).toMatchObject({
      allowed: false,
      reason: 'SYMLINK_ESCAPE',
    })
  })

  it('allows an in-root symlink and returns one physical identity', () => {
    const targetDir = join(rootDir, 'packages', 'target')
    mkdirSync(targetDir, { recursive: true })
    const target = join(targetDir, 'package.json')
    writeFileSync(target, '{}')
    symlinkSync(targetDir, join(rootDir, 'alias'))

    expect(resolveContainedPath(rootDir, join(rootDir, 'alias', 'package.json'))).toEqual({
      allowed: true,
      root: realpathSync(rootDir),
      path: realpathSync(target),
    })
  })

  it('canonicalizes a symlinked root without creating a second identity', () => {
    const rootAlias = join(parentDir, 'project-alias')
    symlinkSync(rootDir, rootAlias)
    const manifest = join(rootDir, 'package.json')
    writeFileSync(manifest, '{}')

    expect(resolveContainedPath(rootAlias, join(rootAlias, 'package.json'))).toEqual({
      allowed: true,
      root: realpathSync(rootDir),
      path: realpathSync(manifest),
    })
  })

  it('blocks a missing root before inspecting the candidate', () => {
    expect(resolveContainedPath(join(parentDir, 'missing-root'), 'package.json')).toMatchObject({
      allowed: false,
      reason: 'ROOT_NOT_FOUND',
    })
  })
})
