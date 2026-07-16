import { describe, expect, it } from 'vitest'
import { resolveManagerAdapter } from './manager-adapters'

const pnpmContainmentArgs = [
  '--config.lockfile-dir=.',
  '--config.modules-dir=node_modules',
  '--config.virtual-store-dir=node_modules/.pnpm',
  '--config.node-linker=isolated',
  '--config.enable-global-virtual-store=false',
  '--config.enable-modules-dir=true',
  '--config.shared-workspace-lockfile=true',
  '--config.lockfile=true',
]

describe('Plan 020 manager adapters', () => {
  it.each([
    {
      manager: 'npm' as const,
      version: '10.9.4',
      lockfile: 'package-lock.json',
      syncArgs: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      installArgs: ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      lifecycle: 'disabled-by-flag',
      externalEffects: ['package-manager-cache'],
    },
    {
      manager: 'npm' as const,
      version: '11.18.0',
      lockfile: 'npm-shrinkwrap.json',
      syncArgs: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      installArgs: ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      lifecycle: 'disabled-by-flag',
      externalEffects: ['package-manager-cache'],
    },
    {
      manager: 'pnpm' as const,
      version: '10.33.0',
      lockfile: 'pnpm-lock.yaml',
      syncArgs: [
        'install',
        '--lockfile-only',
        '--ignore-scripts',
        '--ignore-pnpmfile',
        '--no-frozen-lockfile',
        ...pnpmContainmentArgs,
      ],
      installArgs: [
        'install',
        '--ignore-scripts',
        '--ignore-pnpmfile',
        '--no-frozen-lockfile',
        ...pnpmContainmentArgs,
      ],
      lifecycle: 'disabled-by-flag-and-pnpmfile-bypass',
      externalEffects: ['package-manager-cache'],
    },
    {
      manager: 'pnpm' as const,
      version: '11.0.0',
      lockfile: 'pnpm-lock.yaml',
      syncArgs: [
        'install',
        '--lockfile-only',
        '--ignore-scripts',
        '--ignore-pnpmfile',
        '--no-frozen-lockfile',
        ...pnpmContainmentArgs,
      ],
      installArgs: [
        'install',
        '--ignore-scripts',
        '--ignore-pnpmfile',
        '--no-frozen-lockfile',
        ...pnpmContainmentArgs,
      ],
      lifecycle: 'disabled-by-flag-and-pnpmfile-bypass',
      externalEffects: ['package-manager-cache'],
    },
    {
      manager: 'bun' as const,
      version: '1.2.0',
      lockfile: 'bun.lock',
      syncArgs: ['install', '--lockfile-only', '--ignore-scripts', '--no-progress', '--no-summary'],
      installArgs: ['install', '--ignore-scripts', '--no-progress', '--no-summary'],
      lifecycle: 'disabled-by-flag',
      externalEffects: ['package-manager-cache'],
    },
  ])('returns fixed no-shell commands for $manager@$version', (fixture) => {
    const sync = resolveManagerAdapter({
      manager: fixture.manager,
      version: fixture.version,
      lockfilePath: fixture.lockfile,
      mode: 'sync-lockfile',
    })
    const install = resolveManagerAdapter({
      manager: fixture.manager,
      version: fixture.version,
      lockfilePath: fixture.lockfile,
      mode: 'install',
    })

    expect(sync).toEqual({
      executable: fixture.manager,
      args: fixture.syncArgs,
      lifecycle: fixture.lifecycle,
      permittedPaths: [fixture.lockfile],
      externalEffects: fixture.externalEffects,
    })
    expect(install).toMatchObject({
      executable: fixture.manager,
      args: fixture.installArgs,
      lifecycle: fixture.lifecycle,
      permittedPaths: expect.arrayContaining([fixture.lockfile, 'node_modules']),
      externalEffects: expect.arrayContaining([
        'dependency-install-state',
        'package-manager-cache',
      ]),
    })
  })

  it('contains install state within a nested boundary', () => {
    expect(
      resolveManagerAdapter({
        manager: 'pnpm',
        version: '10.33.0',
        lockfilePath: 'apps/web/pnpm-lock.yaml',
        boundaryPath: 'apps/web',
        mode: 'install',
      }),
    ).toMatchObject({
      permittedPaths: ['apps/web/pnpm-lock.yaml', 'apps/web/node_modules'],
    })
  })

  it.each([
    ['npm', '9.9.4', 'package-lock.json', 'MANAGER_VERSION_UNSUPPORTED'],
    ['npm', '12.0.0', 'package-lock.json', 'MANAGER_VERSION_UNSUPPORTED'],
    ['pnpm', '9.15.0', 'pnpm-lock.yaml', 'MANAGER_VERSION_UNSUPPORTED'],
    ['bun', '1.1.99', 'bun.lock', 'MANAGER_VERSION_UNSUPPORTED'],
    ['bun', '2.0.0', 'bun.lock', 'MANAGER_VERSION_UNSUPPORTED'],
    ['yarn', '1.22.22', 'yarn.lock', 'MANAGER_UNSUPPORTED'],
    ['yarn', '4.7.0', 'yarn.lock', 'MANAGER_UNSUPPORTED'],
    ['bun', '1.2.0', 'bun.lockb', 'LOCKFILE_UNSUPPORTED'],
    ['npm', '11.0.0', 'pnpm-lock.yaml', 'MANAGER_LOCKFILE_MISMATCH'],
    ['pnpm', '10.33.0', 'package-lock.json', 'MANAGER_LOCKFILE_MISMATCH'],
    ['bun', '1.2.0', 'package-lock.json', 'MANAGER_LOCKFILE_MISMATCH'],
    ['npm', 'latest', 'package-lock.json', 'MANAGER_VERSION_UNSUPPORTED'],
  ] as const)(
    'fails closed for %s@%s with %s',
    (manager, version, lockfilePath, expectedReason) => {
      expect(
        resolveManagerAdapter({
          manager,
          version,
          lockfilePath,
          mode: 'sync-lockfile',
        }),
      ).toEqual({ unsupported: expectedReason })
    },
  )

  it('blocks manager execution where process-tree supervision is unavailable', () => {
    expect(
      resolveManagerAdapter({
        manager: 'npm',
        version: '11.0.0',
        lockfilePath: 'package-lock.json',
        mode: 'sync-lockfile',
        platform: 'win32',
      }),
    ).toEqual({ unsupported: 'PROCESS_SUPERVISION_UNSUPPORTED' })
  })

  it('returns fresh argv/path arrays that callers cannot mutate globally', () => {
    const first = resolveManagerAdapter({
      manager: 'npm',
      version: '11.0.0',
      lockfilePath: 'package-lock.json',
      mode: 'sync-lockfile',
    })
    expect('unsupported' in first).toBe(false)
    if ('unsupported' in first) return
    first.args.push('--hostile')
    first.permittedPaths.push('outside')

    expect(
      resolveManagerAdapter({
        manager: 'npm',
        version: '11.0.0',
        lockfilePath: 'package-lock.json',
        mode: 'sync-lockfile',
      }),
    ).toMatchObject({
      args: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      permittedPaths: ['package-lock.json'],
    })
  })
})
