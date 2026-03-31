import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageMeta, ResolvedDepChange } from '../../types'
import { writePackage } from './index'

function makeChange(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'test-pkg',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: { name: 'test-pkg', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  }
}

function makePkg(
  filepath: string,
  raw: Record<string, unknown>,
  overrides: Partial<PackageMeta> = {},
): PackageMeta {
  return {
    name: (raw.name as string) ?? 'test-project',
    type: 'package.json',
    filepath,
    deps: [],
    resolved: [],
    raw,
    indent: '  ',
    ...overrides,
  }
}

describe('writePackage adversarial: non-object source fields', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-adv-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not crash when source field is a string (packageManager)', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      packageManager: 'bun@1.3.10',
      dependencies: { foo: '^1.0.0' },
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw, {
      packageManager: { name: 'bun', version: '1.3.10', raw: 'bun@1.3.10' },
    })

    expect(() => {
      writePackage(
        pkg,
        [
          makeChange({
            name: 'bun',
            source: 'packageManager' as ResolvedDepChange['source'],
            currentVersion: '1.3.10',
            targetVersion: '1.3.11',
            diff: 'patch',
          }),
        ],
        'silent',
      )
    }).not.toThrow()

    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(parsed.packageManager).toBe('bun@1.3.11')
  })

  it('does not crash when source field is a number', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = { name: 'test', weirdField: 42, dependencies: { foo: '^1.0.0' } }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)

    expect(() => {
      writePackage(
        pkg,
        [
          makeChange({
            name: 'something',
            source: 'weirdField' as ResolvedDepChange['source'],
            targetVersion: '2.0.0',
          }),
        ],
        'silent',
      )
    }).not.toThrow()
  })

  it('does not crash when source field is a boolean', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = { name: 'test', private: true }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)

    expect(() => {
      writePackage(
        pkg,
        [
          makeChange({
            name: 'pkg',
            source: 'private' as ResolvedDepChange['source'],
            targetVersion: '1.0.0',
          }),
        ],
        'silent',
      )
    }).not.toThrow()
  })

  it('does not crash when source field is null', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = { name: 'test', nullField: null }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)

    expect(() => {
      writePackage(
        pkg,
        [
          makeChange({
            name: 'pkg',
            source: 'nullField' as ResolvedDepChange['source'],
            targetVersion: '1.0.0',
          }),
        ],
        'silent',
      )
    }).not.toThrow()
  })

  it('does not crash when source field is an array', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = { name: 'test', files: ['dist', 'src'] }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)

    expect(() => {
      writePackage(
        pkg,
        [
          makeChange({
            name: 'dist',
            source: 'files' as ResolvedDepChange['source'],
            targetVersion: '1.0.0',
          }),
        ],
        'silent',
      )
    }).not.toThrow()
  })

  it('packageManager with hash is preserved through write', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      packageManager: 'pnpm@9.0.0+sha512.deadbeef',
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw, {
      packageManager: {
        name: 'pnpm',
        version: '9.0.0',
        hash: 'sha512.deadbeef',
        raw: 'pnpm@9.0.0+sha512.deadbeef',
      },
    })

    writePackage(
      pkg,
      [
        makeChange({
          name: 'pnpm',
          source: 'packageManager' as ResolvedDepChange['source'],
          currentVersion: '9.0.0',
          targetVersion: '10.0.0',
          diff: 'major',
        }),
      ],
      'silent',
    )

    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(parsed.packageManager).toBe('pnpm@10.0.0+sha512.deadbeef')
  })

  it('mixed packageManager + dependency changes work together', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      packageManager: 'bun@1.3.10',
      dependencies: { lodash: '^4.17.0' },
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw, {
      packageManager: { name: 'bun', version: '1.3.10', raw: 'bun@1.3.10' },
    })

    writePackage(
      pkg,
      [
        makeChange({
          name: 'bun',
          source: 'packageManager' as ResolvedDepChange['source'],
          currentVersion: '1.3.10',
          targetVersion: '1.3.11',
          diff: 'patch',
        }),
        makeChange({
          name: 'lodash',
          source: 'dependencies',
          currentVersion: '^4.17.0',
          targetVersion: '^4.18.0',
          diff: 'minor',
        }),
      ],
      'silent',
    )

    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))
    expect(parsed.packageManager).toBe('bun@1.3.11')
    expect(parsed.dependencies.lodash).toBe('^4.18.0')
  })
})
