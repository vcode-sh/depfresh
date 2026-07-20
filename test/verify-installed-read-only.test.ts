import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const verifier = join(root, 'scripts', 'verify-installed-read-only.mjs')
const roots: string[] = []

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { force: true, recursive: true })
})

function runVerifier(cli: string) {
  return spawnSync(process.execPath, [verifier, cli], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
}

function createFakeCli(readOnlySource: string) {
  const fixture = mkdtempSync(join(tmpdir(), 'depfresh-installed-verifier-test-'))
  roots.push(fixture)
  const packageRoot = join(fixture, 'node_modules', 'depfresh')
  const dist = join(packageRoot, 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"depfresh","version":"2.1.1"}\n')
  const cli = join(dist, 'cli.mjs')
  writeFileSync(
    cli,
    `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.includes('--version')) process.stdout.write('2.1.1\\n')
else if (args.includes('--help')) process.stdout.write('depfresh usage help\\n')
else if (args[0] === 'capabilities') process.stdout.write(JSON.stringify({ contract: 'depfresh.capabilities', schemaVersion: 2, version: '2.1.1' }))
else {
${readOnlySource}
}
`,
  )
  chmodSync(cli, 0o755)
  return cli
}

describe('installed read-only distribution verifier', () => {
  it('proves version, help, capabilities, and an unchanged empty fixture', () => {
    const result = runVerifier(join(root, 'dist', 'cli.mjs'))

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      capabilitiesContract: 'depfresh.capabilities',
      capabilitiesSchemaVersion: 2,
      fixtureUnchanged: true,
      help: true,
      managerExecutionRequested: false,
      managerExecutionSupported: false,
      version: '2.1.1',
    })
  })

  it('rejects an installed CLI that mutates the read-only fixture', () => {
    const cli = createFakeCli(
      `  writeFileSync('package.json', '{"name":"mutated"}\\n')
  process.stdout.write(JSON.stringify({ packages: [], errors: [], summary: { total: 0 }, meta: { didWrite: false } }))`,
    )

    const result = runVerifier(cli)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Read-only fixture changed')
  })

  it('makes package-manager executables unavailable to the installed CLI proof', () => {
    const managerExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    expect(spawnSync(managerExecutable, ['--version']).status).toBe(0)
    const cli = createFakeCli(
      `  const manager = spawnSync(${JSON.stringify(managerExecutable)}, ['--version'])
  if (!manager.error && manager.status === 0) writeFileSync('manager-ran', '')
  process.stdout.write(JSON.stringify({ packages: [], errors: [], summary: { total: 0 }, meta: { didWrite: false } }))`,
    )

    const result = runVerifier(cli)

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      managerExecutionRequested: false,
      managerExecutionSupported: false,
    })
  })
})
