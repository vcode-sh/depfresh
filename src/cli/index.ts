import { defineCommand, runMain } from 'citty'
import { version } from '../../package.json' with { type: 'json' }
import { ConfigError } from '../errors'
import { getSafeErrorDetails } from '../utils/redact'
import { args } from './args-schema'
import { normalizeCliRawArgs } from './raw-args'
import { showUsageWithLinks } from './usage'
import './signals'

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
    if (arg && !arg.startsWith('-') && arg !== 'help' && arg !== 'capabilities') return arg
  }
  return 'default'
}

async function outputStartupError(error: unknown, rawArgs: string[]): Promise<void> {
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

      if (args.json) {
        throw new ConfigError('--json is only valid with the capabilities command.', {
          reason: 'UNSUPPORTED_COMBINATION',
        })
      }

      const { normalizeArgs } = await import('./normalize-args')
      const { check } = await import('../commands/check/index')

      const options = await normalizeArgs(args)
      const exitCode = await check(options)
      process.exit(exitCode)
    } catch (error) {
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
