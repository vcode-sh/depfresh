import { describe, expect, it, vi } from 'vitest'
import type { ExecutableHandle, ProcessObservation } from '../commands/apply/process-runner'
import {
  type GlobalProcessRuntime,
  getGlobalManagerAdapter,
  inspectGlobalManager,
  parseGlobalInventory,
  supportsManagerVersion,
} from './global-manager'

const handle: ExecutableHandle = {
  requested: 'npm',
  path: '/tmp/bin/npm',
  dev: 1n,
  ino: 2n,
  size: 3n,
  mtimeNs: 4n,
}

function exited(stdout: string): ProcessObservation {
  return {
    termination: 'exit',
    reason: 'PROCESS_EXITED',
    terminationConfirmed: true,
    exitCode: 0,
    stdout,
  }
}

describe('strict global manager inventory', () => {
  it('distinguishes a valid empty inventory from malformed output', () => {
    expect(parseGlobalInventory('npm', '{"dependencies":{}}')).toEqual([])
    expect(parseGlobalInventory('npm', '{not json')).toBeUndefined()
    expect(
      parseGlobalInventory(
        'npm',
        JSON.stringify({ dependencies: { valid: { version: '1.0.0' }, bad: {} } }),
      ),
    ).toBeUndefined()
  })

  it('rejects malformed Bun versions and duplicate package identities', () => {
    expect(parseGlobalInventory('bun', '├── pkg@not-semver')).toBeUndefined()
    expect(parseGlobalInventory('bun', '├── pkg@1.0.0\n└── pkg@1.0.0')).toBeUndefined()
    expect(parseGlobalInventory('bun', '└── @scope/pkg@1.2.3')).toEqual([
      { name: '@scope/pkg', version: '1.2.3' },
    ])
    expect(parseGlobalInventory('bun', '/tmp/global\njunk\n└── pkg@1.0.0')).toBeUndefined()
  })

  it('requires exactly one pnpm inventory root', () => {
    expect(parseGlobalInventory('pnpm', '[]')).toBeUndefined()
    expect(parseGlobalInventory('pnpm', '[{},{}]')).toBeUndefined()
    expect(parseGlobalInventory('pnpm', '[{"dependencies":{}}]')).toEqual([])
  })

  it('rejects duplicate JSON object identities before JSON.parse can collapse them', () => {
    expect(
      parseGlobalInventory(
        'npm',
        '{"dependencies":{"pkg":{"version":"1.0.0"},"pkg":{"version":"2.0.0"}}}',
      ),
    ).toBeUndefined()
  })

  it('uses fixed lifecycle-disabled argv for every supported manager', () => {
    expect(getGlobalManagerAdapter('npm').updateArgs('pkg', '2.0.0')).toEqual([
      'install',
      '-g',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--',
      'pkg@2.0.0',
    ])
    expect(getGlobalManagerAdapter('pnpm').updateArgs('pkg', '2.0.0')).toContain(
      '--ignore-pnpmfile',
    )
    expect(getGlobalManagerAdapter('bun').updateArgs('pkg', '2.0.0')).toContain('--ignore-scripts')
    expect(getGlobalManagerAdapter('npm').realmArgs).toEqual(['root', '-g'])
    expect(getGlobalManagerAdapter('pnpm').realmArgs).toEqual(['root', '-g'])
  })

  it('enforces the reviewed manager version matrix', () => {
    expect(supportsManagerVersion('npm', '10.9.0')).toBe(true)
    expect(supportsManagerVersion('npm', '12.0.1')).toBe(true)
    expect(supportsManagerVersion('npm', '13.0.0')).toBe(false)
    expect(supportsManagerVersion('pnpm', '11.0.0')).toBe(true)
    expect(supportsManagerVersion('bun', '1.2.0')).toBe(true)
    expect(supportsManagerVersion('bun', '2.0.0')).toBe(false)
  })

  it('retains missing and malformed managers as explicit evidence', async () => {
    const missingRuntime: GlobalProcessRuntime = {
      resolve: () => ({ reason: 'EXECUTABLE_UNAVAILABLE' }),
      run: vi.fn(),
    }
    await expect(
      inspectGlobalManager('npm', { cwd: '/tmp', timeoutMs: 100 }, missingRuntime),
    ).resolves.toMatchObject({ evidence: { status: 'unavailable', packages: [] } })

    const malformedRuntime: GlobalProcessRuntime = {
      resolve: () => handle,
      run: vi.fn().mockResolvedValueOnce(exited('10.0.0\n')).mockResolvedValueOnce(exited('{bad')),
    }
    await expect(
      inspectGlobalManager('npm', { cwd: '/tmp', timeoutMs: 100 }, malformedRuntime),
    ).resolves.toMatchObject({ evidence: { status: 'malformed', packages: [] } })
  })

  it('preserves a realm-probe timeout as timeout evidence', async () => {
    const timeout: ProcessObservation = {
      termination: 'timeout',
      reason: 'PROCESS_TIMEOUT',
      terminationConfirmed: true,
    }
    const runtime: GlobalProcessRuntime = {
      resolve: () => handle,
      run: vi
        .fn()
        .mockResolvedValueOnce(exited('10.0.0\n'))
        .mockResolvedValueOnce(exited('{"dependencies":{}}'))
        .mockResolvedValueOnce(timeout),
    }

    await expect(
      inspectGlobalManager('npm', { cwd: '/tmp', timeoutMs: 100 }, runtime),
    ).resolves.toMatchObject({
      evidence: { status: 'timeout', reason: 'PROCESS_TIMEOUT', packages: [] },
    })
  })
})
