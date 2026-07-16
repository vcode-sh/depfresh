import type { ArgsDef } from 'citty'
import { version } from '../../package.json' with { type: 'json' }
import { MANAGER_PHASE_SUPPORT } from '../commands/apply/manager-registry'
import { CONFIG_FILES, INVOCATION_ONLY_OPTIONS } from '../config'
import { NPM_ARTIFACT_VERIFIER_SUPPORT } from '../contracts/artifact-verifier'
import { APPLY_PHASE_NAMES } from '../contracts/schemas'
import { DEPFRESH_ERROR_REASONS } from '../errors'
import { POLICY_SELECTOR_KEYS } from '../policy/schema'
import { SIGNAL_SELECTOR_KEYS } from '../signals/config'
import { SIGNAL_FAMILIES, SIGNAL_POLICY_EFFECTS, SIGNAL_REASONS, SIGNAL_STATES } from '../types'
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

interface InvocationGrant {
  requires?: string[]
  grants: string[]
}

export interface CliCapabilities {
  contract: 'depfresh.capabilities'
  schemaVersion: number
  schema: 'depfresh/schemas/capabilities-v1.json'
  version: string
  command: string
  enums: {
    mode: readonly string[]
    output: readonly string[]
    sort: readonly string[]
    loglevel: readonly string[]
  }
  exitCodes: Record<string, string>
  machineExitCodes: Record<string, string>
  commands: Record<string, { description: string; schema?: string; surface?: 'cli' | 'library' }>
  contractSchemas: Record<string, string>
  positional: Record<string, CapabilityFlag>
  flags: Record<string, CapabilityFlag>
  workflows: Record<string, Workflow>
  flagRelationships: Record<string, FlagRelationship>
  invocationAuthority: Record<string, InvocationGrant>
  configIgnoredOptions: string[]
  errorReasons: readonly string[]
  configFiles: string[]
  jsonOutputSchema: Record<string, string>
  discoverability: {
    helpJsonFlag: string
    capabilitiesCommand: string
  }
  registries: {
    policySelectors: readonly string[]
    signalSelectors: readonly string[]
    signalStates: readonly string[]
    signalFamilies: readonly string[]
    signalReasons: readonly string[]
    signalEffects: readonly string[]
    applyPhases: readonly string[]
    managers: Array<{
      name: string
      versionRange: string
      lockfiles: readonly string[]
    }>
    artifactVerification: typeof NPM_ARTIFACT_VERIFIER_SUPPORT
  }
  runners: Array<{
    priority: number
    name: string
    command: string
    requirement: string
  }>
  assets: string[]
}

const ENUM_VALUES_BY_FLAG: Record<string, readonly string[]> = {
  mode: VALID_MODES,
  output: VALID_OUTPUTS,
  sort: VALID_SORT_OPTIONS,
  loglevel: VALID_LOG_LEVELS,
}

const EXIT_CODES: Record<string, string> = {
  '0': 'Legacy check completed without an enforced failure; outdated dependencies may still be reported when --fail-on-outdated is false, or requested writes may have completed.',
  '1': 'Outdated dependencies found with --fail-on-outdated and without --write.',
  '2': 'Fatal, configuration, runtime, incomplete-write, or strict discovery/resolution failure (including invalid enum flags, --fail-on-resolution-errors, and --fail-on-no-packages).',
}

const WORKFLOWS: Record<string, Workflow> = {
  inspect: {
    description: 'Inspect deterministic repository evidence without registry access',
    command: 'depfresh inspect --output json',
  },
  plan: {
    description: 'Resolve a deterministic non-mutating dependency plan',
    command: 'depfresh plan --output json',
  },
  apply: {
    description: 'Apply one reviewed immutable plan with explicit file-write authority',
    command: 'depfresh apply --output json --write --plan-file depfresh-plan.json',
  },
  syncLockfile: {
    description: 'Apply a reviewed sync-lockfile plan with only its required authority',
    command: 'depfresh apply --output json --write --sync-lockfile --plan-file depfresh-plan.json',
  },
  installAndVerifyArtifacts: {
    description: 'Apply a reviewed install and exact artifact-verification plan',
    command:
      'depfresh apply --output json --write --install --verify-artifacts --plan-file depfresh-plan.json',
  },
  globalInspect: {
    description: 'Inspect supported global managers without write authority',
    command: 'depfresh --global-all --output json',
  },
  globalApplyObserved: {
    description:
      'Apply observed per-manager global updates with explicit global-write and process authority',
    command: 'depfresh --global-all --write --output json',
  },
  readOnlyGate: {
    description: 'Run a non-mutating legacy freshness gate with structured JSON',
    command:
      'depfresh --output json --fail-on-outdated --fail-on-resolution-errors --fail-on-no-packages',
  },
}

