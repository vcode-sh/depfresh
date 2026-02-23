import type { ArgsDef } from 'citty'
import { version } from '../../package.json' with { type: 'json' }
import { CONFIG_FILES } from '../config'
import { VALID_LOG_LEVELS, VALID_MODES, VALID_OUTPUTS, VALID_SORT_OPTIONS } from './arg-values'
import { args } from './args-schema'

interface CapabilityFlag {
  type: string
  description?: string
  alias?: string
  default?: unknown
  values?: readonly string[]
}

interface Workflow {
  description: string
  command: string
}

interface FlagRelationship {
  requires?: string[]
  conflicts?: string[]
}

interface CliCapabilities {
  schemaVersion: number
  version: string
  command: string
  generatedAt: string
  enums: {
    mode: readonly string[]
    output: readonly string[]
    sort: readonly string[]
    loglevel: readonly string[]
  }
  exitCodes: Record<string, string>
  positional: Record<string, CapabilityFlag>
  flags: Record<string, CapabilityFlag>
  workflows: Record<string, Workflow>
  flagRelationships: Record<string, FlagRelationship>
  configFiles: string[]
  jsonOutputSchema: Record<string, string>
  discoverability: {
    helpJsonFlag: string
    capabilitiesCommand: string
  }
}

const ENUM_VALUES_BY_FLAG: Record<string, readonly string[]> = {
  mode: VALID_MODES,
  output: VALID_OUTPUTS,
  sort: VALID_SORT_OPTIONS,
  loglevel: VALID_LOG_LEVELS,
}

const EXIT_CODES: Record<string, string> = {
  '0': 'Success (no updates found, or updates written successfully).',
  '1': 'Outdated dependencies found with --fail-on-outdated and without --write.',
  '2': 'Fatal/runtime/configuration error (including invalid enum flag values).',
}

const WORKFLOWS: Record<string, Workflow> = {
  checkOnly: {
    description: 'Check for outdated dependencies and return structured JSON',
    command: 'depfresh --output json',
  },
  safeUpdate: {
    description: 'Apply only minor and patch updates',
    command: 'depfresh --write --mode minor --output json',
  },
  fullUpdate: {
    description: 'Update everything to the latest version',
    command: 'depfresh --write --mode latest --output json',
  },
  selective: {
    description: 'Update specific packages by name',
    command: 'depfresh --write --include "pkg1,pkg2" --output json',
  },
}

const FLAG_RELATIONSHIPS: Record<string, FlagRelationship> = {
  install: { requires: ['write'] },
  update: { requires: ['write'] },
  execute: { requires: ['write'] },
  'verify-command': { requires: ['write'] },
  interactive: { requires: ['write'] },
  'deps-only': { conflicts: ['dev-only'] },
  'dev-only': { conflicts: ['deps-only'] },
}

const JSON_OUTPUT_SCHEMA: Record<string, string> = {
  'packages[]': 'Array of scanned packages with their updates',
  'packages[].name': 'Package name from package manifest',
  'packages[].updates[]': 'Array of dependencies with available updates',
  'packages[].updates[].name': 'Dependency name',
  'packages[].updates[].current': 'Current version range',
  'packages[].updates[].target': 'Target version range',
  'packages[].updates[].diff': 'Semver diff type: major | minor | patch',
  'packages[].updates[].source': 'Dependency field (dependencies, devDependencies, etc.)',
  'errors[]': 'Array of dependencies that failed to resolve',
  'errors[].name': 'Dependency name',
  'errors[].source': 'Dependency field',
  'errors[].currentVersion': 'Current version range',
  'errors[].message': 'Error description',
  'summary.total': 'Total number of available updates',
  'summary.major': 'Count of major updates',
  'summary.minor': 'Count of minor updates',
  'summary.patch': 'Count of patch updates',
  'meta.schemaVersion': 'JSON schema version (currently 1)',
  'meta.cwd': 'Working directory used',
  'meta.mode': 'Version range mode used',
  'meta.timestamp': 'ISO 8601 timestamp',
  'meta.didWrite': 'Whether package files were written',
}

function buildFlagDefinitions(argsDef: ArgsDef): {
  positional: Record<string, CapabilityFlag>
  flags: Record<string, CapabilityFlag>
} {
  const positional: Record<string, CapabilityFlag> = {}
  const flags: Record<string, CapabilityFlag> = {}

  for (const [name, rawDef] of Object.entries(argsDef)) {
    const def = rawDef as {
      type?: string
      description?: string
      alias?: string
      default?: unknown
    }
    if (!def.type) continue

    const capability: CapabilityFlag = {
      type: def.type,
      ...(def.description ? { description: def.description } : {}),
      ...(def.alias ? { alias: def.alias } : {}),
      ...(def.default !== undefined ? { default: def.default } : {}),
      ...(ENUM_VALUES_BY_FLAG[name] ? { values: ENUM_VALUES_BY_FLAG[name] } : {}),
    }

    if (def.type === 'positional') {
      positional[name] = capability
    } else {
      flags[name] = capability
    }
  }

  if (positional.mode_arg) {
    positional.mode_arg.values = VALID_MODES
  }

  return { positional, flags }
}

export function getCliCapabilities(): CliCapabilities {
  const { positional, flags } = buildFlagDefinitions(args)

  return {
    schemaVersion: 1,
    version,
    command: 'depfresh',
    generatedAt: new Date().toISOString(),
    enums: {
      mode: VALID_MODES,
      output: VALID_OUTPUTS,
      sort: VALID_SORT_OPTIONS,
      loglevel: VALID_LOG_LEVELS,
    },
    exitCodes: EXIT_CODES,
    positional,
    flags,
    workflows: WORKFLOWS,
    flagRelationships: FLAG_RELATIONSHIPS,
    configFiles: [...CONFIG_FILES],
    jsonOutputSchema: JSON_OUTPUT_SCHEMA,
    discoverability: {
      helpJsonFlag: 'depfresh --help-json',
      capabilitiesCommand: 'depfresh capabilities --json',
    },
  }
}

export function outputCliCapabilities(): void {
  // biome-ignore lint/suspicious/noConsole: intentional machine-readable output
  console.log(JSON.stringify(getCliCapabilities(), null, 2))
}
