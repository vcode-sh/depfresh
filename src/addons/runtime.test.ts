import { describe, expect, it, vi } from 'vitest'
import { ConfigError } from '../errors'
import type { depfreshOptions, PackageMeta, ResolvedDepChange } from '../types'
import { DEFAULT_OPTIONS } from '../types'
import { createAddonLifecycle } from './runtime'
import type { depfreshAddon } from './types'

function makeOptions(overrides: Partial<depfreshOptions> = {}): depfreshOptions {
  return {
    ...(DEFAULT_OPTIONS as depfreshOptions),
    cwd: '/tmp/test',
    loglevel: 'silent',
    ...overrides,
  }
}

function makePkg(name = 'app'): PackageMeta {
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

function makeDep(name = 'react'): ResolvedDepChange {
  return {
    name,
    currentVersion: '^18.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^19.0.0',
    diff: 'major',
    pkgData: { name, versions: ['18.0.0', '19.0.0'], distTags: { latest: '19.0.0' } },
  }
}

describe('createAddonLifecycle', () => {
  it('runs callbacks and addons in deterministic order', async () => {
    const order: string[] = []
    const addon: depfreshAddon = {
      name: 'timeline',
      setup() {
        order.push('addon.setup')
      },
      afterPackagesLoaded() {
        order.push('addon.afterPackagesLoaded')
      },
      beforePackageStart() {
        order.push('addon.beforePackageStart')
      },
      onDependencyResolved() {
        order.push('addon.onDependencyResolved')
      },
      beforePackageWrite() {
        order.push('addon.beforePackageWrite')
        return true
      },
      afterPackageWrite() {
        order.push('addon.afterPackageWrite')
      },
      afterPackageEnd() {
        order.push('addon.afterPackageEnd')
      },
      afterPackagesEnd() {
        order.push('addon.afterPackagesEnd')
      },
    }

    const lifecycle = createAddonLifecycle(
      makeOptions({
        addons: [addon],
        afterPackagesLoaded() {
          order.push('callback.afterPackagesLoaded')
        },
        beforePackageStart() {
          order.push('callback.beforePackageStart')
        },
        onDependencyResolved() {
          order.push('callback.onDependencyResolved')
        },
        beforePackageWrite() {
          order.push('callback.beforePackageWrite')
          return true
        },
        afterPackageWrite() {
          order.push('callback.afterPackageWrite')
        },
        afterPackageEnd() {
          order.push('callback.afterPackageEnd')
        },
        afterPackagesEnd() {
          order.push('callback.afterPackagesEnd')
        },
      }),
    )

    const pkg = makePkg()
    const dep = makeDep()

    await lifecycle.setup()
    await lifecycle.afterPackagesLoaded([pkg])
    await lifecycle.beforePackageStart(pkg)
    await lifecycle.onDependencyResolved(pkg, dep)
    await lifecycle.beforePackageWrite(pkg, [dep])
    await lifecycle.afterPackageWrite(pkg, [dep])
    await lifecycle.afterPackageEnd(pkg)
    await lifecycle.afterPackagesEnd([pkg])

    expect(order).toEqual([
      'addon.setup',
      'callback.afterPackagesLoaded',
      'addon.afterPackagesLoaded',
      'callback.beforePackageStart',
      'addon.beforePackageStart',
      'callback.onDependencyResolved',
      'addon.onDependencyResolved',
      'callback.beforePackageWrite',
      'addon.beforePackageWrite',
      'callback.afterPackageWrite',
      'addon.afterPackageWrite',
      'callback.afterPackageEnd',
      'addon.afterPackageEnd',
      'callback.afterPackagesEnd',
      'addon.afterPackagesEnd',
    ])
  })

  it('can block writes from addon beforePackageWrite', async () => {
    const addonBeforeWrite = vi.fn(() => false)
    const lifecycle = createAddonLifecycle(
      makeOptions({
        beforePackageWrite: () => true,
        addons: [
          {
            name: 'blocker',
            beforePackageWrite: addonBeforeWrite,
          },
        ],
      }),
    )

    const shouldWrite = await lifecycle.beforePackageWrite(makePkg(), [makeDep()])
    expect(shouldWrite).toBe(false)
    expect(addonBeforeWrite).toHaveBeenCalledTimes(1)
  })

  it('throws ConfigError for duplicate addon names', () => {
    expect(() =>
      createAddonLifecycle(
        makeOptions({
          addons: [{ name: 'dup' }, { name: 'dup' }],
        }),
      ),
    ).toThrow(ConfigError)
  })

  it('wraps addon failures with AddonError metadata', async () => {
    const lifecycle = createAddonLifecycle(
      makeOptions({
        addons: [
          {
            name: 'boom',
            afterPackagesEnd() {
              throw new Error('kaboom')
            },
          },
        ],
      }),
    )

    await expect(lifecycle.afterPackagesEnd([makePkg()])).rejects.toMatchObject({
      code: 'ERR_ADDON',
      addon: 'boom',
      hook: 'afterPackagesEnd',
    })
  })
})
