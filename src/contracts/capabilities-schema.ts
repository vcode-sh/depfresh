import Ajv from 'ajv'
import type { JSONSchema } from 'json-schema-to-ts'
import { NPM_ARTIFACT_VERIFIER_SUPPORT } from './artifact-verifier'

export const CAPABILITIES_SCHEMA_ID = 'https://depfresh.dev/schemas/capabilities-v1.json'
export const CAPABILITIES_V2_SCHEMA_ID = 'https://depfresh.dev/schemas/capabilities-v2.json'

const stringArray = { type: 'array', items: { type: 'string' } } as const
const stringMap = {
  type: 'object',
  additionalProperties: { type: 'string' },
} as const
const capabilityFlag = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    alias: { type: 'string', minLength: 1 },
    default: {},
    values: stringArray,
  },
} as const

export const capabilitiesSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: CAPABILITIES_SCHEMA_ID,
  title: 'depfresh capabilities contract v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'contract',
    'schemaVersion',
    'schema',
    'version',
    'command',
    'enums',
    'exitCodes',
    'machineExitCodes',
    'commands',
    'contractSchemas',
    'positional',
    'flags',
    'workflows',
    'flagRelationships',
    'invocationAuthority',
    'configIgnoredOptions',
    'errorReasons',
    'configFiles',
    'jsonOutputSchema',
    'discoverability',
    'registries',
    'runners',
    'assets',
  ],
  properties: {
    contract: { const: 'depfresh.capabilities' },
    schemaVersion: { const: 1 },
    schema: { const: 'depfresh/schemas/capabilities-v1.json' },
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+].+)?$' },
    command: { const: 'depfresh' },
    enums: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'output', 'sort', 'loglevel'],
      properties: {
        mode: stringArray,
        output: stringArray,
        sort: stringArray,
        loglevel: stringArray,
      },
    },
    exitCodes: stringMap,
    machineExitCodes: stringMap,
    commands: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['description'],
        properties: {
          description: { type: 'string', minLength: 1 },
          schema: { type: 'string', minLength: 1 },
          surface: { enum: ['cli', 'library'] },
        },
      },
    },
    contractSchemas: stringMap,
    positional: { type: 'object', additionalProperties: capabilityFlag },
    flags: { type: 'object', additionalProperties: capabilityFlag },
    workflows: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'command'],
        properties: {
          description: { type: 'string', minLength: 1 },
          command: { type: 'string', minLength: 1 },
        },
      },
    },
    flagRelationships: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: { requires: stringArray, conflicts: stringArray },
      },
    },
    invocationAuthority: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['grants'],
        properties: { requires: stringArray, grants: stringArray },
      },
    },
    configIgnoredOptions: stringArray,
    errorReasons: stringArray,
    configFiles: stringArray,
    jsonOutputSchema: stringMap,
    discoverability: {
      type: 'object',
      additionalProperties: false,
      required: ['helpJsonFlag', 'capabilitiesCommand'],
      properties: {
        helpJsonFlag: { type: 'string', minLength: 1 },
        capabilitiesCommand: { type: 'string', minLength: 1 },
      },
    },
    registries: {
      type: 'object',
      additionalProperties: false,
      required: [
        'policySelectors',
        'signalSelectors',
        'signalStates',
        'signalFamilies',
        'signalReasons',
        'signalEffects',
        'applyPhases',
        'managers',
        'artifactVerification',
      ],
      properties: {
        policySelectors: stringArray,
        signalSelectors: stringArray,
        signalStates: stringArray,
        signalFamilies: stringArray,
        signalReasons: stringArray,
        signalEffects: stringArray,
        applyPhases: stringArray,
        managers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'versionRange', 'lockfiles'],
            properties: {
              name: { enum: ['npm', 'pnpm', 'bun'] },
              versionRange: { type: 'string', minLength: 1 },
              lockfiles: stringArray,
            },
          },
        },
        artifactVerification: {
          type: 'object',
          additionalProperties: false,
          required: ['manager', 'versionRange', 'registry', 'integrity'],
          properties: {
            manager: { const: NPM_ARTIFACT_VERIFIER_SUPPORT.manager },
            versionRange: { const: NPM_ARTIFACT_VERIFIER_SUPPORT.versionRange },
            registry: { const: NPM_ARTIFACT_VERIFIER_SUPPORT.registry },
            integrity: { const: NPM_ARTIFACT_VERIFIER_SUPPORT.integrity },
          },
        },
      },
    },
    runners: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['priority', 'name', 'command', 'requirement'],
        properties: {
          priority: { type: 'integer', minimum: 1 },
          name: { type: 'string', minLength: 1 },
          command: { type: 'string', minLength: 1 },
          requirement: { type: 'string', minLength: 1 },
        },
      },
    },
    assets: stringArray,
  },
} as const satisfies JSONSchema

const capabilityFlagV2 = {
  ...capabilityFlag,
  properties: {
    ...capabilityFlag.properties,
    repeatable: { type: 'boolean' },
    matching: { enum: ['exact-literal'] },
    commandScope: { type: 'array', items: { enum: ['check', 'plan'] } },
  },
} as const

