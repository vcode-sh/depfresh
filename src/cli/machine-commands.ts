import type { PlanOptions } from '../commands/plan'
import { ConfigError } from '../errors'
import type { RangeMode } from '../types'
import { parseIntegerOption } from '../validate-options'
import { VALID_MODES } from './arg-values'
import { args as argsSchema } from './args-schema'
import { parseCommaSeparatedArg } from './parse-list-arg'

export type MachineCommand = 'inspect' | 'plan' | 'apply'

const forbiddenOptions = [
  ['write', '--write'],
  ['interactive', '--interactive'],
  ['install', '--install'],
  ['update', '--update'],
  ['execute', '--execute'],
  ['verify-command', '--verify-command'],
  ['strict-post-write', '--strict-post-write'],
  ['global', '--global'],
  ['global-all', '--global-all'],
] as const

const commonMachineOptions = new Set([
  'cwd',
  'recursive',
  'ignore-paths',
  'ignore-other-workspaces',
  'json',
  'output',
])
const planOptions = new Set([
  ...commonMachineOptions,
  'mode',
  'include',
  'exclude',
  'force',
  'peer',
  'include-locked',
  'deps-only',
  'dev-only',
  'concurrency',
  'cooldown',
  'as-of',
])
const applyOptions = new Set(['cwd', 'json', 'output', 'write', 'plan-file'])
const aliasNames = new Map<string, { name: string; type: string }>()
for (const [name, definition] of Object.entries(argsSchema)) {
  const rawDefinition = definition as {
    type?: string
    alias?: string | string[]
  }
  if (rawDefinition.type === 'positional') continue
  const aliases = Array.isArray(rawDefinition.alias)
    ? rawDefinition.alias
    : rawDefinition.alias
      ? [rawDefinition.alias]
      : []
  for (const alias of aliases) {
    aliasNames.set(alias, { name, type: rawDefinition.type ?? '' })
  }
}

export function getMachineCommand(value: unknown): MachineCommand | undefined {
  return value === 'inspect' || value === 'plan' || value === 'apply' ? value : undefined
}

export function assertMachineCommandSafety(
  args: Record<string, unknown>,
  rawArgs: readonly string[],
  command: MachineCommand,
): void {
  if (collectExplicitOptions(rawArgs).has('output') && args.output !== 'json') {
    throw new ConfigError('Machine commands only support --output json.', {
      reason: 'INVALID_OPTION_VALUE',
    })
  }
  for (const [name, flag] of forbiddenOptions) {
    if (args[name] && !(command === 'apply' && name === 'write')) {
      throw new ConfigError(`${flag} is not valid for read-only machine commands.`, {
        reason: 'UNSUPPORTED_COMBINATION',
      })
    }
  }
  const allowed =
    command === 'inspect' ? commonMachineOptions : command === 'plan' ? planOptions : applyOptions
  for (const name of collectExplicitOptions(rawArgs)) {
    if (!allowed.has(name)) {
      throw new ConfigError(`--${name} is not valid for the ${command} command.`, {
        reason: 'UNSUPPORTED_COMBINATION',
      })
    }
  }
  if (command === 'apply') {
    if (args.write !== true) {
      throw new ConfigError('depfresh apply requires explicit --write authority.', {
        reason: 'AUTHORITY_REQUIRED',
      })
    }
    if (typeof args['plan-file'] !== 'string' || args['plan-file'].length === 0) {
      throw new ConfigError('depfresh apply requires --plan-file.', {
        reason: 'MISSING_OPTION_VALUE',
      })
    }
  }
}

function collectExplicitOptions(rawArgs: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const token of rawArgs.slice(1)) {
    if (token.startsWith('--')) {
      const rawName = token.slice(2).split('=', 1)[0] ?? ''
      names.add(rawName.startsWith('no-') ? rawName.slice(3) : rawName)
      continue
    }
    if (!token.startsWith('-') || token === '-') continue
    for (const alias of token.slice(1).split('=', 1)[0] ?? '') {
      const definition = aliasNames.get(alias)
      if (!definition) continue
      names.add(definition.name)
      if (definition.type === 'string') break
    }
  }
  return names
}

function parseMode(value: unknown): RangeMode {
  if (typeof value !== 'string' || !VALID_MODES.includes(value as RangeMode)) {
    throw new ConfigError(
      `Invalid value for --mode: "${String(value)}". Expected one of: ${VALID_MODES.join(', ')}.`,
      { reason: 'INVALID_OPTION_VALUE' },
    )
  }
  return value as RangeMode
}

export function normalizePlanCommandArgs(args: Record<string, unknown>): PlanOptions {
  if (args['deps-only'] && args['dev-only']) {
    throw new ConfigError('--deps-only cannot be combined with --dev-only.', {
      reason: 'UNSUPPORTED_COMBINATION',
    })
  }
  const depFields: PlanOptions['depFields'] = {}
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
  return {
    cwd: typeof args.cwd === 'string' ? args.cwd : process.cwd(),
    recursive: args.recursive as boolean,
    mode: parseMode(args.mode),
    include: parseCommaSeparatedArg(args.include),
    exclude: parseCommaSeparatedArg(args.exclude),
    force: args.force as boolean,
    includeLocked: args['include-locked'] as boolean,
    peer: args.peer as boolean,
    depFields,
    concurrency: parseIntegerOption(args.concurrency, '--concurrency', 1),
    cooldown: parseIntegerOption(args.cooldown, '--cooldown', 0),
    ignorePaths: parseCommaSeparatedArg(args['ignore-paths']),
    ignoreOtherWorkspaces: args['ignore-other-workspaces'] as boolean,
    ...(typeof args['as-of'] === 'string' ? { asOf: args['as-of'] } : {}),
  }
}
