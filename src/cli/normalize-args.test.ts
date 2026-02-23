import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigError } from '../errors'
import type { depfreshOptions } from '../types'
import { normalizeArgs } from './normalize-args'

const { resolveConfigMock } = vi.hoisted(() => ({
  resolveConfigMock: vi.fn(
    async (overrides: Partial<depfreshOptions>) => overrides as depfreshOptions,
  ),
}))

vi.mock('../config', () => ({
  resolveConfig: resolveConfigMock,
}))

function makeRawArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode_arg: undefined,
    cwd: '/tmp/test',
    recursive: true,
    write: false,
    interactive: false,
    mode: 'default',
    include: undefined,
    exclude: undefined,
    force: false,
    global: false,
    peer: false,
    'include-locked': false,
    output: 'table',
    concurrency: '16',
    loglevel: 'info',
    'deps-only': false,
    'dev-only': false,
    all: false,
    group: true,
    sort: 'diff-asc',
    timediff: true,
    cooldown: '0',
    nodecompat: true,
    long: false,
    explain: false,
    install: false,
    update: false,
    execute: undefined,
    'verify-command': undefined,
    'fail-on-outdated': false,
    'ignore-other-workspaces': true,
    ...overrides,
  }
}

describe('normalizeArgs enum validation', () => {
  beforeEach(() => {
    resolveConfigMock.mockClear()
  })

  it('throws ConfigError for invalid --mode', async () => {
    await expect(normalizeArgs(makeRawArgs({ mode: 'super-major' }))).rejects.toBeInstanceOf(
      ConfigError,
    )
    await expect(normalizeArgs(makeRawArgs({ mode: 'super-major' }))).rejects.toThrow(
      'Invalid value for --mode',
    )
  })

  it('throws ConfigError for invalid positional mode shorthand', async () => {
    await expect(
      normalizeArgs(makeRawArgs({ mode_arg: 'super-major', mode: 'minor' })),
    ).rejects.toThrow('Invalid value for --mode')
  })

  it('throws ConfigError for invalid --output (including sarif)', async () => {
    await expect(normalizeArgs(makeRawArgs({ output: 'sarif' }))).rejects.toThrow(
      'Invalid value for --output',
    )
  })

  it('throws ConfigError for invalid --sort', async () => {
    await expect(normalizeArgs(makeRawArgs({ sort: 'ascending' }))).rejects.toThrow(
      'Invalid value for --sort',
    )
  })

  it('throws ConfigError for invalid --loglevel', async () => {
    await expect(normalizeArgs(makeRawArgs({ loglevel: 'trace' }))).rejects.toThrow(
      'Invalid value for --loglevel',
    )
  })

  it('accepts valid enum values and prioritizes positional mode shorthand', async () => {
    await normalizeArgs(
      makeRawArgs({
        mode_arg: 'patch',
        mode: 'major',
        output: 'json',
        sort: 'name-desc',
        loglevel: 'debug',
      }),
    )

    expect(resolveConfigMock).toHaveBeenCalledTimes(1)
    const resolvedOptions = resolveConfigMock.mock.calls[0]?.[0] as depfreshOptions
    expect(resolvedOptions.mode).toBe('patch')
    expect(resolvedOptions.output).toBe('json')
    expect(resolvedOptions.sort).toBe('name-desc')
    expect(resolvedOptions.loglevel).toBe('debug')
  })
})
