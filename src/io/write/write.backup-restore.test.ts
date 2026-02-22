import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageMeta } from '../../types'
import { backupPackageFiles, restorePackageFiles } from './backup'

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

describe('backupPackageFiles', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upgr-backup-'))
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
    tmpDir = mkdtempSync(join(tmpdir(), 'upgr-restore-'))
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
