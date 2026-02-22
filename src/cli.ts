import { defineCommand, runMain } from 'citty'
import { version } from '../package.json' with { type: 'json' }
import type { OutputFormat, RangeMode } from './types'

const main = defineCommand({
  meta: {
    name: 'bump',
    version,
    description: 'Keep your npm dependencies fresh',
  },
  args: {
    recursive: {
      type: 'boolean',
      alias: 'r',
      description: 'Recursively search for package.json in subdirectories',
      default: true,
    },
    write: {
      type: 'boolean',
      alias: 'w',
      description: 'Write updated versions to package files',
      default: false,
    },
    interactive: {
      type: 'boolean',
      alias: 'I',
      description: 'Interactive mode — select which deps to update',
      default: false,
    },
    mode: {
      type: 'string',
      alias: 'm',
      description: 'Version range mode: default, major, minor, patch, latest, newest, next',
      default: 'default',
    },
    include: {
      type: 'string',
      alias: 'n',
      description: 'Only include packages matching this regex (comma-separated)',
    },
    exclude: {
      type: 'string',
      alias: 'x',
      description: 'Exclude packages matching this regex (comma-separated)',
    },
    force: {
      type: 'boolean',
      alias: 'f',
      description: 'Force update even if the version is satisfied',
      default: false,
    },
    global: {
      type: 'boolean',
      alias: 'g',
      description: 'Check global packages',
      default: false,
    },
    peer: {
      type: 'boolean',
      alias: 'P',
      description: 'Include peer dependencies',
      default: false,
    },
    'include-locked': {
      type: 'boolean',
      alias: 'l',
      description: 'Include locked (pinned) dependencies',
      default: false,
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output format: table, json, sarif',
      default: 'table',
    },
    concurrency: {
      type: 'string',
      alias: 'c',
      description: 'Max concurrent registry requests',
      default: '16',
    },
    loglevel: {
      type: 'string',
      description: 'Log level: silent, info, debug',
      default: 'info',
    },
    'deps-only': {
      type: 'boolean',
      description: 'Only check dependencies (not devDependencies)',
      default: false,
    },
    'dev-only': {
      type: 'boolean',
      description: 'Only check devDependencies',
      default: false,
    },
  },
  async run({ args }) {
    const { resolveConfig } = await import('./config')
    const { check } = await import('./commands/check/index')

    const depFields: Record<string, boolean> = {}
    if (args['deps-only']) {
      depFields.devDependencies = false
      depFields.peerDependencies = false
      depFields.optionalDependencies = false
    }
    if (args['dev-only']) {
      depFields.dependencies = false
      depFields.peerDependencies = false
      depFields.optionalDependencies = false
    }

    const options = await resolveConfig({
      cwd: process.cwd(),
      recursive: args.recursive,
      write: args.write,
      interactive: args.interactive,
      mode: args.mode as RangeMode,
      include: args.include?.split(',').map((s) => s.trim()),
      exclude: args.exclude?.split(',').map((s) => s.trim()),
      force: args.force,
      global: args.global,
      peer: args.peer,
      includeLocked: args['include-locked'],
      output: args.output as OutputFormat,
      concurrency: Number.parseInt(args.concurrency, 10),
      loglevel: args.loglevel as 'silent' | 'info' | 'debug',
      depFields,
    })

    const exitCode = await check(options)
    process.exit(exitCode)
  },
})

runMain(main)
