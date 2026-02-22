import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageMeta, ResolvedDepChange } from '../types'
import { writePackage } from './write'

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

describe('writePackage', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-write-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('preserves 2-space indentation', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = `${JSON.stringify({ name: 'test', dependencies: { foo: '^1.0.0' } }, null, 2)}\n`
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw, { indent: '  ' })
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('  "dependencies"')
    expect(result).toContain('"foo": "^2.0.0"')
  })

  it('preserves 4-space indentation', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = `${JSON.stringify({ name: 'test', dependencies: { foo: '^1.0.0' } }, null, 4)}\n`
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw, { indent: '    ' })
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('    "dependencies"')
    expect(result).toContain('"foo": "^2.0.0"')
  })

  it('preserves tab indentation', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = `${JSON.stringify({ name: 'test', dependencies: { foo: '^1.0.0' } }, null, '\t')}\n`
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw, { indent: '\t' })
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('\t"dependencies"')
    expect(result).toContain('"foo": "^2.0.0"')
  })

  it('preserves trailing newline', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = `${JSON.stringify({ name: 'test', dependencies: { foo: '^1.0.0' } }, null, 2)}\n`
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result.endsWith('\n')).toBe(true)
  })

  it('works without trailing newline', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = JSON.stringify({ name: 'test', dependencies: { foo: '^1.0.0' } }, null, 2)
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result.endsWith('\n')).toBe(false)
    expect(result.endsWith('}') || result.endsWith('}')).toBe(true)
  })

  it('preserves npm: protocol prefix', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = { name: 'test', dependencies: { 'my-lodash': 'npm:lodash@^1.0.0' } }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'my-lodash',
        source: 'dependencies',
        targetVersion: '^2.0.0',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.dependencies['my-lodash']).toBe('npm:lodash@^2.0.0')
  })

  it('preserves jsr: protocol prefix', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = { name: 'test', dependencies: { 'my-pkg': 'jsr:@scope/name@^1.0.0' } }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'my-pkg',
        source: 'dependencies',
        targetVersion: '^3.0.0',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.dependencies['my-pkg']).toBe('jsr:@scope/name@^3.0.0')
  })

  it('updates regular version without protocol', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = { name: 'test', dependencies: { react: '^17.0.0' } }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'react',
        source: 'dependencies',
        targetVersion: '^18.0.0',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.dependencies.react).toBe('^18.0.0')
  })

  it('applies multiple changes to different dependency fields', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      dependencies: { lodash: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'lodash',
        source: 'dependencies',
        targetVersion: '^5.0.0',
        diff: 'major',
      }),
      makeChange({
        name: 'vitest',
        source: 'devDependencies',
        targetVersion: '^2.0.0',
        diff: 'major',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.dependencies.lodash).toBe('^5.0.0')
    expect(parsed.devDependencies.vitest).toBe('^2.0.0')
  })

  it('applies changes to nested overrides', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      overrides: { sharp: '0.33.0' },
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'sharp',
        source: 'overrides' as ResolvedDepChange['source'],
        targetVersion: '0.34.0',
        diff: 'minor',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.overrides.sharp).toBe('0.34.0')
  })

  it('skips writing when changes array is empty', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = `${JSON.stringify({ name: 'test', dependencies: { foo: '^1.0.0' } }, null, 2)}\n`
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)

    writePackage(pkg, [], 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toBe(content)
  })

  it('handles pnpm.overrides dotted source path', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      pnpm: { overrides: { sharp: '0.33.0' } },
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'sharp',
        source: 'pnpm.overrides' as ResolvedDepChange['source'],
        targetVersion: '0.34.0',
        diff: 'minor',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.pnpm.overrides.sharp).toBe('0.34.0')
  })
})
