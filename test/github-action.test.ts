import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { getCliCapabilities } from '../src/cli/capabilities'
import { apply, createInvocationAuthority, inspect, plan } from '../src/index'

interface ActionStep {
  env?: Record<string, string>
  id?: string
  if?: string
  name: string
  run?: string
  uses?: string
  with?: Record<string, string>
  'working-directory'?: string
}

interface ActionDefinition {
  inputs: Record<string, { default: string; description: string }>
  runs: { steps: ActionStep[]; using: string }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const actionPath = join(repoRoot, 'action.yml')
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  version: string
}
const tempRoots: string[] = []

function loadAction(): ActionDefinition {
  return parse(readFileSync(actionPath, 'utf8')) as ActionDefinition
}

function getStep(name: string): ActionStep {
  const step = loadAction().runs.steps.find((candidate) => candidate.name === name)
  if (!step) throw new Error(`Missing Action step: ${name}`)
  return step
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'depfresh-action-test-'))
  const workspace = join(root, 'workspace')
  const project = join(workspace, 'project with spaces')
  const runnerTemp = join(root, 'runner-temp')
  const bin = join(root, 'bin')
  const githubOutput = join(root, 'github-output')
  mkdirSync(project, { recursive: true })
  mkdirSync(runnerTemp, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(githubOutput, '')
  tempRoots.push(root)
  return { bin, githubOutput, project, root, runnerTemp, workspace }
}

function runStep(
  name: string,
  env: Record<string, string>,
  cwd = repoRoot,
): ReturnType<typeof spawnSync> {
  const step = getStep(name)
  if (!step.run) throw new Error(`Action step has no script: ${name}`)
  const validatorEnv =
    name === 'Parse outputs'
      ? { DEPFRESH_MODULE: join(repoRoot, 'src/index.ts'), NODE_OPTIONS: '--import tsx' }
      : {}
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...validatorEnv, ...env },
  })
}

function validInputEnv(fixture: ReturnType<typeof createFixture>): Record<string, string> {
  return {
    GITHUB_OUTPUT: fixture.githubOutput,
    GITHUB_WORKSPACE: fixture.workspace,
    INPUT_COMMAND: 'check',
    INPUT_EXCLUDE: '',
    INPUT_FAIL_ON_OUTDATED: 'true',
    INPUT_INCLUDE: '',
    INPUT_MODE: 'default',
    INPUT_NODE_VERSION: '24.15.0',
    INPUT_INSTALL: 'false',
    INPUT_PLAN_FILE: '',
    INPUT_RECURSIVE: 'true',
    INPUT_SYNC_LOCKFILE: 'false',
    INPUT_VERIFY_ARTIFACTS: 'false',
    INPUT_WORKING_DIRECTORY: 'project with spaces',
    INPUT_WRITE: 'false',
    RUNNER_TEMP: fixture.runnerTemp,
  }
}

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function installCommandStubs(fixture: ReturnType<typeof createFixture>): {
  argsFile: string
  npmArgsFile: string
} {
  const argsFile = join(fixture.root, 'depfresh-args.json')
  const npmArgsFile = join(fixture.root, 'npm-args.json')
  writeExecutable(
    join(fixture.bin, 'depfresh'),
    `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
if (process.env.ARGS_FILE) writeFileSync(process.env.ARGS_FILE, JSON.stringify(args))
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(process.env.INSTALLED_DEPFRESH_VERSION || '')
  process.exit(0)
}
process.stdout.write(process.env.DEPFRESH_STDOUT || '{"summary":{"total":0}}')
process.exit(Number(process.env.DEPFRESH_EXIT_CODE || 0))
`,
  )
  writeFileSync(join(fixture.bin, 'index.mjs'), 'export {}\n')
  writeExecutable(
    join(fixture.bin, 'npm'),
    `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
writeFileSync(process.env.NPM_ARGS_FILE, JSON.stringify(process.argv.slice(2)))
process.stdout.write(process.env.NPM_STDOUT || '')
process.stderr.write(process.env.NPM_STDERR || '')
process.exit(Number(process.env.NPM_EXIT_CODE || 0))
`,
  )
  return { argsFile, npmArgsFile }
}

