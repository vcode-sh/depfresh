import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffType, ResolvedDepChange } from '../../types'
import { stripAnsi } from '../../utils/format'

const clackMock = {
  groupMultiselect: vi.fn(),
  multiselect: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}

vi.mock('@clack/prompts', () => clackMock)

const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
const setRawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode')

function setTTY(stdinTTY: boolean, stdoutTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinTTY, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: stdoutTTY, configurable: true })
}

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
    vi.resetModules()
    vi.doUnmock('./interactive')
    vi.doUnmock('./tui/index')
    clackMock.isCancel.mockReturnValue(false)
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
    setTTY(false, false)
  })

  afterAll(() => {
    if (stdinTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinTTYDescriptor)
    }
    if (stdoutTTYDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutTTYDescriptor)
    }
    if (setRawModeDescriptor) {
      Object.defineProperty(process.stdin, 'setRawMode', setRawModeDescriptor)
    }
  })

  it('uses custom TUI on full TTY and forwards explain option', async () => {
    const updates = [makeDep('a', 'major')]
    const createInteractiveTUIMock = vi.fn().mockResolvedValue(updates)
    vi.doMock('./tui/index', () => ({
      createInteractiveTUI: createInteractiveTUIMock,
    }))
    setTTY(true, true)

    const { runInteractive } = await import('./interactive')
    const result = await runInteractive(updates, { explain: true })

    expect(createInteractiveTUIMock).toHaveBeenCalledWith(updates, { explain: true })
    expect(result).toEqual(updates)
    expect(clackMock.groupMultiselect).not.toHaveBeenCalled()
  })

  it('falls back to clack when TUI setup throws on full TTY', async () => {
    const updates = [makeDep('a', 'major')]
    const createInteractiveTUIMock = vi.fn().mockRejectedValue(new Error('raw mode failed'))
    vi.doMock('./tui/index', () => ({
      createInteractiveTUI: createInteractiveTUIMock,
    }))
    clackMock.groupMultiselect.mockResolvedValue(['0'])
    setTTY(true, true)

    const { runInteractive } = await import('./interactive')
    const result = await runInteractive(updates)

    expect(createInteractiveTUIMock).toHaveBeenCalledOnce()
    expect(clackMock.groupMultiselect).toHaveBeenCalledOnce()
    expect(result).toEqual(updates)
  })

  it('falls back to clack when either stream is non-TTY', async () => {
    const updates = [makeDep('a', 'major')]
    clackMock.groupMultiselect.mockResolvedValue(['0'])
    setTTY(true, false)

    const { runInteractive } = await import('./interactive')
    const result = await runInteractive(updates, { explain: true })

    expect(clackMock.groupMultiselect).toHaveBeenCalledOnce()
    expect(result).toEqual(updates)
  })

  it('falls back to clack when raw mode is unavailable on full TTY', async () => {
    const updates = [makeDep('a', 'major')]
    clackMock.groupMultiselect.mockResolvedValue(['0'])
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    setTTY(true, true)

    const { runInteractive } = await import('./interactive')
    const result = await runInteractive(updates)

    expect(clackMock.groupMultiselect).toHaveBeenCalledOnce()
    expect(result).toEqual(updates)
  })

  it('groups deps by diff type into major, minor, patch groups', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['0', '1', '2'])

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
    clackMock.groupMultiselect.mockResolvedValue(['0', '2'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major'), makeDep('b', 'minor'), makeDep('c', 'patch')]

    const result = await runInteractive(updates)

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.name)).toEqual(['a', 'c'])
  })

  it('preserves original update order in grouped fallback even when selection order is reversed', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['2', '0'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major'), makeDep('b', 'minor'), makeDep('c', 'patch')]

    const result = await runInteractive(updates)

    expect(result).toEqual([updates[0], updates[2]])
  })

  it('preserves original update order for duplicate names in grouped mode', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['1', '0'])

    const { runInteractive } = await import('./interactive')

    const updates = [
      makeDep('shared', 'major', { source: 'dependencies' }),
      makeDep('shared', 'minor', { source: 'devDependencies' }),
    ]

    const result = await runInteractive(updates)

    expect(result).toEqual(updates)
  })

  it('selects all dependencies in a group when the group header is selected', async () => {
    clackMock.groupMultiselect.mockImplementation(
      async (input: { options: Record<string, unknown> }) => [Object.keys(input.options)[0]!],
    )

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major'), makeDep('b', 'major'), makeDep('c', 'minor')]

    const result = await runInteractive(updates)

    expect(result).toEqual([updates[0], updates[1]])
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
    clackMock.groupMultiselect.mockResolvedValue(['0', '1'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('a', 'major'), makeDep('b', 'major')]

    await runInteractive(updates)

    const call = clackMock.groupMultiselect.mock.calls[0]![0]
    const groupKeys = Object.keys(call.options)

    expect(groupKeys).toHaveLength(1)
    expect(stripAnsi(groupKeys[0]!)).toBe('major')
  })

  it('preserves group order: major first, then minor, then patch', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['0', '1', '2'])

    const { runInteractive } = await import('./interactive')

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
    clackMock.multiselect.mockResolvedValue(['0'])

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('err-pkg', 'error'), makeDep('none-pkg', 'none')]

    const result = await runInteractive(updates)

    expect(clackMock.multiselect).toHaveBeenCalledOnce()
    expect(clackMock.groupMultiselect).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('err-pkg')
  })

  it('returns empty array on cancel in flat fallback', async () => {
    clackMock.isCancel.mockReturnValue(true)
    clackMock.multiselect.mockResolvedValue(Symbol('cancel'))

    const { runInteractive } = await import('./interactive')

    const updates = [makeDep('err-pkg', 'error')]
    const result = await runInteractive(updates)

    expect(result).toEqual([])
    expect(clackMock.cancel).toHaveBeenCalledWith('Update cancelled')
  })

  it('preserves original update order in flat fallback even when selection order is reversed', async () => {
    clackMock.multiselect.mockResolvedValue(['2', '0'])

    const { runInteractive } = await import('./interactive')

    const updates = [
      makeDep('err-pkg', 'error'),
      makeDep('mid-pkg', 'none'),
      makeDep('late-pkg', 'none'),
    ]

    const result = await runInteractive(updates)

    expect(result).toEqual([updates[0], updates[2]])
  })

  it('keeps duplicate package names independently selectable in grouped mode', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['1'])

    const { runInteractive } = await import('./interactive')

    const updates = [
      makeDep('shared', 'major', { source: 'dependencies' }),
      makeDep('shared', 'minor', { source: 'devDependencies' }),
    ]

    const result = await runInteractive(updates)

    expect(result).toEqual([updates[1]])
  })

  it('keeps duplicate package names independently selectable in flat mode', async () => {
    clackMock.multiselect.mockResolvedValue(['1'])

    const { runInteractive } = await import('./interactive')

    const updates = [
      makeDep('shared', 'error', { source: 'dependencies' }),
      makeDep('shared', 'none', { source: 'devDependencies' }),
    ]

    const result = await runInteractive(updates)

    expect(result).toEqual([updates[1]])
  })

  it('preserves original update order for duplicate names in flat mode', async () => {
    clackMock.multiselect.mockResolvedValue(['1', '0'])

    const { runInteractive } = await import('./interactive')

    const updates = [
      makeDep('shared', 'error', { source: 'dependencies' }),
      makeDep('shared', 'none', { source: 'devDependencies' }),
    ]

    const result = await runInteractive(updates)

    expect(result).toEqual(updates)
  })

  it('handles single group (only minor updates)', async () => {
    clackMock.groupMultiselect.mockResolvedValue(['0', '1'])

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
