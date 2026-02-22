import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageMeta, ResolvedDepChange } from '../../types'
import { writePackage } from './index'
import { detectLineEnding } from './text'

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

describe('detectLineEnding', () => {
  it('returns \\n for LF content', () => {
    expect(detectLineEnding('{\n  "name": "test"\n}\n')).toBe('\n')
  })

  it('returns \\r\\n for CRLF content', () => {
    expect(detectLineEnding('{\r\n  "name": "test"\r\n}\r\n')).toBe('\r\n')
  })

  it('returns \\n for empty content', () => {
    expect(detectLineEnding('')).toBe('\n')
  })
})

describe('detectLineEnding edge cases', () => {
  it('returns \\n for content with no newlines at all', () => {
    expect(detectLineEnding('{"name":"test"}')).toBe('\n')
  })

  it('returns \\r\\n for content with only \\r\\n', () => {
    expect(detectLineEnding('{\r\n}')).toBe('\r\n')
  })

  it('returns \\r\\n for mixed endings (prefers CRLF when present)', () => {
    // When BOTH \r\n and \n exist, detectLineEnding returns \r\n
    expect(detectLineEnding('{\r\n  "name": "test"\n}')).toBe('\r\n')
  })
})

describe('writePackage CRLF without trailing newline', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upgr-crlf-notail-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('preserves CRLF without trailing newline', () => {
    const filepath = join(tmpDir, 'package.json')
    // CRLF content, no trailing newline (ends with })
    const content =
      '{\r\n  "name": "test",\r\n  "dependencies": {\r\n    "foo": "^1.0.0"\r\n  }\r\n}'
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('\r\n')
    expect(result).not.toMatch(/[^\r]\n/)
    expect(result).toContain('"foo": "^2.0.0"')
    // Should NOT have trailing newline since original didn't
    expect(result.endsWith('}')).toBe(true)
  })
})

describe('writePackage CRLF with multiple sources', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upgr-crlf-multi-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('preserves CRLF when updating dependencies and devDependencies', () => {
    const filepath = join(tmpDir, 'package.json')
    const content =
      '{\r\n  "name": "test",\r\n  "dependencies": {\r\n    "lodash": "^4.0.0"\r\n  },\r\n  "devDependencies": {\r\n    "vitest": "^1.0.0"\r\n  }\r\n}\r\n'
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)
    const changes = [
      makeChange({ name: 'lodash', source: 'dependencies', targetVersion: '^5.0.0' }),
      makeChange({ name: 'vitest', source: 'devDependencies', targetVersion: '^2.0.0' }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('\r\n')
    expect(result).not.toMatch(/[^\r]\n/)
    expect(result).toContain('"lodash": "^5.0.0"')
    expect(result).toContain('"vitest": "^2.0.0"')
  })
})

describe('writePackage CRLF preservation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upgr-crlf-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('preserves CRLF when input has CRLF', () => {
    const filepath = join(tmpDir, 'package.json')
    const content =
      '{\r\n  "name": "test",\r\n  "dependencies": {\r\n    "foo": "^1.0.0"\r\n  }\r\n}\r\n'
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('\r\n')
    expect(result).not.toMatch(/[^\r]\n/)
    expect(result).toContain('"foo": "^2.0.0"')
  })

  it('keeps LF when input has LF', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = `${JSON.stringify({ name: 'test', dependencies: { foo: '^1.0.0' } }, null, 2)}\n`
    writeFileSync(filepath, content)

    const raw = JSON.parse(content)
    const pkg = makePkg(filepath, raw)
    const changes = [makeChange({ name: 'foo', source: 'dependencies', targetVersion: '^2.0.0' })]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).not.toContain('\r\n')
    expect(result).toContain('"foo": "^2.0.0"')
  })
})
