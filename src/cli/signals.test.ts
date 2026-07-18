import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSignalCleanup } from './signals'

const originalIsTTY = process.stdout.isTTY

describe('CLI signal cleanup', () => {
  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it('unregisters an eligible cleanup idempotently', () => {
    const cleanup = vi.fn()
    const unregister = registerSignalCleanup(cleanup)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    unregister()
    unregister()
    process.emit('SIGINT')

    expect(cleanup).not.toHaveBeenCalled()
  })

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('runs registered cleanups once before restoring the cursor on %s', (signal, code) => {
    const order: string[] = []
    const cleanup = vi.fn(() => order.push('dispose'))
    registerSignalCleanup(cleanup)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      order.push('cursor')
      return true
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(((received: number) => {
      order.push(`exit:${received}`)
      return undefined as never
    }) as typeof process.exit)
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })

    process.emit(signal)
    process.emit(signal)

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(code)
    expect(order.slice(0, 3)).toEqual(['dispose', 'cursor', `exit:${code}`])
  })

  it('swallows one cleanup failure and continues remaining cleanups', () => {
    const second = vi.fn()
    registerSignalCleanup(() => {
      throw new Error('cleanup failed')
    })
    registerSignalCleanup(second)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    process.emit('SIGTERM')

    expect(second).toHaveBeenCalledTimes(1)
  })
})