function readOutputValue(content: string, name: string): string | undefined {
  const singleLine = content.split('\n').find((line) => line.startsWith(`${name}=`))
  if (singleLine) return singleLine.slice(name.length + 1)

  const marker = content.match(new RegExp(`(?:^|\\n)${name}<<([^\\n]+)\\n`))
  if (!marker?.[1]) return undefined
  const start = (marker.index ?? 0) + marker[0].length
  const endMarker = `\n${marker[1]}`
  const end = content.indexOf(endMarker, start)
  return end === -1 ? undefined : content.slice(start, end)
}

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { force: true, recursive: true })
  }
})

describe('GitHub Action metadata', () => {
  it('pins the exact minimum Node runtime and removes unstructured extra arguments', () => {
    const action = loadAction()

    expect(action.inputs['node-version']?.default).toBe('24.15.0')
    expect(action.inputs['extra-args']).toBeUndefined()
    expect(action.inputs.command?.default).toBe('check')
    expect(action.inputs['plan-file']?.default).toBe('')
    expect(action.inputs['sync-lockfile']?.default).toBe('false')
    expect(action.inputs.install?.default).toBe('false')
    expect(action.inputs['verify-artifacts']?.default).toBe('false')
  })

  it('validates inputs before setup and installation', () => {
    const steps = loadAction().runs.steps
    const validateIndex = steps.findIndex((step) => step.name === 'Validate inputs')
    const setupIndex = steps.findIndex((step) => step.name === 'Setup Node.js')
    const installIndex = steps.findIndex((step) => step.name === 'Install depfresh')

    expect(validateIndex).toBeGreaterThanOrEqual(0)
    expect(validateIndex).toBeLessThan(setupIndex)
    expect(validateIndex).toBeLessThan(installIndex)
  })

  it('does not interpolate runtime values into shell source', () => {
    for (const step of loadAction().runs.steps) {
      if (step.run) expect(step.run).not.toContain('${{')
    }
  })

  it('always schedules temporary-file cleanup', () => {
    const cleanup = getStep('Clean up')
    expect(cleanup.if).toBe('$' + '{{ always() }}')
  })
})

