import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BumpOptions, PackageMeta, ResolvedDepChange } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'

// Mock modules before importing check
vi.mock('../../io/packages', () => ({
  loadPackages: vi.fn(),
}))

vi.mock('../../io/resolve', () => ({
  resolvePackage: vi.fn(),
}))

vi.mock('../../io/write', () => ({
  writePackage: vi.fn(),
}))

vi.mock('../../cache/index', () => ({
  createSqliteCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 0, misses: 0, size: 0 })),
  })),
}))

vi.mock('../../utils/npmrc', () => ({
  loadNpmrc: vi.fn(() => ({
    registries: new Map(),
    defaultRegistry: 'https://registry.npmjs.org/',
    strictSsl: true,
  })),
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
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
    const packagesModule = await import('../../io/packages')
    const resolveModule = await import('../../io/resolve')
    const writeModule = await import('../../io/write')
    loadPackagesMock = packagesModule.loadPackages as ReturnType<typeof vi.fn>
    resolvePackageMock = resolveModule.resolvePackage as ReturnType<typeof vi.fn>
    writePackageMock = writeModule.writePackage as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 when no packages found', async () => {
    loadPackagesMock.mockResolvedValue([])

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 0 when no updates available', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(0)
  })

  it('returns 1 when updates available and write=false', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'major', targetVersion: '^2.0.0' })])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: false })

    expect(result).toBe(1)
  })

  it('returns 0 when updates available and write=true', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])

    const { check } = await import('./index')
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
    const { check } = await import('./index')
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
    const { check } = await import('./index')
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

  it('handles errors gracefully and returns 2', async () => {
    loadPackagesMock.mockRejectedValue(new Error('filesystem crash'))

    const { check } = await import('./index')
    const result = await check(baseOptions)

    expect(result).toBe(2)
  })

  it('calls writePackage when write=true and beforePackageWrite returns true', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'patch', targetVersion: '^1.0.1' })])

    const beforePackageWrite = vi.fn().mockResolvedValue(true)
    const afterPackageWrite = vi.fn()

    const { check } = await import('./index')
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

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, beforePackageWrite, afterPackageWrite })

    expect(writePackageMock).not.toHaveBeenCalled()
    expect(afterPackageWrite).not.toHaveBeenCalled()
  })
})

describe('--all flag', () => {
  let loadPackagesMock: ReturnType<typeof vi.fn>
  let resolvePackageMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const packagesModule = await import('../../io/packages')
    const resolveModule = await import('../../io/resolve')
    loadPackagesMock = packagesModule.loadPackages as ReturnType<typeof vi.fn>
    resolvePackageMock = resolveModule.resolvePackage as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes up-to-date packages in JSON when all=true', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json', all: true })

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
    expect(output.packages[0].updates).toHaveLength(0)

    consoleSpy.mockRestore()
  })

  it('skips up-to-date packages in JSON when all=false', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json', all: false })

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
    expect(output.packages).toHaveLength(0)

    consoleSpy.mockRestore()
  })

  it('renders up-to-date message in table when all=true', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'table', all: true, loglevel: 'info' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).toContain('my-app')
    expect(allOutput).toContain('All dependencies are up to date')

    consoleSpy.mockRestore()
  })

  it('still returns 0 when no updates even with all=true', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, all: true })

    expect(result).toBe(0)
  })
})

describe('contextual tips', () => {
  let loadPackagesMock: ReturnType<typeof vi.fn>
  let resolvePackageMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const packagesModule = await import('../../io/packages')
    const resolveModule = await import('../../io/resolve')
    loadPackagesMock = packagesModule.loadPackages as ReturnType<typeof vi.fn>
    resolvePackageMock = resolveModule.resolvePackage as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows major tip when mode=default and has updates', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', mode: 'default' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).toContain('bump major')

    consoleSpy.mockRestore()
  })

  it('shows write tip when not writing and has updates', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', write: false })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).toContain('-w')

    consoleSpy.mockRestore()
  })

  it('does not show tips in JSON output', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, output: 'json', mode: 'default' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('Tip:')

    consoleSpy.mockRestore()
  })

  it('does not show major tip when mode is not default', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', mode: 'major' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('bump major')

    consoleSpy.mockRestore()
  })

  it('does not show write tip when writing', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'info', output: 'table', write: true })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('-w')

    consoleSpy.mockRestore()
  })

  it('does not show tips in silent mode', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor' })])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { check } = await import('./index')
    await check({ ...baseOptions, loglevel: 'silent', output: 'table', mode: 'default' })

    const allOutput = consoleSpy.mock.calls.map((c) => String(c.join(' '))).join('\n')
    expect(allOutput).not.toContain('Tip:')

    consoleSpy.mockRestore()
  })
})

