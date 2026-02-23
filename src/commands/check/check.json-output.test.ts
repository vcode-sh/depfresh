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
    expect(output.errors).toEqual([])
    expect(output.summary.total).toBe(2)
    expect(output.summary.major).toBe(1)
    expect(output.summary.minor).toBe(1)
    expect(output.summary.packages).toBe(1)
    expect(output.summary.scannedPackages).toBe(1)
    expect(output.summary.packagesWithUpdates).toBe(1)
    expect(output.summary.plannedUpdates).toBe(0)
    expect(output.summary.appliedUpdates).toBe(0)
    expect(output.summary.revertedUpdates).toBe(0)
    expect(output.meta.schemaVersion).toBe(1)
    expect(output.meta.cwd).toBe('/tmp/test')
    expect(output.meta.mode).toBeDefined()
    expect(output.meta.timestamp).toBeDefined()
    expect(output.meta.noPackagesFound).toBe(false)
    expect(output.meta.didWrite).toBe(false)

    consoleSpy.mockRestore()
  })

  it('forces silent runtime log level in json mode', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json', loglevel: 'info' })

    expect(mocks.loadPackagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output: 'json',
        loglevel: 'silent',
      }),
    )
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

  it('reports noPackagesFound state in JSON envelope', async () => {
    mocks.loadPackagesMock.mockResolvedValue([])

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
    expect(output.packages).toEqual([])
    expect(output.summary.scannedPackages).toBe(0)
    expect(output.summary.packagesWithUpdates).toBe(0)
    expect(output.summary.plannedUpdates).toBe(0)
    expect(output.summary.appliedUpdates).toBe(0)
    expect(output.summary.revertedUpdates).toBe(0)
    expect(output.meta.noPackagesFound).toBe(true)
    expect(output.meta.didWrite).toBe(false)

    consoleSpy.mockRestore()
  })

  it('reports planned/applied/reverted counters for verify-command writes', async () => {
    const pkg = makePkg('my-app')
    const dep = makeResolved({
      name: 'lodash',
      diff: 'major',
      currentVersion: '^4.0.0',
      targetVersion: '^5.0.0',
    })
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([dep])
    mocks.execSyncMock.mockImplementation(() => {
      throw new Error('verify failed')
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json', write: true, verifyCommand: 'npm test' })

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
    expect(output.summary.total).toBe(1)
    expect(output.summary.scannedPackages).toBe(1)
    expect(output.summary.packagesWithUpdates).toBe(1)
    expect(output.summary.plannedUpdates).toBe(1)
    expect(output.summary.appliedUpdates).toBe(0)
    expect(output.summary.revertedUpdates).toBe(1)
    expect(output.meta.noPackagesFound).toBe(false)
    expect(output.meta.didWrite).toBe(false)

    consoleSpy.mockRestore()
  })
})

describe('JSON error envelope', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('outputs structured JSON error when check throws in json mode', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('Something went wrong'))

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(2)

    const jsonCall = consoleSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string)
        return parsed.error !== undefined
      } catch {
        return false
      }
    })

    expect(jsonCall).toBeDefined()
    const output = JSON.parse(jsonCall![0] as string)
    expect(output.error.code).toBe('ERR_UNKNOWN')
    expect(output.error.message).toBe('Something went wrong')
    expect(output.error.retryable).toBe(false)
    expect(output.meta.schemaVersion).toBe(1)

    consoleSpy.mockRestore()
  })

  it('marks registry errors as retryable', async () => {
    const { RegistryError } = await import('../../errors')
    mocks.loadPackagesMock.mockRejectedValue(
      new RegistryError('timeout', 503, 'https://registry.npmjs.org/foo'),
    )

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'json' })

    expect(exitCode).toBe(2)

    const jsonCall = consoleSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string)
        return parsed.error !== undefined
      } catch {
        return false
      }
    })

    expect(jsonCall).toBeDefined()
    const output = JSON.parse(jsonCall![0] as string)
    expect(output.error.code).toBe('ERR_REGISTRY')
    expect(output.error.retryable).toBe(true)

    consoleSpy.mockRestore()
  })

  it('does not output JSON error in table mode', async () => {
    mocks.loadPackagesMock.mockRejectedValue(new Error('Something went wrong'))

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    const exitCode = await check({ ...baseOptions, output: 'table' })

    expect(exitCode).toBe(2)

    const jsonCall = consoleSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string)
        return parsed.error !== undefined
      } catch {
        return false
      }
    })

    expect(jsonCall).toBeUndefined()

    consoleSpy.mockRestore()
  })

  it('surfaces resolution errors in JSON envelope', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({
        name: 'good-dep',
        diff: 'minor',
        currentVersion: '^1.0.0',
        targetVersion: '^1.1.0',
      }),
      makeResolved({
        name: 'bad-dep',
        diff: 'error',
        currentVersion: '^1.0.0',
        targetVersion: '^1.0.0',
        source: 'dependencies',
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
    expect(output.packages[0].updates).toHaveLength(1)
    expect(output.packages[0].updates[0].name).toBe('good-dep')

    expect(output.errors).toHaveLength(1)
    expect(output.errors[0].name).toBe('bad-dep')
    expect(output.errors[0].source).toBe('dependencies')
    expect(output.errors[0].currentVersion).toBe('^1.0.0')
    expect(output.errors[0].message).toBeDefined()

    consoleSpy.mockRestore()
  })
})
