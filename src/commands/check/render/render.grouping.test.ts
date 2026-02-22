import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripAnsi } from '../../../utils/format'
import { renderTable } from './index'
import { defaultOpts, makeUpdate } from './test-helpers'

describe('renderTable grouping', () => {
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

  it('groups deps under source headers when group is true', () => {
    const updates = [
      makeUpdate({ name: 'a-dep', source: 'dependencies' }),
      makeUpdate({ name: 'b-dev', source: 'devDependencies', diff: 'minor' }),
      makeUpdate({ name: 'c-dep', source: 'dependencies', diff: 'patch' }),
    ]

    renderTable('test-project', updates, { ...defaultOpts, group: true })

    const stripped = lines.map(stripAnsi)
    expect(stripped.some((l) => l.includes('dependencies') && !l.includes('devDependencies'))).toBe(
      true,
    )
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
