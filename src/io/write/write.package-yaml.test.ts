import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import YAML from 'yaml'
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
  raw: unknown,
  overrides: Partial<PackageMeta> = {},
): PackageMeta {
  return {
    name: 'test-project',
    type: 'package.yaml',
    filepath,
    deps: [],
    resolved: [],
    raw,
    indent: '  ',
    ...overrides,
  }
}

describe('writePackage package.yaml', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-write-yaml-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates dependencies and devDependencies', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content = [
      'name: test',
      'dependencies:',
      '  lodash: ^4.0.0',
      'devDependencies:',
      '  vitest: ^1.0.0',
      '',
    ].join('\n')
    writeFileSync(filepath, content, 'utf-8')

    const pkg = makePkg(filepath, YAML.parseDocument(content))
    const changes = [
      makeChange({ name: 'lodash', source: 'dependencies', targetVersion: '^5.0.0' }),
      makeChange({ name: 'vitest', source: 'devDependencies', targetVersion: '^2.0.0' }),
    ]

    writePackage(pkg, changes, 'silent')

    const parsed = YAML.parse(readFileSync(filepath, 'utf-8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(parsed.dependencies.lodash).toBe('^5.0.0')
    expect(parsed.devDependencies.vitest).toBe('^2.0.0')
  })

  it('updates overrides and pnpm.overrides', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content = [
      'name: test',
      'overrides:',
      '  sharp: 0.33.0',
      'pnpm:',
      '  overrides:',
      '    esbuild: 0.19.0',
      '',
    ].join('\n')
    writeFileSync(filepath, content, 'utf-8')

    const pkg = makePkg(filepath, YAML.parseDocument(content))
    const changes = [
      makeChange({ name: 'sharp', source: 'overrides', targetVersion: '0.34.0', diff: 'minor' }),
      makeChange({
        name: 'esbuild',
        source: 'pnpm.overrides',
        targetVersion: '0.20.0',
        diff: 'minor',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const parsed = YAML.parse(readFileSync(filepath, 'utf-8')) as {
      overrides: Record<string, string>
      pnpm: { overrides: Record<string, string> }
    }
    expect(parsed.overrides.sharp).toBe('0.34.0')
    expect(parsed.pnpm.overrides.esbuild).toBe('0.20.0')
  })

  it('updates peerDependencies, optionalDependencies, and resolutions', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content = [
      'name: test',
      'peerDependencies:',
      '  react: ^18.0.0',
      'optionalDependencies:',
      '  dayjs: ^1.10.0',
      'resolutions:',
      '  lodash: ^4.17.20',
      '',
    ].join('\n')
    writeFileSync(filepath, content, 'utf-8')

    const pkg = makePkg(filepath, YAML.parseDocument(content))
    const changes = [
      makeChange({ name: 'react', source: 'peerDependencies', targetVersion: '^19.0.0' }),
      makeChange({ name: 'dayjs', source: 'optionalDependencies', targetVersion: '^1.11.19' }),
      makeChange({ name: 'lodash', source: 'resolutions', targetVersion: '^4.17.23' }),
    ]

    writePackage(pkg, changes, 'silent')

    const parsed = YAML.parse(readFileSync(filepath, 'utf-8')) as {
      peerDependencies: Record<string, string>
      optionalDependencies: Record<string, string>
      resolutions: Record<string, string>
    }
    expect(parsed.peerDependencies.react).toBe('^19.0.0')
    expect(parsed.optionalDependencies.dayjs).toBe('^1.11.19')
    expect(parsed.resolutions.lodash).toBe('^4.17.23')
  })

  it('preserves npm: and jsr: protocol prefixes', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content = [
      'name: test',
      'dependencies:',
      '  my-lodash: npm:lodash@^1.0.0',
      '  my-pkg: jsr:@scope/name@^1.0.0',
      '',
    ].join('\n')
    writeFileSync(filepath, content, 'utf-8')

    const pkg = makePkg(filepath, YAML.parseDocument(content))
    const changes = [
      makeChange({ name: 'my-lodash', source: 'dependencies', targetVersion: '^2.0.0' }),
      makeChange({ name: 'my-pkg', source: 'dependencies', targetVersion: '^3.0.0' }),
    ]

    writePackage(pkg, changes, 'silent')

    const parsed = YAML.parse(readFileSync(filepath, 'utf-8')) as {
      dependencies: Record<string, string>
    }
    expect(parsed.dependencies['my-lodash']).toBe('npm:lodash@^2.0.0')
    expect(parsed.dependencies['my-pkg']).toBe('jsr:@scope/name@^3.0.0')
  })

  it('updates packageManager and keeps hash suffix', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content = ['name: test', 'packageManager: pnpm@9.0.0+sha512.deadbeef', ''].join('\n')
    writeFileSync(filepath, content, 'utf-8')

    const pkg = makePkg(filepath, YAML.parseDocument(content), {
      packageManager: {
        name: 'pnpm',
        version: '9.0.0',
        hash: 'sha512.deadbeef',
        raw: 'pnpm@9.0.0+sha512.deadbeef',
      },
    })
    const changes = [
      makeChange({
        name: 'pnpm',
        source: 'packageManager',
        currentVersion: '9.0.0',
        targetVersion: '10.0.0',
      }),
    ]

    writePackage(pkg, changes, 'silent')

    const parsed = YAML.parse(readFileSync(filepath, 'utf-8')) as { packageManager: string }
    expect(parsed.packageManager).toBe('pnpm@10.0.0+sha512.deadbeef')
  })

  it('preserves CRLF and no trailing newline', () => {
    const filepath = join(tmpDir, 'package.yaml')
    const content =
      'name: test\r\ndependencies:\r\n  lodash: ^4.0.0\r\ndevDependencies:\r\n  vitest: ^1.0.0'
    writeFileSync(filepath, content, 'utf-8')

    const pkg = makePkg(filepath, YAML.parseDocument(content))
    const changes = [
      makeChange({ name: 'lodash', source: 'dependencies', targetVersion: '^5.0.0' }),
      makeChange({ name: 'vitest', source: 'devDependencies', targetVersion: '^2.0.0' }),
    ]

    writePackage(pkg, changes, 'silent')

    const result = readFileSync(filepath, 'utf-8')
    expect(result).toContain('\r\n')
    expect(result).not.toMatch(/[^\r]\n/)
    expect(result.endsWith('\n')).toBe(false)
    expect(result).toContain('lodash: ^5.0.0')
    expect(result).toContain('vitest: ^2.0.0')
  })
})