export const capabilitiesV2Schema = {
  ...capabilitiesSchema,
  $id: CAPABILITIES_V2_SCHEMA_ID,
  title: 'depfresh capabilities contract v2',
  required: [...capabilitiesSchema.required, 'contractVersions'],
  properties: {
    ...capabilitiesSchema.properties,
    schemaVersion: { const: 2 },
    schema: { const: 'depfresh/schemas/capabilities-v2.json' },
    positional: { type: 'object', additionalProperties: capabilityFlagV2 },
    flags: { type: 'object', additionalProperties: capabilityFlagV2 },
    contractVersions: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilities', 'plan', 'inspect', 'apply', 'error'],
      properties: {
        capabilities: {
          type: 'object',
          additionalProperties: false,
          required: ['current', 'supported'],
          properties: {
            current: { const: 'depfresh/schemas/capabilities-v2.json' },
            supported: {
              type: 'array',
              items: {
                enum: [
                  'depfresh/schemas/capabilities-v1.json',
                  'depfresh/schemas/capabilities-v2.json',
                ],
              },
            },
          },
        },
        plan: {
          type: 'object',
          additionalProperties: false,
          required: ['current', 'supported', 'applyCompatible'],
          properties: {
            current: { const: 'depfresh/schemas/plan-v2.json' },
            supported: {
              type: 'array',
              items: { enum: ['depfresh/schemas/plan-v1.json', 'depfresh/schemas/plan-v2.json'] },
            },
            applyCompatible: {
              type: 'array',
              items: { enum: ['depfresh/schemas/plan-v1.json', 'depfresh/schemas/plan-v2.json'] },
            },
          },
        },
        inspect: {
          type: 'object',
          additionalProperties: false,
          required: ['current', 'supported'],
          properties: {
            current: { const: 'depfresh/schemas/inspect-v1.json' },
            supported: { type: 'array', items: { const: 'depfresh/schemas/inspect-v1.json' } },
          },
        },
        apply: {
          type: 'object',
          additionalProperties: false,
          required: ['current', 'supported'],
          properties: {
            current: { const: 'depfresh/schemas/apply-v1.json' },
            supported: { type: 'array', items: { const: 'depfresh/schemas/apply-v1.json' } },
          },
        },
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['current', 'supported'],
          properties: {
            current: { const: 'depfresh/schemas/error-v1.json' },
            supported: { type: 'array', items: { const: 'depfresh/schemas/error-v1.json' } },
          },
        },
      },
    },
  },
} as const satisfies JSONSchema

const validateCapabilitiesShape = new Ajv({ allErrors: true, strict: true }).compile(
  capabilitiesSchema,
)
const validateCapabilitiesV2Shape = new Ajv({ allErrors: true, strict: true }).compile(
  capabilitiesV2Schema,
)

export function validateCapabilities(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const schemaVersion = (value as Record<string, unknown>).schemaVersion
  return schemaVersion === 1
    ? validateCapabilitiesShape(value)
    : schemaVersion === 2
      ? validateCapabilitiesV2Shape(value) && hasValidCapabilitiesV2Semantics(value)
      : false
}

export function validateCapabilitiesV1(value: unknown): boolean {
  return validateCapabilitiesShape(value)
}

export function validateCapabilitiesV2(value: unknown): boolean {
  return validateCapabilitiesV2Shape(value) && hasValidCapabilitiesV2Semantics(value)
}

function hasValidCapabilitiesV2Semantics(value: unknown): boolean {
  const capabilities = value as {
    flags: Record<string, unknown>
    contractSchemas: Record<string, string>
    contractVersions: Record<string, unknown>
    assets: string[]
  }
  for (const name of ['exclude-workspace', 'exclude-catalog']) {
    const flag = capabilities.flags[name] as Record<string, unknown> | undefined
    if (
      flag?.type !== 'string' ||
      typeof flag.description !== 'string' ||
      flag.repeatable !== true ||
      flag.matching !== 'exact-literal' ||
      JSON.stringify(flag.commandScope) !== JSON.stringify(['check', 'plan'])
    ) {
      return false
    }
  }
  const expectedVersions = {
    capabilities: {
      current: 'depfresh/schemas/capabilities-v2.json',
      supported: ['depfresh/schemas/capabilities-v1.json', 'depfresh/schemas/capabilities-v2.json'],
    },
    plan: {
      current: 'depfresh/schemas/plan-v2.json',
      supported: ['depfresh/schemas/plan-v1.json', 'depfresh/schemas/plan-v2.json'],
      applyCompatible: ['depfresh/schemas/plan-v1.json', 'depfresh/schemas/plan-v2.json'],
    },
    inspect: {
      current: 'depfresh/schemas/inspect-v1.json',
      supported: ['depfresh/schemas/inspect-v1.json'],
    },
    apply: {
      current: 'depfresh/schemas/apply-v1.json',
      supported: ['depfresh/schemas/apply-v1.json'],
    },
    error: {
      current: 'depfresh/schemas/error-v1.json',
      supported: ['depfresh/schemas/error-v1.json'],
    },
  }
  if (JSON.stringify(capabilities.contractVersions) !== JSON.stringify(expectedVersions)) {
    return false
  }
  return (
    capabilities.contractSchemas.capabilities === expectedVersions.capabilities.current &&
    capabilities.contractSchemas.plan === expectedVersions.plan.current &&
    capabilities.assets.includes(expectedVersions.capabilities.current) &&
    capabilities.assets.includes(expectedVersions.plan.current)
  )
}
