import { execSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  detectGlobalPackageManager,
  loadGlobalPackages,
  parseBunGlobalList,
  parseNpmGlobalList,
  parsePnpmGlobalList,
  writeGlobalPackage,
} from './global'

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

const mockedExecSync = vi.mocked(execSync)

describe('parseNpmGlobalList', () => {
  it('parses valid JSON with dependencies', () => {
    const json = JSON.stringify({
      dependencies: {
        typescript: { version: '5.3.3' },
        eslint: { version: '8.56.0' },
      },
    })
    const result = parseNpmGlobalList(json)
    expect(result).toEqual([
      { name: 'typescript', version: '5.3.3' },
      { name: 'eslint', version: '8.56.0' },
    ])
  })

  it('returns empty array for empty dependencies', () => {
    const json = JSON.stringify({ dependencies: {} })
    const result = parseNpmGlobalList(json)
    expect(result).toEqual([])
  })

  it('returns empty array for missing dependencies key', () => {
    const json = JSON.stringify({ name: 'global' })
    const result = parseNpmGlobalList(json)
    expect(result).toEqual([])
  })
})

describe('parsePnpmGlobalList', () => {
  it('parses array format with dependencies', () => {
    const json = JSON.stringify([
      {
        dependencies: {
          tsx: { version: '4.7.0' },
          turbo: { version: '1.12.0' },
        },
      },
    ])
    const result = parsePnpmGlobalList(json)
    expect(result).toEqual([
      { name: 'tsx', version: '4.7.0' },
      { name: 'turbo', version: '1.12.0' },
    ])
  })

  it('returns empty array for empty array input', () => {
    const result = parsePnpmGlobalList('[]')
    expect(result).toEqual([])
  })
})

describe('parseBunGlobalList', () => {
  it('parses tree output with packages', () => {
    const output = [
      '/home/user/.bun/install/global',
      '├── typescript@5.3.3',
      '└── eslint@8.56.0',
    ].join('\n')
    const result = parseBunGlobalList(output)
    expect(result).toEqual([
      { name: 'typescript', version: '5.3.3' },
      { name: 'eslint', version: '8.56.0' },
    ])
  })

  it('returns empty array for empty output', () => {
    const result = parseBunGlobalList('')
    expect(result).toEqual([])
  })

  it('parses scoped packages correctly', () => {
    const output = ['├── @scope/package@1.2.3', '└── @other/lib@4.5.6'].join('\n')
    const result = parseBunGlobalList(output)
    expect(result).toEqual([
      { name: '@scope/package', version: '1.2.3' },
      { name: '@other/lib', version: '4.5.6' },
    ])
  })
})

describe('detectGlobalPackageManager', () => {
  it('returns explicit PM when provided', () => {
    expect(detectGlobalPackageManager('npm')).toBe('npm')
    expect(detectGlobalPackageManager('pnpm')).toBe('pnpm')
    expect(detectGlobalPackageManager('bun')).toBe('bun')
  })

  it('falls back to npm when no PM is detected', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found')
    })
    expect(detectGlobalPackageManager()).toBe('npm')
  })
})

describe('loadGlobalPackages', () => {
  it('returns PackageMeta with type global', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'npm list -g --depth=0 --json') {
        return JSON.stringify({
          dependencies: { typescript: { version: '5.3.3' } },
        })
      }
      throw new Error('not found')
    })

    const result = loadGlobalPackages('npm')
    expect(result).toHaveLength(1)
    expect(result[0]?.type).toBe('global')
    expect(result[0]?.name).toBe('Global packages')
    expect(result[0]?.filepath).toBe('global:npm')
    expect(result[0]?.deps).toHaveLength(1)
    expect(result[0]?.deps[0]?.name).toBe('typescript')
    expect(result[0]?.deps[0]?.currentVersion).toBe('5.3.3')
  })

  it('returns empty array when no packages found', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'npm list -g --depth=0 --json') {
        return JSON.stringify({ dependencies: {} })
      }
      throw new Error('not found')
    })

    const result = loadGlobalPackages('npm')
    expect(result).toEqual([])
  })
})

describe('writeGlobalPackage', () => {
  it('executes correct command for npm', () => {
    mockedExecSync.mockReturnValue(Buffer.from(''))
    writeGlobalPackage('npm', 'typescript', '5.3.3')
    expect(mockedExecSync).toHaveBeenCalledWith('npm install -g typescript@5.3.3', {
      stdio: 'inherit',
    })
  })

  it('executes correct command for pnpm', () => {
    mockedExecSync.mockReturnValue(Buffer.from(''))
    writeGlobalPackage('pnpm', 'tsx', '4.7.0')
    expect(mockedExecSync).toHaveBeenCalledWith('pnpm add -g tsx@4.7.0', { stdio: 'inherit' })
  })

  it('executes correct command for bun', () => {
    mockedExecSync.mockReturnValue(Buffer.from(''))
    writeGlobalPackage('bun', 'turbo', '1.12.0')
    expect(mockedExecSync).toHaveBeenCalledWith('bun add -g turbo@1.12.0', { stdio: 'inherit' })
  })

  it('warns for yarn without throwing', () => {
    expect(() => writeGlobalPackage('yarn', 'pkg', '1.0.0')).not.toThrow()
  })
})
