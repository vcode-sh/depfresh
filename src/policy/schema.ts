import { ConfigError } from '../errors'
import type { PolicyAction, PolicyMode, PolicyRuleInput, PolicySelectors } from '../types/policy'
import { patternToRegex } from '../utils/patterns'

const RULE_KEYS = new Set(['id', 'selectors', 'action', 'mode'])
const SELECTOR_KEYS = new Set([
  'dependencyName',
  'workspacePath',
  'packageName',
  'catalogName',
  'catalogRole',
  'field',
  'role',
  'manager',
  'protocol',
  'currentChannel',
  'specifierStatus',
])
const PATTERN_SELECTOR_KEYS = new Set([
  'dependencyName',
  'workspacePath',
  'packageName',
  'catalogName',
])
const ACTIONS = new Set<PolicyAction>(['include', 'exclude'])
const MODES = new Set<PolicyMode>([
  'default',
  'major',
  'minor',
  'patch',
  'latest',
  'newest',
  'next',
])
const EXACT_ENUMS = new Map<string, ReadonlySet<string>>([
  ['catalogRole', new Set(['direct', 'owner', 'consumer'])],
  [
    'role',
    new Set([
      'dependency',
      'override',
      'package-manager',
      'catalog-owner',
      'catalog-consumer',
      'global',
    ]),
  ],
  ['manager', new Set(['npm', 'pnpm', 'yarn', 'bun'])],
  [
    'field',
    new Set([
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
      'overrides',
      'resolutions',
      'packageManager',
      'pnpm.overrides',
      'catalog',
    ]),
  ],
  [
    'protocol',
    new Set([
      'semver',
      'npm',
      'jsr',
      'github',
      'workspace',
      'catalog',
      'file',
      'link',
      'git',
      'http',
      'unknown',
    ]),
  ],
  ['specifierStatus', new Set(['locked', 'range', 'dynamic', 'invalid'])],
])

export function validatePolicyRules(value: readonly unknown[]): PolicyRuleInput[] {
  try {
    assertJsonCompatible(value, 'policyRules', new WeakSet())
    const rules = value.map((entry, index) => validateRule(entry, index))
    const ids = new Set<string>()
    for (const rule of rules) {
      if (ids.has(rule.id)) invalid('policyRules contains a duplicate id')
      ids.add(rule.id)
    }
    return rules
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError('Invalid policyRules structure', { cause: error })
  }
}

function validateRule(value: unknown, index: number): PolicyRuleInput {
  const path = `policyRules[${index}]`
  const record = asPlainRecord(value, path)
  rejectUnknownKeys(record, RULE_KEYS, path)
  const id = record.id
  if (typeof id !== 'string' || id.trim() === '' || id.startsWith('$')) {
    invalid(`${path}.id must be a non-empty public identifier`)
  }
  const selectors = validateSelectors(record.selectors, `${path}.selectors`)
  const action = record.action
  const mode = record.mode
  if (
    action !== undefined &&
    (typeof action !== 'string' || !ACTIONS.has(action as PolicyAction))
  ) {
    invalid(`${path}.action is invalid`)
  }
  if (mode !== undefined && (typeof mode !== 'string' || !MODES.has(mode as PolicyMode))) {
    invalid(`${path}.mode is invalid`)
  }
  if (action === undefined && mode === undefined) invalid(`${path} must define action or mode`)
  if (action === 'exclude' && mode !== undefined) {
    invalid(`${path} cannot combine action exclude with mode`)
  }
  return {
    id,
    selectors,
    ...(action === undefined ? {} : { action: action as PolicyAction }),
    ...(mode === undefined ? {} : { mode: mode as PolicyMode }),
  }
}

function validateSelectors(value: unknown, path: string): PolicySelectors {
  const record = asPlainRecord(value, path)
  rejectUnknownKeys(record, SELECTOR_KEYS, path)
  const selectors: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string' || entry.length === 0) invalid(`${path}.${key} is invalid`)
    const allowed = EXACT_ENUMS.get(key)
    if (allowed && !allowed.has(entry)) invalid(`${path}.${key} is invalid`)
    if (PATTERN_SELECTOR_KEYS.has(key)) {
      try {
        patternToRegex(entry)
      } catch (error) {
        throw new ConfigError(`Invalid policy pattern at ${path}.${key}`, { cause: error })
      }
    }
    selectors[key] = entry
  }
  return selectors as PolicySelectors
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid(`${path} contains a non-string key`)
    if (!allowed.has(key)) invalid(`${path}.${key} is not supported`)
  }
}

function asPlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${path} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${path} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function assertJsonCompatible(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(`${path} must contain finite JSON numbers`)
    return
  }
  if (typeof value !== 'object') invalid(`${path} must contain JSON-compatible values`)
  if (seen.has(value)) invalid(`${path} must not contain cycles`)
  seen.add(value)
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor) invalid(`${path} must not contain sparse arrays`)
      if (!(descriptor.enumerable && 'value' in descriptor)) {
        invalid(`${path}[${index}] must be an enumerable data property`)
      }
      assertJsonCompatible(descriptor.value, `${path}[${index}]`, seen)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue
      if (typeof key !== 'string' || !isArrayIndex(key, value.length)) {
        invalid(`${path} must not contain extra array properties`)
      }
    }
    seen.delete(value)
    return
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${path} must contain plain JSON objects`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid(`${path} must not contain symbol keys`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!(descriptor?.enumerable && 'value' in descriptor)) {
      invalid(`${path}.${key} must be an enumerable data property`)
    }
    assertJsonCompatible(descriptor.value, `${path}.${key}`, seen)
  }
  seen.delete(value)
}

function isArrayIndex(value: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false
  const index = Number(value)
  return Number.isSafeInteger(index) && index >= 0 && index < length
}

function invalid(message: string): never {
  throw new ConfigError(message, { reason: 'INVALID_CONFIG' })
}
