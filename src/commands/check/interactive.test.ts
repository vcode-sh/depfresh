import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffType, ResolvedDepChange } from '../../types'
import { stripAnsi } from '../../utils/format'

const clackMock = {
  groupMultiselect: vi.fn(),
  multiselect: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}

vi.mock('@clack/prompts', () => clackMock)

function makeDep(
  name: string,
  diff: DiffType,
  overrides: Partial<ResolvedDepChange> = {},
): ResolvedDepChange {
  return {
    name,
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff,
    pkgData: {
      name,
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    },
    ...overrides,
  }
}

describe('runInteractive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clackMock.isCancel.mockReturnValue(false)
  })

  it('groups deps by diff type into major, minor, patch groups', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['a', 'b', 'c'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major'), makeDep('b', 'minor'), makeDep('c', 'patch')]

    await runInteractive(updates)

    expect(clackMock.groupMultiselect).toHaveBeenCalledOnce()
    const call = clackMock.groupMultiselect.mock.calls[0]![0]
    const groupKeys = Object.keys(call.options)

    expect(groupKeys).toHaveLength(3)
    expect(stripAnsi(groupKeys[0]!)).toBe('major')
    expect(stripAnsi(groupKeys[1]!)).toBe('minor')
    expect(stripAnsi(groupKeys[2]!)).toBe('patch')
  })

  it('returns selected deps from groupMultiselect', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['a', 'c'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major'), makeDep('b', 'minor'), makeDep('c', 'patch')]

    const result = await runInteractive(updates)

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.name)).toEqual(['a', 'c'])
  })

  it('returns empty array on cancel', async () => {
    clackMock.isCancel.mockReturnValue(true)
    clackMock.groupMultiselect.mockResolvedValue(Symbol('cancel'))

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major')]
    const result = await runInteractive(updates)

    expect(result).toEqual([])
    expect(clackMock.cancel).toHaveBeenCalledWith('Update cancelled')
  })

  it('omits empty groups', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['a', 'b'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major'), makeDep('b', 'major')]

    await runInteractive(updates)

    const call = clackMock.groupMultiselect.mock.calls[0]![0]
    const groupKeys = Object.keys(call.options)

    expect(groupKeys).toHaveLength(1)
    expect(stripAnsi(groupKeys[0]!)).toBe('major')
  })

  it('preserves group order: major first, then minor, then patch', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['c', 'b', 'a'])

    const { runInteractive } = await import('./interactive')

    // Pass in reverse order to verify sorting
    const updates = [makeDep('c', 'patch'), makeDep('b', 'minor'), makeDep('a', 'major')]

    await runInteractive(updates)

    const call = clackMock.groupMultiselect.mock.calls[0]![0]
    const groupKeys = Object.keys(call.options).map(stripAnsi)

    expect(groupKeys).toEqual(['major', 'minor', 'patch'])
  })

  it('shows deprecated hint in options', async () => {
    clackMock.groupMultiselect.mockResolvedValue([])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('old-pkg', 'major', { deprecated: 'Use new-pkg instead' })]

    await runInteractive(updates)

    const call = clackMock.groupMultiselect.mock.calls[0]![0]
    const groupKeys = Object.keys(call.options)
    const options = call.options[groupKeys[0]!]

    expect(options[0]!.hint).toBeDefined()
    expect(stripAnsi(options[0]!.hint)).toBe('deprecated')
  })

  it('falls back to flat multiselect when no standard diffs', async () => {
    clackMock.multiselect.mockResolvedValue(['err-pkg'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('err-pkg', 'error'), makeDep('none-pkg', 'none')]

    const result = await runInteractive(updates)

    expect(clackMock.multiselect).toHaveBeenCalledOnce()
    expect(clackMock.groupMultiselect).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('err-pkg')
  })

  it('handles single group (only minor updates)', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['x', 'y'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('x', 'minor'), makeDep('y', 'minor')]

    await runInteractive(updates)

    const call = clackMock.groupMultiselect.mock.calls[0]![0]
    const groupKeys = Object.keys(call.options)

    expect(groupKeys).toHaveLength(1)
    expect(stripAnsi(groupKeys[0]!)).toBe('minor')
    expect(call.options[groupKeys[0]!]).toHaveLength(2)
    expect(call.selectableGroups).toBe(true)
  })
})
