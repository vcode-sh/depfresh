import type { ArgsDef } from 'citty'
import { VALID_LOG_LEVELS, VALID_MODES, VALID_OUTPUTS, VALID_SORT_OPTIONS } from './arg-values'
import { args } from './args-schema'

interface CapabilityFlag {
  type: string
  description?: string
  alias?: string
  default?: unknown
  values?: readonly string[]
}

interface CliCapabilities {
  schemaVersion: number
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