describe('GitHub Action input validation', () => {
  it('accepts the minimum runtime and resolves a directory with spaces', () => {
    const fixture = createFixture()
    const result = runStep('Validate inputs', validInputEnv(fixture))

    expect(result.status).toBe(0)
    const output = readFileSync(fixture.githubOutput, 'utf8')
    expect(readOutputValue(output, 'working-directory')).toBe(realpathSync(fixture.project))
  })

  it.each(['24.14.1', '23.99.99', '24', '24.x', 'v24.15.0', 'lts/*', ' 24.15.0'])(
    'rejects unsupported or non-exact Node version %j',
    (nodeVersion) => {
      const fixture = createFixture()
      const env = { ...validInputEnv(fixture), INPUT_NODE_VERSION: nodeVersion }
      const result = runStep('Validate inputs', env)

      expect(result.status).toBe(2)
      expect(result.stdout).toContain('::error title=depfresh input error::Invalid Node version')
      expect(result.stdout).not.toContain(nodeVersion)
    },
  )

  it('does not execute shell syntax embedded in the Node version', () => {
    const fixture = createFixture()
    const sentinel = join(fixture.root, 'node-version-injected')
    const env = {
      ...validInputEnv(fixture),
      INPUT_NODE_VERSION: `24.15.0; touch ${sentinel}`,
    }
    const result = runStep('Validate inputs', env)

    expect(result.status).toBe(2)
    expect(() => readFileSync(sentinel)).toThrow()
  })

  it.each(['24.15.0', '24.15.1', '25.0.0', '26.5.0'])(
    'accepts supported exact Node version %s',
    (nodeVersion) => {
      const fixture = createFixture()
      const result = runStep('Validate inputs', {
        ...validInputEnv(fixture),
        INPUT_NODE_VERSION: nodeVersion,
      })

      expect(result.status).toBe(0)
    },
  )

  it.each(['write', 'fail-on-outdated', 'recursive'])(
    'rejects malformed %s boolean values before side effects',
    (inputName) => {
      const fixture = createFixture()
      const envName = `INPUT_${inputName.replaceAll('-', '_').toUpperCase()}`
      const env = { ...validInputEnv(fixture), [envName]: 'yes please' }
      const result = runStep('Validate inputs', env)

      expect(result.status).toBe(2)
      expect(result.stdout).toContain('::error title=depfresh input error::Invalid boolean input')
      expect(result.stdout).not.toContain('yes please')
    },
  )

  it.each(['TRUE', 'False', '1', '0', '--write', 'true\nfalse'])(
    'rejects real-world malformed boolean value %j',
    (value) => {
      const fixture = createFixture()
      const result = runStep('Validate inputs', {
        ...validInputEnv(fixture),
        INPUT_WRITE: value,
      })

      expect(result.status).toBe(2)
      expect(result.stdout).not.toContain(value)
    },
  )

  it.each(['wat', 'major --write', '$(touch mode-injected)', 'major\n--write'])(
    'rejects malformed mode %j without reflecting it',
    (mode) => {
      const fixture = createFixture()
      const result = runStep('Validate inputs', {
        ...validInputEnv(fixture),
        INPUT_MODE: mode,
      })

      expect(result.status).toBe(2)
      expect(result.stdout).toContain('::error title=depfresh input error::Invalid mode input')
      expect(result.stdout).not.toContain(mode)
    },
  )

  it('rejects missing, escaping, control-character, and symlinked working directories', () => {
    const fixture = createFixture()
    const outside = join(fixture.root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(fixture.workspace, 'outside-link'))
    const cases = ['missing', '..', outside, 'project with spaces\nother', 'outside-link']

    for (const workingDirectory of cases) {
      writeFileSync(fixture.githubOutput, '')
      const result = runStep('Validate inputs', {
        ...validInputEnv(fixture),
        INPUT_WORKING_DIRECTORY: workingDirectory,
      })

      expect(result.status, workingDirectory).toBe(2)
      expect(result.stdout).toContain(
        '::error title=depfresh input error::Invalid working directory',
      )
      expect(result.stdout).not.toContain(workingDirectory)
    }
  })

  it('accepts a contained regular reviewed plan for apply', () => {
    const fixture = createFixture()
    const plan = join(fixture.project, 'reviewed plan.json')
    writeFileSync(plan, '{}')
    const result = runStep('Validate inputs', {
      ...validInputEnv(fixture),
      INPUT_COMMAND: 'apply',
      INPUT_PLAN_FILE: 'reviewed plan.json',
      INPUT_WRITE: 'true',
    })

    expect(result.status).toBe(0)
    expect(readOutputValue(readFileSync(fixture.githubOutput, 'utf8'), 'plan-file')).toBe(
      realpathSync(plan),
    )
  })

  it.each([
    { INPUT_COMMAND: 'inspect', INPUT_WRITE: 'true' },
    { INPUT_COMMAND: 'plan', INPUT_WRITE: 'true' },
    { INPUT_COMMAND: 'apply', INPUT_PLAN_FILE: '' },
    { INPUT_INSTALL: 'true', INPUT_SYNC_LOCKFILE: 'true' },
    { INPUT_VERIFY_ARTIFACTS: 'true' },
  ])('rejects unsafe machine input combinations before side effects: %j', (overrides) => {
    const fixture = createFixture()
    const result = runStep('Validate inputs', { ...validInputEnv(fixture), ...overrides })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error title=depfresh input error::')
  })

  it('rejects escaping and symlinked plan files', () => {
    const fixture = createFixture()
    const outside = join(fixture.root, 'outside-plan.json')
    writeFileSync(outside, '{}')
    symlinkSync(outside, join(fixture.project, 'plan-link.json'))

    for (const planFile of ['../../outside-plan.json', 'plan-link.json']) {
      writeFileSync(fixture.githubOutput, '')
      const result = runStep('Validate inputs', {
        ...validInputEnv(fixture),
        INPUT_COMMAND: 'apply',
        INPUT_PLAN_FILE: planFile,
        INPUT_WRITE: 'true',
      })
      expect(result.status).toBe(2)
      expect(result.stdout).not.toContain(planFile)
    }
  })
})

