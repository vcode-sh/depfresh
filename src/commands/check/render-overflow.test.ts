import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions, ResolvedDepChange } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { stripAnsi, visualLength } from '../../utils/format'
import { renderTable } from './render'

const baseOptions = { ...DEFAULT_OPTIONS, group: false } as depfreshOptions

function makeUpdate(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'really-long-package-name-for-overflow-checking',
    currentVersion: '^1.0.0-very-long-build-metadata',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0-very-long-build-metadata',
    diff: 'major',
    pkgData: { name: 'pkg', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  }
}

describe('render overflow handling', () => {
  let lines: string[]
  let consoleSpy: ReturnType<typeof vi.spyOn>
  const originalIsTTY = process.stdout.isTTY
  const originalColumns = process.stdout.columns

  beforeEach(() => {
    lines = []
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: originalColumns })
  })

  it('truncates table rows when terminal columns are narrow', () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 62 })

    renderTable('workspace-with-a-long-name', [makeUpdate()], baseOptions)

    const row = lines.map(stripAnsi).find((l) => l.includes(' -> ') && l.includes('major'))
    expect(row).toBeDefined()
    expect(visualLength(row!)).toBeLessThanOrEqual(62)
    expect(row).toContain('…')
  })

  it('does not force truncation when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 40 })

    const depName = 'very-very-long-name-that-should-stay-complete'
    renderTable('project', [makeUpdate({ name: depName })], baseOptions)

    const row = lines.map(stripAnsi).find((l) => l.includes(depName))
    expect(row).toBeDefined()
    expect(row).not.toContain('…')
  })
})
