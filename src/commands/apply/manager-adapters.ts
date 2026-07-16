import { basename } from 'node:path'
import * as semver from 'semver'
import { getManagerPhaseSupport } from './manager-registry'

export type ManagerPhaseMode = 'sync-lockfile' | 'install'

export interface ManagerAdapterRequest {
  manager: string
  version: string
  lockfilePath: string
  mode: ManagerPhaseMode
  boundaryPath?: string
  platform?: NodeJS.Platform
}

export interface ManagerAdapter {
  executable: 'npm' | 'pnpm' | 'bun'
  args: string[]
  lifecycle: 'disabled-by-flag' | 'disabled-by-flag-and-pnpmfile-bypass'
  permittedPaths: string[]
  externalEffects: Array<'package-manager-cache' | 'dependency-install-state'>
}

export interface UnsupportedManagerAdapter {
  unsupported:
    | 'MANAGER_UNSUPPORTED'
    | 'MANAGER_VERSION_UNSUPPORTED'
    | 'LOCKFILE_UNSUPPORTED'
    | 'MANAGER_LOCKFILE_MISMATCH'
    | 'PROCESS_SUPERVISION_UNSUPPORTED'
}

const PNPM_CONTAINMENT_ARGS = [
  '--config.lockfile-dir=.',
  '--config.modules-dir=node_modules',
  '--config.virtual-store-dir=node_modules/.pnpm',
  '--config.node-linker=isolated',
  '--config.enable-global-virtual-store=false',
  '--config.enable-modules-dir=true',
  '--config.shared-workspace-lockfile=true',
  '--config.lockfile=true',
]

export function resolveManagerAdapter(
  request: ManagerAdapterRequest,
): ManagerAdapter | UnsupportedManagerAdapter {
  const lockfileName = basename(request.lockfilePath)
  if ((request.platform ?? process.platform) === 'win32') {
    return { unsupported: 'PROCESS_SUPERVISION_UNSUPPORTED' }
  }
  if (request.manager === 'yarn') return { unsupported: 'MANAGER_UNSUPPORTED' }
  if (lockfileName === 'bun.lockb') return { unsupported: 'LOCKFILE_UNSUPPORTED' }

  if (request.manager === 'npm') {
    const support = getManagerPhaseSupport('npm')
    if (!support) return { unsupported: 'MANAGER_UNSUPPORTED' }
    if (lockfileName !== 'package-lock.json' && lockfileName !== 'npm-shrinkwrap.json') {
      return { unsupported: 'MANAGER_LOCKFILE_MISMATCH' }
    }
    if (!satisfies(request.version, support.versionRange)) {
      return { unsupported: 'MANAGER_VERSION_UNSUPPORTED' }
    }
    return adapter(
      'npm',
      request.mode,
      request.lockfilePath,
      request.boundaryPath,
      request.mode === 'sync-lockfile'
        ? ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      'disabled-by-flag',
    )
  }

  if (request.manager === 'pnpm') {
    const support = getManagerPhaseSupport('pnpm')
    if (!support) return { unsupported: 'MANAGER_UNSUPPORTED' }
    if (lockfileName !== 'pnpm-lock.yaml') {
      return { unsupported: 'MANAGER_LOCKFILE_MISMATCH' }
    }
    if (!satisfies(request.version, support.versionRange)) {
      return { unsupported: 'MANAGER_VERSION_UNSUPPORTED' }
    }
    return adapter(
      'pnpm',
      request.mode,
      request.lockfilePath,
      request.boundaryPath,
      request.mode === 'sync-lockfile'
        ? [
            'install',
            '--lockfile-only',
            '--ignore-scripts',
            '--ignore-pnpmfile',
            '--no-frozen-lockfile',
            ...PNPM_CONTAINMENT_ARGS,
          ]
        : [
            'install',
            '--ignore-scripts',
            '--ignore-pnpmfile',
            '--no-frozen-lockfile',
            ...PNPM_CONTAINMENT_ARGS,
          ],
      'disabled-by-flag-and-pnpmfile-bypass',
    )
  }

  if (request.manager === 'bun') {
    const support = getManagerPhaseSupport('bun')
    if (!support) return { unsupported: 'MANAGER_UNSUPPORTED' }
    if (lockfileName !== 'bun.lock') return { unsupported: 'MANAGER_LOCKFILE_MISMATCH' }
    if (!satisfies(request.version, support.versionRange)) {
      return { unsupported: 'MANAGER_VERSION_UNSUPPORTED' }
    }
    return adapter(
      'bun',
      request.mode,
      request.lockfilePath,
      request.boundaryPath,
      request.mode === 'sync-lockfile'
        ? ['install', '--lockfile-only', '--ignore-scripts', '--no-progress', '--no-summary']
        : ['install', '--ignore-scripts', '--no-progress', '--no-summary'],
      'disabled-by-flag',
    )
  }

  return { unsupported: 'MANAGER_UNSUPPORTED' }
}

function adapter(
  executable: ManagerAdapter['executable'],
  mode: ManagerPhaseMode,
  lockfilePath: string,
  boundaryPath: string | undefined,
  args: string[],
  lifecycle: ManagerAdapter['lifecycle'],
): ManagerAdapter {
  return {
    executable,
    args: [...args],
    lifecycle,
    permittedPaths:
      mode === 'sync-lockfile'
        ? [lockfilePath]
        : [
            lockfilePath,
            boundaryPath && boundaryPath !== '.' ? `${boundaryPath}/node_modules` : 'node_modules',
          ],
    externalEffects:
      mode === 'sync-lockfile'
        ? ['package-manager-cache']
        : ['dependency-install-state', 'package-manager-cache'],
  }
}

function satisfies(version: string, range: string): boolean {
  const parsed = semver.valid(version)
  return parsed !== null && semver.satisfies(parsed, range)
}
