import { describe, expect, it } from 'vitest'
import type { GlobalProcessRuntime } from '../../io/global-manager'
import type { GlobalManagerName } from '../../types'
import type { ExecutableHandle, ProcessObservation } from '../apply/process-runner'
import {
  applyGlobalPlan,
  createGlobalApplyPlan,
  createGlobalInvocationAuthority,
  validateGlobalApplyPlan,
  validateGlobalApplyResult,
} from '.'

interface FakeOptions {
  failUpdate?: Set<string>
  applyThenFail?: Set<string>
  thirdVersion?: Map<string, string>
  malformedInventoryAfterUpdate?: Set<GlobalManagerName>
  timeoutUpdate?: Set<string>
  unconfirmedUpdate?: Set<string>
  realmChangeAfterUpdate?: Set<GlobalManagerName>
}

function fakeRuntime(
  initial: Partial<Record<GlobalManagerName, Record<string, string>>>,
  options: FakeOptions = {},
): {
  runtime: GlobalProcessRuntime
  calls: Array<{ manager: GlobalManagerName; args: string[] }>
  setVersion(manager: GlobalManagerName, name: string, version: string): void
} {
  const state = new Map(
    Object.entries(initial).map(([manager, packages]) => [
      manager as GlobalManagerName,
      new Map(Object.entries(packages ?? {})),
    ]),
  )
  const calls: Array<{ manager: GlobalManagerName; args: string[] }> = []
  const updatedManagers = new Set<GlobalManagerName>()
  const handles = new Map<GlobalManagerName, ExecutableHandle>()
  for (const manager of ['npm', 'pnpm', 'bun'] as const) {
    handles.set(manager, {
      requested: manager,
      path: `/tmp/fake/${manager}`,
      dev: 1n,
      ino: BigInt(handles.size + 1),
      size: 100n,
      mtimeNs: 1n,
    })
  }
  const runtime: GlobalProcessRuntime = {
    resolve: (executable) => handles.get(executable as GlobalManagerName)!,
    run: async (handle, args) => {
      const manager = handle.requested as GlobalManagerName
      calls.push({ manager, args: [...args] })
      if (args.length === 1 && args[0] === '--version') {
        return exited(manager === 'bun' ? '1.2.0\n' : '10.0.0\n')
      }
      if (args[0] === 'root') {
        const suffix =
          updatedManagers.has(manager) && options.realmChangeAfterUpdate?.has(manager)
            ? '-changed'
            : ''
        return exited(`/tmp/fake/${manager}-global${suffix}\n`)
      }
      if (isInventory(manager, args)) {
        if (updatedManagers.has(manager) && options.malformedInventoryAfterUpdate?.has(manager)) {
          return exited('{malformed')
        }
        return exited(renderInventory(manager, state.get(manager) ?? new Map()))
      }
      const spec = args.at(-1) ?? ''
      const separator = spec.lastIndexOf('@')
      const name = spec.slice(0, separator)
      const target = spec.slice(separator + 1)
      const key = `${manager}:${name}`
      updatedManagers.add(manager)
      if (options.timeoutUpdate?.has(key)) {
        return {
          termination: 'timeout',
          reason: 'PROCESS_TIMEOUT',
          terminationConfirmed: true,
        }
      }
      if (options.unconfirmedUpdate?.has(key)) {
        return {
          termination: 'unknown',
          reason: 'PROCESS_DESCENDANTS_SURVIVED',
          terminationConfirmed: false,
        }
      }
      if (options.thirdVersion?.has(key)) {
        const packages = state.get(manager) ?? new Map<string, string>()
        packages.set(name, options.thirdVersion.get(key)!)
        state.set(manager, packages)
        return exited('')
      }
      if (options.applyThenFail?.has(key)) {
        const packages = state.get(manager) ?? new Map<string, string>()
        packages.set(name, target)
        state.set(manager, packages)
        return exited('', 1)
      }
      if (options.failUpdate?.has(key)) return exited('', 1)
      const packages = state.get(manager) ?? new Map<string, string>()
      packages.set(name, target)
      state.set(manager, packages)
      return exited('')
    },
  }
  return {
    runtime,
    calls,
    setVersion: (manager, name, value) => {
      const packages = state.get(manager) ?? new Map<string, string>()
      packages.set(name, value)
      state.set(manager, packages)
    },
  }
}

function exited(stdout: string, exitCode = 0): ProcessObservation {
  return {
    termination: 'exit',
    reason: 'PROCESS_EXITED',
    terminationConfirmed: true,
    exitCode,
    stdout,
  }
}

