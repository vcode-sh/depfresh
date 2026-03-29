import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
const cliEntry = fileURLToPath(new URL('./index.ts', import.meta.url))

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
}

describe('CLI interactive mode validation', () => {
  it('exits with code 2 and prints a table-mode error when interactive is used without write', () => {
    const result = runCli(['--interactive'])

    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Fatal error:')
    expect(result.stderr).toContain(
      'Interactive mode requires write mode. Pass `--write` with `--interactive`.',
    )
  })

  it('exits with code 2 and prints a JSON error when interactive is used without write', () => {
    const result = runCli(['--interactive', '--output', 'json'])

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')

    const output = JSON.parse(result.stdout) as {
      error: { code: string; message: string; retryable: boolean }
      meta: { schemaVersion: number; cwd: string; mode: string }
    }

    expect(output.error.code).toBe('ERR_CONFIG')
    expect(output.error.message).toBe(
      'Interactive mode requires write mode. Pass `--write` with `--interactive`.',
    )
    expect(output.error.retryable).toBe(false)
    expect(output.meta.schemaVersion).toBe(1)
    expect(output.meta.cwd).toBe(projectRoot)
    expect(output.meta.mode).toBe('default')
  })

  it('exits with code 2 and prints a JSON error when concurrency is invalid', () => {
    const result = runCli(['--concurrency', 'abc', '--output', 'json'])

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')

    const output = JSON.parse(result.stdout) as {
      error: { code: string; message: string; retryable: boolean }
      meta: { schemaVersion: number; cwd: string; mode: string }
    }

    expect(output.error.code).toBe('ERR_CONFIG')
    expect(output.error.message).toBe(
      'Invalid value for --concurrency: "abc". Expected a positive integer.',
    )
    expect(output.error.retryable).toBe(false)
    expect(output.meta.schemaVersion).toBe(1)
    expect(output.meta.cwd).toBe(projectRoot)
    expect(output.meta.mode).toBe('default')
  })

  it('exits with code 2 and prints a JSON error when interactive json output is requested', () => {
    const result = runCli(['--interactive', '--write', '--output', 'json'])

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')

    const output = JSON.parse(result.stdout) as {
      error: { code: string; message: string; retryable: boolean }
      meta: { schemaVersion: number; cwd: string; mode: string }
    }

    expect(output.error.code).toBe('ERR_CONFIG')
    expect(output.error.message).toBe(
      'Interactive mode cannot be used with JSON output. Pass `--output table` or disable `--interactive`.',
    )
    expect(output.error.retryable).toBe(false)
    expect(output.meta.schemaVersion).toBe(1)
    expect(output.meta.cwd).toBe(projectRoot)
    expect(output.meta.mode).toBe('default')
  })

  it('exits with code 2 and prints a JSON error when execute is combined with JSON output', () => {
    const result = runCli(['--write', '--execute', 'echo done', '--output', 'json'])

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')

    const output = JSON.parse(result.stdout) as {
      error: { code: string; message: string; retryable: boolean }
      meta: { schemaVersion: number; cwd: string; mode: string }
    }

    expect(output.error.code).toBe('ERR_CONFIG')
    expect(output.error.message).toBe(
      'JSON output cannot be used with --execute, --install, or --update. Pass `--output table` or disable post-write commands.',
    )
    expect(output.error.retryable).toBe(false)
    expect(output.meta.schemaVersion).toBe(1)
    expect(output.meta.cwd).toBe(projectRoot)
    expect(output.meta.mode).toBe('default')
  })
})
