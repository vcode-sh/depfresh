import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageMeta, ResolvedDepChange } from '../types'
import { backupPackageFiles, detectLineEnding, restorePackageFiles, writePackage } from './write'

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

describe('backupPackageFiles', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-backup-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('captures main file content', () => {
    const filepath = join(tmpDir, 'package.json')
    const content = '{"name": "test", "version": "1.0.0"}\n'
    writeFileSync(filepath, content)

    const pkg = makePkg(filepath, JSON.parse(content))
    const backups = backupPackageFiles(pkg)

    expect(backups).toHaveLength(1)
    expect(backups[0]!.filepath).toBe(filepath)
    expect(backups[0]!.content).toBe(content)
  })

  it('captures catalog files when present', () => {
    const filepath = join(tmpDir, 'package.json')
    const catalogPath = join(tmpDir, 'pnpm-workspace.yaml')
    const content = '{"name": "test"}\n'
    const catalogContent = 'catalog:\n  lodash: ^4.0.0\n'
    writeFileSync(filepath, content)
    writeFileSync(catalogPath, catalogContent)

    const pkg = makePkg(filepath, JSON.parse(content), {
      catalogs: [
        {
          type: 'pnpm',
          name: 'default',
          filepath: catalogPath,
          deps: [],
          raw: {},
          indent: '  ',
        },
      ],
    })

    const backups = backupPackageFiles(pkg)

    expect(backups).toHaveLength(2)
    expect(backups[0]!.filepath).toBe(filepath)
    expect(backups[0]!.content).toBe(content)
    expect(backups[1]!.filepath).toBe(catalogPath)
    expect(backups[1]!.content).toBe(catalogContent)
  })
})

describe('restorePackageFiles', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-restore-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('restores content correctly', () => {
    const filepath = join(tmpDir, 'package.json')
    const originalContent = '{"name": "test", "version": "1.0.0"}\n'
    writeFileSync(filepath, originalContent)

    // Overwrite with different content
    writeFileSync(filepath, '{"name": "modified"}\n')

    restorePackageFiles([{ filepath, content: originalContent }])

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toBe(originalContent)
  })

  it('handles multiple files', () => {
    const filepath1 = join(tmpDir, 'package.json')
    const filepath2 = join(tmpDir, 'workspace.yaml')
    const content1 = '{"name": "test"}\n'
    const content2 = 'catalog:\n  lodash: ^4.0.0\n'
    writeFileSync(filepath1, content1)
    writeFileSync(filepath2, content2)

    // Overwrite both
    writeFileSync(filepath1, '{"modified": true}\n')
    writeFileSync(filepath2, 'modified: true\n')

    restorePackageFiles([
      { filepath: filepath1, content: content1 },
      { filepath: filepath2, content: content2 },
    ])

    expect(readFileSync(filepath1, 'utf-8')).toBe(content1)
    expect(readFileSync(filepath2, 'utf-8')).toBe(content2)
  })
})

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
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-crlf-notail-'))
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
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-crlf-multi-'))
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

describe('writePackage CRLF with npm: protocol', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-crlf-proto-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
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

describe('writePackage CRLF preservation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bump-crlf-'))
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
