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

describe('writePackage protocol preservation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-proto-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
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

  it('preserves github: protocol with v-prefixed tag', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      dependencies: { 'uWebSockets.js': 'github:uNetworking/uWebSockets.js#v20.51.0' },
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'uWebSockets.js',
        source: 'dependencies',
        currentVersion: '20.51.0',
        targetVersion: '20.52.0',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.dependencies['uWebSockets.js']).toBe('github:uNetworking/uWebSockets.js#v20.52.0')
  })

  it('preserves github: refs/tags/ prefix', () => {
    const filepath = join(tmpDir, 'package.json')
    const raw = {
      name: 'test',
      dependencies: { foo: 'github:owner/repo#refs/tags/v1.2.3' },
    }
    const content = `${JSON.stringify(raw, null, 2)}\n`
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({
        name: 'foo',
        source: 'dependencies',
        currentVersion: '1.2.3',
        targetVersion: '1.3.0',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.dependencies.foo).toBe('github:owner/repo#refs/tags/v1.3.0')
  })

  it('preserves both CRLF and npm: protocol prefix', () => {
    const filepath = join(tmpDir, 'package.json')
    const content =
      '{\r\n  "name": "test",\r\n  "dependencies": {\r\n    "my-lodash": "npm:lodash@^1.0.0"\r\n  }\r\n}\r\n'
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({ name: 'my-lodash', source: 'dependencies', targetVersion: '^2.0.0' }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(result)
    expect(parsed.dependencies['my-lodash']).toBe('npm:lodash@^2.0.0')
    expect(result).toContain('\r\n')
    expect(result).not.toMatch(/[^\r]\n/)
  })

  it('preserves npm: and jsr: protocols in package.yaml', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content = [
      'name: test',
      'dependencies:',
      '  my-lodash: npm:lodash@^1.0.0',
      '  my-pkg: jsr:@scope/name@^1.0.0',
      '',
    ].join('\n')
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, {}, { type: 'package.yaml' })
    const changes = [
      makeChange({ name: 'my-lodash', source: 'dependencies', targetVersion: '^2.0.0' }),
      makeChange({ name: 'my-pkg', source: 'dependencies', targetVersion: '^3.0.0' }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('my-lodash: npm:lodash@^2.0.0')
    expect(result).toContain('my-pkg: jsr:@scope/name@^3.0.0')
  })

  it('preserves github: protocol in package.yaml', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content = [
      'name: test',
      'dependencies:',
      '  uWebSockets.js: github:uNetworking/uWebSockets.js#v20.51.0',
      '',
    ].join('\n')
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, {}, { type: 'package.yaml' })
    const changes = [
      makeChange({
        name: 'uWebSockets.js',
        source: 'dependencies',
        currentVersion: '20.51.0',
        targetVersion: '20.52.0',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('uWebSockets.js: github:uNetworking/uWebSockets.js#v20.52.0')
  })
})
