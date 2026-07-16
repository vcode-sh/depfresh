import type { ArgsDef } from 'citty'
import { migrationParityArgs } from './migration-flags'

export const args: ArgsDef = {
  mode_arg: {
    type: 'positional',
    description: 'Command (inspect, plan, apply, capabilities) or version range mode shorthand',
    required: false,
  },
  cwd: {
    type: 'string',
    alias: 'C',
    description: 'Working directory for depfresh to run in',
  },
  recursive: {
    type: 'boolean',
    alias: 'r',
    description:
      'Recursively search for package manifests (package.json, package.yaml) in subdirectories',
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
    description: 'Interactive mode — select which deps to update (requires --write)',
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
    description: 'Only include packages matching these regex/glob patterns (comma-separated)',
  },
  exclude: {
    type: 'string',
    alias: 'x',
    description: 'Exclude packages matching these regex/glob patterns (comma-separated)',
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
    description: 'Inspect one supported global manager; --write uses observed global apply',
    default: false,
  },
  'global-all': {
    type: 'boolean',
    description: 'Inspect npm, pnpm, and bun globals; --write applies each occurrence separately',
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
    description: 'Output format: table, json',
    default: 'table',
  },
  'help-json': {
    type: 'boolean',
    description: 'Print machine-readable CLI capabilities as JSON',
    default: false,
  },
  json: {
    type: 'boolean',
    description: 'Print JSON output for machine-discoverability commands',
    default: false,
  },
  'plan-file': {
    type: 'string',
    description: 'Path to one immutable JSON plan for the apply command',
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
  all: {
    type: 'boolean',
    alias: 'a',
    description: 'Show all packages including up-to-date ones',
    default: false,
  },
  group: {
    type: 'boolean',
    alias: 'G',
    description: 'Group output by dependency source',
    default: true,
  },
  sort: {
    type: 'string',
    alias: 's',
    description: 'Sort order: diff-asc, diff-desc, time-asc, time-desc, name-asc, name-desc',
    default: 'diff-asc',
  },
  timediff: {
    type: 'boolean',
    alias: 'T',
    description: 'Show time since version was published',
    default: true,
  },
  cooldown: {
    type: 'string',
    description: 'Skip versions published less than N days ago (0 = disabled)',
    default: '0',
  },
  'as-of': {
    type: 'string',
    description: 'Semantic UTC timestamp for deterministic cooldown planning',
  },
  nodecompat: {
    type: 'boolean',
    description: 'Show Node.js engine compatibility for target versions',
    default: true,
  },
  long: {
    type: 'boolean',
    alias: 'L',
    description: 'Show extra details (homepage URL) per package',
    default: false,
  },
  explain: {
    type: 'boolean',
    alias: 'E',
    description: 'Show human-readable explanations for update types in interactive mode',
    default: false,
  },
  'explain-discovery': {
    type: 'boolean',
    description: 'Explain how depfresh discovered roots, manifests, skipped paths, and catalogs',
    default: false,
  },
  profile: {
    type: 'boolean',
    description: 'Emit runtime timing and cache/network diagnostics for this run',
    default: false,
  },
  install: {
    type: 'boolean',
    alias: 'i',
    description: 'Plan or grant an explicit lifecycle-disabled package-manager install phase',
    default: false,
  },
  'sync-lockfile': {
    type: 'boolean',
    description: 'Plan or grant a lifecycle-disabled lockfile synchronization phase',
    default: false,
  },
  verify: {
    type: 'boolean',
    description: 'Grant the exact verification argv embedded in an apply plan',
    default: false,
  },
  'verify-argv': {
    type: 'string',
    description: 'JSON string array for an exact post-manager verification command in a plan',
  },
  'phase-timeout': {
    type: 'string',
    description: 'Timeout in milliseconds for the planned verification phase',
    default: '120000',
  },
  update: {
    type: 'boolean',
    alias: 'u',
    description: 'Deprecated legacy option; rejected in favor of plan/apply phases',
    default: false,
  },
  'strict-post-write': {
    type: 'boolean',
    description: 'Deprecated legacy option; rejected in favor of plan/apply phase results',
    default: false,
  },
  execute: {
    type: 'string',
    alias: 'e',
    description: 'Deprecated shell-string option; rejected in favor of --verify-argv',
  },
  'verify-command': {
    type: 'string',
    alias: 'V',
    description: 'Deprecated shell-string option; rejected in favor of --verify-argv',
  },
  'fail-on-outdated': {
    type: 'boolean',
    description: 'Exit with code 1 when outdated dependencies are found (CI mode)',
    default: false,
  },
  'fail-on-resolution-errors': {
    type: 'boolean',
    description: 'Exit with code 2 when any dependency fails to resolve from the registry',
    default: false,
  },
  'fail-on-no-packages': {
    type: 'boolean',
    description: 'Exit with code 2 when no packages are discovered in the target workspace',
    default: false,
  },
  'ignore-other-workspaces': {
    type: 'boolean',
    description: 'Skip packages that belong to nested/separate workspaces',
    default: true,
  },
  ...migrationParityArgs,
}
