import { ConfigError } from '../errors'
import type { depfreshOptions, OutputFormat, RangeMode, SortOption } from '../types'
import { VALID_LOG_LEVELS, VALID_MODES, VALID_OUTPUTS, VALID_SORT_OPTIONS } from './arg-values'
import { parseCommaSeparatedArg } from './parse-list-arg'

function validateEnum<T extends string>(
  value: unknown,
  flagName: string,
  validValues: readonly T[],
): T {
  if (typeof value !== 'string' || !validValues.includes(value as T)) {
    throw new ConfigError(
      `Invalid value for ${flagName}: "${String(value)}". Expected one of: ${validValues.join(', ')}.`,
    )
  }
  return value as T
}

export async function normalizeArgs(args: Record<string, unknown>): Promise<depfreshOptions> {
  const { resolveConfig } = await import('../config')
  const globalAll = args['global-all'] as boolean

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

  // Positional mode arg: `depfresh major` is shorthand for `depfresh --mode major`
  const modeValue = args.mode_arg ?? args.mode
  const mode = validateEnum(modeValue, '--mode', VALID_MODES) as RangeMode
  const output = validateEnum(args.output, '--output', VALID_OUTPUTS) as OutputFormat
  const sort = validateEnum(args.sort, '--sort', VALID_SORT_OPTIONS) as SortOption
  const loglevel = validateEnum(args.loglevel, '--loglevel', VALID_LOG_LEVELS)

  const include = parseCommaSeparatedArg(args.include)
  const exclude = parseCommaSeparatedArg(args.exclude)
  const ignorePaths = parseCommaSeparatedArg(args['ignore-paths'])
  const refreshCache = Boolean(args['refresh-cache'] || args['no-cache'])

  return resolveConfig({
    cwd: (args.cwd as string) || process.cwd(),
    recursive: args.recursive as boolean,
    write: args.write as boolean,
    interactive: args.interactive as boolean,
    mode,
    include,
    exclude,
    ignorePaths,
    force: args.force as boolean,
    refreshCache,
    global: (args.global as boolean) || globalAll,
    globalAll,
    peer: args.peer as boolean,
    includeLocked: args['include-locked'] as boolean,
    output,
    concurrency: Number.parseInt(args.concurrency as string, 10),
    loglevel,
    depFields,
    all: args.all as boolean,
    group: args.group as boolean,
    sort,
    timediff: args.timediff as boolean,
    cooldown: Number.parseInt(args.cooldown as string, 10),
    nodecompat: args.nodecompat as boolean,
    long: args.long as boolean,
    explain: args.explain as boolean,
    install: args.install as boolean,
    update: args.update as boolean,
    execute: args.execute as string | undefined,
    verifyCommand: args['verify-command'] as string | undefined,
    failOnOutdated: args['fail-on-outdated'] as boolean,
    ignoreOtherWorkspaces: args['ignore-other-workspaces'] as boolean,
  })
}
