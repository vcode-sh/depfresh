import { vi } from 'vitest'
import type { BumpOptions, PackageMeta, ResolvedDepChange } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'

vi.mock('../../io/packages', () => ({
  loadPackages: vi.fn(),
}))

vi.mock('../../io/resolve', () => ({
  resolvePackage: vi.fn(),
}))

vi.mock('../../io/write', () => ({
  writePackage: vi.fn(),
  backupPackageFiles: vi.fn(() => [{ filepath: '/tmp/test/package.json', content: '{}' }]),
  restorePackageFiles: vi.fn(),
}))

vi.mock('../../cache/index', () => ({
  createSqliteCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 0, misses: 0, size: 0 })),
  })),
}))

vi.mock('../../utils/npmrc', () => ({
  loadNpmrc: vi.fn(() => ({
    registries: new Map(),
    defaultRegistry: 'https://registry.npmjs.org/',
    strictSsl: true,
  })),
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}))

vi.mock('../../io/global', () => ({
  writeGlobalPackage: vi.fn(),
}))

export const baseOptions: BumpOptions = {
  ...(DEFAULT_OPTIONS as BumpOptions),
  cwd: '/tmp/test',
  loglevel: 'silent',
}

export function makePkg(name: string, deps: ResolvedDepChange[] = []): PackageMeta {
  return {
    name,
    type: 'package.json',
    filepath: `/tmp/test/${name}/package.json`,
    deps: deps.map((d) => ({
      name: d.name,
      currentVersion: d.currentVersion,
      source: d.source,
      update: true,
      parents: [],
    })),
    resolved: [],
    raw: { name },
    indent: '  ',
  }
}

export function makeResolved(overrides: Partial<ResolvedDepChange> = {}): ResolvedDepChange {
  return {
    name: 'test-dep',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    targetVersion: '^2.0.0',
    diff: 'major',
    pkgData: { name: 'test-dep', versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    ...overrides,
  }
}

export interface CheckMocks {
  loadPackagesMock: ReturnType<typeof vi.fn>
  resolvePackageMock: ReturnType<typeof vi.fn>
  writePackageMock: ReturnType<typeof vi.fn>
  execSyncMock: ReturnType<typeof vi.fn>
  existsSyncMock: ReturnType<typeof vi.fn>
  backupPackageFilesMock: ReturnType<typeof vi.fn>
  restorePackageFilesMock: ReturnType<typeof vi.fn>
  writeGlobalPackageMock: ReturnType<typeof vi.fn>
}

export async function setupMocks(): Promise<CheckMocks> {
  const packagesModule = await import('../../io/packages')
  const resolveModule = await import('../../io/resolve')
  const writeModule = await import('../../io/write')
  const cp = await import('node:child_process')
  const fs = await import('node:fs')
  const globalModule = await import('../../io/global')

  return {
    loadPackagesMock: packagesModule.loadPackages as ReturnType<typeof vi.fn>,
    resolvePackageMock: resolveModule.resolvePackage as ReturnType<typeof vi.fn>,
    writePackageMock: writeModule.writePackage as ReturnType<typeof vi.fn>,
    execSyncMock: cp.execSync as ReturnType<typeof vi.fn>,
    existsSyncMock: fs.existsSync as ReturnType<typeof vi.fn>,
    backupPackageFilesMock: writeModule.backupPackageFiles as ReturnType<typeof vi.fn>,
    restorePackageFilesMock: writeModule.restorePackageFiles as ReturnType<typeof vi.fn>,
    writeGlobalPackageMock: globalModule.writeGlobalPackage as ReturnType<typeof vi.fn>,
  }
}
