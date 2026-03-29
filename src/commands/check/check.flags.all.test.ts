import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseOptions, type CheckMocks, makePkg, makeResolved, setupMocks } from './test-helpers'

describe('--all flag', () => {
  let mocks: CheckMocks

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes up-to-date packages in JSON when all=true', async () => {
    const pkg = makePkg('my-app')
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

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
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

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
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

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
    mocks.loadPackagesMock.mockResolvedValue([pkg])
    mocks.resolvePackageMock.mockResolvedValue([
      makeResolved({ diff: 'none', targetVersion: '^1.0.0' }),
    ])

    const { check } = await import('./index')
    const result = await check({ ...baseOptions, all: true })

    expect(result).toBe(0)
  })
})

describe('detectPackageManager', () => {
  let mocks: CheckMocks
  const tmpDirs: string[] = []

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks = await setupMocks()
    mocks.existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  it('returns name from packageManager field if present', async () => {
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'pnpm', version: '9.0.0', raw: 'pnpm@9.0.0' }

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [pkg])).toBe('pnpm')
  })

  it('detects bun from bun.lock', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-pm-detect-'))
    tmpDirs.push(tmpDir)
    writeFileSync(join(tmpDir, 'bun.lock'), '')

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager(tmpDir, [])).toBe('bun')
  })

  it('detects bun from bun.lockb', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-pm-detect-'))
    tmpDirs.push(tmpDir)
    writeFileSync(join(tmpDir, 'bun.lockb'), '')

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager(tmpDir, [])).toBe('bun')
  })

  it('detects pnpm from pnpm-lock.yaml', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-pm-detect-'))
    tmpDirs.push(tmpDir)
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager(tmpDir, [])).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-pm-detect-'))
    tmpDirs.push(tmpDir)
    writeFileSync(join(tmpDir, 'yarn.lock'), '')

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager(tmpDir, [])).toBe('yarn')
  })

  it('defaults to npm when no lockfile found', async () => {
    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [])).toBe('npm')
  })

  it('detects packageManager from nearest ancestor manifest when called from a child cwd', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-pm-detect-'))
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, 'apps', 'web', 'src'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', packageManager: 'pnpm@9.0.0' }, null, 2),
    )

    mocks.existsSyncMock.mockImplementation(() => false)

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager(join(tmpDir, 'apps', 'web', 'src'), [])).toBe('pnpm')
  })

  it('walks past a child manifest without packageManager to find an ancestor field', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-pm-detect-'))
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, 'apps', 'web'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', packageManager: 'pnpm@9.0.0' }, null, 2),
    )
    writeFileSync(
      join(tmpDir, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: 'web' }, null, 2),
    )
    mocks.existsSyncMock.mockImplementation(() => false)

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager(join(tmpDir, 'apps', 'web'), [])).toBe('pnpm')
  })

  it('prefers packageManager field over lockfiles', async () => {
    mocks.existsSyncMock.mockImplementation((p: string) => p.endsWith('yarn.lock'))
    const pkg = makePkg('my-app')
    pkg.packageManager = { name: 'bun', version: '1.0.0', raw: 'bun@1.0.0' }

    const { detectPackageManager } = await import('./index')
    expect(detectPackageManager('/tmp/test', [pkg])).toBe('bun')
  })
})