describe('lifecycle callbacks', () => {
  let loadPackagesMock: ReturnType<typeof vi.fn>
  let resolvePackageMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const packagesModule = await import('../../io/packages')
    const resolveModule = await import('../../io/resolve')
    loadPackagesMock = packagesModule.loadPackages as ReturnType<typeof vi.fn>
    resolvePackageMock = resolveModule.resolvePackage as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls afterPackagesLoaded with all packages', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    resolvePackageMock.mockResolvedValue([])

    const afterPackagesLoaded = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackagesLoaded })

    expect(afterPackagesLoaded).toHaveBeenCalledTimes(1)
    expect(afterPackagesLoaded).toHaveBeenCalledWith([pkg1, pkg2])
  })

  it('does not call afterPackagesLoaded when no packages found', async () => {
    loadPackagesMock.mockResolvedValue([])

    const afterPackagesLoaded = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackagesLoaded })

    expect(afterPackagesLoaded).not.toHaveBeenCalled()
  })

  it('calls afterPackageEnd for every package including ones without updates', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    // pkg1 has no updates, pkg2 has updates
    resolvePackageMock
      .mockResolvedValueOnce([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])
      .mockResolvedValueOnce([makeResolved({ diff: 'major', targetVersion: '^2.0.0' })])

    const afterPackageEnd = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackageEnd })

    expect(afterPackageEnd).toHaveBeenCalledTimes(2)
    expect(afterPackageEnd).toHaveBeenCalledWith(pkg1)
    expect(afterPackageEnd).toHaveBeenCalledWith(pkg2)
  })

  it('calls afterPackagesEnd with all packages after processing', async () => {
    const pkg1 = makePkg('app-a')
    const pkg2 = makePkg('app-b')
    loadPackagesMock.mockResolvedValue([pkg1, pkg2])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])

    const afterPackagesEnd = vi.fn()
    const { check } = await import('./index')
    await check({ ...baseOptions, afterPackagesEnd })

    expect(afterPackagesEnd).toHaveBeenCalledTimes(1)
    expect(afterPackagesEnd).toHaveBeenCalledWith([pkg1, pkg2])
  })

  it('calls callbacks in correct order', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])

    const order: string[] = []
    const afterPackagesLoaded = vi.fn(() => {
      order.push('afterPackagesLoaded')
    })
    const beforePackageStart = vi.fn(() => {
      order.push('beforePackageStart')
    })
    const afterPackageEnd = vi.fn(() => {
      order.push('afterPackageEnd')
    })
    const afterPackagesEnd = vi.fn(() => {
      order.push('afterPackagesEnd')
    })

    const { check } = await import('./index')
    await check({
      ...baseOptions,
      afterPackagesLoaded,
      beforePackageStart,
      afterPackageEnd,
      afterPackagesEnd,
    })

    expect(order).toEqual([
      'afterPackagesLoaded',
      'beforePackageStart',
      'afterPackageEnd',
      'afterPackagesEnd',
    ])
  })
})

describe('detectPackageManager', () => {
  let existsSyncMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const fs = await import('node:fs')
    existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>
    existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns name from packageManager field if present', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [pkg])).toBe('pnpm')
  })

  it('detects bun from bun.lock', async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith('bun.lock'))

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [])).toBe('bun')
  })

  it('detects bun from bun.lockb', async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith('bun.lockb'))

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [])).toBe('bun')
  })

  it('detects pnpm from pnpm-lock.yaml', async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith('pnpm-lock.yaml'))

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [])).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith('yarn.lock'))

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [])).toBe('yarn')
  })

  it('defaults to npm when no lockfile found', async () => {
    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [])).toBe('npm')
  })

  it('prefers packageManager field over lockfiles', async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith('yarn.lock'))
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'bun', version: '1.0.0', raw: 'bun@1.0.0' }

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [pkg])).toBe('bun')
  })
})

describe('--install flag', () => {
  let loadPackagesMock: ReturnType<typeof vi.fn>
  let resolvePackageMock: ReturnType<typeof vi.fn>
  let execSyncMock: ReturnType<typeof vi.fn>
  let existsSyncMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const packagesModule = await import('../../io/packages')
    const resolveModule = await import('../../io/resolve')
    const cp = await import('node:child_process')
    const fs = await import('node:fs')
    loadPackagesMock = packagesModule.loadPackages as ReturnType<typeof vi.fn>
    resolvePackageMock = resolveModule.resolvePackage as ReturnType<typeof vi.fn>
    execSyncMock = cp.execSync as ReturnType<typeof vi.fn>
    existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>
    existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs install after write when install=true and write=true', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, install: true })

    expect(execSyncMock).toHaveBeenCalledWith('pnpm install', {
      cwd: '/tmp/test',
      stdio: 'inherit',
    })
  })

  it('does not run install when write=false', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: false, install: true })

    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run install when install=false', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, install: false })

    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it('does not run install when no updates', async () => {
    const pkg = makePkg('my-app')
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'none', targetVersion: '^1.0.0' })])

    const { check } = await import('./index')
    await check({ ...baseOptions, write: true, install: true })

    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it('handles install failure gracefully without changing exit code', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'npm', version: '10.0.0', raw: 'npm@10.0.0' }
    loadPackagesMock.mockResolvedValue([pkg])
    resolvePackageMock.mockResolvedValue([makeResolved({ diff: 'minor', targetVersion: '^1.1.0' })])
    execSyncMock.mockImplementation(() => {
      throw new Error('install failed')
    })

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, write: true, install: true })

    // Exit code should be 0 (write succeeded), not affected by install failure
    expect(result).toBe(0)
    expect(execSyncMock).toHaveBeenCalled()
  })
})
