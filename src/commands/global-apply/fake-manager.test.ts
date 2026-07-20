import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultGlobalProcessRuntime, type GlobalProcessRuntime } from '../../io/global-manager'
import type { GlobalManagerName } from '../../types'
import { applyGlobalPlan, createGlobalApplyPlan, createGlobalInvocationAuthority } from '.'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('global apply fake manager integration', () => {
  it('uses supervised fixed argv and a sanitized environment for npm, pnpm, and Bun', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-global-managers-'))
    roots.push(root)
    const home = join(root, 'home')
    const bin = join(root, 'bin')
    mkdirSync(home)
    mkdirSync(bin)
    for (const manager of ['npm', 'pnpm', 'bun'] as const) {
      const path = join(bin, manager)
      writeFileSync(path, fakeManagerSource(manager))
      chmodSync(path, 0o755)
      writeFileSync(join(home, `${manager}.json`), JSON.stringify({ pkg: '1.0.0' }))
    }
    const inheritedEnv = {
      PATH: `${bin}:${dirname(process.execPath)}`,
      HOME: home,
      npm_config_ignore_scripts: 'false',
      NPM_CONFIG_USERCONFIG: join(root, 'hostile-npmrc'),
      NODE_OPTIONS: '--require=/definitely/not-present',
    }
    const requests = (['npm', 'pnpm', 'bun'] as const).map((manager) => ({
      manager,
      name: 'pkg',
      expectedVersion: '1.0.0',
      targetVersion: '2.0.0',
    }))
    const observations: Array<{
      reason: string
      termination: string
      terminationConfirmed: boolean
    }> = []
    const runtime: GlobalProcessRuntime = {
      resolve: (...args) => defaultGlobalProcessRuntime.resolve(...args),
      run: async (...args) => {
        const observation = await defaultGlobalProcessRuntime.run(...args)
        observations.push({
          reason: observation.reason,
          termination: observation.termination,
          terminationConfirmed: observation.terminationConfirmed,
        })
        return observation
      },
    }
    const plan = await createGlobalApplyPlan(
      requests,
      {
        cwd: root,
        timeoutMs: 5_000,
        inheritedEnv,
      },
      runtime,
    )
    const result = await applyGlobalPlan(
      plan,
      { cwd: root, inheritedEnv },
      createGlobalInvocationAuthority(['npm', 'pnpm', 'bun'], {
        globalWrite: true,
        processExecute: true,
      }),
      runtime,
    )

    const diagnostics = {
      items: result.items.map(({ manager, status, reason }) => ({ manager, status, reason })),
      commands: result.commands.map(
        ({ manager, termination, terminationConfirmed, exitCode, signal }) => ({
          manager,
          termination,
          terminationConfirmed,
          exitCode,
          signal,
        }),
      ),
      observations,
    }
    expect(result.status, JSON.stringify(diagnostics)).toBe('applied')
    expect(result.items.map((item) => [item.manager, item.status])).toEqual([
      ['npm', 'applied'],
      ['pnpm', 'applied'],
      ['bun', 'applied'],
    ])
    expect(result.commands.map((command) => command.args)).toEqual([
      ['install', '-g', '--ignore-scripts', '--no-audit', '--no-fund', '--', 'pkg@2.0.0'],
      ['add', '-g', '--ignore-scripts', '--ignore-pnpmfile', '--', 'pkg@2.0.0'],
      ['add', '-g', '--ignore-scripts', 'pkg@2.0.0'],
    ])
    for (const manager of ['npm', 'pnpm', 'bun'] as const) {
      expect(JSON.parse(readFileSync(join(home, `${manager}.json`), 'utf8'))).toEqual({
        pkg: '2.0.0',
      })
    }
  }, 30_000)
})

function fakeManagerSource(manager: GlobalManagerName): string {
  const managerVersion = manager === 'bun' ? '1.2.0' : '10.0.0'
  return `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const manager = ${JSON.stringify(manager)}
const args = process.argv.slice(2)
if (process.env.npm_config_ignore_scripts || process.env.NPM_CONFIG_USERCONFIG || process.env.NODE_OPTIONS) process.exit(91)
const home = process.env.HOME
const statePath = path.join(home, manager + '.json')
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(${JSON.stringify(`${managerVersion}\n`)})
  process.exit(0)
}
if (args[0] === 'root') {
  process.stdout.write(path.join(home, manager + '-global') + '\\n')
  process.exit(0)
}
if (args[0] === 'list') {
  const dependencies = Object.fromEntries(Object.entries(state).map(([name, version]) => [name, { version }]))
  process.stdout.write(JSON.stringify(manager === 'pnpm' ? [{ dependencies }] : { dependencies }))
  process.exit(0)
}
if (manager === 'bun' && args[0] === 'pm') {
  const rows = Object.entries(state).map(([name, version]) => '├── ' + name + '@' + version)
  process.stdout.write([path.join(home, manager + '-global'), ...rows].join('\\n'))
  process.exit(0)
}
const spec = args[args.length - 1]
const separator = spec.lastIndexOf('@')
state[spec.slice(0, separator)] = spec.slice(separator + 1)
fs.writeFileSync(statePath, JSON.stringify(state))
`
}
