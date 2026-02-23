import type { ArgsDef } from 'citty'
import { migrationParityArgs } from './migration-flags'

export const args: ArgsDef = {
  mode_arg: {
    type: 'positional',
    description: 'Version range mode shorthand (major, minor, patch, latest, newest, next)',
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
    description: 'Check global packages for one detected package manager',
    default: false,
  },
  'global-all': {
    type: 'boolean',
    description: 'Check global packages across npm, pnpm, and bun with deduped names',
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
  install: {
    type: 'boolean',
    alias: 'i',
    description: 'Run package manager install after writing',
    default: false,
  },
  update: {
    type: 'boolean',
    alias: 'u',
    description: 'Run package manager update instead of install after writing',
    default: false,
  },
  execute: {
    type: 'string',
    alias: 'e',
    description: 'Run command after writing updates (e.g. "pnpm test")',
  },
  'verify-command': {
    type: 'string',
    alias: 'V',
    description: 'Run command after each dep update, revert on failure',
  },
  'fail-on-outdated': {
    type: 'boolean',
    description: 'Exit with code 1 when outdated dependencies are found (CI mode)',
    default: false,
  },
  'ignore-other-workspaces': {
    type: 'boolean',
    description: 'Skip packages that belong to nested/separate workspaces',
    default: true,
  },
  ...migrationParityArgs,
}
