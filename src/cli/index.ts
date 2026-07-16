import { defineCommand, runMain } from 'citty'
import { version } from '../../package.json' with { type: 'json' }
import { ConfigError } from '../errors'
import { getSafeErrorDetails } from '../utils/redact'
import { args } from './args-schema'
import { normalizeCliRawArgs } from './raw-args'
import { showUsageWithLinks } from './usage'
import './signals'

function rawMachineCommand(rawArgs: string[]): 'inspect' | 'plan' | 'apply' | undefined {
  return rawArgs[0] === 'inspect' || rawArgs[0] === 'plan' || rawArgs[0] === 'apply'
    ? rawArgs[0]
    : undefined
}

function wantsJsonOutput(rawArgs: string[]): boolean {
  if (
    rawArgs.includes('--help-json') ||
    rawArgs.includes('--json') ||
    rawArgs.includes('--json=true')
  ) {
    return true
  }
  return rawArgs.some((arg, index) => {
    if (arg === '--output=json' || arg === '-ojson') return true
    return (arg === '--output' || arg === '-o') && rawArgs[index + 1] === 'json'
  })
}

function getRawMode(rawArgs: string[]): string {
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]
    if (arg === '--mode' || arg === '-m') return rawArgs[index + 1] ?? 'default'
    if (arg?.startsWith('--mode=')) return arg.slice('--mode='.length)
    if (arg?.startsWith('-m') && arg.length > 2) return arg.slice(2)
    if (
      arg &&
      !arg.startsWith('-') &&
      arg !== 'help' &&
      arg !== 'capabilities' &&
      arg !== 'inspect' &&
      arg !== 'plan' &&
      arg !== 'apply'
    ) {
      return arg
    }
  }
  return 'default'
}

async function outputStartupError(error: unknown, rawArgs: string[]): Promise<void> {
  const command = rawMachineCommand(rawArgs)
  if (command) {
    const { buildMachineCommandError } = await import('../contracts/error-document')
    // biome-ignore lint/suspicious/noConsole: intentional stable machine output
    console.log(JSON.stringify(buildMachineCommandError(command, error), null, 2))
    return
  }
  if (wantsJsonOutput(rawArgs)) {
    const { outputJsonError } = await import('../commands/check/json-output')
    outputJsonError(error, { cwd: process.cwd(), mode: getRawMode(rawArgs) })
    return
  }

  // biome-ignore lint/suspicious/noConsole: intentional stable CLI error output
  console.error('Fatal error:', getSafeErrorDetails(error).message)
}

