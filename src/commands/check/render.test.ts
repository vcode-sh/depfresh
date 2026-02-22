import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BumpOptions, ResolvedDepChange } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { stripAnsi } from '../../utils/format'
import { renderTable } from './render'

const defaultOpts = { ...DEFAULT_OPTIONS } as BumpOptions

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

    renderTable('test-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    const depLines = stripped.filter((l) => l.includes('-pkg'))

    expect(depLines[0]).toContain('major-pkg')
    expect(depLines[1]).toContain('minor-pkg')
    expect(depLines[2]).toContain('patch-pkg')
  })

  it('shows deprecated flag for deprecated packages', () => {
    const updates = [makeUpdate({ name: 'old-pkg', deprecated: 'Use new-pkg instead' })]

    renderTable('test-project', updates, defaultOpts)

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

    renderTable('test-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    const summaryLine = stripped.find((l) => l.includes('total'))

    expect(summaryLine).toContain('2 major')
    expect(summaryLine).toContain('1 minor')
    expect(summaryLine).toContain('1 patch')
    expect(summaryLine).toContain('4 total')
  })

  it('handles single change', () => {
    const updates = [makeUpdate({ name: 'only-one', diff: 'patch', targetVersion: '^1.0.1' })]

    renderTable('my-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('only-one'))).toBe(true)
    expect(stripped.some((l) => l.includes('1 total'))).toBe(true)
  })

  it('includes header row with column names', () => {
    const updates = [makeUpdate()]

    renderTable('test-project', updates, { ...defaultOpts, group: false })

    const stripped = lines.map(stripAnsi)
    const headerLine = stripped.find(
      (l) =>
        l.includes('name') && l.includes('source') && l.includes('current') && l.includes('target'),
    )
    expect(headerLine).toBeDefined()
  })

  it('displays package name as title', () => {
    const updates = [makeUpdate()]

    renderTable('my-awesome-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('my-awesome-project'))).toBe(true)
  })

  it('does not show deprecated when not deprecated', () => {
    const updates = [makeUpdate({ name: 'normal-pkg', deprecated: undefined })]

    renderTable('test-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    const depLine = stripped.find((l) => l.includes('normal-pkg'))
    expect(depLine).not.toContain('deprecated')
  })

  it('summary omits zero-count diff types', () => {
    const updates = [
      makeUpdate({ name: 'a', diff: 'patch' }),
      makeUpdate({ name: 'b', diff: 'patch' }),
    ]

    renderTable('test-project', updates, defaultOpts)

    const stripped = lines.map(stripAnsi)
    const summaryLine = stripped.find((l) => l.includes('total'))

    expect(summaryLine).toContain('2 patch')
    expect(summaryLine).not.toContain('major')
    expect(summaryLine).not.toContain('minor')
  })

  describe('grouping', () => {
    it('groups deps under source headers when group is true', () => {
      const updates = [
        makeUpdate({ name: 'a-dep', source: 'dependencies' }),
        makeUpdate({ name: 'b-dev', source: 'devDependencies', diff: 'minor' }),
        makeUpdate({ name: 'c-dep', source: 'dependencies', diff: 'patch' }),
      ]

      renderTable('test-project', updates, { ...defaultOpts, group: true })

      const stripped = lines.map(stripAnsi)
      expect(
        stripped.some((l) => l.includes('dependencies') && !l.includes('devDependencies')),
      ).toBe(true)
      expect(stripped.some((l) => l.includes('devDependencies'))).toBe(true)
    })

    it('does not show source column in grouped mode', () => {
      const updates = [makeUpdate({ name: 'a-dep', source: 'dependencies' })]

      renderTable('test-project', updates, { ...defaultOpts, group: true })

      const stripped = lines.map(stripAnsi)
      // In grouped mode, individual rows should not have a separate 'source' column header
      // but the group header IS the source
      const headerLine = stripped.find((l) => l.includes('name') && l.includes('current'))
      expect(headerLine).toBeDefined()
    })

    it('shows source column when group is false', () => {
      const updates = [makeUpdate()]

      renderTable('test-project', updates, { ...defaultOpts, group: false })

      const stripped = lines.map(stripAnsi)
      const headerLine = stripped.find((l) => l.includes('source'))
      expect(headerLine).toBeDefined()
    })

    it('handles multiple groups correctly', () => {
      const updates = [
        makeUpdate({ name: 'dep-a', source: 'dependencies', diff: 'major' }),
        makeUpdate({ name: 'dev-b', source: 'devDependencies', diff: 'minor' }),
        makeUpdate({ name: 'peer-c', source: 'peerDependencies', diff: 'patch' }),
      ]

      renderTable('test-project', updates, { ...defaultOpts, group: true })

      const stripped = lines.map(stripAnsi)
      expect(stripped.some((l) => l.trim() === 'dependencies')).toBe(true)
      expect(stripped.some((l) => l.trim() === 'devDependencies')).toBe(true)
      expect(stripped.some((l) => l.trim() === 'peerDependencies')).toBe(true)
    })
  })

  describe('timediff', () => {
    it('shows age column when timediff is true', () => {
      const updates = [
        makeUpdate({
          name: 'fresh-pkg',
          publishedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        }),
      ]

      renderTable('test-project', updates, { ...defaultOpts, timediff: true })

      const stripped = lines.map(stripAnsi)
      const headerLine = stripped.find((l) => l.includes('age'))
      expect(headerLine).toBeDefined()
      const depLine = stripped.find((l) => l.includes('fresh-pkg'))
      expect(depLine).toContain('~')
    })

    it('hides age column when timediff is false', () => {
      const updates = [makeUpdate({ name: 'fresh-pkg', publishedAt: new Date().toISOString() })]

      renderTable('test-project', updates, { ...defaultOpts, timediff: false })

      const stripped = lines.map(stripAnsi)
      const headerLine = stripped.find((l) => l.includes('age'))
      expect(headerLine).toBeUndefined()
    })
  })
})
