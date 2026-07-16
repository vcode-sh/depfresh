import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { collectVcsEvidence } = vi.hoisted(() => ({
  collectVcsEvidence: vi.fn(() => {
    throw new Error('inspect must not execute the Git adapter')
  }),
}))

vi.mock('../../repository/vcs', () => ({ collectVcsEvidence }))

import { inspect } from './index'

describe('inspect contract', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns deterministic repository evidence without registry, process, or write calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-'))
    const manifest = join(root, 'package.json')
    writeFileSync(manifest, '{\n  "name": "fixture",\n  "dependencies": { "alpha": "^1.0.0" }\n}\n')
    const before = readFileSync(manifest)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('registry forbidden'))

    const first = await inspect({ cwd: root })
    const second = await inspect({ cwd: root })

    expect(first.contract).toBe('depfresh.inspect')
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.repository.sources).toHaveLength(1)
    expect(first.occurrences).toHaveLength(1)
    expect(first.vcs.status).toBe('unavailable')
    expect(first.vcs.diagnostics[0]?.code).toBe('VCS_PROBE_DISABLED')
    expect(JSON.stringify(first)).not.toContain(root)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(collectVcsEvidence).not.toHaveBeenCalled()
    expect(readFileSync(manifest)).toEqual(before)
  })

  it('is byte-identical for cloned repositories at different absolute roots', async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'depfresh-inspect-clone-a-'))
    const secondRoot = mkdtempSync(join(tmpdir(), 'depfresh-inspect-clone-b-'))
    const manifest = '{"name":"fixture","dependencies":{"alpha":"^1.0.0"}}\n'
    writeFileSync(join(firstRoot, 'package.json'), manifest)
    writeFileSync(join(secondRoot, 'package.json'), manifest)

    expect(JSON.stringify(await inspect({ cwd: secondRoot }))).toBe(
      JSON.stringify(await inspect({ cwd: firstRoot })),
    )
  })

  it('does not project absolute POSIX or Windows paths from dependency declarations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-paths-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: {
          localPosix: 'file:/Users/alice/private/pkg',
          localWindows: String.raw`file:C:\Users\alice\private\pkg`,
        },
      }),
    )

    const result = await inspect({ cwd: root })
    const serialized = JSON.stringify(result)

    expect(result.occurrences.map((occurrence) => occurrence.declaredValue)).toEqual([
      '[REDACTED_PATH]',
      '[REDACTED_PATH]',
    ])
    expect(serialized).not.toMatch(/\/Users\/alice|C:\\\\Users\\\\alice/u)
  })

  it('redacts secret-bearing occurrence names and paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-secret-key-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { 'token=supersecret': '^1.0.0' },
      }),
    )

    const result = await inspect({ cwd: root })
    const serialized = JSON.stringify(result)

    expect(result.occurrences[0]).toMatchObject({
      name: '[REDACTED]',
      path: ['dependencies', '[REDACTED]'],
    })
    expect(serialized).not.toContain('supersecret')
    expect(result.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OCCURRENCE_VALUE_REDACTED', severity: 'blocking' }),
      ]),
    )
  })

  it('projects complete, resolvable manager evidence and model entities', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-evidence-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'pnpm@10.0.0',
        dependencies: { alpha: '^1.0.0' },
      }),
    )

    const result = await inspect({ cwd: root })
    const manager = result.evidence.find((entry) => entry.kind === 'package-manager')
    const occurrence = result.occurrences[0]

    expect(manager?.values).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'pnpm', version: '10.0.0' })]),
    )
    expect(manager?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'field', path: 'package.json', field: ['packageManager'] }),
      ]),
    )
    expect(
      result.repository.sourceFiles.some((source) => source.id === occurrence?.sourceFileId),
    ).toBe(true)
    expect(result.repository.packages.some((pkg) => pkg.id === occurrence?.ownerId)).toBe(true)
  })

  it('retains every ambiguous manager candidate with its source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-manager-ambiguity-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }))
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const result = await inspect({ cwd: root })
    const manager = result.evidence.find((entry) => entry.kind === 'package-manager')

    expect(manager?.status).toBe('ambiguous')
    expect(manager?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'npm' }),
        expect.objectContaining({ name: 'pnpm' }),
      ]),
    )
    expect(manager?.sources.map((source) => source.path)).toEqual(
      expect.arrayContaining(['package-lock.json', 'pnpm-lock.yaml']),
    )
  })

  it('redacts hostile lockfile format text and reports withheld evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-lock-secret-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', packageManager: 'pnpm@10.0.0' }),
    )
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: token=supersecret\n')

    const result = await inspect({ cwd: root })
    const serialized = JSON.stringify(result)

    expect(result.lockfiles[0]?.formatVersion).toBe('[REDACTED]')
    expect(result.risks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'REPOSITORY_VALUE_REDACTED' })]),
    )
    expect(serialized).not.toContain('supersecret')
  })

  it('fails safely when a repository identity path cannot be public', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-source-secret-'))
    const nested = join(root, 'token=supersecret')
    mkdirSync(nested)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
    writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: 'nested' }))

    await expect(inspect({ cwd: root })).rejects.toMatchObject({
      code: 'ERR_CONTRACT',
      reason: 'UNSAFE_PUBLIC_PATH',
      message: 'Repository paths cannot be represented in the public machine contract.',
    })
  })

  it('preserves hostile JSON keys as inert evidence data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-inspect-json-key-'))
    writeFileSync(
      join(root, 'package.json'),
      '{"name":"fixture","workspaces":{"packages":["packages/*"],"__proto__":{"polluted":true}}}',
    )

    const result = await inspect({ cwd: root })

    expect(JSON.stringify(result)).toContain('"__proto__"')
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('rejects hostile option accessors before they can run', async () => {
    const marker = join(tmpdir(), `depfresh-inspect-accessor-${process.pid}`)
    const options = Object.defineProperty({}, 'cwd', {
      enumerable: true,
      get: () => {
        writeFileSync(marker, 'bad')
        return '.'
      },
    })

    await expect(inspect(options as { cwd: string })).rejects.toMatchObject({
      code: 'ERR_CONFIG',
      reason: 'INVALID_CONFIG',
      message: 'Inspect options must be plain JSON data.',
    })
    expect(existsSync(marker)).toBe(false)
  })
})
