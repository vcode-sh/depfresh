import { defineCommand, runMain } from 'citty'
import { version } from '../../package.json' with { type: 'json' }
import { args } from './args-schema'
import './signals'

const main = defineCommand({
  meta: {
    name: 'depfresh',
    version,
    description: 'Keep your npm dependencies fresh',
  },
  args,
  async run({ args }) {
    try {
      if (args['help-json']) {
        const { outputCliCapabilities } = await import('./capabilities')
        outputCliCapabilities()
        process.exit(0)
      }

      if (args.mode_arg === 'capabilities') {
        if (!args.json) {
          throw new Error('`depfresh capabilities` requires `--json`.')
        }

        const { outputCliCapabilities } = await import('./capabilities')
        outputCliCapabilities()
        process.exit(0)
      }

      const { normalizeArgs } = await import('./normalize-args')
      const { check } = await import('../commands/check/index')

      const options = await normalizeArgs(args)
      const exitCode = await check(options)
      process.exit(exitCode)
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: intentional error output
      console.error('Fatal error:', error instanceof Error ? error.message : String(error))
      process.exit(2)
    }
  },
})

runMain(main)
