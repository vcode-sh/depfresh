import Ajv from 'ajv'
import type { JSONSchema } from 'json-schema-to-ts'
import { NPM_ARTIFACT_VERIFIER_SUPPORT } from './artifact-verifier'

export const CAPABILITIES_SCHEMA_ID = 'https://depfresh.dev/schemas/capabilities-v1.json'

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

const validateCapabilitiesShape = new Ajv({ allErrors: true, strict: true }).compile(
  capabilitiesSchema,
)

export function validateCapabilities(value: unknown): boolean {
  return validateCapabilitiesShape(value)
}