const FLAG_RELATIONSHIPS: Record<string, FlagRelationship> = {
  install: { conflicts: ['sync-lockfile'] },
  'sync-lockfile': { conflicts: ['install'] },
  verify: { requires: ['write', 'plan-file'] },
  'verify-artifacts': { requires: ['install'] },
  interactive: { requires: ['write'] },
  'deps-only': { conflicts: ['dev-only'] },
  'dev-only': { conflicts: ['deps-only'] },
}

const INVOCATION_AUTHORITY: Record<string, InvocationGrant> = {
  write: { grants: ['write'] },
  'sync-lockfile': {
    requires: ['write', 'plan-file'],
    grants: ['processExecute', 'lockfileWrite'],
  },
  install: {
    requires: ['write', 'plan-file'],
    grants: ['processExecute', 'lockfileWrite', 'install'],
  },
  verify: { requires: ['write', 'plan-file'], grants: ['verifyCommand'] },
  'verify-artifacts': {
    requires: ['write', 'plan-file', 'install'],
    grants: ['artifactVerify', 'networkAccess'],
  },
  global: { requires: ['write'], grants: ['globalWrite', 'processExecute'] },
  'global-all': { requires: ['write'], grants: ['globalWrite', 'processExecute'] },
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
  'summary.failedResolutions': 'Count of dependencies that failed to resolve',
  'meta.schemaVersion': 'JSON schema version (currently 1)',
  'meta.cwd': 'Working directory used',
  'meta.effectiveRoot': 'Derived project root used for discovery and root-aware operations',
  'meta.mode': 'Version range mode used',
  'meta.timestamp': 'ISO 8601 timestamp',
  'meta.hadResolutionErrors': 'Whether any dependency failed to resolve',
  'meta.didWrite': 'Whether package files were written',
  discovery: 'Optional discovery diagnostics block emitted when --explain-discovery is enabled',
  'discovery.inputCwd': 'Original cwd requested by the user',
  'discovery.effectiveRoot': 'Resolved root used for discovery',
  'discovery.discoveryMode': 'How the effective root was determined',
  profile: 'Optional runtime performance diagnostics block emitted when --profile is enabled',
  'profile.discoveryMs': 'Time spent discovering packages and catalogs',
  'profile.resolutionMs': 'Time spent resolving dependencies',
  'profile.postWriteMs': 'Time spent in execute/install/update post-write steps',
  'profile.totalMs': 'Total wall-clock time for the run',
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
    positional.mode_arg.values = [...VALID_MODES, 'inspect', 'plan', 'apply', 'capabilities']
  }

  return { positional, flags }
}