function isInventory(manager: GlobalManagerName, args: string[]): boolean {
  return manager === 'bun' ? args[0] === 'pm' : args[0] === 'list'
}

function renderInventory(manager: GlobalManagerName, packages: Map<string, string>): string {
  if (manager === 'npm') {
    return JSON.stringify({
      dependencies: Object.fromEntries([...packages].map(([name, version]) => [name, { version }])),
    })
  }
  if (manager === 'pnpm') {
    return JSON.stringify([
      {
        dependencies: Object.fromEntries(
          [...packages].map(([name, version]) => [name, { version }]),
        ),
      },
    ])
  }
  return [
    '/tmp/fake/bun-global',
    ...[...packages].map(([name, version]) => `├── ${name}@${version}`),
  ].join('\n')
}

describe('global apply state machine', () => {
  it('keeps duplicate names as distinct manager occurrences and blocks downgrades', async () => {
    const { runtime } = fakeRuntime({ npm: { shared: '3.0.0' }, pnpm: { shared: '1.0.0' } })
    const plan = await createGlobalApplyPlan(
      [
        { manager: 'npm', name: 'shared', expectedVersion: '3.0.0', targetVersion: '2.0.0' },
        { manager: 'pnpm', name: 'shared', expectedVersion: '1.0.0', targetVersion: '2.0.0' },
      ],
      { cwd: '/tmp', timeoutMs: 100 },
      runtime,
    )

    expect(new Set(plan.operations.map((entry) => entry.occurrenceId)).size).toBe(2)
    const result = await applyGlobalPlan(
      plan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm', 'pnpm'], {
        globalWrite: true,
        processExecute: true,
      }),
      runtime,
    )

    expect(result.items).toMatchObject([
      { manager: 'npm', status: 'skipped', reason: 'DOWNGRADE_BLOCKED' },
      { manager: 'pnpm', status: 'applied', reason: 'APPLIED', observedVersion: '2.0.0' },
    ])
    expect(result.summary).toMatchObject({ planned: 2, applied: 1, skipped: 1 })
    expect(result.status).toBe('applied')
    expect(validateGlobalApplyPlan(plan)).toBe(true)
    expect(validateGlobalApplyResult(result)).toBe(true)
  })

  it('preflights every item before the first command and retains partial outcomes', async () => {
    const fixture = fakeRuntime(
      { npm: { first: '1.0.0' }, pnpm: { second: '1.0.0' } },
      { failUpdate: new Set(['npm:first']) },
    )
    const plan = await createGlobalApplyPlan(
      [
        { manager: 'npm', name: 'first', expectedVersion: '1.0.0', targetVersion: '2.0.0' },
        { manager: 'pnpm', name: 'second', expectedVersion: '1.0.0', targetVersion: '2.0.0' },
      ],
      { cwd: '/tmp', timeoutMs: 100 },
      fixture.runtime,
    )
    fixture.calls.length = 0

    const result = await applyGlobalPlan(
      plan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm', 'pnpm'], {
        globalWrite: true,
        processExecute: true,
      }),
      fixture.runtime,
    )

    const firstUpdate = fixture.calls.findIndex((call) => call.args.includes('first@2.0.0'))
    expect(firstUpdate).toBeGreaterThan(
      fixture.calls.findLastIndex(
        (call, index) => index < firstUpdate && isInventory(call.manager, call.args),
      ),
    )
    expect(result.items.map((entry) => entry.status)).toEqual(['failed', 'applied'])
    expect(result.status).toBe('partial')
    expect(result.rollback).toBe('not-supported')
  })

  it('reports post-command inventory loss as unknown', async () => {
    const fixture = fakeRuntime(
      { npm: { pkg: '1.0.0' } },
      { malformedInventoryAfterUpdate: new Set(['npm']) },
    )
    const plan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      fixture.runtime,
    )
    const result = await applyGlobalPlan(
      plan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm'], { globalWrite: true, processExecute: true }),
      fixture.runtime,
    )
    expect(result.items).toMatchObject([{ status: 'unknown', reason: 'INVENTORY_MALFORMED' }])
    expect(result.status).toBe('unknown')
  })

  it('requires both capability grants and the exact manager set', async () => {
    const { runtime } = fakeRuntime({ npm: { pkg: '1.0.0' } })
    const plan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      runtime,
    )
    await expect(
      applyGlobalPlan(
        plan,
        { cwd: '/tmp' },
        createGlobalInvocationAuthority(['npm'], {
          globalWrite: true,
          processExecute: false,
        }),
        runtime,
      ),
    ).rejects.toMatchObject({ reason: 'AUTHORITY_REQUIRED' })
    await expect(
      applyGlobalPlan(
        plan,
        { cwd: '/tmp' },
        createGlobalInvocationAuthority(['pnpm'], {
          globalWrite: true,
          processExecute: true,
        }),
        runtime,
      ),
    ).rejects.toMatchObject({ reason: 'AUTHORITY_REQUIRED' })
    await expect(
      applyGlobalPlan(
        plan,
        { cwd: '/tmp' },
        createGlobalInvocationAuthority(['npm', 'pnpm'], {
          globalWrite: true,
          processExecute: true,
        }),
        runtime,
      ),
    ).rejects.toMatchObject({ reason: 'AUTHORITY_REQUIRED' })
  })

  it('rejects contradictory item semantics and forged command linkage', async () => {
    const { runtime } = fakeRuntime({ npm: { pkg: '1.0.0' } })
    const plan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      runtime,
    )
    const result = await applyGlobalPlan(
      plan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm'], { globalWrite: true, processExecute: true }),
      runtime,
    )

    const contradictory = structuredClone(result)
    contradictory.items[0]!.status = 'failed'
    contradictory.summary = {
      planned: 1,
      applied: 0,
      skipped: 0,
      conflicted: 0,
      failed: 1,
      unknown: 0,
    }
    contradictory.status = 'failed'
    expect(validateGlobalApplyResult(contradictory)).toBe(false)

    const forgedCommand = structuredClone(result)
    forgedCommand.commands[0] = {
      ...forgedCommand.commands[0]!,
      manager: 'bun',
      executable: 'evil',
      args: ['arbitrary'],
    }
    expect(validateGlobalApplyResult(forgedCommand)).toBe(false)

    const unconfirmedApplied = structuredClone(result)
    unconfirmedApplied.commands[0] = {
      ...unconfirmedApplied.commands[0]!,
      termination: 'unknown',
      terminationConfirmed: false,
    }
    Reflect.deleteProperty(unconfirmedApplied.commands[0]!, 'exitCode')
    expect(validateGlobalApplyResult(unconfirmedApplied)).toBe(false)

    const failedAtTarget = structuredClone(result)
    failedAtTarget.items[0]!.status = 'failed'
    failedAtTarget.items[0]!.reason = 'COMMAND_TIMEOUT'
    failedAtTarget.commands[0] = {
      ...failedAtTarget.commands[0]!,
      termination: 'timeout',
      terminationConfirmed: true,
    }
    Reflect.deleteProperty(failedAtTarget.commands[0]!, 'exitCode')
    failedAtTarget.summary = {
      planned: 1,
      applied: 0,
      skipped: 0,
      conflicted: 0,
      failed: 1,
      unknown: 0,
    }
    failedAtTarget.status = 'failed'
    expect(validateGlobalApplyResult(failedAtTarget)).toBe(false)

    const timeoutCalledFailed = structuredClone(failedAtTarget)
    timeoutCalledFailed.items[0]!.reason = 'COMMAND_FAILED'
    timeoutCalledFailed.items[0]!.observedVersion = timeoutCalledFailed.items[0]!.expectedVersion
    expect(validateGlobalApplyResult(timeoutCalledFailed)).toBe(false)

    const timeoutCalledMissing = structuredClone(failedAtTarget)
    timeoutCalledMissing.items[0]!.reason = 'PACKAGE_MISSING'
    Reflect.deleteProperty(timeoutCalledMissing.items[0]!, 'observedVersion')
    expect(validateGlobalApplyResult(timeoutCalledMissing)).toBe(false)
  })

  it('rejects plan fingerprint and fixed-argv forgery', async () => {
    const { runtime } = fakeRuntime({ npm: { pkg: '1.0.0' } })
    const plan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      runtime,
    )
    const forged = structuredClone(plan)
    forged.operations[0]!.args = ['install', '-g', 'attacker@9.9.9']
    expect(validateGlobalApplyPlan(forged)).toBe(false)
  })

  it('blocks stale operations before spawning their command', async () => {
    const fixture = fakeRuntime({ npm: { pkg: '1.0.0' } })
    const plan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      fixture.runtime,
    )
    fixture.setVersion('npm', 'pkg', '1.5.0')
    fixture.calls.length = 0
    const result = await applyGlobalPlan(
      plan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm'], { globalWrite: true, processExecute: true }),
      fixture.runtime,
    )
    expect(result.items).toMatchObject([
      {
        status: 'conflicted',
        reason: 'EXPECTED_VALUE_MISMATCH',
        observedVersion: '1.5.0',
      },
    ])
    expect(fixture.calls.some((call) => call.args.includes('pkg@2.0.0'))).toBe(false)
  })

  it('uses observed state for nonzero and unexpected command outcomes', async () => {
    const appliedFixture = fakeRuntime(
      { npm: { pkg: '1.0.0' } },
      { applyThenFail: new Set(['npm:pkg']) },
    )
    const appliedPlan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      appliedFixture.runtime,
    )
    const applied = await applyGlobalPlan(
      appliedPlan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm'], { globalWrite: true, processExecute: true }),
      appliedFixture.runtime,
    )
    expect(applied.items).toMatchObject([{ status: 'applied', observedVersion: '2.0.0' }])

    const racedFixture = fakeRuntime(
      { npm: { pkg: '1.0.0' } },
      { thirdVersion: new Map([['npm:pkg', '3.0.0']]) },
    )
    const racedPlan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      racedFixture.runtime,
    )
    const raced = await applyGlobalPlan(
      racedPlan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm'], { globalWrite: true, processExecute: true }),
      racedFixture.runtime,
    )
    expect(raced.items).toMatchObject([
      { status: 'conflicted', reason: 'POST_STATE_MISMATCH', observedVersion: '3.0.0' },
    ])
  })

  it('fails a confirmed timeout and stops later commands after uncontained execution', async () => {
    const timedOutFixture = fakeRuntime(
      { npm: { pkg: '1.0.0' } },
      { timeoutUpdate: new Set(['npm:pkg']) },
    )
    const timedOutPlan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      timedOutFixture.runtime,
    )
    const timedOut = await applyGlobalPlan(
      timedOutPlan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm'], { globalWrite: true, processExecute: true }),
      timedOutFixture.runtime,
    )
    expect(timedOut.items).toMatchObject([{ status: 'failed', reason: 'COMMAND_TIMEOUT' }])

    const unsafeFixture = fakeRuntime(
      { npm: { first: '1.0.0' }, pnpm: { second: '1.0.0' } },
      { unconfirmedUpdate: new Set(['npm:first']) },
    )
    const unsafePlan = await createGlobalApplyPlan(
      [
        { manager: 'npm', name: 'first', expectedVersion: '1.0.0', targetVersion: '2.0.0' },
        { manager: 'pnpm', name: 'second', expectedVersion: '1.0.0', targetVersion: '2.0.0' },
      ],
      { cwd: '/tmp', timeoutMs: 100 },
      unsafeFixture.runtime,
    )
    unsafeFixture.calls.length = 0
    const unsafe = await applyGlobalPlan(
      unsafePlan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm', 'pnpm'], {
        globalWrite: true,
        processExecute: true,
      }),
      unsafeFixture.runtime,
    )
    expect(unsafe.items.map((entry) => entry.status)).toEqual(['unknown', 'unknown'])
    expect(unsafeFixture.calls.some((call) => call.args.includes('second@2.0.0'))).toBe(false)
  })

  it('treats a changed global realm as unknown', async () => {
    const fixture = fakeRuntime(
      { npm: { pkg: '1.0.0' } },
      { realmChangeAfterUpdate: new Set(['npm']) },
    )
    const plan = await createGlobalApplyPlan(
      [{ manager: 'npm', name: 'pkg', expectedVersion: '1.0.0', targetVersion: '2.0.0' }],
      { cwd: '/tmp', timeoutMs: 100 },
      fixture.runtime,
    )
    const result = await applyGlobalPlan(
      plan,
      { cwd: '/tmp' },
      createGlobalInvocationAuthority(['npm'], { globalWrite: true, processExecute: true }),
      fixture.runtime,
    )
    expect(result.items).toMatchObject([{ status: 'unknown', reason: 'EXECUTABLE_CHANGED' }])
  })

  it('creates deterministic plans independent of request enumeration order', async () => {
    const left = fakeRuntime({ npm: { a: '1.0.0' }, pnpm: { b: '1.0.0' } })
    const right = fakeRuntime({ npm: { a: '1.0.0' }, pnpm: { b: '1.0.0' } })
    const requests = [
      { manager: 'pnpm' as const, name: 'b', expectedVersion: '1.0.0', targetVersion: '2.0.0' },
      { manager: 'npm' as const, name: 'a', expectedVersion: '1.0.0', targetVersion: '2.0.0' },
    ]
    const first = await createGlobalApplyPlan(
      requests,
      { cwd: '/tmp', timeoutMs: 100 },
      left.runtime,
    )
    const second = await createGlobalApplyPlan(
      [...requests].reverse(),
      { cwd: '/tmp', timeoutMs: 100 },
      right.runtime,
    )
    expect(first).toEqual(second)
  })
})
