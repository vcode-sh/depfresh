import { execSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { getGlobalWriteTargets, loadGlobalPackagesAll } from './global'

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

const mockedExecSync = vi.mocked(execSync)

describe('loadGlobalPackagesAll', () => {
  it('scans npm, pnpm, and bun and deduplicates by package name', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'npm list -g --depth=0 --json') {
        return JSON.stringify({
          dependencies: {
            eslint: { version: '8.57.0' },
            typescript: { version: '5.7.2' },
          },
        })
      }

      if (cmd === 'pnpm list -g --json') {
        return JSON.stringify([
          {
            dependencies: {
              tsx: { version: '4.19.2' },
              typescript: { version: '5.8.0' },
            },
          },
        ])
      }

      if (cmd === 'bun pm ls -g') {
        return ['├── eslint@9.0.0', '└── bun-types@1.1.0'].join('\n')
      }

      throw new Error(`Unexpected command: ${cmd}`)
    })

    const result = loadGlobalPackagesAll()
    expect(result).toHaveLength(1)
    const pkg = result[0]
    expect(pkg?.filepath).toBe('global:npm+pnpm+bun')
    expect(pkg?.deps.map((dep) => dep.name)).toEqual(['bun-types', 'eslint', 'tsx', 'typescript'])
    expect(pkg?.deps.find((dep) => dep.name === 'eslint')?.currentVersion).toBe('8.57.0')
    expect(pkg?.deps.find((dep) => dep.name === 'typescript')?.currentVersion).toBe('5.7.2')

    expect(getGlobalWriteTargets(pkg!, 'eslint')).toEqual(['npm', 'bun'])
    expect(getGlobalWriteTargets(pkg!, 'typescript')).toEqual(['npm', 'pnpm'])
    expect(getGlobalWriteTargets(pkg!, 'tsx')).toEqual(['pnpm'])
    expect(getGlobalWriteTargets(pkg!, 'bun-types')).toEqual(['bun'])
  })

  it('returns empty array when no global packages are found', () => {
    mockedExecSync.mockImplementation(() => JSON.stringify({}))
    const result = loadGlobalPackagesAll()
    expect(result).toEqual([])
  })
})

describe('getGlobalWriteTargets', () => {
  it('falls back to parsing package manager names from filepath', () => {
    const targets = getGlobalWriteTargets(
      {
        name: 'Global packages',
        type: 'global',
        filepath: 'global:npm+pnpm',
        deps: [],
        resolved: [],
        raw: {},
        indent: '  ',
      },
      'typescript',
    )
    expect(targets).toEqual(['npm', 'pnpm'])
  })
})
