import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('contextual tips', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows major tip when mode=default and has updates', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', mode: 'default' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).toContain('bump major')

    consoleSpy.mockRestore()
  })

  it('shows write tip when not writing and has updates', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', write: false })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).toContain('-w')

    consoleSpy.mockRestore()
  })

  it('does not show tips in JSON output', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json', mode: 'default' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('Tip:')

    consoleSpy.mockRestore()
  })

  it('does not show major tip when mode is not default', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', mode: 'major' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('bump major')

    consoleSpy.mockRestore()
  })

  it('does not show write tip when writing', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', write: true })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('-w')

    consoleSpy.mockRestore()
  })

  it('does not show tips in silent mode', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'silent', output: 'table', mode: 'default' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('Tip:')

    consoleSpy.mockRestore()
  })
})
