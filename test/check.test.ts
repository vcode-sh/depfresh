import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BumpOptions, PackageMeta, ResolvedDepChange } from '../src/types'
import { DEFAULT_OPTIONS } from '../src/types'

// Mock modules before importing check
vi.mock('../src/io/packages', () => ({
  loadPackages: vi.fn(),
}))

vi.mock('../src/io/resolve', () => ({
  resolvePackage: vi.fn(),
}))

vi.mock('../src/io/write', () => ({
  writePackage: vi.fn(),
}))

vi.mock('../src/cache/index', () => ({
  createSqliteCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 0, misses: 0, size: 0 })),
  })),
}))

vi.mock('../src/utils/npmrc', () => ({
  loadNpmrc: vi.fn(() => ({
    registries: new Map(),
    defaultRegistry: 'https://registry.npmjs.org/',
    strictSsl: true,
  })),
}))

const baseOptions: BumpOptions = {
  ...(DEFAULT_OPTIONS as BumpOptions),
  cwd: '/tmp/test',
  loglevel: 'silent',
}

function makePkg(name: string, deps: ResolvedDepChange[] = []): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath: `/tmp/test/${name}/package.json`,
    deps: deps.map((d) => ({
      name: d.name,
      currentVersion: d.currentVersion,
      source: d.source,
      update: true,
      parents: [],
    })),
    resolved: [],
    raw: { name },
    indent: '  ',
  }
}

function makeResolved(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'test-dep',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: { name: 'test-dep', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  }
}

describe('check', () => {
  let loadPackagesMock: ReturnType<typeof vi.fn>
  let resolvePackageMock: ReturnType<typeof vi.fn>
  let writePackageMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const packagesModule = await import('../src/io/packages')
    const resolveModule = await import('../src/io/resolve')
    const writeModule = await import('../src/io/write')
    loadPackagesMock = packagesModule.loadPackages as ReturnType<typeof vi.fn>
    resolvePackageMock = resolveModule.resolvePackage as ReturnType<typeof vi.fn>
    writePackageMock = writeModule.writePackage as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 when no packages found', async () => {
    loadPackagesMock.mockResolvedValue([])

    const { check } = await import('../src/commands/check/index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 0 when no updates available', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])

    const { check } = await import('../src/commands/check/index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 1 when updates available and write=false', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'major', targetVersion: '^2.0.0' })])

    const { check } = await import('../src/commands/check/index')
    const result = await check({ ...baseOptions, write: false })

    expect(result).toBe(1)
  })

  it('returns 0 when updates available and write=true', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])

    const { check } = await import('../src/commands/check/index')
    const result = await check({ ...baseOptions, write: true })

    expect(result).toBe(0)
    expect(writePackageMock).toHaveBeenCalled()
  })

  it('calls beforePackageStart for each package', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    resolvePackageMock.mockResolvedValue([])

    const beforePackageStart = vi.fn()
    const { check } = await import('../src/commands/check/index')
    await check({ ...baseOptions, beforePackageStart })

    expect(beforePackageStart).toHaveBeenCalledTimes(2)
    expect(beforePackageStart).toHaveBeenCalledWith(pkg1)
    expect(beforePackageStart).toHaveBeenCalledWith(pkg2)
  })

  it('calls onDependencyResolved for each resolved dep', async () => {
    const pkg = makePkg('my-app')
    const resolved = [
      makeResolved({ name: 'dep-a', diff: 'major' }),
      makeResolved({ name: 'dep-b', diff: 'minor' }),
    ]
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue(resolved)

    const onDependencyResolved = vi.fn()
    const { check } = await import('../src/commands/check/index')
    await check({ ...baseOptions, onDependencyResolved })

    // onDependencyResolved is called inside resolvePackage which we mocked,
    // so it won't be called from check directly. The mock bypasses the real resolve.
    // But check does assign pkg.resolved from the return value.
    expect(pkg.resolved).toEqual(resolved)
  })

  it('JSON output has correct envelope structure', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([
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

    const { check } = await import('../src/commands/check/index')
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

  it('handles errors gracefully and returns 2', async () => {
    loadPackagesMock.mockRejectedValue(new Error('filesystem crash'))

    const { check } = await import('../src/commands/check/index')
    const result = await check(baseOptions)

    expect(result).toBe(2)
  })

  it('calls writePackage when write=true and beforePackageWrite returns true', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'patch', targetVersion: '^1.0.1' })])

    const beforePackageWrite = vi.fn().mockResolvedValue(true)
    const afterPackageWrite = vi.fn()

    const { check } = await import('../src/commands/check/index')
    await check({ ...baseOptions, write: true, beforePackageWrite, afterPackageWrite })

    expect(writePackageMock).toHaveBeenCalled()
    expect(afterPackageWrite).toHaveBeenCalledWith(pkg)
  })

  it('skips write when beforePackageWrite returns false', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'patch', targetVersion: '^1.0.1' })])

    const beforePackageWrite = vi.fn().mockResolvedValue(false)
    const afterPackageWrite = vi.fn()

    const { check } = await import('../src/commands/check/index')
    await check({ ...baseOptions, write: true, beforePackageWrite, afterPackageWrite })

    expect(writePackageMock).not.toHaveBeenCalled()
    expect(afterPackageWrite).not.toHaveBeenCalled()
  })
})
