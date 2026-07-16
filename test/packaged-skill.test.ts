import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots: string[] = []

function bashBlocks(relativePath: string): string[] {
  const content = readFileSync(join(root, relativePath), 'utf8')
  return [...content.matchAll(/```bash\n([\s\S]*?)```/gu)].map((match) => match[1] ?? '')
}

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'depfresh-skill-'))
  const bin = join(path, 'bin')
  const log = join(path, 'argv.jsonl')
  mkdirSync(bin)
  temporaryRoots.push(path)
  const stub = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const command = require('node:path').basename(process.argv[1])
const args = process.argv.slice(2)
appendFileSync(process.env.ARGV_LOG, JSON.stringify({ command, args }) + '\\n')
const depfreshIndex = command === 'depfresh' ? -1 : args.indexOf('depfresh')
const cli = depfreshIndex === -1 ? args : args.slice(depfreshIndex + 1)
if (cli[0] === '--version') process.stdout.write('1.2.0')
else if (cli[0] === 'capabilities') process.stdout.write('{"contract":"depfresh.capabilities","schemaVersion":1}')
else if (cli[0] === 'inspect') process.stdout.write('{"contract":"depfresh.inspect","schemaVersion":1,"risks":[],"errors":[]}')
else if (cli[0] === 'plan') {
  process.stdout.write('{"contract":"depfresh.plan","schemaVersion":1,"operations":[{}],"summary":{"blocked":0,"unknown":0,"errors":0},"risks":[]}')
  process.exit(1)
} else if (cli[0] === 'apply') process.stdout.write('{"contract":"depfresh.apply","schemaVersion":1,"status":"applied"}')
else process.stdout.write('{"summary":{"total":0}}')
`
  for (const name of ['depfresh', 'npm', 'pnpm']) {
    const target = join(bin, name)
    writeFileSync(target, stub)
    chmodSync(target, 0o755)
  }
  return { bin, log, path }
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const path = temporaryRoots.pop()
    if (path) rmSync(path, { recursive: true, force: true })
  }
})

describe('packaged depfresh skill commands', () => {
  it('preserves exact argument forwarding for every documented runner', () => {
    const current = fixture()
    for (const block of bashBlocks('skills/depfresh/recipes/runners.md')) {
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', block], {
        cwd: current.path,
        encoding: 'utf8',
        env: {
          ...process.env,
          ARGV_LOG: current.log,
          HOME: current.path,
          PATH: `${current.bin}:${process.env.PATH ?? ''}`,
          XDG_CACHE_HOME: join(current.path, 'cache'),
        },
      })
      expect(result.status, result.stderr).toBe(0)
    }

    const calls = readFileSync(current.log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { command: string; args: string[] })
    expect(calls).toEqual([
      { command: 'pnpm', args: ['exec', 'depfresh', '--version'] },
      { command: 'pnpm', args: ['exec', 'depfresh', 'capabilities', '--json'] },
      {
        command: 'npm',
        args: ['exec', '--yes', '--package=depfresh@1.2.0', '--', 'depfresh', '--version'],
      },
      {
        command: 'npm',
        args: [
          'exec',
          '--yes',
          '--package=depfresh@1.2.0',
          '--',
          'depfresh',
          'capabilities',
          '--json',
        ],
      },
    ])
  })

  it('executes every packaged example and CI shell block with inert argv', () => {
    const current = fixture()
    const blocks = [
      ...bashBlocks('skills/depfresh/examples/README.md'),
      ...bashBlocks('skills/depfresh/recipes/ci.md'),
    ]
    for (const block of blocks) {
      const result = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-e', '-c', `DEPFRESH=(depfresh)\n${block}`],
        {
          cwd: current.path,
          encoding: 'utf8',
          env: {
            ...process.env,
            ARGV_LOG: current.log,
            HOME: current.path,
            PATH: `${current.bin}:${process.env.PATH ?? ''}`,
            XDG_CACHE_HOME: join(current.path, 'cache'),
          },
        },
      )
      expect(result.status, result.stderr).toBe(0)
    }
  })
})
