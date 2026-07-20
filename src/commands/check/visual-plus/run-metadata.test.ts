import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPackage } from '../../../io/packages/load-package'
import {
  DEFAULT_OPTIONS,
  type depfreshOptions,
  type PackageManagerField,
  type PackageMeta,
} from '../../../types'
import { deriveVisualPlusRunMetadata } from './run-metadata'

const processMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}))

const filesystemHooks = vi.hoisted(() => ({
  beforeOpen: undefined as ((path: string) => void) | undefined,
}))

vi.mock('node:child_process', () => processMocks)
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    openSync: ((path: string, flags: string | number, mode?: number) => {
      filesystemHooks.beforeOpen?.(path)
      return original.openSync(path, flags, mode)
    }) as typeof original.openSync,
  }
})

function packageMeta(
  root: string,
  filename: 'package.json' | 'package.yaml',
  name: string,
  packageManager?: PackageManagerField,
): PackageMeta {
  const filepath = join(root, filename)
  writeFileSync(
    filepath,
    filename === 'package.json'
      ? `${JSON.stringify({ name })}\n`
      : `name: ${JSON.stringify(name)}\n`,
  )
  return {
    ...loadPackage(filepath, { ...DEFAULT_OPTIONS, cwd: root } as depfreshOptions),
    ...(packageManager ? { packageManager } : {}),
  }
}

function nestedPackage(root: string, relativeDirectory: string, name: string): PackageMeta {
  const directory = join(root, relativeDirectory)
  mkdirSync(directory, { recursive: true })
  return packageMeta(directory, 'package.json', name)
}

function manager(name: PackageManagerField['name'], version: string): PackageManagerField {
  return { name, version, raw: `${name}@${version}` }
}

function presentation(detailLevel: 'compact' | 'full') {
  return {
    detailLevel,
    display: { group: false, sort: 'diff-asc' as const, timediff: false, nodecompat: false },
  }
}

