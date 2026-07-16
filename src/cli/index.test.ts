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

function significantStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter(
      (line) =>
        !/DeprecationWarning|ExperimentalWarning|--trace-deprecation|--trace-warnings/.test(line),
    )
    .join('\n')
    .trim()
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
    expect(significantStderr(result.stderr)).toBe('')

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
    expect(significantStderr(result.stderr)).toBe('')

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
    expect(significantStderr(result.stderr)).toBe('')

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
    expect(significantStderr(result.stderr)).toBe('')

    const output = JSON.parse(result.stdout) as {
      error: { code: string; message: string; retryable: boolean }
      meta: { schemaVersion: number; cwd: string; mode: string }
    }

    expect(output.error.code).toBe('ERR_CONFIG')
    expect(output.error.message).toBe(
      '--execute is only supported by the explicit plan/apply phase workflow.',
    )
    expect(output.error.retryable).toBe(false)
    expect(output.meta.schemaVersion).toBe(1)
    expect(output.meta.cwd).toBe(projectRoot)
    expect(output.meta.mode).toBe('default')
  })
})

describe('CLI raw argument validation', () => {
  it.each([
    [['--unknown'], 'UNKNOWN_OPTION', 'Unknown option: --unknown'],
    [['--mode'], 'MISSING_OPTION_VALUE', 'Missing value for --mode'],
    [['--mode', 'major', '--mode', 'minor'], 'CONFLICTING_OPTION', 'Conflicting values for --mode'],
    [['--write=maybe'], 'INVALID_BOOLEAN', 'Invalid boolean value for --write'],
  ])('returns one stable JSON error for malformed argv %j', (argv, reason, message) => {
    const result = runCli([...argv, '--output', 'json'])

    expect(result.status).toBe(2)
    expect(significantStderr(result.stderr)).toBe('')
    const output = JSON.parse(result.stdout) as {
      error: { code: string; message: string; reason: string; retryable: boolean }
    }
    expect(output.error).toMatchObject({
      code: 'ERR_CONFIG',
      message: expect.stringContaining(message),
      reason,
      retryable: false,
    })
  })

  it('renders a human input error without a stack trace', () => {
    const result = runCli(['--unknown'])

    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(significantStderr(result.stderr)).toBe('Fatal error: Unknown option: --unknown')
    expect(result.stderr).not.toMatch(/\n\s+at /u)
  })

  it.each([
    ['capabilities', '--json', '--unknown'],
    ['--help-json', '--unknown'],
  ])('keeps discoverability failures machine-readable for %j', (...argv) => {
    const result = runCli(argv)

    expect(result.status).toBe(2)
    expect(significantStderr(result.stderr)).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: 'ERR_CONFIG', reason: 'UNKNOWN_OPTION' },
    })
  })

  it('uses INVALID_OPTION_VALUE for malformed enum input', () => {
    const result = runCli(['--mode', 'everything', '--output', 'json'])

    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: 'ERR_CONFIG', reason: 'INVALID_OPTION_VALUE' },
    })
  })

  it('uses INVALID_OPTION_VALUE for a negative numeric input', () => {
    const result = runCli(['--cooldown', '-1', '--output', 'json'])

    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: 'ERR_CONFIG', reason: 'INVALID_OPTION_VALUE' },
    })
  })

  it('redacts secret-like invalid mode values from JSON metadata', () => {
    const result = runCli(['NPM_TOKEN=top-secret', '--unknown', '--output', 'json'])

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('[REDACTED]')
    expect(result.stdout).not.toContain('top-secret')
  })
})

describe('CLI unsupported combinations', () => {
  it.each([
    [['--install'], '--install is only supported'],
    [['--update'], '--update is only supported'],
    [['--execute', 'echo done'], '--execute is only supported'],
    [['--verify-command', 'pnpm test'], '--verify-command is only supported'],
    [['--write', '--install', '--update'], '--install is only supported'],
    [['--deps-only', '--dev-only'], '--deps-only cannot be combined with --dev-only'],
    [['--plan-file', 'plan.json'], '--plan-file is only valid with the apply command'],
    [['--json'], '--json is only valid with the capabilities command'],
    [['capabilities'], 'capabilities requires --json'],
    [
      ['capabilities', '--json', '--plan-file', 'plan.json'],
      '--plan-file is only valid with the apply command',
    ],
  ])('rejects %j before starting a check', (argv, message) => {
    const result = runCli([...argv, '--output', 'json'])

    expect(result.status).toBe(2)
    expect(significantStderr(result.stderr)).toBe('')
    const output = JSON.parse(result.stdout) as {
      error: { code: string; message: string; reason: string }
    }
    expect(output.error).toMatchObject({
      code: 'ERR_CONFIG',
      message: expect.stringContaining(message),
      reason: 'UNSUPPORTED_COMBINATION',
    })
  })

  it('requires --version to be the only argument', () => {
    const result = runCli(['--version', '--write', '--output', 'json'])

    expect(result.status).toBe(2)
    const output = JSON.parse(result.stdout) as {
      error: { reason: string }
    }
    expect(output.error.reason).toBe('UNSUPPORTED_COMBINATION')
  })
})
