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
    'ignore-paths': undefined,
    force: false,
    'refresh-cache': false,
    'no-cache': false,
    global: false,
    'global-all': false,
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

describe('normalizeArgs parity flags', () => {
  beforeEach(() => {
    resolveConfigMock.mockClear()
  })

  it('normalizes ignore-paths into ignorePaths array', async () => {
    await normalizeArgs(makeRawArgs({ 'ignore-paths': '**/tmp/**,**/.cache/**' }))

    const resolvedOptions = resolveConfigMock.mock.calls[0]?.[0] as depfreshOptions
    expect(resolvedOptions.ignorePaths).toEqual(['**/tmp/**', '**/.cache/**'])
  })

  it('enables refreshCache for --refresh-cache', async () => {
    await normalizeArgs(makeRawArgs({ 'refresh-cache': true }))

    const resolvedOptions = resolveConfigMock.mock.calls[0]?.[0] as depfreshOptions
    expect(resolvedOptions.refreshCache).toBe(true)
  })

  it('treats --no-cache as refresh cache alias', async () => {
    await normalizeArgs(makeRawArgs({ 'no-cache': true }))

    const resolvedOptions = resolveConfigMock.mock.calls[0]?.[0] as depfreshOptions
    expect(resolvedOptions.refreshCache).toBe(true)
  })

  it('maps --global-all and enables global mode automatically', async () => {
    await normalizeArgs(makeRawArgs({ global: false, 'global-all': true }))

    const resolvedOptions = resolveConfigMock.mock.calls[0]?.[0] as depfreshOptions
    expect(resolvedOptions.global).toBe(true)
    expect(resolvedOptions.globalAll).toBe(true)
  })

  it('keeps globalAll false when only --global is used', async () => {
    await normalizeArgs(makeRawArgs({ global: true, 'global-all': false }))

    const resolvedOptions = resolveConfigMock.mock.calls[0]?.[0] as depfreshOptions
    expect(resolvedOptions.global).toBe(true)
    expect(resolvedOptions.globalAll).toBe(false)
  })
})
