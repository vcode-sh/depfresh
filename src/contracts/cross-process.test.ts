import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const inspectUrl = pathToFileURL(join(import.meta.dirname, '../commands/inspect/index.ts')).href
const planUrl = pathToFileURL(join(import.meta.dirname, '../commands/plan/index.ts')).href

function runContracts(root: string, locale: string, timezone: string): string {
  const script = `
    import { inspect } from ${JSON.stringify(inspectUrl)};
    import { plan } from ${JSON.stringify(planUrl)};
    const cwd = process.argv[1];
    const output = { inspect: await inspect({ cwd }), plan: await plan({ cwd }) };
    process.stdout.write(JSON.stringify(output));
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', script, root], {
    cwd: join(import.meta.dirname, '../..'),
    encoding: 'utf8',
    env: { ...process.env, LANG: locale, LC_ALL: locale, TZ: timezone },
  })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

describe('inspect and plan cross-process determinism', () => {
  it('is independent of absolute root, locale, timezone, and process', () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'depfresh-contract-process-a-'))
    const secondRoot = mkdtempSync(join(tmpdir(), 'depfresh-contract-process-b-'))
    for (const root of [firstRoot, secondRoot]) {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'fixture', private: true, workspaces: ['*'] }),
      )
      for (const directory of ['z', 'ä']) {
        mkdirSync(join(root, directory))
        writeFileSync(join(root, directory, 'package.json'), '{bad')
      }
    }

    expect(runContracts(secondRoot, 'sv_SE.UTF-8', 'Pacific/Auckland')).toBe(
      runContracts(firstRoot, 'en_US.UTF-8', 'UTC'),
    )
  })
})
