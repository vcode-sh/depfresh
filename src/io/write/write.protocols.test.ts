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
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-proto-'))
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
})
