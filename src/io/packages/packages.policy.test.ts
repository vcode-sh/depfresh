import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../../config'
import { evaluateRepositoryPolicy } from '../../policy'
import { inspectRepository } from '../../repository/inspect'
import { loadPackages } from './discovery'

function writeJson(filepath: string, value: unknown): void {
  writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`)
}

describe('loadPackages occurrence policy', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('caps a named catalog without affecting a direct declaration of the same dependency', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-bun-'))
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
    const options = await resolveConfig({
      cwd: root,
      loglevel: 'silent',
      mode: 'latest',
      policyRules: [
        {
          id: 'native-minor',
          selectors: { catalogName: 'native' },
          mode: 'minor',
        },
      ],
    })

    const packages = await loadPackages(options)
    const direct = packages
      .find((pkg) => pkg.type === 'package.json' && pkg.name === 'root')
      ?.deps.find((dep) => dep.name === 'react')
    const owner = packages
      .find((pkg) => pkg.type === 'bun-workspace')
      ?.deps.find((dep) => dep.name === 'react')
    const decisions = evaluateRepositoryPolicy(
      await inspectRepository({ cwd: root }),
      options.compiledPolicy!,
    ).filter((decision) => decision.occurrenceId)

    expect(direct?.policyDecision).toMatchObject({ status: 'selected', mode: 'latest' })
    expect(owner?.policyDecision).toMatchObject({
      status: 'selected',
      mode: 'minor',
      winningModeRuleId: 'native-minor',
    })
    expect(decisions.filter((decision) => decision.mode === 'minor')).toHaveLength(3)
    expect(decisions.filter((decision) => decision.mode === 'latest')).toHaveLength(2)
  })

  it('lets explicit rules override legacy filters and removes skipped or blocked work', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-filter-'))
    writeJson(join(root, 'package.json'), {
      name: 'root',
      dependencies: {
        react: '^18.0.0',
        vue: '^3.0.0',
      },
    })
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    const options = await resolveConfig({
      cwd: root,
      loglevel: 'silent',
      include: ['react'],
      policyRules: [
        { id: 'vue-override', selectors: { dependencyName: '^vue$' }, action: 'include' },
        {
          id: 'unknown-pnpm',
          selectors: { dependencyName: '^react$', manager: 'pnpm' },
          mode: 'minor',
        },
      ],
    })

    const packages = await loadPackages(options)
    const deps = packages.find((pkg) => pkg.name === 'root')?.deps ?? []

    expect(deps.map((dep) => dep.name)).toEqual(['vue'])
    expect(deps[0]?.policyDecision).toMatchObject({
      status: 'selected',
      winningActionRuleId: 'vue-override',
    })
  })

  it('links dotted catalog names by structural metadata instead of splitting the name', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-dotted-catalog-'))
    writeJson(join(root, 'package.json'), {
      name: 'root',
      private: true,
      packageManager: 'pnpm@10.0.0',
      dependencies: { react: 'catalog:native.v2' },
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      ["packages: ['.']", 'catalogs:', "  'native.v2':", '    react: ^18.0.0', ''].join('\n'),
    )
    const options = await resolveConfig({
      cwd: root,
      loglevel: 'silent',
      mode: 'latest',
      policyRules: [
        {
          id: 'dotted-minor',
          selectors: { catalogName: 'native\\.v2' },
          mode: 'minor',
        },
      ],
    })

    const packages = await loadPackages(options)
    const owner = packages
      .find((pkg) => pkg.type === 'pnpm-workspace')
      ?.deps.find((dep) => dep.name === 'react')

    expect(owner?.policyDecision).toMatchObject({
      status: 'selected',
      mode: 'minor',
      winningModeRuleId: 'dotted-minor',
    })
  })

  it('preserves packageMode matching against an npm alias resolution name', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-alias-'))
    writeJson(join(root, 'package.json'), {
      name: 'root',
      dependencies: { alias: 'npm:react@^18.0.0' },
    })
    const options = await resolveConfig({
      cwd: root,
      loglevel: 'silent',
      mode: 'default',
      packageMode: { react: 'minor' },
    })

    const packages = await loadPackages(options)
    const alias = packages[0]?.deps.find((dep) => dep.name === 'alias')

    expect(alias?.policyDecision).toMatchObject({
      status: 'selected',
      mode: 'minor',
    })
  })

  it('links dotted Bun catalog names without parsing their dots as path separators', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-dotted-bun-'))
    writeJson(join(root, 'package.json'), {
      name: 'root',
      private: true,
      packageManager: 'bun@1.2.0',
      workspaces: {
        packages: ['.'],
        catalogs: { 'native.v2': { react: '^18.0.0' } },
      },
      dependencies: { react: 'catalog:native.v2' },
    })
    const options = await resolveConfig({
      cwd: root,
      loglevel: 'silent',
      mode: 'latest',
      policyRules: [
        {
          id: 'dotted-minor',
          selectors: { catalogName: 'native\\.v2' },
          mode: 'minor',
        },
      ],
    })

    const packages = await loadPackages(options)
    const owner = packages
      .find((pkg) => pkg.type === 'bun-workspace')
      ?.deps.find((dep) => dep.name === 'react')

    expect(owner?.policyDecision).toMatchObject({ status: 'selected', mode: 'minor' })
  })
})
