import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  RepositoryEvidenceConclusion,
  RepositoryEvidenceKind,
  RepositoryModel,
} from '../types/repository'
import { inspectRepository } from './inspect'

function writeJson(filepath: string, value: unknown): void {
  mkdirSync(dirname(filepath), { recursive: true })
  writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`)
}

function sha256(filepath: string): string {
  return createHash('sha256').update(readFileSync(filepath)).digest('hex')
}

function boundaryId(model: RepositoryModel, path: string): string {
  const boundary = model.boundaries?.find((candidate) => candidate.path === path)
  if (!boundary) throw new Error(`Missing boundary: ${path}`)
  return boundary.id
}

function evidence(
  model: RepositoryModel,
  kind: RepositoryEvidenceKind,
  boundaryPath?: string,
): RepositoryEvidenceConclusion {
  const owner = boundaryPath === undefined ? undefined : boundaryId(model, boundaryPath)
  const result = model.evidence?.find(
    (candidate) => candidate.kind === kind && candidate.boundaryId === owner,
  )
  if (!result) throw new Error(`Missing ${kind} evidence for ${boundaryPath ?? 'repository'}`)
  return result
}

function valueNames(conclusion: RepositoryEvidenceConclusion): string[] {
  return conclusion.value.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null || !('name' in candidate)) return []
    return [String(candidate.name)]
  })
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Evidence Test',
      GIT_AUTHOR_EMAIL: 'evidence@example.test',
      GIT_COMMITTER_NAME: 'Evidence Test',
      GIT_COMMITTER_EMAIL: 'evidence@example.test',
    },
    stdio: 'ignore',
  })
}

describe('repository evidence', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-evidence-'))
    writeJson(join(root, 'package.json'), { name: 'root' })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps conflicting manager fields ambiguous and diagnoses a lockfile mismatch', async () => {
    writeJson(join(root, 'package.json'), {
      name: 'json-root',
      packageManager: 'pnpm@10.1.0+sha512.pnpm',
    })
    writeFileSync(
      join(root, 'package.yaml'),
      'name: yaml-root\npackageManager: yarn@4.7.0+sha512.yarn\n',
    )
    writeJson(join(root, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })

    const model = await inspectRepository({ cwd: root })
    const manager = evidence(model, 'package-manager', '.')

    expect(manager.status).toBe('ambiguous')
    expect(valueNames(manager)).toEqual(['pnpm', 'yarn'])
    expect(manager.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'pnpm',
          version: '10.1.0',
          hash: 'sha512.pnpm',
          raw: 'pnpm@10.1.0+sha512.pnpm',
        }),
      ]),
    )
    expect(manager.sources.map((source) => source.path)).toEqual(['package.json', 'package.yaml'])
    expect(manager.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PACKAGE_MANAGER_LOCKFILE_MISMATCH',
    )
  })

  it('lets one valid boundary-root field stay authoritative across a lockfile mismatch', async () => {
    writeJson(join(root, 'package.json'), {
      name: 'root',
      packageManager: 'pnpm@10.2.0+sha512.exact',
    })
    writeJson(join(root, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })

    const model = await inspectRepository({ cwd: root })
    const manager = evidence(model, 'package-manager', '.')

    expect(manager.status).toBe('confirmed')
    expect(manager.value).toEqual([
      {
        name: 'pnpm',
        version: '10.2.0',
        hash: 'sha512.exact',
        raw: 'pnpm@10.2.0+sha512.exact',
      },
    ])
    expect(manager.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PACKAGE_MANAGER_LOCKFILE_MISMATCH',
    ])
  })

  it('separates manager confirmation from same-manager lockfile selection ambiguity', async () => {
    writeJson(join(root, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })
    writeJson(join(root, 'npm-shrinkwrap.json'), { name: 'root', lockfileVersion: 3 })

    const model = await inspectRepository({ cwd: root })

    expect(evidence(model, 'package-manager', '.')).toMatchObject({
      status: 'confirmed',
      value: [{ name: 'npm' }],
    })
    expect(evidence(model, 'lockfile-selection', '.')).toMatchObject({
      status: 'ambiguous',
      value: expect.arrayContaining(model.lockfiles!.map((lockfile) => lockfile.id)),
    })
    expect(model.lockfiles).toHaveLength(2)
  })

  it('keeps cross-manager lockfiles ambiguous with every candidate', async () => {
    writeJson(join(root, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const model = await inspectRepository({ cwd: root })

    expect(evidence(model, 'package-manager', '.').status).toBe('ambiguous')
    expect(valueNames(evidence(model, 'package-manager', '.'))).toEqual(['npm', 'pnpm'])
    expect(evidence(model, 'lockfile-selection', '.').status).toBe('ambiguous')
  })

  it('owns nested lockfiles at the nearest boundary without contaminating the root', async () => {
    writeJson(join(root, 'package.json'), {
      name: 'root',
      packageManager: 'npm@11.0.0',
      workspaces: ['packages/*', 'vendor'],
    })
    writeJson(join(root, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })
    writeJson(join(root, 'vendor', 'package.json'), {
      name: 'vendor',
      packageManager: 'pnpm@10.0.0',
      workspaces: ['packages/*'],
    })
    writeFileSync(join(root, 'vendor', 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    writeFileSync(join(root, 'vendor', 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const model = await inspectRepository({ cwd: root })
    const rootBoundary = boundaryId(model, '.')
    const nestedBoundary = boundaryId(model, 'vendor')

    expect(model.lockfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'package-lock.json', boundaryId: rootBoundary }),
        expect.objectContaining({ path: 'vendor/pnpm-lock.yaml', boundaryId: nestedBoundary }),
      ]),
    )
    expect(valueNames(evidence(model, 'package-manager', '.'))).toEqual(['npm'])
    expect(valueNames(evidence(model, 'package-manager', 'vendor'))).toEqual(['pnpm'])
    expect(model.relationships.lockfileBoundaries).toHaveLength(2)
    expect(model.relationships.boundaryPackages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundaryId: rootBoundary }),
        expect.objectContaining({ boundaryId: nestedBoundary }),
      ]),
    )
  })

  it('changes exact source and lockfile hashes for one-byte changes only', async () => {
    const manifestPath = join(root, 'package.json')
    const lockfilePath = join(root, 'package-lock.json')
    writeFileSync(manifestPath, '{"name":"aaaa"}\n')
    writeJson(lockfilePath, { name: 'aaaa', lockfileVersion: 3 })

    const first = await inspectRepository({ cwd: root })
    writeFileSync(manifestPath, '{"name":"aaab"}\n')
    const second = await inspectRepository({ cwd: root })
    writeFileSync(lockfilePath, readFileSync(lockfilePath, 'utf-8').replace('aaaa', 'aaab'))
    const third = await inspectRepository({ cwd: root })

    expect(first.sourceFiles[0]?.byteHash).not.toBe(second.sourceFiles[0]?.byteHash)
    expect(first.lockfiles![0]?.byteHash).toBe(second.lockfiles![0]?.byteHash)
    expect(second.sourceFiles[0]?.byteHash).toBe(third.sourceFiles[0]?.byteHash)
    expect(second.lockfiles![0]?.byteHash).not.toBe(third.lockfiles![0]?.byteHash)
    expect(third.sourceFiles[0]?.byteHash).toBe(sha256(manifestPath))
    expect(third.lockfiles![0]?.byteHash).toBe(sha256(lockfilePath))
  })

  it('records malformed text lockfiles and binary Bun lockfiles without executing them', async () => {
    writeFileSync(join(root, 'package-lock.json'), '{not-json')
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: [unterminated')
    writeFileSync(join(root, 'yarn.lock'), 'not a Yarn lockfile\n')
    writeFileSync(join(root, 'bun.lock'), '{not-json')
    writeFileSync(join(root, 'bun.lockb'), Buffer.from([0, 1, 2, 3]))

    const model = await inspectRepository({ cwd: root })
    const byPath = new Map(model.lockfiles!.map((lockfile) => [lockfile.path, lockfile]))

    expect(byPath.get('package-lock.json')?.parseState).toBe('error')
    expect(byPath.get('pnpm-lock.yaml')?.parseState).toBe('error')
    expect(byPath.get('yarn.lock')?.parseState).toBe('error')
    expect(byPath.get('bun.lock')?.parseState).toBe('error')
    expect(byPath.get('bun.lockb')?.parseState).toBe('unsupported')
    expect(byPath.get('bun.lockb')?.byteHash).toBe(sha256(join(root, 'bun.lockb')))
  })

  it('rejects structurally malformed known lockfile formats after syntax parsing', async () => {
    writeJson(join(root, 'package-lock.json'), {})
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'other: true\n')
    writeFileSync(join(root, 'yarn.lock'), '__metadata:\n  cacheKey: 10\n')
    writeJson(join(root, 'bun.lock'), {})

    const model = await inspectRepository({ cwd: root })

    expect(model.lockfiles?.map((lockfile) => [lockfile.path, lockfile.parseState])).toEqual([
      ['bun.lock', 'error'],
      ['package-lock.json', 'error'],
      ['pnpm-lock.yaml', 'error'],
      ['yarn.lock', 'error'],
    ])
  })

  it('rejects escaped lockfile symlinks and deduplicates physical aliases', async () => {
    const external = `${root}-external-lock.json`
    writeJson(external, { name: 'external', lockfileVersion: 3 })
    writeJson(join(root, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })
    symlinkSync(join(root, 'package-lock.json'), join(root, 'npm-shrinkwrap.json'))
    symlinkSync(external, join(root, 'bun.lock'))

    try {
      const model = await inspectRepository({ cwd: root })

      expect(model.lockfiles).toEqual([
        expect.objectContaining({
          path: 'package-lock.json',
          manager: 'npm',
          parseState: 'parsed',
        }),
      ])
      expect(model.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(['LOCKFILE_DUPLICATE_IDENTITY', 'LOCKFILE_OUTSIDE_ROOT']),
      )
      expect(JSON.stringify(model)).not.toContain(external)
    } finally {
      rmSync(external, { force: true })
    }
  })

  it('selects a direct lockfile over cross-manager aliases independent of creation order', async () => {
    const other = mkdtempSync(join(tmpdir(), 'depfresh-evidence-alias-order-'))
    try {
      writeJson(join(root, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })
      symlinkSync(join(root, 'package-lock.json'), join(root, 'bun.lock'))
      writeJson(join(other, 'package.json'), { name: 'root' })
      symlinkSync(join(other, 'package-lock.json'), join(other, 'bun.lock'))
      writeJson(join(other, 'package-lock.json'), { name: 'root', lockfileVersion: 3 })

      const first = await inspectRepository({ cwd: root })
      const second = await inspectRepository({ cwd: other })

      expect(first.lockfiles).toEqual([
        expect.objectContaining({ path: 'package-lock.json', manager: 'npm' }),
      ])
      expect(second.lockfiles).toEqual(first.lockfiles)
      expect(second.diagnostics).toEqual(first.diagnostics)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('keeps cross-manager aliases ambiguous when no canonical lockfile path exists', async () => {
    const payload = join(root, 'shared-lock-data')
    writeJson(payload, { lockfileVersion: 3 })
    symlinkSync(payload, join(root, 'package-lock.json'))
    symlinkSync(payload, join(root, 'bun.lock'))

    const model = await inspectRepository({ cwd: root })

    expect(model.lockfiles).toEqual([])
    expect(evidence(model, 'lockfile-selection', '.').status).toBe('ambiguous')
    expect(evidence(model, 'package-manager', '.')).toMatchObject({
      status: 'ambiguous',
      value: [{ name: 'bun' }, { name: 'npm' }],
    })
    expect(evidence(model, 'package-manager', '.').sources.map((source) => source.path)).toEqual([
      'bun.lock',
      'package-lock.json',
    ])
  })

  it('parses real Bun JSONC lockfiles with comments and trailing commas', async () => {
    writeFileSync(
      join(root, 'bun.lock'),
      `{
  // A URL inside a string is data, not a comment.
  "lockfileVersion": 1,
  "packages": {
    "example": ["example@1.0.0", "https://registry.example.test/a//b"],
  },
}
`,
    )

    const model = await inspectRepository({ cwd: root })

    expect(model.lockfiles).toEqual([
      expect.objectContaining({
        path: 'bun.lock',
        manager: 'bun',
        parseState: 'parsed',
        formatVersion: '1',
      }),
    ])
  })

  it('keeps conflicting workspace declarations ambiguous and preserves every marker', async () => {
    writeJson(join(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] })
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'modules/*'\n")

    const model = await inspectRepository({ cwd: root })
    const workspace = evidence(model, 'workspace', '.')
    const boundary = model.boundaries?.find((candidate) => candidate.path === '.')

    expect(workspace.status).toBe('ambiguous')
    expect(workspace.sources.map((source) => source.path)).toEqual([
      'package.json',
      'pnpm-workspace.yaml',
    ])
    expect(workspace.sources[0]).toMatchObject({
      kind: 'field',
      field: ['workspaces'],
    })
    expect(boundary?.markers.map((marker) => marker.path)).toEqual([
      'package.json',
      'pnpm-workspace.yaml',
    ])
  })

  it('reports malformed workspace declarations as unsupported instead of confirmed', async () => {
    writeJson(join(root, 'package.json'), { name: 'root', workspaces: 'packages/*' })
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: [unterminated\n')
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: [unterminated\n')

    const model = await inspectRepository({ cwd: root })
    const workspace = evidence(model, 'workspace', '.')

    expect(workspace.status).toBe('unsupported')
    expect(workspace.sources.map((source) => source.path)).toEqual([
      '.yarnrc.yml',
      'package.json',
      'pnpm-workspace.yaml',
    ])
    expect(workspace.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'WORKSPACE_DECLARATION_UNSUPPORTED',
      'WORKSPACE_DECLARATION_UNSUPPORTED',
      'WORKSPACE_DECLARATION_UNSUPPORTED',
    ])
  })

  it('accepts catalog-only pnpm workspace files and empty Yarn configuration markers', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "catalog:\n  react: '19.0.0'\n")
    writeFileSync(join(root, '.yarnrc.yml'), '')

    const model = await inspectRepository({ cwd: root })
    const workspace = evidence(model, 'workspace', '.')

    expect(workspace.status).toBe('confirmed')
    expect(workspace.value).toEqual([
      { marker: 'yarn-workspace', declaration: [] },
      { marker: 'pnpm-workspace', declaration: [] },
    ])
    expect(workspace.diagnostics).toEqual([])
  })

  it('never exposes unrelated Yarn configuration or registry credentials', async () => {
    writeFileSync(
      join(root, '.yarnrc.yml'),
      [
        'nodeLinker: node-modules',
        'npmScopes:',
        '  private:',
        '    npmRegistryServer: https://registry.example.test',
        '    npmAuthToken: super-secret-token',
        '',
      ].join('\n'),
    )

    const model = await inspectRepository({ cwd: root })
    const workspace = evidence(model, 'workspace', '.')
    const serialized = JSON.stringify(model)

    expect(workspace.status).toBe('confirmed')
    expect(workspace.value).toEqual([{ marker: 'yarn-workspace', declaration: [] }])
    expect(workspace.sources.map((source) => source.path)).toEqual(['.yarnrc.yml'])
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('registry.example.test')
  })

  it('uses the nearest nested Git boundary instead of an outer workspace root', async () => {
    writeJson(join(root, 'package.json'), { name: 'outer', workspaces: ['vendor/*'] })
    const nested = join(root, 'vendor', 'nested')
    writeJson(join(nested, 'package.json'), { name: 'nested' })
    mkdirSync(join(nested, 'src'))
    git(nested, 'init', '--quiet')

    const model = await inspectRepository({ cwd: join(nested, 'src') })

    expect(model.root).toMatchObject({ path: '.', discoveryMode: 'inside-project' })
    expect(model.sourceFiles.map((source) => source.path)).toEqual(['package.json'])
    expect(JSON.stringify(model)).not.toContain(root)
  })

  it('models repository runtime declarations but never the executor Node version', async () => {
    writeJson(join(root, 'package.json'), { name: 'root', engines: { node: '>=24.15.0' } })
    writeFileSync(join(root, '.nvmrc'), '24.15.0\n')
    writeFileSync(join(root, '.node-version'), '24.16.0\n')
    writeFileSync(join(root, '.tool-versions'), 'nodejs 24.17.0\npython 3.14.0\n')

    const model = await inspectRepository({ cwd: root })
    const runtime = evidence(model, 'runtime', '.')

    expect(runtime.status).toBe('ambiguous')
    expect(model.runtimeDeclarations!.map((entry) => entry.declaredText)).toEqual([
      '24.16.0',
      '24.15.0',
      '24.17.0',
      '>=24.15.0',
    ])
    expect(model.runtimeDeclarations!.filter((entry) => entry.byteHash)).toHaveLength(3)
    expect(JSON.stringify(model)).not.toContain(process.version)
    expect(JSON.stringify(model)).not.toContain('python 3.14.0')
  })

  it('reports unsupported runtime syntax without guessing', async () => {
    writeFileSync(join(root, '.tool-versions'), 'nodejs\n')

    const model = await inspectRepository({ cwd: root })

    expect(evidence(model, 'runtime', '.')).toMatchObject({ status: 'unsupported', value: [] })
    expect(evidence(model, 'runtime', '.').diagnostics.map((entry) => entry.code)).toEqual([
      'RUNTIME_DECLARATION_UNSUPPORTED',
    ])
  })

  it('retains a multi-value tool-versions declaration without interpreting fallback policy', async () => {
    writeFileSync(join(root, '.tool-versions'), 'nodejs 24.15.0 system\n')

    const model = await inspectRepository({ cwd: root })

    expect(model.runtimeDeclarations).toEqual([
      expect.objectContaining({
        kind: 'tool-versions-nodejs',
        declaredText: '24.15.0 system',
      }),
    ])
    expect(evidence(model, 'runtime', '.').status).toBe('confirmed')
  })

  it('assigns unsupported runtime diagnostics once and rejects duplicate nodejs tool entries', async () => {
    writeJson(join(root, 'package.json'), { name: 'root', workspaces: ['vendor'] })
    writeFileSync(join(root, '.tool-versions'), 'nodejs\n')
    writeJson(join(root, 'vendor', 'package.json'), {
      name: 'vendor',
      workspaces: ['packages/*'],
    })
    writeFileSync(join(root, 'vendor', '.tool-versions'), 'nodejs 24.15.0\nnodejs 24.16.0\n')

    const model = await inspectRepository({ cwd: root })
    const rootRuntime = evidence(model, 'runtime', '.')
    const nestedRuntime = evidence(model, 'runtime', 'vendor')

    expect(rootRuntime.diagnostics).toHaveLength(1)
    expect(rootRuntime.diagnostics[0]?.path).toBe('.tool-versions')
    expect(nestedRuntime).toMatchObject({ status: 'unsupported', value: [] })
    expect(nestedRuntime.diagnostics).toHaveLength(1)
    expect(nestedRuntime.diagnostics[0]?.path).toBe('vendor/.tool-versions')
    expect(model.runtimeDeclarations).toEqual([])
  })

  it('retains invalid manager declarations and valid lockfile evidence without guessing', async () => {
    writeJson(join(root, 'package.json'), { name: 'root', packageManager: 'unknown-manager' })
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const model = await inspectRepository({ cwd: root })
    const manager = evidence(model, 'package-manager', '.')

    expect(manager.status).toBe('unsupported')
    expect(manager.value).toEqual([{ name: 'pnpm' }, { raw: 'unknown-manager' }])
    expect(manager.sources.map((source) => source.path)).toEqual(['package.json', 'pnpm-lock.yaml'])
    expect(manager.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PACKAGE_MANAGER_INVALID',
    ])
  })

  it('returns unavailable evidence for unreadable lockfiles and runtime files without throwing', async () => {
    const lockfile = join(root, 'pnpm-lock.yaml')
    const runtime = join(root, '.nvmrc')
    writeFileSync(lockfile, "lockfileVersion: '9.0'\n")
    writeFileSync(runtime, '24.15.0\n')
    chmodSync(lockfile, 0o000)
    chmodSync(runtime, 0o000)

    try {
      const model = await inspectRepository({ cwd: root })

      expect(model.lockfiles).toEqual([
        expect.objectContaining({ path: 'pnpm-lock.yaml', parseState: 'unavailable' }),
      ])
      expect(model.lockfiles?.[0]).not.toHaveProperty('byteHash')
      expect(evidence(model, 'lockfile-selection', '.').status).toBe('unavailable')
      expect(evidence(model, 'runtime', '.').status).toBe('unavailable')
      expect(model.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(['LOCKFILE_UNAVAILABLE', 'RUNTIME_DECLARATION_UNAVAILABLE']),
      )
    } finally {
      chmodSync(lockfile, 0o600)
      chmodSync(runtime, 0o600)
    }
  })

  it('does not confirm partial runtime evidence when another declaration is unavailable', async () => {
    writeJson(join(root, 'package.json'), { name: 'root', engines: { node: '>=24' } })
    const runtime = join(root, '.nvmrc')
    writeFileSync(runtime, '24.15.0\n')
    chmodSync(runtime, 0o000)

    try {
      const model = await inspectRepository({ cwd: root })

      expect(model.runtimeDeclarations?.map((entry) => entry.declaredText)).toEqual(['>=24'])
      expect(evidence(model, 'runtime', '.').status).toBe('unavailable')
    } finally {
      chmodSync(runtime, 0o600)
    }
  })

  it('does not confirm partial runtime evidence when another declaration is unsupported', async () => {
    writeFileSync(join(root, '.nvmrc'), '24.15.0\n')
    writeFileSync(join(root, '.tool-versions'), 'nodejs\n')

    const model = await inspectRepository({ cwd: root })

    expect(model.runtimeDeclarations?.map((entry) => entry.declaredText)).toEqual(['24.15.0'])
    expect(evidence(model, 'runtime', '.').status).toBe('unsupported')
  })

  it('does not report missing evidence when repository directories cannot be read', async () => {
    const blocked = join(root, 'blocked')
    mkdirSync(blocked)
    writeFileSync(join(blocked, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    chmodSync(blocked, 0o000)

    try {
      const model = await inspectRepository({ cwd: root })

      expect(model.diagnostics).toContainEqual({
        code: 'REPOSITORY_DIRECTORY_UNAVAILABLE',
        path: 'blocked',
      })
      expect(evidence(model, 'lockfile-selection', '.').status).toBe('unavailable')
      expect(evidence(model, 'package-manager', '.').status).toBe('unavailable')
    } finally {
      chmodSync(blocked, 0o700)
    }
  })

  it('does not confirm visible lockfile evidence when part of the boundary is unreadable', async () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    const blocked = join(root, 'blocked')
    mkdirSync(blocked)
    writeFileSync(join(blocked, 'yarn.lock'), '# yarn lockfile v1\n')
    chmodSync(blocked, 0o000)

    try {
      const model = await inspectRepository({ cwd: root })

      expect(model.lockfiles?.map((lockfile) => lockfile.path)).toEqual(['pnpm-lock.yaml'])
      expect(evidence(model, 'package-manager', '.').status).toBe('unavailable')
      expect(evidence(model, 'lockfile-selection', '.').status).toBe('unavailable')
    } finally {
      chmodSync(blocked, 0o700)
    }
  })

  it('keeps an authoritative manager field conclusive during a partial directory scan', async () => {
    writeJson(join(root, 'package.json'), { name: 'root', packageManager: 'pnpm@10.33.0' })
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    const blocked = join(root, 'blocked')
    mkdirSync(blocked)
    writeFileSync(join(blocked, 'yarn.lock'), '# yarn lockfile v1\n')
    chmodSync(blocked, 0o000)

    try {
      const model = await inspectRepository({ cwd: root })

      expect(evidence(model, 'package-manager', '.').status).toBe('confirmed')
      expect(evidence(model, 'lockfile-selection', '.').status).toBe('unavailable')
    } finally {
      chmodSync(blocked, 0o700)
    }
  })

  it('reports an unreadable workspace declaration as unavailable', async () => {
    const workspaceFile = join(root, 'pnpm-workspace.yaml')
    writeFileSync(workspaceFile, "packages:\n  - 'packages/*'\n")
    chmodSync(workspaceFile, 0o000)

    try {
      const model = await inspectRepository({ cwd: root })

      expect(evidence(model, 'workspace', '.').status).toBe('unavailable')
      expect(model.diagnostics).toContainEqual({
        code: 'WORKSPACE_DECLARATION_UNAVAILABLE',
        path: 'pnpm-workspace.yaml',
      })
    } finally {
      chmodSync(workspaceFile, 0o600)
    }
  })

  it('is byte-identical across absolute roots and never invokes manager or lifecycle sentinels', async () => {
    writeJson(join(root, 'package.json'), {
      name: 'root',
      packageManager: 'pnpm@10.0.0',
      engines: { node: '>=24' },
      scripts: { preinstall: 'sentinel-lifecycle' },
    })
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    const other = mkdtempSync(join(tmpdir(), 'depfresh-evidence-copy-'))
    const bin = join(root, 'bin')
    const marker = join(root, 'invoked')
    mkdirSync(bin)
    for (const command of ['npm', 'pnpm', 'yarn', 'bun', 'sentinel-lifecycle']) {
      const executable = join(bin, command)
      writeFileSync(executable, `#!/bin/sh\ntouch '${marker}'\nexit 91\n`)
      chmodSync(executable, 0o755)
    }
    writeFileSync(join(other, 'package.json'), readFileSync(join(root, 'package.json')))
    writeFileSync(join(other, 'pnpm-lock.yaml'), readFileSync(join(root, 'pnpm-lock.yaml')))
    try {
      const script = `
        const { inspectRepository } = await import('./src/repository/inspect.ts')
        Object.defineProperty(process, 'version', { value: 'hostile-executor-version' })
        const model = await inspectRepository({ cwd: process.argv.at(-1) })
        process.stdout.write(JSON.stringify(model))
      `
      const inspectInIsolatedProcess = (cwd: string): RepositoryModel =>
        JSON.parse(
          execFileSync(
            process.execPath,
            ['--import', 'tsx', '--input-type=module', '--eval', script, cwd],
            {
              cwd: process.cwd(),
              encoding: 'utf-8',
              env: { ...process.env, PATH: bin },
            },
          ),
        ) as RepositoryModel
      const first = inspectInIsolatedProcess(root)
      const second = inspectInIsolatedProcess(other)

      expect(JSON.stringify(second)).toBe(JSON.stringify(first))
      expect(JSON.stringify(first)).not.toContain('hostile-executor-version')
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('applies ignore paths to lockfiles, runtime files, workspace markers, and nested Git markers', async () => {
    const ignored = join(root, 'ignored')
    mkdirSync(join(ignored, '.git'), { recursive: true })
    writeFileSync(join(ignored, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    writeFileSync(join(ignored, '.tool-versions'), 'nodejs 24.15.0\n')
    writeFileSync(join(ignored, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")

    const model = await inspectRepository({ cwd: root, ignorePaths: ['ignored/**'] })

    expect(model.boundaries?.map((boundary) => boundary.path)).toEqual(['.'])
    expect(model.lockfiles).toEqual([])
    expect(model.runtimeDeclarations).toEqual([])
    expect(evidence(model, 'package-manager', '.')).toMatchObject({
      status: 'missing',
      value: [],
    })
  })

  it('keeps a missing root serializable with unavailable root and VCS evidence', async () => {
    const emptyParent = mkdtempSync(join(tmpdir(), 'depfresh-missing-evidence-'))
    const missing = join(emptyParent, 'does-not-exist')
    try {
      const model = await inspectRepository({ cwd: missing })
      const rootConclusion = evidence(model, 'root')

      expect(rootConclusion).toMatchObject({ status: 'unavailable', value: [] })
      expect(rootConclusion.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'ROOT_NOT_FOUND',
      ])
      expect(model.vcs).toMatchObject({ status: 'unavailable' })
      expect(JSON.stringify(model)).not.toContain(emptyParent)
    } finally {
      rmSync(emptyParent, { recursive: true, force: true })
    }
  })
})
