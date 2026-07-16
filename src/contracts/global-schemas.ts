import type { FromSchema, JSONSchema } from 'json-schema-to-ts'

const hashSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const
const managerSchema = { enum: ['npm', 'pnpm', 'bun'] } as const
const globalPackageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'version'],
  properties: {
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
  },
} as const
const managerEvidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['manager', 'executable', 'status', 'reason', 'packages'],
  properties: {
    manager: managerSchema,
    executable: { type: 'string', minLength: 1 },
    status: {
      enum: ['confirmed', 'unavailable', 'malformed', 'timeout', 'unknown', 'unsupported'],
    },
    reason: { type: 'string', minLength: 1 },
    executableFingerprint: hashSchema,
    realmFingerprint: hashSchema,
    managerVersion: { type: 'string', minLength: 1 },
    packages: { type: 'array', items: globalPackageSchema },
  },
} as const
const globalOperationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'occurrenceId',
    'manager',
    'executable',
    'name',
    'expectedVersion',
    'targetVersion',
    'args',
    'timeoutMs',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    occurrenceId: { type: 'string', minLength: 1 },
    manager: managerSchema,
    executable: { type: 'string', minLength: 1 },
    executableFingerprint: hashSchema,
    realmFingerprint: hashSchema,
    managerVersion: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    expectedVersion: { type: 'string', minLength: 1 },
    targetVersion: { type: 'string', minLength: 1 },
    args: { type: 'array', minItems: 1, items: { type: 'string' } },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 600000 },
  },
} as const

export const GLOBAL_PLAN_SCHEMA_ID = 'https://depfresh.dev/schemas/global-plan-v1.schema.json'
export const GLOBAL_APPLY_SCHEMA_ID = 'https://depfresh.dev/schemas/global-apply-v1.schema.json'

export const globalPlanSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: GLOBAL_PLAN_SCHEMA_ID,
  title: 'depfresh global plan contract v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'contract',
    'schemaVersion',
    'toolVersion',
    'managers',
    'operations',
    'requiredCapabilities',
    'planFingerprint',
  ],
  properties: {
    contract: { const: 'depfresh.global-plan' },
    schemaVersion: { const: 1 },
    toolVersion: { type: 'string', minLength: 1 },
    managers: { type: 'array', items: managerEvidenceSchema },
    operations: { type: 'array', items: globalOperationSchema },
    requiredCapabilities: {
      const: ['global-inventory-read', 'global-write', 'process-execute'],
    },
    planFingerprint: hashSchema,
  },
} as const satisfies JSONSchema

const globalItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'operationId',
    'occurrenceId',
    'manager',
    'name',
    'expectedVersion',
    'targetVersion',
    'status',
    'reason',
  ],
  properties: {
    operationId: { type: 'string', minLength: 1 },
    occurrenceId: { type: 'string', minLength: 1 },
    manager: managerSchema,
    name: { type: 'string', minLength: 1 },
    expectedVersion: { type: 'string', minLength: 1 },
    targetVersion: { type: 'string', minLength: 1 },
    observedVersion: { type: 'string', minLength: 1 },
    status: { enum: ['applied', 'skipped', 'conflicted', 'failed', 'unknown'] },
    reason: {
      enum: [
        'APPLIED',
        'NO_CHANGE',
        'DOWNGRADE_BLOCKED',
        'EXPECTED_VALUE_MISMATCH',
        'PACKAGE_MISSING',
        'INVALID_PACKAGE',
        'INVALID_VERSION',
        'MANAGER_UNAVAILABLE',
        'MANAGER_UNSUPPORTED',
        'INVENTORY_MALFORMED',
        'INVENTORY_TIMEOUT',
        'INVENTORY_UNKNOWN',
        'EXECUTABLE_CHANGED',
        'COMMAND_FAILED',
        'COMMAND_TIMEOUT',
        'COMMAND_UNOBSERVABLE',
        'POST_STATE_MISMATCH',
      ],
    },
  },
} as const
const globalCommandSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operationId', 'manager', 'executable', 'args', 'termination', 'terminationConfirmed'],
  properties: {
    operationId: { type: 'string', minLength: 1 },
    manager: managerSchema,
    executable: { type: 'string', minLength: 1 },
    args: { type: 'array', minItems: 1, items: { type: 'string' } },
    termination: { enum: ['exit', 'signal', 'timeout', 'unavailable', 'unknown'] },
    terminationConfirmed: { type: 'boolean' },
    exitCode: { type: 'integer' },
    signal: { type: 'string', minLength: 1 },
  },
} as const
const globalSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['planned', 'applied', 'skipped', 'conflicted', 'failed', 'unknown'],
  properties: {
    planned: { type: 'integer', minimum: 0 },
    applied: { type: 'integer', minimum: 0 },
    skipped: { type: 'integer', minimum: 0 },
    conflicted: { type: 'integer', minimum: 0 },
    failed: { type: 'integer', minimum: 0 },
    unknown: { type: 'integer', minimum: 0 },
  },
} as const

export const globalApplySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: GLOBAL_APPLY_SCHEMA_ID,
  title: 'depfresh global apply contract v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'contract',
    'schemaVersion',
    'toolVersion',
    'planFingerprint',
    'status',
    'items',
    'commands',
    'summary',
    'requiredCapabilities',
    'rollback',
  ],
  properties: {
    contract: { const: 'depfresh.global-apply' },
    schemaVersion: { const: 1 },
    toolVersion: { type: 'string', minLength: 1 },
    planFingerprint: hashSchema,
    status: { enum: ['applied', 'noop', 'partial', 'conflicted', 'failed', 'unknown'] },
    items: { type: 'array', items: globalItemSchema },
    commands: { type: 'array', items: globalCommandSchema },
    summary: globalSummarySchema,
    requiredCapabilities: { const: ['global-write', 'process-execute'] },
    rollback: { const: 'not-supported' },
  },
} as const satisfies JSONSchema

export type GlobalApplyPlan = FromSchema<typeof globalPlanSchema>
export type GlobalApplyResult = FromSchema<typeof globalApplySchema>
export type GlobalManagerEvidence = GlobalApplyPlan['managers'][number]
export type GlobalPlanOperation = GlobalApplyPlan['operations'][number]
export type GlobalItemResult = GlobalApplyResult['items'][number]
export type GlobalCommandResult = GlobalApplyResult['commands'][number]
export type GlobalApplySummary = GlobalApplyResult['summary']
export type GlobalApplyStatus = GlobalApplyResult['status']
export type GlobalItemStatus = GlobalItemResult['status']
export type GlobalItemReason = GlobalItemResult['reason']