export function getCliCapabilities(): CliCapabilities {
  const { positional, flags } = buildFlagDefinitions(args)

  return {
    contract: 'depfresh.capabilities',
    schemaVersion: 1,
    schema: 'depfresh/schemas/capabilities-v1.json',
    version,
    command: 'depfresh',
    enums: {
      mode: VALID_MODES,
      output: VALID_OUTPUTS,
      sort: VALID_SORT_OPTIONS,
      loglevel: VALID_LOG_LEVELS,
    },
    exitCodes: EXIT_CODES,
    machineExitCodes: {
      '0': 'Capabilities completed, inspect or plan had no actionable/incomplete findings, or apply completed as applied or noop.',
      '1': 'Schema-valid inspect or plan findings, or a schema-valid conflicted, reverted, failed, or unknown apply result.',
      '2': 'Fatal input, contract, configuration, or runtime error prevented a trustworthy result.',
    },
    commands: {
      check: {
        description: 'Legacy human/table or JSON dependency check and compatibility write flow.',
        surface: 'cli',
      },
      capabilities: {
        description:
          'Deterministic installed command, schema, feature, runner, and asset descriptor.',
        schema: 'depfresh/schemas/capabilities-v1.json',
        surface: 'cli',
      },
      inspect: {
        description: 'Process-free repository model and evidence inspection.',
        schema: 'depfresh/schemas/inspect-v1.json',
        surface: 'cli',
      },
      plan: {
        description: 'Registry-aware planning without file or process side effects.',
        schema: 'depfresh/schemas/plan-v1.json',
        surface: 'cli',
      },
      apply: {
        description:
          'Stale-safe file and explicitly granted manager phases from one immutable plan.',
        schema: 'depfresh/schemas/apply-v1.json',
        surface: 'cli',
      },
      globalPlan: {
        description: 'Observed global update plan API; no standalone machine CLI command.',
        schema: 'depfresh/schemas/global-plan-v1.json',
        surface: 'library',
      },
      globalApply: {
        description: 'Observed global apply API; legacy global CLI delegates to this contract.',
        schema: 'depfresh/schemas/global-apply-v1.json',
        surface: 'library',
      },
    },
    contractSchemas: {
      capabilities: 'depfresh/schemas/capabilities-v1.json',
      inspect: 'depfresh/schemas/inspect-v1.json',
      plan: 'depfresh/schemas/plan-v1.json',
      apply: 'depfresh/schemas/apply-v1.json',
      error: 'depfresh/schemas/error-v1.json',
      globalPlan: 'depfresh/schemas/global-plan-v1.json',
      globalApply: 'depfresh/schemas/global-apply-v1.json',
    },
    positional,
    flags,
    workflows: WORKFLOWS,
    flagRelationships: FLAG_RELATIONSHIPS,
    invocationAuthority: INVOCATION_AUTHORITY,
    configIgnoredOptions: [...INVOCATION_ONLY_OPTIONS],
    errorReasons: DEPFRESH_ERROR_REASONS,
    configFiles: [...CONFIG_FILES],
    jsonOutputSchema: JSON_OUTPUT_SCHEMA,
    discoverability: {
      helpJsonFlag: 'depfresh --help-json',
      capabilitiesCommand: 'depfresh capabilities --json',
    },
    registries: {
      policySelectors: POLICY_SELECTOR_KEYS,
      signalSelectors: SIGNAL_SELECTOR_KEYS,
      signalStates: SIGNAL_STATES,
      signalFamilies: SIGNAL_FAMILIES,
      signalReasons: SIGNAL_REASONS,
      signalEffects: SIGNAL_POLICY_EFFECTS,
      applyPhases: APPLY_PHASE_NAMES,
      managers: MANAGER_PHASE_SUPPORT.map((entry) => ({
        name: entry.name,
        versionRange: entry.versionRange,
        lockfiles: entry.lockfiles,
      })),
      artifactVerification: NPM_ARTIFACT_VERIFIER_SUPPORT,
    },
    runners: [
      {
        priority: 1,
        name: 'repository-local',
        command: 'pnpm exec depfresh',
        requirement: 'The repository lockfile pins depfresh.',
      },
      {
        priority: 2,
        name: 'exact-package',
        command: `npm exec --yes --package=depfresh@${version} -- depfresh`,
        requirement: 'The exact package version is approved.',
      },
    ],
    assets: [
      'depfresh/schemas/capabilities-v1.json',
      'depfresh/skills/depfresh/SKILL.md',
      'depfresh/skills/depfresh/recipes/runners.md',
      'depfresh/skills/depfresh/recipes/manager-phases.md',
      'depfresh/skills/depfresh/recipes/ci.md',
      'depfresh/skills/depfresh/examples/README.md',
      'depfresh/skills/depfresh/examples/catalog-policy.json',
      'depfresh/skills/depfresh/examples/read-only-gate.yml',
      'depfresh/skills/depfresh/examples/protected-apply.yml',
    ],
  }
}

export function outputCliCapabilities(): void {
  // biome-ignore lint/suspicious/noConsole: intentional machine-readable output
  console.log(JSON.stringify(getCliCapabilities(), null, 2))
}