describe('GitHub Action version coupling', () => {
  it('installs and verifies the exact version from the reviewed package manifest', () => {
    const fixture = createFixture()
    const { npmArgsFile } = installCommandStubs(fixture)
    const result = runStep('Install depfresh', {
      DEPFRESH_PACKAGE_JSON: join(repoRoot, 'package.json'),
      GITHUB_OUTPUT: fixture.githubOutput,
      GITHUB_ACTION_PATH: repoRoot,
      INSTALLED_DEPFRESH_VERSION: packageJson.version,
      NPM_ARGS_FILE: npmArgsFile,
      PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: fixture.runnerTemp,
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(npmArgsFile, 'utf8'))).toEqual([
      'install',
      '--global',
      '--ignore-scripts',
      `depfresh@${packageJson.version}`,
    ])
  })

  it('fails closed when the installed version does not match', () => {
    const fixture = createFixture()
    const { npmArgsFile } = installCommandStubs(fixture)
    const result = runStep('Install depfresh', {
      DEPFRESH_PACKAGE_JSON: join(repoRoot, 'package.json'),
      GITHUB_OUTPUT: fixture.githubOutput,
      GITHUB_ACTION_PATH: repoRoot,
      INSTALLED_DEPFRESH_VERSION: '0.0.0-wrong',
      NPM_ARGS_FILE: npmArgsFile,
      PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: fixture.runnerTemp,
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error title=depfresh install error::Version mismatch')
    expect(result.stdout).not.toContain('0.0.0-wrong')
  })

  it('redacts installation failure output and returns the stable fatal code', () => {
    const fixture = createFixture()
    const { npmArgsFile } = installCommandStubs(fixture)
    const secret = 'https://token@example.test/private-registry'
    const result = runStep('Install depfresh', {
      DEPFRESH_PACKAGE_JSON: join(repoRoot, 'package.json'),
      GITHUB_OUTPUT: fixture.githubOutput,
      GITHUB_ACTION_PATH: repoRoot,
      INSTALLED_DEPFRESH_VERSION: packageJson.version,
      NPM_ARGS_FILE: npmArgsFile,
      NPM_EXIT_CODE: '1',
      NPM_STDERR: secret,
      NPM_STDOUT: secret,
      PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: fixture.runnerTemp,
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error title=depfresh install error::Installation failed')
    expect(result.stdout).not.toContain(secret)
    expect(result.stderr).not.toContain(secret)
  })
})

describe('GitHub Action argument authority', () => {
  it.each([
    ['capabilities', ['capabilities', '--json']],
    ['inspect', ['inspect', '--output', 'json', '--no-recursive']],
    ['plan', ['plan', '--output', 'json', '--mode', 'latest', '--no-recursive', '--sync-lockfile']],
    [
      'apply',
      [
        'apply',
        '--output',
        'json',
        '--write',
        '--plan-file',
        '/tmp/reviewed plan.json',
        '--install',
        '--verify-artifacts',
      ],
    ],
  ])('builds exact argv for the %s machine command', (command, expected) => {
    const fixture = createFixture()
    const { argsFile } = installCommandStubs(fixture)
    const result = runStep(
      'Run depfresh',
      {
        ARGS_FILE: argsFile,
        DEPFRESH_EXIT_CODE: '0',
        GITHUB_OUTPUT: fixture.githubOutput,
        INPUT_COMMAND: command,
        INPUT_EXCLUDE: '',
        INPUT_FAIL_ON_OUTDATED: 'true',
        INPUT_INCLUDE: '',
        INPUT_INSTALL: command === 'apply' ? 'true' : 'false',
        INPUT_MODE: command === 'plan' ? 'latest' : 'default',
        INPUT_PLAN_FILE: '/tmp/reviewed plan.json',
        INPUT_RECURSIVE: command === 'inspect' || command === 'plan' ? 'false' : 'true',
        INPUT_SYNC_LOCKFILE: command === 'plan' ? 'true' : 'false',
        INPUT_VERIFY_ARTIFACTS: command === 'apply' ? 'true' : 'false',
        INPUT_WRITE: command === 'apply' ? 'true' : 'false',
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fixture.project,
    )

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual(expected)
  })

  it('keeps spaces, quotes, newlines, option-looking values, and shell syntax inert', () => {
    const fixture = createFixture()
    const { argsFile } = installCommandStubs(fixture)
    const sentinel = join(fixture.root, 'argument-injected')
    const include = `name with spaces,"quoted",--write,$(${`touch ${sentinel}`})`
    const exclude = 'line one\nline two; --execute "danger"'
    const result = runStep(
      'Run depfresh',
      {
        ARGS_FILE: argsFile,
        DEPFRESH_EXIT_CODE: '0',
        GITHUB_OUTPUT: fixture.githubOutput,
        INPUT_EXCLUDE: exclude,
        INPUT_FAIL_ON_OUTDATED: 'false',
        INPUT_INCLUDE: include,
        INPUT_MODE: 'default',
        INPUT_RECURSIVE: 'true',
        INPUT_WRITE: 'false',
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fixture.project,
    )

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual([
      '--output',
      'json',
      `--include=${include}`,
      `--exclude=${exclude}`,
    ])
    expect(() => readFileSync(sentinel)).toThrow()
  })

  it('grants mutation only when write is exactly true', () => {
    const fixture = createFixture()
    const { argsFile } = installCommandStubs(fixture)
    const result = runStep(
      'Run depfresh',
      {
        ARGS_FILE: argsFile,
        DEPFRESH_EXIT_CODE: '0',
        GITHUB_OUTPUT: fixture.githubOutput,
        INPUT_EXCLUDE: '',
        INPUT_FAIL_ON_OUTDATED: 'true',
        INPUT_INCLUDE: '--write',
        INPUT_MODE: 'minor',
        INPUT_RECURSIVE: 'false',
        INPUT_WRITE: 'true',
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fixture.project,
    )

    expect(result.status).toBe(0)
    const args = JSON.parse(readFileSync(argsFile, 'utf8')) as string[]
    expect(args.filter((arg) => arg === '--write')).toEqual(['--write'])
    expect(args).toEqual([
      '--output',
      'json',
      '--mode',
      'minor',
      '--write',
      '--no-recursive',
      '--include=--write',
    ])
    expect(args).not.toContain('--fail-on-outdated')
    expect(args).not.toContain('--install')
    expect(args).not.toContain('--update')
    expect(args).not.toContain('--execute')
  })

  it('keeps an option-looking include value inert in the real CLI parser', () => {
    const fixture = createFixture()
    const packagePath = join(fixture.project, 'package.json')
    const packageContent = JSON.stringify(
      {
        dependencies: { example: '1.0.0' },
        name: 'action-parser-boundary',
        private: true,
        version: '1.0.0',
      },
      null,
      2,
    )
    writeFileSync(packagePath, `${packageContent}\n`)

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(repoRoot, 'src/cli/index.ts'),
        '--cwd',
        fixture.project,
        '--output',
        'json',
        '--include=--write',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: fixture.root,
          NO_COLOR: '1',
          XDG_CACHE_HOME: join(fixture.root, 'cache'),
        },
      },
    )

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ summary: { total: 0 } })
    expect(readFileSync(packagePath, 'utf8')).toBe(`${packageContent}\n`)
  })

  it('does not expose fatal output that may contain credentials', () => {
    const fixture = createFixture()
    installCommandStubs(fixture)
    const secret = 'registry-token-should-not-appear'
    const result = runStep(
      'Run depfresh',
      {
        DEPFRESH_EXIT_CODE: '2',
        DEPFRESH_STDOUT: `{"error":"${secret}"}`,
        GITHUB_OUTPUT: fixture.githubOutput,
        INPUT_EXCLUDE: '',
        INPUT_FAIL_ON_OUTDATED: 'true',
        INPUT_INCLUDE: '',
        INPUT_MODE: 'default',
        INPUT_RECURSIVE: 'true',
        INPUT_WRITE: 'false',
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fixture.project,
    )

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error title=depfresh runtime error::Fatal exit code 2')
    expect(result.stdout).not.toContain(secret)
  })

  it('preserves fail-on-outdated behavior for read-only runs', () => {
    const fixture = createFixture()
    const { argsFile } = installCommandStubs(fixture)
    const result = runStep(
      'Run depfresh',
      {
        ARGS_FILE: argsFile,
        DEPFRESH_EXIT_CODE: '1',
        GITHUB_OUTPUT: fixture.githubOutput,
        INPUT_EXCLUDE: '',
        INPUT_FAIL_ON_OUTDATED: 'true',
        INPUT_INCLUDE: '',
        INPUT_MODE: 'default',
        INPUT_RECURSIVE: 'true',
        INPUT_WRITE: 'false',
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fixture.project,
    )

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual([
      '--output',
      'json',
      '--fail-on-outdated',
    ])
    const output = readFileSync(fixture.githubOutput, 'utf8')
    expect(readOutputValue(output, 'exit-code')).toBe('1')
  })
})

describe('GitHub Action outputs and cleanup', () => {
  it.each([
    [
      'capabilities',
      0,
      { contract: 'depfresh.capabilities', schemaVersion: 1 },
      'depfresh.capabilities',
      'false',
    ],
    [
      'inspect',
      0,
      { contract: 'depfresh.inspect', schemaVersion: 1, risks: [], errors: [] },
      'depfresh.inspect',
      'false',
    ],
    [
      'plan',
      1,
      {
        contract: 'depfresh.plan',
        schemaVersion: 1,
        operations: [{}],
        summary: { blocked: 0, unknown: 0, errors: 0 },
        risks: [],
      },
      'depfresh.plan',
      'true',
    ],
    [
      'apply',
      1,
      {
        contract: 'depfresh.apply',
        schemaVersion: 1,
        status: 'conflicted',
        operations: [],
        phases: [],
      },
      'depfresh.apply',
      'true',
    ],
  ])(
    'rejects a partial %s document even when its top-level fields look plausible',
    (command, exitCode, payload) => {
      const fixture = createFixture()
      const outputFile = join(fixture.runnerTemp, 'depfresh-output.json')
      const errorFile = join(fixture.runnerTemp, 'depfresh-error.log')
      writeFileSync(outputFile, JSON.stringify(payload))
      writeFileSync(errorFile, '')
      const result = runStep('Parse outputs', {
        COMMAND: command,
        ERROR_FILE: errorFile,
        EXIT_CODE: String(exitCode),
        GITHUB_OUTPUT: fixture.githubOutput,
        OUTPUT_FILE: outputFile,
      })

      expect(result.status).toBe(2)
      expect(readFileSync(fixture.githubOutput, 'utf8')).toBe('')
    },
  )

  it('accepts complete schema-valid capabilities, inspect, plan, and apply documents', async () => {
    const fixture = createFixture()
    vi.stubEnv('HOME', fixture.root)
    vi.stubEnv('XDG_CACHE_HOME', join(fixture.root, 'cache'))
    writeFileSync(
      join(fixture.project, 'package.json'),
      JSON.stringify({ name: 'action-machine-contract', private: true, version: '1.0.0' }),
    )
    const planned = await plan({ cwd: fixture.project })
    const planFindings =
      planned.operations.length > 0 ||
      planned.summary.blocked > 0 ||
      planned.summary.unknown > 0 ||
      planned.summary.errors > 0 ||
      planned.risks.length > 0
    const documents = [
      ['capabilities', getCliCapabilities(), 0],
      ['inspect', await inspect({ cwd: fixture.project }), 0],
      ['plan', planned, planFindings ? 1 : 0],
      [
        'apply',
        await apply(planned, { cwd: fixture.project }, createInvocationAuthority({ write: true })),
        0,
      ],
    ] as const

    for (const [command, payload, exitCode] of documents) {
      writeFileSync(fixture.githubOutput, '')
      const outputFile = join(fixture.runnerTemp, `${command}-output.json`)
      const errorFile = join(fixture.runnerTemp, `${command}-error.log`)
      writeFileSync(outputFile, JSON.stringify(payload))
      writeFileSync(errorFile, '')
      const result = runStep('Parse outputs', {
        COMMAND: command,
        ERROR_FILE: errorFile,
        EXIT_CODE: String(exitCode),
        GITHUB_OUTPUT: fixture.githubOutput,
        OUTPUT_FILE: outputFile,
      })

      expect(result.status, `${command}: ${result.stderr}`).toBe(0)
      expect(readOutputValue(readFileSync(fixture.githubOutput, 'utf8'), 'contract')).toBe(
        payload.contract,
      )
    }
  })

  it('rejects a machine contract whose result disagrees with its exit code', () => {
    const fixture = createFixture()
    const outputFile = join(fixture.runnerTemp, 'depfresh-output.json')
    const errorFile = join(fixture.runnerTemp, 'depfresh-error.log')
    writeFileSync(
      outputFile,
      JSON.stringify({
        contract: 'depfresh.apply',
        schemaVersion: 1,
        status: 'conflicted',
        operations: [],
        phases: [],
      }),
    )
    writeFileSync(errorFile, '')
    const result = runStep('Parse outputs', {
      COMMAND: 'apply',
      ERROR_FILE: errorFile,
      EXIT_CODE: '0',
      GITHUB_OUTPUT: fixture.githubOutput,
      OUTPUT_FILE: outputFile,
    })

    expect(result.status).toBe(2)
    expect(readFileSync(fixture.githubOutput, 'utf8')).toBe('')
  })

  it('parses JSON without jq and transports the exact payload', () => {
    const fixture = createFixture()
    const outputFile = join(fixture.runnerTemp, 'depfresh-output.json')
    const errorFile = join(fixture.runnerTemp, 'depfresh-error.log')
    const payload = JSON.stringify({ packages: [], summary: { total: 3 } }, null, 2)
    writeFileSync(outputFile, payload)
    writeFileSync(errorFile, '')
    const result = runStep('Parse outputs', {
      ERROR_FILE: errorFile,
      EXIT_CODE: '1',
      GITHUB_OUTPUT: fixture.githubOutput,
      OUTPUT_FILE: outputFile,
    })

    expect(result.status).toBe(0)
    expect(getStep('Parse outputs').run).not.toContain('jq')
    const output = readFileSync(fixture.githubOutput, 'utf8')
    expect(readOutputValue(output, 'json')).toBe(payload)
    expect(readOutputValue(output, 'outdated-count')).toBe('3')
    expect(readOutputValue(output, 'has-updates')).toBe('true')
  })

  it('keeps workflow-command-shaped JSON in the output file, not process logs', () => {
    const fixture = createFixture()
    const outputFile = join(fixture.runnerTemp, 'depfresh-output.json')
    const errorFile = join(fixture.runnerTemp, 'depfresh-error.log')
    const payload = JSON.stringify({
      packages: [{ name: '::error::not-a-command' }],
      summary: { total: 0 },
    })
    writeFileSync(outputFile, payload)
    writeFileSync(errorFile, '')
    const result = runStep('Parse outputs', {
      ERROR_FILE: errorFile,
      GITHUB_OUTPUT: fixture.githubOutput,
      OUTPUT_FILE: outputFile,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('::error::not-a-command')
    expect(readOutputValue(readFileSync(fixture.githubOutput, 'utf8'), 'json')).toBe(payload)
  })

  it('rejects invalid JSON without reflecting secret-like content', () => {
    const fixture = createFixture()
    const outputFile = join(fixture.runnerTemp, 'depfresh-output.json')
    const errorFile = join(fixture.runnerTemp, 'depfresh-error.log')
    const secret = 'registry-auth-token-value'
    writeFileSync(outputFile, `{${secret}`)
    writeFileSync(errorFile, '')
    const result = runStep('Parse outputs', {
      ERROR_FILE: errorFile,
      GITHUB_OUTPUT: fixture.githubOutput,
      OUTPUT_FILE: outputFile,
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error title=depfresh output error::Invalid JSON output')
    expect(result.stdout).not.toContain(secret)
    expect(result.stderr).not.toContain(secret)
  })

  it.each([
    ['', 'empty output'],
    ['{}', 'missing summary'],
    ['{"summary":{}}', 'missing total'],
    ['{"summary":{"total":null}}', 'null total'],
    ['{"summary":{"total":"0"}}', 'string total'],
    ['{"summary":{"total":-1}}', 'negative total'],
    ['{"summary":{"total":1.5}}', 'fractional total'],
    [`{"summary":{"total":${Number.MAX_SAFE_INTEGER + 1}}}`, 'unsafe total'],
  ])('rejects %s as an untrustworthy result (%s)', (payload) => {
    const fixture = createFixture()
    const outputFile = join(fixture.runnerTemp, 'depfresh-output.json')
    const errorFile = join(fixture.runnerTemp, 'depfresh-error.log')
    writeFileSync(outputFile, payload)
    writeFileSync(errorFile, '')

    const result = runStep('Parse outputs', {
      ERROR_FILE: errorFile,
      GITHUB_OUTPUT: fixture.githubOutput,
      OUTPUT_FILE: outputFile,
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error title=depfresh output error::Invalid JSON output')
    expect(readFileSync(fixture.githubOutput, 'utf8')).toBe('')
  })

  it('removes the temporary output file even after earlier failures', () => {
    const fixture = createFixture()
    const outputFile = join(fixture.runnerTemp, 'depfresh-output.json')
    const errorFile = join(fixture.runnerTemp, 'depfresh-error.log')
    writeFileSync(outputFile, '{}')
    writeFileSync(errorFile, 'sensitive diagnostic')
    const result = runStep('Clean up', { ERROR_FILE: errorFile, OUTPUT_FILE: outputFile })

    expect(result.status).toBe(0)
    expect(() => readFileSync(outputFile)).toThrow()
    expect(() => readFileSync(errorFile)).toThrow()
  })
})

describe('GitHub Action documented workflow', () => {
  it('executes the default read-only flow against a temporary project', () => {
    const fixture = createFixture()
    const { argsFile, npmArgsFile } = installCommandStubs(fixture)
    const path = `${fixture.bin}:${process.env.PATH ?? ''}`

    const validation = runStep('Validate inputs', validInputEnv(fixture))
    expect(validation.status).toBe(0)

    const installation = runStep('Install depfresh', {
      DEPFRESH_PACKAGE_JSON: join(repoRoot, 'package.json'),
      GITHUB_OUTPUT: fixture.githubOutput,
      INSTALLED_DEPFRESH_VERSION: packageJson.version,
      NPM_ARGS_FILE: npmArgsFile,
      PATH: path,
      RUNNER_TEMP: fixture.runnerTemp,
    })
    expect(installation.status).toBe(0)

    const execution = runStep(
      'Run depfresh',
      {
        ARGS_FILE: argsFile,
        DEPFRESH_EXIT_CODE: '0',
        DEPFRESH_STDOUT: JSON.stringify({ packages: [], summary: { total: 0 } }),
        GITHUB_OUTPUT: fixture.githubOutput,
        INPUT_EXCLUDE: '',
        INPUT_FAIL_ON_OUTDATED: 'true',
        INPUT_INCLUDE: '',
        INPUT_MODE: 'default',
        INPUT_RECURSIVE: 'true',
        INPUT_WRITE: 'false',
        PATH: path,
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fixture.project,
    )
    expect(execution.status).toBe(0)

    const runOutput = readFileSync(fixture.githubOutput, 'utf8')
    const outputFile = readOutputValue(runOutput, 'output-file')
    const errorFile = readOutputValue(runOutput, 'error-file')
    expect(outputFile).toBeDefined()
    expect(errorFile).toBeDefined()

    const parsing = runStep('Parse outputs', {
      ERROR_FILE: errorFile ?? '',
      GITHUB_OUTPUT: fixture.githubOutput,
      OUTPUT_FILE: outputFile ?? '',
    })
    expect(parsing.status).toBe(0)

    const cleanup = runStep('Clean up', {
      ERROR_FILE: errorFile ?? '',
      OUTPUT_FILE: outputFile ?? '',
    })
    expect(cleanup.status).toBe(0)
    expect(() => readFileSync(outputFile ?? '')).toThrow()
    expect(() => readFileSync(errorFile ?? '')).toThrow()

    const output = readFileSync(fixture.githubOutput, 'utf8')
    expect(readOutputValue(output, 'outdated-count')).toBe('0')
    expect(readOutputValue(output, 'has-updates')).toBe('false')
    expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual([
      '--output',
      'json',
      '--fail-on-outdated',
    ])
  })

  it('keeps every documented workflow example parseable and injection-safe', () => {
    const documentation = readFileSync(join(repoRoot, 'docs/integrations/github-action.md'), 'utf8')
    const yamlBlocks = [...documentation.matchAll(/```yaml\n([\s\S]*?)```/gu)]

    expect(yamlBlocks.length).toBeGreaterThan(0)
    for (const match of yamlBlocks) {
      expect(() => parse(match[1] ?? '')).not.toThrow()
    }
    expect(documentation).not.toContain('extra-args')
    expect(documentation).not.toMatch(/JSON\.parse\(`\$\{\{/u)
  })
})
