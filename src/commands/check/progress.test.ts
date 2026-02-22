import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageMeta, UpgrOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { createCheckProgress } from './progress'

const baseOptions = { ...DEFAULT_OPTIONS, output: 'table', loglevel: 'info' } as UpgrOptions

function makePkg(name: string, depCount: number): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath: `/tmp/${name}/package.json`,
    deps: Array.from({ length: depCount }, (_, idx) => ({
      name: `dep-${idx}`,
      currentVersion: '^1.0.0',
      source: 'dependencies',
      update: true,
      parents: [],
    })),
    resolved: [],
    raw: { name },
    indent: '  ',
  }
}

describe('createCheckProgress', () => {
  const originalIsTTY = process.stdout.isTTY
  const originalColumns = process.stdout.columns
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 })
  })

  afterEach(() => {
    writeSpy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: originalColumns })
  })

  it('returns null when progress should not be shown', () => {
    const jsonProgress = createCheckProgress({ ...baseOptions, output: 'json' }, [makePkg('a', 1)])
    const silentProgress = createCheckProgress({ ...baseOptions, loglevel: 'silent' }, [
      makePkg('a', 1),
    ])
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false })
    const nonTtyProgress = createCheckProgress(baseOptions, [makePkg('a', 1)])

    expect(jsonProgress).toBeNull()
    expect(silentProgress).toBeNull()
    expect(nonTtyProgress).toBeNull()
  })

  it('renders package and dependency bars and clears them', () => {
    const pkg = makePkg('alpha', 2)
    const progress = createCheckProgress(baseOptions, [pkg])

    expect(progress).not.toBeNull()

    progress!.onPackageStart(pkg)
    progress!.onDependencyProcessed()
    progress!.onDependencyProcessed()
    progress!.onPackageEnd()
    progress!.done()

    const output = writeSpy.mock.calls.map((call: [unknown]) => String(call[0])).join('')
    expect(output).toContain('Packages')
    expect(output).toContain('Deps (alpha)')
    expect(output).toContain('2/2')
    expect(output).toContain('\x1B[2K')
  })

  it('caps dependency progress at package totals', () => {
    const pkg = makePkg('beta', 1)
    const progress = createCheckProgress(baseOptions, [pkg])
    progress!.onPackageStart(pkg)
    progress!.onDependencyProcessed()
    progress!.onDependencyProcessed()

    const output = writeSpy.mock.calls.map((call: [unknown]) => String(call[0])).join('')
    expect(output).toContain('1/1')
    expect(output).not.toContain('2/1')

    progress!.done()
  })
})