const main = defineCommand({
  meta: {
    name: 'depfresh',
    version,
    description: 'Keep your npm dependencies fresh',
  },
  args,
  async run({ args }) {
    try {
      if (args.mode_arg === 'help') {
        const { showUsage } = await import('citty')
        await showUsage(main)
        process.exit(0)
      }

      if (args.mode_arg !== 'apply' && typeof args['plan-file'] === 'string') {
        throw new ConfigError('--plan-file is only valid with the apply command.', {
          reason: 'UNSUPPORTED_COMBINATION',
        })
      }

      if (args['help-json']) {
        const { outputCliCapabilities } = await import('./capabilities')
        outputCliCapabilities()
        process.exit(0)
      }

      if (args.mode_arg === 'capabilities') {
        if (!args.json) {
          throw new ConfigError('depfresh capabilities requires --json.', {
            reason: 'UNSUPPORTED_COMBINATION',
          })
        }

        const { outputCliCapabilities } = await import('./capabilities')
        outputCliCapabilities()
        process.exit(0)
      }

      const { assertMachineCommandSafety, getMachineCommand } = await import('./machine-commands')
      const machineCommand = getMachineCommand(args.mode_arg)
      if (machineCommand) {
        const commandArgs = args as Record<string, unknown>
        assertMachineCommandSafety(commandArgs, originalRawArgs, machineCommand)
        if (!(args.json || args.output === 'json')) {
          throw new ConfigError(`depfresh ${machineCommand} requires --json.`, {
            reason: 'UNSUPPORTED_COMBINATION',
          })
        }
        if (machineCommand === 'inspect') {
          const { inspect } = await import('../commands/inspect')
          const result = await inspect({
            cwd: typeof commandArgs.cwd === 'string' ? commandArgs.cwd : process.cwd(),
            recursive: commandArgs.recursive !== false,
            ignorePaths:
              typeof commandArgs['ignore-paths'] === 'string'
                ? commandArgs['ignore-paths']
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                : undefined,
            ignoreOtherWorkspaces: commandArgs['ignore-other-workspaces'] !== false,
          })
          // biome-ignore lint/suspicious/noConsole: intentional stable machine output
          console.log(JSON.stringify(result, null, 2))
          process.exit(result.risks.length > 0 || result.errors.length > 0 ? 1 : 0)
        }
        if (machineCommand === 'apply') {
          const { readFileSync } = await import('node:fs')
          const { apply } = await import('../commands/apply')
          const { createInvocationAuthority } = await import('../invocation-authority')
          const planPath = commandArgs['plan-file']
          if (typeof planPath !== 'string') {
            throw new ConfigError('depfresh apply requires --plan-file.', {
              reason: 'MISSING_OPTION_VALUE',
            })
          }
          const planInput: unknown = JSON.parse(readFileSync(planPath, 'utf8'))
          const result = await apply(
            planInput as import('../contracts/schemas').PlanResult,
            { cwd: typeof commandArgs.cwd === 'string' ? commandArgs.cwd : process.cwd() },
            createInvocationAuthority({
              write: commandArgs.write === true,
              syncLockfile: commandArgs['sync-lockfile'] === true,
              install: commandArgs.install === true,
              verifyArtifacts: commandArgs['verify-artifacts'] === true,
              verify: commandArgs.verify === true,
            }),
          )
          // biome-ignore lint/suspicious/noConsole: intentional stable machine output
          console.log(JSON.stringify(result, null, 2))
          process.exit(result.status === 'applied' || result.status === 'noop' ? 0 : 1)
        }
        const { planForInvocation } = await import('../commands/plan')
        const { normalizePlanCommandArgs } = await import('./machine-commands')
        const result = await planForInvocation(normalizePlanCommandArgs(commandArgs), 'cli')
        // biome-ignore lint/suspicious/noConsole: intentional stable machine output
        console.log(JSON.stringify(result, null, 2))
        const findings =
          result.operations.length > 0 ||
          result.summary.blocked > 0 ||
          result.summary.unknown > 0 ||
          result.summary.errors > 0 ||
          result.risks.length > 0
        process.exit(findings ? 1 : 0)
      }

      if (args.json) {
        throw new ConfigError('--json is only valid with the capabilities command.', {
          reason: 'UNSUPPORTED_COMBINATION',
        })
      }

      const { normalizeArgs } = await import('./normalize-args')
      const { checkFromCli } = await import('../commands/check/run-check')

      const options = await normalizeArgs(args)
      const exitCode = await checkFromCli(options)
      process.exit(exitCode)
    } catch (error) {
      const machineCommand =
        args.mode_arg === 'inspect' || args.mode_arg === 'plan' || args.mode_arg === 'apply'
          ? args.mode_arg
          : undefined
      if (machineCommand) {
        const { buildMachineCommandError } = await import('../contracts/error-document')
        // biome-ignore lint/suspicious/noConsole: intentional stable machine output
        console.log(JSON.stringify(buildMachineCommandError(machineCommand, error), null, 2))
        process.exit(2)
      }
      if (args.output === 'json') {
        const { outputJsonError } = await import('../commands/check/json-output')
        outputJsonError(error, {
          cwd: typeof args.cwd === 'string' ? args.cwd : process.cwd(),
          mode: typeof args.mode === 'string' ? args.mode : 'default',
        })
        process.exit(2)
      }
      // biome-ignore lint/suspicious/noConsole: intentional error output
      console.error('Fatal error:', error instanceof Error ? error.message : String(error))
      process.exit(2)
    }
  },
})

const originalRawArgs = process.argv.slice(2)
let normalizedRawArgs: string[] | undefined

try {
  normalizedRawArgs = normalizeCliRawArgs(originalRawArgs)
} catch (error) {
  await outputStartupError(error, originalRawArgs)
  process.exitCode = 2
}

if (normalizedRawArgs) {
  await runMain(main, {
    rawArgs: normalizedRawArgs,
    showUsage: showUsageWithLinks,
  })
}
