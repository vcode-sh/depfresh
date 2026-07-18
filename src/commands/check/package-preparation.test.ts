import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  depfreshOptions,
  InvocationAuthority,
  PackageMeta,
  ResolvedDepChange,
} from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import { createLogger } from '../../utils/logger'
import type { ProcessPackageHooks } from './process-package'

const resolvePackageMock = vi.hoisted(() => vi.fn())
const selectInteractiveUpdatesMock = vi.hoisted(() => vi.fn())
const localWriterMock = vi.hoisted(() => vi.fn())
const globalWriterMock = vi.hoisted(() => vi.fn())

vi.mock('../../io/resolve', () => ({ resolvePackage: resolvePackageMock }))
vi.mock('./post-write-actions', () => ({
  selectInteractiveUpdates: selectInteractiveUpdatesMock,
}))
vi.mock('../apply/legacy', () => ({ applyLegacyPackageWrite: localWriterMock }))
vi.mock('../global-apply', () => ({ applyGlobalPlan: globalWriterMock }))

const authority: InvocationAuthority = {
  write: true,
  install: false,
  update: false,
  execute: false,
  processExecute: false,
  lockfileWrite: false,
  verifyCommand: false,
  artifactVerify: false,
  networkAccess: false,
  globalWrite: true,
}

const options: depfreshOptions = {
  ...(DEFAULT_OPTIONS as depfreshOptions),
  cwd: '/tmp/test',
  write: true,
  loglevel: 'silent',
}

function makePkg(name: string): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath: `/tmp/test/${name}/package.json`,
    deps: [],
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
    pkgData: {
      name: 'test-dep',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    },
    ...overrides,
  }
}

function makeHooks(order: string[] = []): ProcessPackageHooks {
  return {
    cache: {} as ProcessPackageHooks['cache'],
    npmrc: {} as ProcessPackageHooks['npmrc'],
    workspacePackageNames: new Set(),
    beforePackageStart: vi.fn(() => {
      order.push('beforePackageStart')
    }),
    beforePackageWrite: vi.fn(() => {
      order.push('beforePackageWrite')
      return true
    }),
    afterPackageWrite: vi.fn(() => {
      order.push('afterPackageWrite')
    }),
    afterPackageEnd: vi.fn(() => {
      order.push('afterPackageEnd')
    }),
    onDependencyProcessed: vi.fn(),
    onHasUpdates: vi.fn(() => {
      order.push('onHasUpdates')
    }),
    onErrorDeps: vi.fn(() => {
      order.push('onErrorDeps')
    }),
    onAllModeNoUpdates: vi.fn(() => {
      order.push('onAllModeNoUpdates')
    }),
    onPlannedUpdates: vi.fn(() => {
      order.push('onPlannedUpdates')
    }),
    onWriteResult: vi.fn(() => {
      order.push('onWriteResult')
    }),
    onDidWrite: vi.fn(() => {
      order.push('onDidWrite')
    }),
    logger: createLogger('silent'),
  }
}

function makeResult(didWrite = true) {
  return {
    planned: 1,
    applied: didWrite ? 1 : 0,
    skipped: 0,
    conflicted: 0,
    reverted: 0,
    failed: 0,
    unknown: didWrite ? 0 : 1,
    outcomes: [],
    diagnostics: [],
    didWrite,
  }
}

