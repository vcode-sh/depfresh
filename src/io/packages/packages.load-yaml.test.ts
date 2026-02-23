import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS } as depfreshOptions

describe('loadPackages YAML manifests', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-packages-yaml-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds root package.yaml', async () => {
    writeFileSync(
      join(tmpDir, 'package.yaml'),
      ['name: yaml-root', 'dependencies:', '  lodash: ^4.17.21', ''].join('\n'),
    )

    const packages = await loadPackages({ ...baseOptions, cwd: tmpDir, loglevel: 'silent' })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.type).toBe('package.yaml')
    expect(packages[0]?.name).toBe('yaml-root')
  })

  it('finds nested package.yaml files with recursive option', async () => {
    writeFileSync(join(tmpDir, 'package.yaml'), ['name: root', ''].join('\n'))
    mkdirSync(join(tmpDir, 'packages', 'sub'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'sub', 'package.yaml'),
      ['name: sub-yaml', 'dependencies:', '  dayjs: ^1.11.0', ''].join('\n'),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      recursive: true,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(2)
    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(['root', 'sub-yaml'])
  })

  it('prefers package.yaml over package.json in the same directory', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'json-project', dependencies: { react: '^18.0.0' } }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'package.yaml'),
      ['name: yaml-project', 'dependencies:', '  vue: ^3.4.0', ''].join('\n'),
    )

    const packages = await loadPackages({ ...baseOptions, cwd: tmpDir, loglevel: 'silent' })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.type).toBe('package.yaml')
    expect(packages[0]?.name).toBe('yaml-project')
    expect(packages[0]?.deps.some((dep) => dep.name === 'vue')).toBe(true)
    expect(packages[0]?.deps.some((dep) => dep.name === 'react')).toBe(false)
  })

  it('handles malformed package.yaml gracefully', async () => {
    writeFileSync(join(tmpDir, 'package.yaml'), 'name: [invalid')

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(0)
  })

  it('parses packageManager field from package.yaml', async () => {
    writeFileSync(
      join(tmpDir, 'package.yaml'),
      ['name: test', 'packageManager: pnpm@9.0.0+sha512.deadbeef', ''].join('\n'),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })

    expect(packages[0]?.packageManager).toEqual({
      name: 'pnpm',
      version: '9.0.0',
      hash: 'sha512.deadbeef',
      raw: 'pnpm@9.0.0+sha512.deadbeef',
    })
  })

  it('parses overrides and pnpm.overrides from package.yaml', async () => {
    writeFileSync(
      join(tmpDir, 'package.yaml'),
      [
        'name: test',
        'dependencies:',
        '  lodash: ^4.17.21',
        'overrides:',
        '  sharp: 0.33.0',
        'pnpm:',
        '  overrides:',
        '    esbuild: 0.19.0',
        '',
      ].join('\n'),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      loglevel: 'silent',
    })

    expect(packages).toHaveLength(1)
    const depNames = packages[0]!.deps.map((dep) => `${dep.source}:${dep.name}`).sort()
    expect(depNames).toEqual(['dependencies:lodash', 'overrides:sharp', 'pnpm.overrides:esbuild'])
  })
})
