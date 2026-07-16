import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectRepositoryCandidates } from './evidence'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-evidence-walk-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('repository evidence candidate inventory', () => {
  it('retains only evidence candidates while pruning ignored and symlinked directories', () => {
    const root = fixture()
    const external = fixture()
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })
    mkdirSync(join(root, 'tmp', 'bulk'), { recursive: true })
    mkdirSync(join(root, 'dist'), { recursive: true })
    mkdirSync(join(root, 'nested', '.git'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{}\n')
    writeFileSync(join(root, 'apps', 'web', 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    writeFileSync(join(root, 'nested', '.node-version'), '24.15.0\n')
    writeFileSync(join(root, 'README.md'), 'irrelevant\n')
    writeFileSync(join(root, 'dist', 'package-lock.json'), '{}\n')
    writeFileSync(join(external, 'package.json'), '{}\n')
    symlinkSync(external, join(root, 'linked-external'))
    for (let index = 0; index < 500; index += 1) {
      writeFileSync(join(root, 'tmp', 'bulk', `artifact-${index}.txt`), 'irrelevant\n')
    }

    const walk = collectRepositoryCandidates(root, ['**/dist/**'])

    expect(walk.files.map((path) => relative(root, path))).toEqual([
      'apps/web/pnpm-lock.yaml',
      'nested/.git',
      'nested/.node-version',
      'package.json',
    ])
    expect(walk.unavailableDirectories).toEqual([])
  })

  it('applies candidate-file ignore rules without dropping sibling evidence', () => {
    const root = fixture()
    mkdirSync(join(root, 'workspace'), { recursive: true })
    writeFileSync(join(root, 'workspace', 'package.json'), '{}\n')
    writeFileSync(join(root, 'workspace', 'yarn.lock'), '# yarn lockfile v1\n')

    const walk = collectRepositoryCandidates(root, ['**/yarn.lock'])

    expect(walk.files.map((path) => relative(root, path))).toEqual(['workspace/package.json'])
  })

  it('retains broken and directory-target candidate symlinks as unavailable evidence', () => {
    const root = fixture()
    const directoryTarget = fixture()
    mkdirSync(join(root, 'pnpm-lock.yaml'))
    symlinkSync(directoryTarget, join(root, 'yarn.lock'))
    symlinkSync(join(root, 'missing-lockfile'), join(root, 'package-lock.json'))

    const walk = collectRepositoryCandidates(root, [])

    expect(walk.files.map((path) => relative(root, path))).toEqual([
      'package-lock.json',
      'yarn.lock',
    ])
  })

  it('always excludes node_modules evidence even with an empty ignore list', () => {
    const root = fixture()
    mkdirSync(join(root, 'node_modules', 'nested'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{}\n')
    writeFileSync(join(root, 'node_modules', 'nested', 'package.json'), '{}\n')
    writeFileSync(join(root, 'node_modules', 'nested', 'yarn.lock'), '# lock\n')

    const walk = collectRepositoryCandidates(root, [])

    expect(walk.files.map((path) => relative(root, path))).toEqual(['package.json'])
  })
})
