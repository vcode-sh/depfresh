import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { loadPackages } from './discovery'

const baseOptions = { ...DEFAULT_OPTIONS } as depfreshOptions

describe('loadPackages ignorePaths patterns', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-ignore-paths-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('skips manifests matching custom ignore path patterns', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root-app' }, null, 2))

    mkdirSync(join(tmpDir, 'apps', 'legacy'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'apps', 'legacy', 'package.json'),
      JSON.stringify({ name: 'legacy-app' }, null, 2),
    )

    mkdirSync(join(tmpDir, 'packages', 'core'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'packages', 'core', 'package.yaml'),
      ['name: core-pkg', 'dependencies:', '  ansi-styles: ^6.2.1', ''].join('\n'),
    )

    const packages = await loadPackages({
      ...baseOptions,
      cwd: tmpDir,
      recursive: true,
      ignorePaths: ['apps/**'],
      loglevel: 'silent',
    })

    const names = packages.map((pkg) => pkg.name).sort()
    expect(names).toEqual(['core-pkg', 'root-app'])
  })
})
