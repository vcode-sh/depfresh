import { defineCommand, runMain } from 'citty'
import { version } from '../../package.json' with { type: 'json' }
import { args } from './args-schema'
import './signals'

const main = defineCommand({
  meta: {
    name: 'upgr',
    version,
    description: 'Keep your npm dependencies fresh',
  },
  args,
  async run({ args }) {
    try {
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
