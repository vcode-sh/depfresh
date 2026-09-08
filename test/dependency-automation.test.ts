import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { parse } from 'yaml'

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-automation-'))
  roots.push(root)
  return root
}

function steps(file: string, job: string): { name?: string; run?: string }[] {
  return parse(readFileSync(`.github/workflows/${file}.yml`, 'utf8')).jobs[job].steps
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('builds the checkout before freshness and preserves valid outdated reports and error exits', () => {
  const workflow = steps('dependency-freshness', 'depfresh')
  const build = workflow.findIndex((step) => step.run === 'pnpm build')
  const generate = workflow.findIndex((step) => step.name === 'Generate depfresh JSON report')
  expect(build).toBeGreaterThanOrEqual(0)
  expect(generate).toBeGreaterThan(build)
  const root = fixture()
  mkdirSync(join(root, 'dist'))
  for (const [output, exitCode, expected] of [
    ['{"summary":{"total":1}}', 1, 0],
    ['undefined', 1, 1],
    ['{"summary":{"total":1}}', 2, 2],
  ] as const) {
    writeFileSync(
      join(root, 'dist/cli.mjs'),
      `process.stdout.write(${JSON.stringify(output)}); process.exitCode = ${exitCode}`,
    )
    const result = spawnSync('bash', ['-e', '-c', workflow[generate]?.run ?? 'exit 99'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(expected)
    expect(readFileSync(join(root, 'depfresh-report.json'), 'utf8')).toBe(output)
  }
})

it('requests auto-merge only when enabled and fails closed on unknown settings or API failure', () => {
  const script = steps('dependabot-automerge', 'automerge').find(
    (step) => step.name === 'Auto-merge',
  )?.run
  expect(script).toBeDefined()
  const root = fixture()
  const executable = join(root, 'gh')
  writeFileSync(
    executable,
    '#!/bin/sh\nif [ "$1" = api ]; then printf "%s" "$SETTING"; exit "$API_EXIT"; fi\nprintf "%s\\n" "$*" > merged\n',
  )
  chmodSync(executable, 0o755)
  for (const [setting, apiExit, expected, merged] of [
    ['false', '0', 0, false],
    ['null', '0', 1, false],
    ['true', '1', 1, false],
    ['true', '0', 0, true],
  ] as const) {
    const result = spawnSync('bash', ['-e', '-c', script ?? 'exit 99'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        SETTING: setting,
        API_EXIT: apiExit,
        GITHUB_REPOSITORY: 'example/repo',
        PR_URL: 'https://github.com/example/repo/pull/1',
      },
    })
    expect(result.status, result.stderr).toBe(expected)
    if (merged) {
      expect(readFileSync(join(root, 'merged'), 'utf8')).toBe(
        'pr merge --auto --squash https://github.com/example/repo/pull/1\n',
      )
    } else {
      expect(() => readFileSync(join(root, 'merged'))).toThrow()
    }
  }
})
