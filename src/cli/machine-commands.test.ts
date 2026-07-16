import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

function runCliWithStdoutBackpressure(args: string[]) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
        cwd: projectRoot,
        env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'depfresh-cli-home-')) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      let stdout = ''

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.pause()
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (status) => resolve({ status, stderr, stdout }))
      setTimeout(() => child.stdout.resume(), 50)
    },
  )
}

describe('inspect and plan CLI routing', () => {
  it('drains a large schema-valid inspect document before exiting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-large-inspect-'))
    const dependencies = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => [`fixture-dependency-${index}`, '^1.0.0']),
    )
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'large-fixture', dependencies }),
    )

    const result = await runCliWithStdoutBackpressure(['inspect', '--json', '--cwd', root])
    const output: unknown = JSON.parse(result.stdout)

    expect(result.stdout.length).toBeGreaterThan(65_536)
    expect(result.stderr).toBe('')
    expect(validateInspectResult(output)).toBe(true)
    expect(result.status).toBe(0)
  }, 30_000)

  it('drains a large schema-valid plan document before exiting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-large-plan-'))
    const dependencies = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => [`fixture-dependency-${index}`, '^1.0.0']),
    )
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'large-fixture', dependencies }),
    )

    const result = await runCliWithStdoutBackpressure([
      'plan',
      '--json',
      '--cwd',
      root,
      '--exclude',
      '*',
    ])
    const output: unknown = JSON.parse(result.stdout)

    expect(result.stdout.length).toBeGreaterThan(65_536)
    expect(result.stderr).toBe('')
    expect(validatePlanResult(output)).toBe(true)
    expect(result.status).toBe(1)
  }, 30_000)

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

  it('retains built-in discovery ignores when inspect adds an ignore path', () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-cli-inspect-ignores-'))
    for (const directory of [
      join(root, 'ignored', 'fixture'),
      join(root, 'node_modules', 'rogue'),
    ]) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'must-not-load' }))
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))

    const result = runCli(['inspect', '--json', '--cwd', root, '--ignore-paths', 'ignored/**'])
    const output = JSON.parse(result.stdout) as {
      repository: { sourceFiles: Array<{ path: string }> }
    }

    expect(result.status).toBe(0)
    expect(output.repository.sourceFiles.map((source) => source.path)).toEqual(['package.json'])
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