describe('deriveVisualPlusRunMetadata', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-metadata-'))
    filesystemHooks.beforeOpen = undefined
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('describes one root package without inventing manager evidence', () => {
    const metadata = deriveVisualPlusRunMetadata(
      root,
      [packageMeta(root, 'package.json', 'solo')],
      presentation('compact'),
    )

    expect(metadata).toEqual({
      detailLevel: 'compact',
      display: { group: false, sort: 'diff-asc', timediff: false, nodecompat: false },
      repository: { name: 'solo', relativePath: '.' },
      workspaceScope: 'single-package',
      packageManager: { status: 'unknown', sources: [] },
    })
  })

  it('preserves immutable startup display intent after discovery', () => {
    const presentation = {
      detailLevel: 'compact' as const,
      display: {
        group: true,
        sort: 'time-desc' as const,
        timediff: false,
        nodecompat: true,
      },
    }

    const metadata = deriveVisualPlusRunMetadata(
      root,
      [packageMeta(root, 'package.json', 'solo')],
      presentation,
    )

    expect(metadata).toMatchObject(presentation)
    expect(metadata.display).not.toBe(presentation.display)
    expect(Object.isFrozen(metadata.display)).toBe(true)
  })

  it.each([
    ['package.json', '{}\n'],
    ['package.yaml', '{}\n'],
  ] as const)(
    'uses the controlled root basename for an unnamed %s manifest without exposing its absolute fallback',
    (filename, content) => {
      const filepath = join(root, filename)
      writeFileSync(filepath, content)
      const pkg = loadPackage(filepath, { ...DEFAULT_OPTIONS, cwd: root } as depfreshOptions)

      expect(pkg.name).toBe(root)
      const metadata = deriveVisualPlusRunMetadata(root, [pkg], presentation('compact'))

      expect(metadata.repository).toEqual({ name: basename(root), relativePath: '.' })
      expect(JSON.stringify(metadata)).not.toContain(root)
    },
  )

  it('describes a multi-package workspace from physical manifest owners', () => {
    const rootPackage = packageMeta(root, 'package.json', 'workspace-root')

    expect(
      deriveVisualPlusRunMetadata(
        root,
        [nestedPackage(root, 'packages/web', 'web'), rootPackage],
        presentation('full'),
      ),
    ).toMatchObject({
      detailLevel: 'full',
      repository: { name: 'workspace-root', relativePath: '.' },
      workspaceScope: 'workspace',
    })
  })

  it.each(['outside the effective root', 'through a symlink escape'])(
    'does not let a workspace catalog projection %s change a single-package scope',
    (location) => {
      const external = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-catalog-'))
      const externalCatalog = join(external, 'pnpm-workspace.yaml')
      writeFileSync(externalCatalog, 'catalog: {}\n')
      const filepath =
        location === 'outside the effective root'
          ? externalCatalog
          : join(root, 'pnpm-workspace.yaml')
      if (location === 'through a symlink escape') symlinkSync(externalCatalog, filepath)

      try {
        expect(
          deriveVisualPlusRunMetadata(
            root,
            [
              packageMeta(root, 'package.json', 'solo'),
              {
                name: 'catalog',
                type: 'pnpm-workspace',
                filepath,
                deps: [],
                resolved: [],
                raw: {},
                indent: '  ',
              },
            ],
            presentation('compact'),
          ).workspaceScope,
        ).toBe('single-package')
      } finally {
        rmSync(external, { recursive: true, force: true })
      }
    },
  )

  it('does not accept a parent-traversing manifest path through canonical fallback', () => {
    mkdirSync(join(root, 'nested'))
    const manifest = packageMeta(root, 'package.json', 'solo')

    expect(
      deriveVisualPlusRunMetadata(
        root,
        [{ ...manifest, filepath: `${root}/nested/../package.json` }],
        presentation('compact'),
      ),
    ).toMatchObject({
      repository: { relativePath: '.' },
      workspaceScope: 'unknown',
    })
  })

  it('uses a root packageManager declaration with its exact version and source', () => {
    const metadata = deriveVisualPlusRunMetadata(
      root,
      [packageMeta(root, 'package.json', 'declared', manager('pnpm', '10.33.0'))],
      presentation('compact'),
    )

    expect(metadata.packageManager).toEqual({
      status: 'observed',
      name: 'pnpm',
      version: '10.33.0',
      sources: ['package.json'],
    })
  })

  it('coalesces coherent root declarations without losing their sources', () => {
    const json = packageMeta(root, 'package.json', 'root', manager('pnpm', '10.33.0'))
    const yaml = packageMeta(root, 'package.yaml', 'root', manager('pnpm', '10.33.0'))

    expect(
      deriveVisualPlusRunMetadata(root, [yaml, json], presentation('compact')).packageManager,
    ).toEqual({
      status: 'observed',
      name: 'pnpm',
      version: '10.33.0',
      sources: ['package.json', 'package.yaml'],
    })
  })

  it('retains conflicting declarations as deterministic ambiguous candidates', () => {
    const json = packageMeta(root, 'package.json', 'root', manager('pnpm', '10.33.0'))
    const yaml = packageMeta(root, 'package.yaml', 'root', manager('npm', '11.12.1'))

    expect(
      deriveVisualPlusRunMetadata(root, [json, yaml], presentation('compact')).packageManager,
    ).toEqual({
      status: 'ambiguous',
      candidates: [
        { name: 'pnpm', version: '10.33.0', source: 'package.json' },
        { name: 'npm', version: '11.12.1', source: 'package.yaml' },
      ],
    })
  })

  it('uses one readable contained lockfile marker when no declaration exists', () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    expect(
      deriveVisualPlusRunMetadata(
        root,
        [packageMeta(root, 'package.json', 'marker-only')],
        presentation('compact'),
      ).packageManager,
    ).toEqual({ status: 'observed', name: 'pnpm', sources: ['pnpm-lock.yaml'] })
  })

  it('rejects a lexical lockfile symlink whose target remains contained', () => {
    const target = join(root, 'contained-pnpm-lock.yaml')
    writeFileSync(target, "lockfileVersion: '9.0'\n")
    symlinkSync(target, join(root, 'pnpm-lock.yaml'))

    expect(
      deriveVisualPlusRunMetadata(
        root,
        [packageMeta(root, 'package.json', 'contained-symlink')],
        presentation('compact'),
      ).packageManager,
    ).toEqual({ status: 'unavailable', sources: ['pnpm-lock.yaml'] })
  })

  it('rejects lockfile marker evidence replaced between lexical inspection and open', () => {
    const marker = join(root, 'pnpm-lock.yaml')
    const replacement = join(root, 'replacement-pnpm-lock.yaml')
    writeFileSync(marker, "lockfileVersion: '9.0'\n")
    writeFileSync(replacement, "lockfileVersion: '9.0'\n")
    let replaced = false
    filesystemHooks.beforeOpen = (path) => {
      if (!path.endsWith('/pnpm-lock.yaml')) return
      filesystemHooks.beforeOpen = undefined
      renameSync(replacement, marker)
      replaced = true
    }

    const packageManager = deriveVisualPlusRunMetadata(
      root,
      [packageMeta(root, 'package.json', 'replacement-race')],
      presentation('compact'),
    ).packageManager

    expect(replaced).toBe(true)
    expect(packageManager).toEqual({ status: 'unavailable', sources: ['pnpm-lock.yaml'] })
  })

  it('does not collapse a lockfile marker removed before open into absent evidence', () => {
    const marker = join(root, 'pnpm-lock.yaml')
    writeFileSync(marker, "lockfileVersion: '9.0'\n")
    filesystemHooks.beforeOpen = (path) => {
      if (!path.endsWith('/pnpm-lock.yaml')) return
      filesystemHooks.beforeOpen = undefined
      rmSync(marker)
    }

    expect(
      deriveVisualPlusRunMetadata(
        root,
        [packageMeta(root, 'package.json', 'removal-race')],
        presentation('compact'),
      ).packageManager,
    ).toEqual({ status: 'unavailable', sources: ['pnpm-lock.yaml'] })
  })

  it('retains conflicting markers as deterministic ambiguous candidates', () => {
    writeFileSync(join(root, 'yarn.lock'), '# yarn lockfile v1\n')
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')

    expect(
      deriveVisualPlusRunMetadata(
        root,
        [packageMeta(root, 'package.json', 'conflicting-markers')],
        presentation('compact'),
      ).packageManager,
    ).toEqual({
      status: 'ambiguous',
      candidates: [
        { name: 'npm', source: 'package-lock.json' },
        { name: 'yarn', source: 'yarn.lock' },
      ],
    })
  })

  it('reports absent manager evidence as unknown only after discovery', () => {
    expect(deriveVisualPlusRunMetadata(root, [], presentation('compact'))).toEqual({
      detailLevel: 'compact',
      display: { group: false, sort: 'diff-asc', timediff: false, nodecompat: false },
      repository: { relativePath: '.' },
      workspaceScope: 'unknown',
      packageManager: { status: 'unknown', sources: [] },
    })
  })

  it('reports unsafe and unreadable marker-shaped entries as unavailable', () => {
    const external = mkdtempSync(join(tmpdir(), 'depfresh-visual-plus-external-'))
    writeFileSync(join(external, 'lock.yaml'), "lockfileVersion: '9.0'\n")
    symlinkSync(join(external, 'lock.yaml'), join(root, 'pnpm-lock.yaml'))
    mkdirSync(join(root, 'yarn.lock'))

    try {
      expect(
        deriveVisualPlusRunMetadata(
          root,
          [packageMeta(root, 'package.json', 'unsafe-markers')],
          presentation('compact'),
        ).packageManager,
      ).toEqual({ status: 'unavailable', sources: ['pnpm-lock.yaml', 'yarn.lock'] })
    } finally {
      rmSync(external, { recursive: true, force: true })
    }
  })

  it('preserves hostile names for the validated renderer sanitization boundary', () => {
    const hostile = 'spreadu\u001B]0;owned\u0007\nforged'

    expect(
      deriveVisualPlusRunMetadata(
        root,
        [packageMeta(root, 'package.json', hostile, manager('pnpm', '10.33.0'))],
        presentation('compact'),
      ).repository?.name,
    ).toBe(hostile)
  })

  it('orders sources independently of package enumeration and performs no process work', () => {
    const json = packageMeta(root, 'package.json', 'root', manager('pnpm', '10.33.0'))
    const yaml = packageMeta(root, 'package.yaml', 'root', manager('pnpm', '10.33.0'))
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const forward = deriveVisualPlusRunMetadata(root, [json, yaml], presentation('compact'))
    const reverse = deriveVisualPlusRunMetadata(root, [yaml, json], presentation('compact'))

    expect(reverse).toEqual(forward)
    expect(reverse.packageManager).toEqual({
      status: 'observed',
      name: 'pnpm',
      version: '10.33.0',
      sources: ['package.json', 'package.yaml', 'pnpm-lock.yaml'],
    })
    for (const processMock of Object.values(processMocks)) {
      expect(processMock).not.toHaveBeenCalled()
    }
  })
})
