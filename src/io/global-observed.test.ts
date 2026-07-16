import { describe, expect, it } from 'vitest'
import type { ExecutableHandle, ProcessObservation } from '../commands/apply/process-runner'
import { compilePolicy } from '../policy'
import type { GlobalManagerName } from '../types'
import { loadGlobalPackagesAllObserved, loadGlobalPackagesObserved } from './global'
import type { GlobalProcessRuntime } from './global-manager'

function runtimeFor(inventories: Partial<Record<GlobalManagerName, string>>): GlobalProcessRuntime {
  return {
    resolve: (executable) =>
      inventories[executable as GlobalManagerName] === undefined
        ? { reason: 'EXECUTABLE_UNAVAILABLE' }
        : handle(executable as GlobalManagerName),
    run: async (executable, args) => {
      const manager = executable.requested as GlobalManagerName
      if (args[0] === '--version') return exited(manager === 'bun' ? '1.2.0\n' : '10.0.0\n')
      if (args[0] === 'root') return exited(`/tmp/${manager}-global\n`)
      return exited(inventories[manager] ?? '')
    },
  }
}

function handle(manager: GlobalManagerName): ExecutableHandle {
  return {
    requested: manager,
    path: `/tmp/${manager}`,
    dev: 1n,
    ino: manager === 'npm' ? 1n : manager === 'pnpm' ? 2n : 3n,
    size: 100n,
    mtimeNs: 1n,
  }
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

describe('observed global package loading', () => {
  it('does not turn an unavailable explicit manager into an empty inventory', async () => {
    await expect(
      loadGlobalPackagesObserved('npm', { cwd: '/tmp', timeoutMs: 100 }, runtimeFor({})),
    ).rejects.toMatchObject({ reason: 'GLOBAL_INVENTORY_UNAVAILABLE' })
  })

  it('keeps per-manager versions while deduplicating only the resolution presentation', async () => {
    const packages = await loadGlobalPackagesAllObserved(
      { cwd: '/tmp', timeoutMs: 100 },
      runtimeFor({
        npm: JSON.stringify({ dependencies: { shared: { version: '3.0.0' } } }),
        pnpm: JSON.stringify([{ dependencies: { shared: { version: '1.0.0' } } }]),
        bun: '/tmp/bun-global\n├── other@1.0.0',
      }),
    )
    expect(packages[0]?.deps).toMatchObject([
      { name: 'shared', currentVersion: '3.0.0', globalManager: 'npm' },
      { name: 'shared', currentVersion: '1.0.0', globalManager: 'pnpm' },
      { name: 'other', currentVersion: '1.0.0', globalManager: 'bun' },
    ])
    expect(packages[0]?.raw).toMatchObject({
      managersByDependency: { shared: ['npm', 'pnpm'] },
      versionsByDependency: { shared: { npm: '3.0.0', pnpm: '1.0.0' } },
      managerEvidence: [
        { manager: 'npm', status: 'confirmed' },
        { manager: 'pnpm', status: 'confirmed' },
        { manager: 'bun', status: 'confirmed' },
      ],
    })
  })

  it('evaluates ordered policy independently for each manager occurrence', async () => {
    const packages = await loadGlobalPackagesAllObserved(
      {
        cwd: '/tmp',
        timeoutMs: 100,
        compiledPolicy: compilePolicy([
          { source: 'defaults', mode: 'latest' },
          {
            source: 'library',
            policyRules: [
              {
                id: 'exclude-npm-global',
                selectors: { manager: 'npm', role: 'global' },
                action: 'exclude',
              },
            ],
          },
        ]),
      },
      runtimeFor({
        npm: JSON.stringify({ dependencies: { shared: { version: '1.0.0' } } }),
        pnpm: JSON.stringify([{ dependencies: { shared: { version: '1.0.0' } } }]),
        bun: '/tmp/bun-global',
      }),
    )
    expect(packages[0]?.deps).toMatchObject([
      {
        globalManager: 'npm',
        update: false,
        policyDecision: { status: 'skipped', winningActionRuleId: 'exclude-npm-global' },
      },
      { globalManager: 'pnpm', update: true, policyDecision: { status: 'selected' } },
    ])
  })
})
