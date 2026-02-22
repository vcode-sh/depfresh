import type { BumpOptions, OutputFormat, RangeMode, SortOption } from '../types'

const VALID_MODES = new Set<string>([
  'default',
  'major',
  'minor',
  'patch',
  'latest',
  'newest',
  'next',
])

export async function normalizeArgs(args: Record<string, unknown>): Promise<BumpOptions> {
  const { resolveConfig } = await import('../config')

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

  // Positional mode arg: `bump major` is shorthand for `bump --mode major`
  const mode =
    args.mode_arg && VALID_MODES.has(args.mode_arg as string)
      ? (args.mode_arg as RangeMode)
      : (args.mode as RangeMode)

  const include =
    typeof args.include === 'string' ? args.include.split(',').map((s) => s.trim()) : undefined
  const exclude =
    typeof args.exclude === 'string' ? args.exclude.split(',').map((s) => s.trim()) : undefined

  return resolveConfig({
    cwd: (args.cwd as string) || process.cwd(),
    recursive: args.recursive as boolean,
    write: args.write as boolean,
    interactive: args.interactive as boolean,
    mode,
    include,
    exclude,
    force: args.force as boolean,
    global: args.global as boolean,
    peer: args.peer as boolean,
    includeLocked: args['include-locked'] as boolean,
    output: args.output as OutputFormat,
    concurrency: Number.parseInt(args.concurrency as string, 10),
    loglevel: args.loglevel as 'silent' | 'info' | 'debug',
    depFields,
    all: args.all as boolean,
    group: args.group as boolean,
    sort: args.sort as SortOption,
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
