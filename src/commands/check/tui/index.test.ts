import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DepFieldType, ResolvedDepChange } from '../../../types'
import { createInteractiveTUI } from './index'

function makeDep(name: string, source: DepFieldType = 'dependencies'): ResolvedDepChange {
  return {
    name,
    currentVersion: '^1.0.0',
    source,
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: {
      name,
      versions: ['1.0.0', '1.1.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    },
  }
}

describe('createInteractiveTUI', () => {
  const setRawModeMock = vi.fn()
  const pauseMock = vi.fn()
  const resumeMock = vi.fn()
  let writeSpy: ReturnType<typeof vi.spyOn>
  let originalSetRawMode: ((mode: boolean) => void) | undefined
  let originalPause: (() => void) | undefined
  let originalResume: (() => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    originalSetRawMode = (process.stdin as { setRawMode?: (mode: boolean) => void }).setRawMode
    originalPause = process.stdin.pause.bind(process.stdin)
    originalResume = process.stdin.resume.bind(process.stdin)

    Object.defineProperty(process.stdin, 'setRawMode', {
      value: setRawModeMock,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(process.stdin, 'pause', {
      value: pauseMock,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(process.stdin, 'resume', {
      value: resumeMock,
      configurable: true,
      writable: true,
    })

    Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true, writable: true })
    Object.defineProperty(process.stdout, 'columns', {
      value: 100,
      configurable: true,
      writable: true,
    })

    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    writeSpy.mockRestore()
    if (originalSetRawMode) {
      Object.defineProperty(process.stdin, 'setRawMode', {
        value: originalSetRawMode,
        configurable: true,
        writable: true,
      })
    }
    Object.defineProperty(process.stdin, 'pause', {
      value: originalPause,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(process.stdin, 'resume', {
      value: originalResume,
      configurable: true,
      writable: true,
    })
    vi.restoreAllMocks()
  })

  it('returns empty array immediately for empty updates', async () => {
    const result = await createInteractiveTUI([], { explain: false })
    expect(result).toEqual([])
    expect(setRawModeMock).not.toHaveBeenCalled()
  })

  it('returns selected updates on confirm', async () => {
    const dep = makeDep('alpha')
    const promise = createInteractiveTUI([dep], { explain: false })

    process.stdin.emit('keypress', '', { name: 'space' })
    process.stdin.emit('keypress', '\r', { name: 'return' })

    const result = await promise
    expect(result).toEqual([dep])
    expect(setRawModeMock).toHaveBeenCalledWith(true)
    expect(setRawModeMock).toHaveBeenCalledWith(false)
    expect(writeSpy).toHaveBeenCalled()
  })

  it('returns all updates when toggling all and confirming immediately', async () => {
    const updates = [
      makeDep('alpha', 'dependencies'),
      makeDep('beta', 'devDependencies'),
      makeDep('gamma', 'peerDependencies'),
    ]
    const promise = createInteractiveTUI(updates, { explain: false })

    process.stdin.emit('keypress', 'a', { name: 'a' })
    process.stdin.emit('keypress', '\r', { name: 'return' })

    const result = await promise
    expect(result).toEqual(updates)
  })

  it('keeps duplicate package names independently selectable', async () => {
    const updates = [makeDep('shared', 'dependencies'), makeDep('shared', 'devDependencies')]
    const promise = createInteractiveTUI(updates, { explain: false })

    process.stdin.emit('keypress', ' ', { name: 'space' })
    process.stdin.emit('keypress', '\r', { name: 'return' })

    const result = await promise
    expect(result).toEqual([updates[0]])
  })

  it('returns empty array on cancel', async () => {
    const dep = makeDep('alpha')
    const promise = createInteractiveTUI([dep], { explain: false })

    process.stdin.emit('keypress', '', { name: 'escape' })

    const result = await promise
    expect(result).toEqual([])
  })

  it('supports selecting a version in detail view before confirm', async () => {
    const dep = makeDep('alpha')
    const promise = createInteractiveTUI([dep], { explain: false })

    process.stdin.emit('keypress', '', { name: 'right' })
    process.stdin.emit('keypress', '', { name: 'down' })
    process.stdin.emit('keypress', '\r', { name: 'return' })
    process.stdin.emit('keypress', '\r', { name: 'return' })

    const result = await promise
    expect(result).toEqual([dep])
    expect(dep.targetVersion).toBe('^1.1.0')
    expect(dep.diff).toBe('minor')
  })

  it('handles resize events without crashing', async () => {
    const dep = makeDep('alpha')
    const promise = createInteractiveTUI([dep], { explain: false })

    process.stdout.emit('resize')
    process.stdin.emit('keypress', '', { name: 'escape' })

    const result = await promise
    expect(result).toEqual([])
  })
})
