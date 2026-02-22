import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderTable } from '../src/commands/check/render'
import type { ResolvedDepChange } from '../src/types'
import { stripAnsi } from '../src/utils/format'

function makeUpdate(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
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

describe('renderTable', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let lines: string[]

  beforeEach(() => {
    lines = []
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('sorts by diff type (major first, then minor, then patch)', () => {
    const updates = [
      makeUpdate({ name: 'patch-pkg', diff: 'patch', targetVersion: '^1.0.1' }),
      makeUpdate({ name: 'major-pkg', diff: 'major', targetVersion: '^2.0.0' }),
      makeUpdate({ name: 'minor-pkg', diff: 'minor', targetVersion: '^1.1.0' }),
    ]

    renderTable('test-project', updates)

    const stripped = lines.map(stripAnsi)
    const depLines = stripped.filter((l) => l.includes('-pkg'))

    expect(depLines[0]).toContain('major-pkg')
    expect(depLines[1]).toContain('minor-pkg')
    expect(depLines[2]).toContain('patch-pkg')
  })

  it('shows deprecated flag for deprecated packages', () => {
    const updates = [makeUpdate({ name: 'old-pkg', deprecated: 'Use new-pkg instead' })]

    renderTable('test-project', updates)

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('old-pkg'))
    expect(depLine).toContain('(deprecated)')
  })

  it('summary line counts major/minor/patch correctly', () => {
    const updates = [
      makeUpdate({ name: 'a', diff: 'major' }),
      makeUpdate({ name: 'b', diff: 'major' }),
      makeUpdate({ name: 'c', diff: 'minor' }),
      makeUpdate({ name: 'd', diff: 'patch' }),
    ]

    renderTable('test-project', updates)

    const stripped = lines.map(stripAnsi)
    const summaryLine = stripped.find((l) => l.includes('total'))

    expect(summaryLine).toContain('2 major')
    expect(summaryLine).toContain('1 minor')
    expect(summaryLine).toContain('1 patch')
    expect(summaryLine).toContain('4 total')
  })

  it('handles single change', () => {
    const updates = [makeUpdate({ name: 'only-one', diff: 'patch', targetVersion: '^1.0.1' })]

    renderTable('my-project', updates)

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('only-one'))).toBe(true)
    expect(stripped.some((l) => l.includes('1 total'))).toBe(true)
  })

  it('includes header row with column names', () => {
    const updates = [makeUpdate()]

    renderTable('test-project', updates)

    const stripped = lines.map(stripAnsi)
    const headerLine = stripped.find(
      (l) =>
        l.includes('name') && l.includes('source') && l.includes('current') && l.includes('target'),
    )
    expect(headerLine).toBeDefined()
  })

  it('displays package name as title', () => {
    const updates = [makeUpdate()]

    renderTable('my-awesome-project', updates)

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('my-awesome-project'))).toBe(true)
  })

  it('does not show deprecated when not deprecated', () => {
    const updates = [makeUpdate({ name: 'normal-pkg', deprecated: undefined })]

    renderTable('test-project', updates)

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('normal-pkg'))
    expect(depLine).not.toContain('deprecated')
  })

  it('summary omits zero-count diff types', () => {
    const updates = [
      makeUpdate({ name: 'a', diff: 'patch' }),
      makeUpdate({ name: 'b', diff: 'patch' }),
    ]

    renderTable('test-project', updates)

    const stripped = lines.map(stripAnsi)
    const summaryLine = stripped.find((l) => l.includes('total'))

    expect(summaryLine).toContain('2 patch')
    expect(summaryLine).not.toContain('major')
    expect(summaryLine).not.toContain('minor')
  })
})
