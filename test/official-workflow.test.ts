import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageData } from '../src/types'

const { fetchPackageData } = vi.hoisted(() => ({
  fetchPackageData: vi.fn<(name: string) => Promise<PackageData>>(),
}))

vi.mock('../src/io/registry', () => ({ fetchPackageData }))

import { apply, createInvocationAuthority, inspect, plan } from '../src/index'

const roots: string[] = []

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-official-workflow-'))
  roots.push(root)
  return root
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

beforeEach(() => {
  const home = fixtureRoot()
  vi.stubEnv('HOME', home)
  vi.stubEnv('XDG_CACHE_HOME', join(home, 'cache'))
  fetchPackageData.mockImplementation(async (name) =>
    name === 'react'
      ? {
          name,
          versions: ['18.0.0', '18.3.0', '19.0.0'],
          distTags: { latest: '19.0.0' },
        }
      : { name, versions: ['1.2.0'], distTags: { latest: '1.2.0' } },
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('official inspect, plan, review, and apply workflow', () => {
  it('caps a native catalog at minor while direct declarations remain latest', async () => {
    const root = fixtureRoot()
    mkdirSync(join(root, 'apps', 'one'), { recursive: true })
    mkdirSync(join(root, 'apps', 'two'), { recursive: true })
    writeJson(join(root, 'package.json'), {
      name: 'root',
      private: true,
      packageManager: 'bun@1.2.0',
      workspaces: {
        packages: ['apps/*'],
        catalogs: { native: { react: '^18.0.0' } },
      },
      dependencies: { react: '^18.0.0' },
    })
    for (const name of ['one', 'two']) {
      writeJson(join(root, 'apps', name, 'package.json'), {
        name,
        dependencies: { react: 'catalog:native' },
      })
    }
    const beforeConsumers = ['one', 'two'].map((name) =>
      readFileSync(join(root, 'apps', name, 'package.json'), 'utf8'),
    )

    const inspected = await inspect({ cwd: root })
    const planned = await plan({
      cwd: root,
      mode: 'latest',
      policyRules: [
        {
          id: 'native-catalog-minor',
          selectors: { catalogName: 'native' },
          mode: 'minor',
        },
      ],
    })

    expect(inspected.contract).toBe('depfresh.inspect')
    expect(planned.contract).toBe('depfresh.plan')
    expect(planned.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['dependencies', 'react'],
          requestedValue: '^19.0.0',
        }),
        expect.objectContaining({
          path: ['workspaces', 'catalogs', 'native', 'react'],
          requestedValue: '^18.3.0',
        }),
      ]),
    )
    const consumers = planned.decisions.filter((decision) =>
      planned.occurrences.some(
        (occurrence) =>
          occurrence.id === decision.occurrenceId && occurrence.role === 'catalog-consumer',
      ),
    )
    expect(consumers).toHaveLength(2)
    expect(consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'skipped',
          reason: 'CATALOG_CONSUMER_EXPLANATORY',
        }),
      ]),
    )

    const result = await apply(planned, { cwd: root }, createInvocationAuthority({ write: true }))

    expect(result.status).toBe('applied')
    const observed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: { react: string }
      workspaces: { catalogs: { native: { react: string } } }
    }
    expect(observed.dependencies.react).toBe('^19.0.0')
    expect(observed.workspaces.catalogs.native.react).toBe('^18.3.0')
    expect(
      ['one', 'two'].map((name) => readFileSync(join(root, 'apps', name, 'package.json'), 'utf8')),
    ).toEqual(beforeConsumers)
  })

  it('blocks missing authority and a stale plan before replacing target bytes', async () => {
    const root = fixtureRoot()
    const manifest = join(root, 'package.json')
    writeJson(manifest, { name: 'root', dependencies: { react: '^18.0.0' } })
    const planned = await plan({ cwd: root, mode: 'latest' })
    const before = readFileSync(manifest, 'utf8')

    await expect(
      apply(planned, { cwd: root }, createInvocationAuthority({ write: false })),
    ).rejects.toMatchObject({ reason: 'AUTHORITY_REQUIRED' })
    expect(readFileSync(manifest, 'utf8')).toBe(before)

    const concurrent = `${before.trimEnd()}\n `
    writeFileSync(manifest, concurrent)
    const stale = await apply(planned, { cwd: root }, createInvocationAuthority({ write: true }))
    expect(stale.status).toBe('conflicted')
    expect(readFileSync(manifest, 'utf8')).toBe(concurrent)
  })
})
