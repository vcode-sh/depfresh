import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
const stdoutRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'rows')
const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns')

function setTTY(stdinTTY: boolean, stdoutTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinTTY, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: stdoutTTY, configurable: true })
}

describe('interactive selection integration', () => {
  let mocks: CheckMocks
  let originalSetRawMode: ((mode: boolean) => void) | undefined
  let originalPause: (() => void) | undefined
  let originalResume: (() => void) | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()

    originalSetRawMode = (process.stdin as { setRawMode?: (mode: boolean) => void }).setRawMode
    originalPause = process.stdin.pause.bind(process.stdin)
    originalResume = process.stdin.resume.bind(process.stdin)

    Object.defineProperty(process.stdin, 'setRawMode', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
    Object.defineProperty(process.stdin, 'pause', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
    Object.defineProperty(process.stdin, 'resume', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })

    Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true, writable: true })
    Object.defineProperty(process.stdout, 'columns', {
      value: 100,
      configurable: true,
      writable: true,
    })
    setTTY(true, true)
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: originalSetRawMode,
      configurable: true,
      writable: true,
    })
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
    if (stdinTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinTTYDescriptor)
    }
    if (stdoutTTYDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutTTYDescriptor)
    }
    if (stdoutRowsDescriptor) {
      Object.defineProperty(process.stdout, 'rows', stdoutRowsDescriptor)
    }
    if (stdoutColumnsDescriptor) {
      Object.defineProperty(process.stdout, 'columns', stdoutColumnsDescriptor)
    }

    vi.restoreAllMocks()
  })

  it('writes every selected dependency after toggle-all and immediate confirm', async () => {
    const pkg = makePkg('my-app')
    const updates = [
      makeResolved({ name: 'dep-a', source: 'dependencies', diff: 'major' }),
      makeResolved({ name: 'dep-b', source: 'devDependencies', diff: 'minor' }),
      makeResolved({ name: 'dep-c', source: 'peerDependencies', diff: 'patch' }),
    ]

    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue(updates)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    let sentKeys = false

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      if (!sentKeys && text.includes('\u001B[?25l')) {
        sentKeys = true
        queueMicrotask(() => {
          process.stdin.emit('keypress', 'a', { name: 'a' })
          process.stdin.emit('keypress', '\r', { name: 'return' })
        })
      }
      return true
    })

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, interactive: true })

    expect(result).toBe(0)
    expect(sentKeys).toBe(true)
    expect(mocks.writePackageMock).toHaveBeenCalledWith(pkg, updates, 'silent')

    logSpy.mockRestore()
  })

  it('writes only the focused duplicate dependency when names collide across fields', async () => {
    const pkg = makePkg('my-app')
    const updates = [
      makeResolved({
        name: 'shared',
        source: 'dependencies',
        diff: 'major',
        targetVersion: '^2.0.0',
      }),
      makeResolved({
        name: 'shared',
        source: 'devDependencies',
        diff: 'minor',
        targetVersion: '^1.1.0',
      }),
    ]

    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue(updates)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    let sentKeys = false

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      if (!sentKeys && text.includes('\u001B[?25l')) {
        sentKeys = true
        queueMicrotask(() => {
          process.stdin.emit('keypress', ' ', { name: 'space' })
          process.stdin.emit('keypress', '\r', { name: 'return' })
        })
      }
      return true
    })

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, interactive: true })

    expect(result).toBe(0)
    expect(sentKeys).toBe(true)
    expect(mocks.writePackageMock).toHaveBeenCalledWith(pkg, [updates[0]], 'silent')

    logSpy.mockRestore()
  })
})