describe('package preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectInteractiveUpdatesMock.mockImplementation((updates: ResolvedDepChange[]) => updates)
  })

  it('classifies errors and updates without invoking any writer', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const pkg = makePkg('app')
    const error = makeResolved({ name: 'broken', diff: 'error' })
    const update = makeResolved({ name: 'ready', diff: 'minor' })
    const unchanged = makeResolved({ name: 'current', diff: 'none' })
    const resolved: ResolvedDepChange[] = [error, update, unchanged]
    Object.freeze(resolved)
    const order: string[] = []
    const hooks = makeHooks(order)

    const prepared = await preparePackage(
      pkg,
      { ...options, write: false },
      authority,
      hooks,
      resolved,
    )

    expect(prepared).toEqual({
      pkg,
      updates: [update],
      selected: [update],
      writeApproved: false,
      kind: 'none',
    })
    expect(hooks.onErrorDeps).toHaveBeenCalledWith([error])
    expect(hooks.onHasUpdates).toHaveBeenCalledWith([update])
    expect(hooks.beforePackageWrite).not.toHaveBeenCalled()
    expect(localWriterMock).not.toHaveBeenCalled()
    expect(globalWriterMock).not.toHaveBeenCalled()
    expect(resolved).toEqual([error, update, unchanged])
    expect(order).toEqual(['beforePackageStart', 'onErrorDeps', 'onHasUpdates'])

    await completePreparedPackage(prepared, undefined, hooks)
    expect(order).toEqual(['beforePackageStart', 'onErrorDeps', 'onHasUpdates', 'afterPackageEnd'])
  })

  it('returns an accepted local interactive selection before completion callbacks', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const pkg = makePkg('app')
    const updates = [makeResolved({ name: 'a' }), makeResolved({ name: 'b' })]
    const selected = [updates[1]!]
    selectInteractiveUpdatesMock.mockResolvedValue(selected)
    const order: string[] = []
    const hooks = makeHooks(order)

    const prepared = await preparePackage(
      pkg,
      { ...options, interactive: true, explain: true },
      authority,
      hooks,
      updates,
    )

    expect(selectInteractiveUpdatesMock).toHaveBeenCalledWith(updates, true)
    expect(hooks.beforePackageWrite).toHaveBeenCalledWith(pkg, selected)
    expect(prepared).toMatchObject({ selected, writeApproved: true, kind: 'local' })
    expect(order).toEqual(['beforePackageStart', 'onHasUpdates', 'beforePackageWrite'])

    const result = makeResult()
    await completePreparedPackage(prepared, result, hooks)
    expect(hooks.onWriteResult).toHaveBeenCalledWith(result)
    expect(hooks.afterPackageWrite).toHaveBeenCalledWith(pkg, selected)
    expect(order).toEqual([
      'beforePackageStart',
      'onHasUpdates',
      'beforePackageWrite',
      'onPlannedUpdates',
      'onWriteResult',
      'onDidWrite',
      'afterPackageWrite',
      'afterPackageEnd',
    ])
  })

  it('returns an accepted global decision without executing a manager', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const pkg = makePkg('global')
    pkg.type = 'global'
    pkg.filepath = 'global:npm'
    const update = makeResolved()
    const hooks = makeHooks()

    const prepared = await preparePackage(pkg, options, authority, hooks, [update])

    expect(prepared).toMatchObject({ selected: [update], writeApproved: true, kind: 'global' })
    expect(localWriterMock).not.toHaveBeenCalled()
    expect(globalWriterMock).not.toHaveBeenCalled()
    const result = makeResult(false)
    await completePreparedPackage(prepared, result, hooks)
    expect(hooks.onWriteResult).toHaveBeenCalledWith(result)
    expect(hooks.onDidWrite).not.toHaveBeenCalled()
    expect(hooks.afterPackageWrite).toHaveBeenCalledWith(pkg, [update])
    expect(hooks.afterPackageEnd).toHaveBeenCalledTimes(1)
  })

  it('omits write completion for rejected and empty selections', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const update = makeResolved()

    const rejectedHooks = makeHooks()
    vi.mocked(rejectedHooks.beforePackageWrite).mockResolvedValue(false)
    const rejected = await preparePackage(makePkg('rejected'), options, authority, rejectedHooks, [
      update,
    ])
    expect(rejected).toMatchObject({ writeApproved: false, kind: 'none' })
    await completePreparedPackage(rejected, undefined, rejectedHooks)
    expect(rejectedHooks.afterPackageWrite).not.toHaveBeenCalled()
    expect(rejectedHooks.afterPackageEnd).toHaveBeenCalledTimes(1)

    const emptyHooks = makeHooks()
    selectInteractiveUpdatesMock.mockResolvedValue([])
    const empty = await preparePackage(
      makePkg('empty'),
      { ...options, interactive: true },
      authority,
      emptyHooks,
      [update],
    )
    expect(empty).toMatchObject({ selected: [], writeApproved: false, kind: 'none' })
    expect(emptyHooks.beforePackageWrite).not.toHaveBeenCalled()
    await completePreparedPackage(empty, undefined, emptyHooks)
    expect(emptyHooks.afterPackageWrite).not.toHaveBeenCalled()
    expect(emptyHooks.afterPackageEnd).toHaveBeenCalledTimes(1)
  })

  it('reports all-mode no-updates only when resolution had no errors', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const hooks = makeHooks()
    const pkg = makePkg('current')
    const prepared = await preparePackage(pkg, { ...options, all: true }, authority, hooks, [
      makeResolved({ diff: 'none' }),
    ])

    expect(prepared).toMatchObject({ updates: [], selected: [], kind: 'none' })
    expect(hooks.onAllModeNoUpdates).toHaveBeenCalledTimes(1)
    await completePreparedPackage(prepared, undefined, hooks)

    const errorHooks = makeHooks()
    const errored = await preparePackage(
      makePkg('errored'),
      { ...options, all: true },
      authority,
      errorHooks,
      [makeResolved({ diff: 'error' })],
    )
    expect(errorHooks.onAllModeNoUpdates).not.toHaveBeenCalled()
    await completePreparedPackage(errored, undefined, errorHooks)
  })

  it('ends exactly once when preparation or completion hooks throw', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const update = makeResolved()
    const preparationHooks = makeHooks()
    vi.mocked(preparationHooks.beforePackageWrite).mockRejectedValue(
      new Error('reject hook failed'),
    )

    await expect(
      preparePackage(makePkg('prepare-failure'), options, authority, preparationHooks, [update]),
    ).rejects.toThrow('reject hook failed')
    expect(preparationHooks.afterPackageEnd).toHaveBeenCalledTimes(1)

    const completionHooks = makeHooks()
    vi.mocked(completionHooks.afterPackageWrite).mockRejectedValue(new Error('after write failed'))
    const prepared = await preparePackage(
      makePkg('completion-failure'),
      options,
      authority,
      completionHooks,
      [update],
    )
    await expect(completePreparedPackage(prepared, makeResult(), completionHooks)).rejects.toThrow(
      'after write failed',
    )
    expect(completionHooks.afterPackageEnd).toHaveBeenCalledTimes(1)
    await completePreparedPackage(prepared, makeResult(), completionHooks)
    expect(completionHooks.afterPackageEnd).toHaveBeenCalledTimes(1)
  })

  it.each(['onPlannedUpdates', 'onWriteResult', 'onDidWrite'] as const)(
    'ends exactly once when %s throws and omits later write callbacks',
    async (hookName) => {
      const { completePreparedPackage, preparePackage } = await import('./package-preparation')
      const hooks = makeHooks()
      vi.mocked(hooks[hookName]).mockImplementation(() => {
        throw new Error(`${hookName} failed`)
      })
      const prepared = await preparePackage(makePkg(hookName), options, authority, hooks, [
        makeResolved(),
      ])

      await expect(completePreparedPackage(prepared, makeResult(), hooks)).rejects.toThrow(
        `${hookName} failed`,
      )

      expect(hooks.afterPackageEnd).toHaveBeenCalledTimes(1)
      expect(hooks.afterPackageWrite).not.toHaveBeenCalled()
      if (hookName === 'onPlannedUpdates') {
        expect(hooks.onWriteResult).not.toHaveBeenCalled()
        expect(hooks.onDidWrite).not.toHaveBeenCalled()
      }
      if (hookName === 'onWriteResult') {
        expect(hooks.onDidWrite).not.toHaveBeenCalled()
      }
    },
  )

  it('preserves afterPackageEnd error precedence over an earlier completion error', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const hooks = makeHooks()
    vi.mocked(hooks.afterPackageWrite).mockRejectedValue(new Error('after write failed'))
    vi.mocked(hooks.afterPackageEnd).mockRejectedValue(new Error('end failed'))
    const prepared = await preparePackage(makePkg('precedence'), options, authority, hooks, [
      makeResolved(),
    ])

    await expect(completePreparedPackage(prepared, makeResult(), hooks)).rejects.toThrow(
      'end failed',
    )
    expect(hooks.afterPackageEnd).toHaveBeenCalledTimes(1)
  })

  it('rejects a write result for an unapproved package and still ends exactly once', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const hooks = makeHooks()
    const prepared = await preparePackage(
      makePkg('read-only'),
      { ...options, write: false },
      authority,
      hooks,
      [makeResolved()],
    )

    await expect(completePreparedPackage(prepared, makeResult(), hooks)).rejects.toThrow(
      'not approved for writing',
    )
    expect(hooks.afterPackageWrite).not.toHaveBeenCalled()
    expect(hooks.afterPackageEnd).toHaveBeenCalledTimes(1)
  })

  it('preserves processPackage writer success and writer failure callback semantics', async () => {
    const { processPackage } = await import('./process-package')
    const update = makeResolved()

    const successHooks = makeHooks()
    localWriterMock.mockResolvedValueOnce({
      outcomes: [
        {
          name: update.name,
          occurrence: {
            file: '/tmp/test/success/package.json',
            path: ['dependencies', update.name],
          },
          expectedValue: update.currentVersion,
          requestedValue: update.targetVersion,
          observedValue: update.targetVersion,
          status: 'applied',
          reason: 'APPLIED',
        },
      ],
      diagnostics: [],
    })
    await processPackage(makePkg('success'), options, authority, successHooks, [update])
    expect(successHooks.onWriteResult).toHaveBeenCalledTimes(1)
    expect(successHooks.onDidWrite).toHaveBeenCalledTimes(1)
    expect(successHooks.afterPackageWrite).toHaveBeenCalledTimes(1)
    expect(successHooks.afterPackageEnd).toHaveBeenCalledTimes(1)

    const failureHooks = makeHooks()
    localWriterMock.mockRejectedValueOnce(new Error('writer failed'))
    await expect(
      processPackage(makePkg('failure'), options, authority, failureHooks, [update]),
    ).rejects.toThrow('writer failed')
    expect(failureHooks.onWriteResult).not.toHaveBeenCalled()
    expect(failureHooks.onDidWrite).not.toHaveBeenCalled()
    expect(failureHooks.afterPackageWrite).not.toHaveBeenCalled()
    expect(failureHooks.afterPackageEnd).toHaveBeenCalledTimes(1)
  })

  it('does not call afterPackageEnd when beforePackageStart throws', async () => {
    const { preparePackage } = await import('./package-preparation')
    const hooks = makeHooks()
    vi.mocked(hooks.beforePackageStart).mockRejectedValue(new Error('start failed'))

    await expect(
      preparePackage(makePkg('start-failure'), options, authority, hooks, []),
    ).rejects.toThrow('start failed')
    expect(hooks.afterPackageEnd).not.toHaveBeenCalled()
  })

  it('resolves when no pre-resolved value is supplied without mutating the resolved array', async () => {
    const { completePreparedPackage, preparePackage } = await import('./package-preparation')
    const pkg = makePkg('resolved')
    const resolved: ResolvedDepChange[] = [makeResolved({ diff: 'none' })]
    Object.freeze(resolved)
    resolvePackageMock.mockResolvedValue(resolved)
    const hooks = makeHooks()

    const prepared = await preparePackage(pkg, options, authority, hooks)

    expect(resolvePackageMock).toHaveBeenCalledWith(
      pkg,
      options,
      hooks.cache,
      hooks.npmrc,
      hooks.workspacePackageNames,
      hooks.onDependencyProcessed,
    )
    expect(pkg.resolved).toBe(resolved)
    expect(resolved).toEqual([expect.objectContaining({ diff: 'none' })])
    await completePreparedPackage(prepared, undefined, hooks)
  })
})
