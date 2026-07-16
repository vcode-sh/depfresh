import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  validateApplyResult,
  validateInspectResult,
  validateMachineCommandError,
  validatePlanResult,
} from '../contracts/validate'

const cliEntry = fileURLToPath(new URL('./index.ts', import.meta.url))
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'depfresh-cli-home-')) },
  })
}

describe('inspect and plan CLI routing', () => {
  it('writes one schema-valid inspect document and no diagnostics', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-inspect-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))

    const result = runCli(['inspect', '--json', '--cwd', root])
    const output: unknown = JSON.parse(result.stdout)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(validateInspectResult(output)).toBe(true)
    expect(result.stdout.trim().split('\n').at(0)).toBe('{')
  })

  it('writes a schema-valid no-update plan without touching persistent cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-plan-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))

    const result = runCli(['plan', '--json', '--cwd', root])
    const output: unknown = JSON.parse(result.stdout)

    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(validatePlanResult(output)).toBe(true)
  })

  it('applies one explicit plan file with one schema-valid result document', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-apply-'))
    const planFile = join(root, 'plan.json')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
    const planned = runCli(['plan', '--json', '--cwd', root])
    writeFileSync(planFile, planned.stdout)

    const result = runCli(['apply', '--json', '--write', '--cwd', root, '--plan-file', planFile])
    const output: unknown = JSON.parse(result.stdout)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(validateApplyResult(output)).toBe(true)
    expect(output).toMatchObject({ contract: 'depfresh.apply', status: 'noop' })
  }, 30_000)

  it('requires explicit apply authority before reading the plan file', () => {
    const missing = join(tmpdir(), `depfresh-missing-plan-${process.pid}`)
    const result = runCli(['apply', '--json', '--plan-file', missing])
    const output: unknown = JSON.parse(result.stdout)

    expect(result.status).toBe(2)
    expect(validateMachineCommandError(output)).toBe(true)
    expect(output).toMatchObject({
      command: 'apply',
      errors: [{ reason: 'AUTHORITY_REQUIRED', fatal: true }],
    })
  })

  it('records CLI policy provenance in plan traces', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-policy-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '1.0.0' } }),
    )

    const result = runCli(['plan', '--json', '--cwd', root, '--mode', 'latest'])
    const output = JSON.parse(result.stdout) as {
      decisions: Array<{ policy: { matchedRuleIds: string[] } }>
    }

    expect(result.status).toBe(1)
    expect(output.decisions[0]?.policy.matchedRuleIds).toContain('$cli:mode')
    expect(output.decisions[0]?.policy.matchedRuleIds).not.toContain('$library:mode')
  })

  it('rejects side-effect flags before discovery with one command error document', () => {
    const missing = join(tmpdir(), `depfresh-missing-${process.pid}`)
    const result = runCli(['plan', '--json', '--write', '--cwd', missing])
    const output: unknown = JSON.parse(result.stdout)

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')
    expect(validateMachineCommandError(output)).toBe(true)
    expect(output).toMatchObject({
      command: 'plan',
      errors: [{ reason: 'UNSUPPORTED_COMBINATION', fatal: true }],
    })
  })

  it.each([
    ['inspect', '--mode', 'latest'],
    ['plan', '--all'],
  ])('rejects a command-specific option outside the supported contract', (...argv) => {
    const result = runCli([...argv, '--json'])
    const output = JSON.parse(result.stdout) as { errors: Array<{ reason: string }> }

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')
    expect(output.errors[0]?.reason).toBe('UNSUPPORTED_COMBINATION')
  })

  it.each(['inspect', 'plan'])(
    'rejects an invalid explicit output even with --json for %s',
    (command) => {
      const result = runCli([command, '--json', '--output', 'xml'])
      const output = JSON.parse(result.stdout) as { errors: Array<{ reason: string }> }

      expect(result.status).toBe(2)
      expect(output.errors[0]?.reason).toBe('INVALID_OPTION_VALUE')
    },
  )

  it('never evaluates executable project configuration', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-config-'))
    const marker = join(root, 'executed')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
    writeFileSync(
      join(root, 'depfresh.config.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad'); export default {}`,
    )

    const result = runCli(['plan', '--json', '--cwd', root])
    const output = JSON.parse(result.stdout) as { errors: Array<{ reason: string }> }

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')
    expect(output.errors[0]?.reason).toBe('EXECUTABLE_CONFIG_FORBIDDEN')
    expect(existsSync(marker)).toBe(false)
  })

  it('keeps fatal machine errors free of absolute paths, secrets, and stacks', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-error-'))
    writeFileSync(join(root, 'package.json'), '{bad token=supersecret')

    const result = runCli(['plan', '--json', '--cwd', root])
    const output = JSON.parse(result.stdout) as {
      errors: Array<{ message: string }>
    }
    const serialized = JSON.stringify(output)

    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')
    expect(validateMachineCommandError(output)).toBe(true)
    expect(output.errors[0]?.message).toBe(
      'The plan command could not produce a trustworthy result.',
    )
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain('supersecret')
    expect(serialized).not.toContain('stack')
  })
})
