import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('JSON output', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has correct envelope structure', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'lodash',
        diff: 'major',
        currentVersion: '^4.0.0',
        targetVersion: '^5.0.0',
      }),
      makeResolved({
        name: 'react',
        diff: 'minor',
        currentVersion: '^18.0.0',
        targetVersion: '^18.1.0',
      }),
    ])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json' })

    const jsonCall = consoleSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string)
        return parsed.packages !== undefined
      } catch {
        return false
      }
    })

    expect(jsonCall).toBeDefined()
    const output = JSON.parse(jsonCall![0] as string)

    expect(output.packages).toHaveLength(1)
    expect(output.packages[0].name).toBe('my-app')
    expect(output.packages[0].updates).toHaveLength(2)
    expect(output.summary.total).toBe(2)
    expect(output.summary.major).toBe(1)
    expect(output.summary.minor).toBe(1)
    expect(output.summary.packages).toBe(1)
    expect(output.meta.cwd).toBe('/tmp/test')
    expect(output.meta.mode).toBeDefined()
    expect(output.meta.timestamp).toBeDefined()

    consoleSpy.mockRestore()
  })

  it('includes currentVersionTime when present', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'lodash',
        diff: 'major',
        currentVersion: '^4.0.0',
        targetVersion: '^5.0.0',
        currentVersionTime: '2023-01-15T10:00:00.000Z',
        publishedAt: '2024-06-01T12:00:00.000Z',
      }),
    ])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json' })

    const jsonCall = consoleSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string)
        return parsed.packages !== undefined
      } catch {
        return false
      }
    })

    expect(jsonCall).toBeDefined()
    const output = JSON.parse(jsonCall![0] as string)
    const update = output.packages[0].updates[0]
    expect(update.currentVersionTime).toBe('2023-01-15T10:00:00.000Z')
    expect(update.publishedAt).toBe('2024-06-01T12:00:00.000Z')

    consoleSpy.mockRestore()
  })

  it('omits currentVersionTime when not present', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'lodash',
        diff: 'major',
        currentVersion: '^4.0.0',
        targetVersion: '^5.0.0',
      }),
    ])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json' })

    const jsonCall = consoleSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string)
        return parsed.packages !== undefined
      } catch {
        return false
      }
    })

    expect(jsonCall).toBeDefined()
    const output = JSON.parse(jsonCall![0] as string)
    const update = output.packages[0].updates[0]
    expect(update.currentVersionTime).toBeUndefined()

    consoleSpy.mockRestore()
  })
})
