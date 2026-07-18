import { afterEach, describe, expect, it, vi } from 'vitest'

describe('createLogger terminal boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('honors an explicit colorless capability even when FORCE_COLOR is set', async () => {
    vi.stubEnv('FORCE_COLOR', '1')
    vi.resetModules()
    const { createLogger } = await import('./logger')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    createLogger('info', { color: false, sanitize: true }).info('durable value')

    expect(logSpy.mock.calls.flat().map(String).join('')).toContain('durable value')
    expect(logSpy.mock.calls.flat().map(String).join('')).not.toContain('\u001B[')
  })

  it('sanitizes every human argument at the final logging boundary', async () => {
    const { createLogger } = await import('./logger')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    createLogger('info', { color: false, sanitize: true }).error(
      'failed\u001B]0;owned\u0007\nforged',
      new Error('boom\u009B2J\u202Etxt'),
    )

    expect(errorSpy.mock.calls).toEqual([['x', 'failed forged', 'boomtxt']])
  })

  it('wraps capability-bound output without exceeding the immutable width', async () => {
    const { createLogger } = await import('./logger')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const wrap = (value: string, width: number): readonly string[] => {
      const lines: string[] = []
      for (let index = 0; index < value.length; index += width) {
        lines.push(value.slice(index, index + width))
      }
      return lines.length > 0 ? lines : ['']
    }

    createLogger('info', { color: false, sanitize: true, width: 8, wrap }).info(
      'long durable value',
    )

    expect(logSpy.mock.calls).toEqual([
      ['i', 'long d'],
      ['i', 'urable'],
      ['i', ' value'],
    ])
  })

  it('does not throw while sanitizing an object without a primitive conversion', async () => {
    const { createLogger } = await import('./logger')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() =>
      createLogger('info', { color: false, sanitize: true }).warn(Object.create(null)),
    ).not.toThrow()
    expect(warnSpy.mock.calls).toEqual([['!', '[unprintable]']])
  })

  it('does not throw while inspecting a hostile Error proxy', async () => {
    const { createLogger } = await import('./logger')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hostile = new Proxy(new Error('hidden'), {
      get() {
        throw new Error('trap')
      },
    })

    expect(() => createLogger('info', { color: false, sanitize: true }).warn(hostile)).not.toThrow()
    expect(warnSpy.mock.calls).toEqual([['!', '[unprintable]']])
  })
})
