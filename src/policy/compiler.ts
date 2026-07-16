import { ConfigError } from '../errors'
import type {
  CompiledPolicy,
  CompiledPolicyRule,
  PolicyInputLayer,
  PolicyMode,
  PolicyRuleInput,
  PolicyRuleSource,
} from '../types/policy'
import { patternToRegex } from '../utils/patterns'
import type { CompatibilityAction, InternalCompiledPolicyRule } from './internal-types'
import { validatePolicyRules } from './schema'

const LEGACY_MODES = new Set<PolicyMode | 'ignore'>([
  'default',
  'major',
  'minor',
  'patch',
  'latest',
  'newest',
  'next',
  'ignore',
])
const POLICY_SOURCES = new Set<PolicyRuleSource>(['defaults', 'config', 'library', 'cli'])
const POLICY_SOURCE_ORDER: Record<PolicyRuleSource, number> = {
  defaults: 0,
  config: 1,
  library: 2,
  cli: 3,
}
const LAYER_KEYS = new Set(['source', 'mode', 'packageMode', 'include', 'exclude', 'policyRules'])

interface Located<T> {
  value: T
  source: PolicyRuleSource
}

interface PackageModeEntry {
  pattern: string
  mode: PolicyMode | 'ignore'
  source: PolicyRuleSource
}

interface CompatibilityState {
  mode: Located<PolicyMode | 'ignore'>
  packageModes: Map<string, PackageModeEntry>
}

interface ValidatedLayer {
  source: PolicyRuleSource
  mode?: PolicyMode | 'ignore'
  packageModes?: Array<{ pattern: string; mode: PolicyMode | 'ignore' }>
  include?: string[]
  exclude?: string[]
  policyRules: PolicyRuleInput[]
}

export function compilePolicy(inputLayers: readonly PolicyInputLayer[]): CompiledPolicy {
  const validatedInputLayers = readLayerArray(inputLayers).map((layer) => validateLayer(layer))
  const providedLayers = validatedInputLayers.some((layer) => layer.source === 'defaults')
    ? validatedInputLayers
    : [validateLayer({ source: 'defaults', mode: 'default' }), ...validatedInputLayers]
  assertUniqueSources(providedLayers)
  const layers = [...providedLayers].sort(
    (left, right) => POLICY_SOURCE_ORDER[left.source] - POLICY_SOURCE_ORDER[right.source],
  )
  const rules: InternalCompiledPolicyRule[] = []
  const state: CompatibilityState = {
    mode: { value: 'default', source: 'defaults' },
    packageModes: new Map(),
  }

  for (const layer of layers) {
    compileCompatibilityLayer(rules, state, layer)
    for (const rule of layer.policyRules) {
      addRule(rules, rule, layer.source, 'explicit')
    }
  }

  assertUniqueCompiledIds(rules)
  return { rules }
}

function validateLayer(layer: unknown): ValidatedLayer {
  try {
    const record = readLayerRecord(layer)
    const source = record.source
    const mode = record.mode
    if (typeof source !== 'string' || !POLICY_SOURCES.has(source as PolicyRuleSource)) {
      throw new ConfigError('Invalid policy source')
    }
    if (mode !== undefined) validateLegacyMode(mode, 'mode')
    return {
      source: source as PolicyRuleSource,
      ...(mode === undefined ? {} : { mode }),
      ...(record.packageMode === undefined
        ? {}
        : { packageModes: readPackageMode(record.packageMode) }),
      ...(record.include === undefined
        ? {}
        : { include: readFilterList(record.include, 'include') }),
      ...(record.exclude === undefined
        ? {}
        : { exclude: readFilterList(record.exclude, 'exclude') }),
      policyRules: validatePolicyRules((record.policyRules ?? []) as readonly unknown[]),
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError('Invalid compatibility policy structure')
  }
}

function readLayerArray(value: unknown): unknown[] {
  try {
    if (!Array.isArray(value)) throw new ConfigError('Policy layers must be an array')
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!(lengthDescriptor && 'value' in lengthDescriptor)) {
      throw new ConfigError('Policy layers must be a dense array')
    }
    const length = lengthDescriptor.value
    const layers: unknown[] = []
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue
      if (typeof key !== 'string' || !isDenseArrayIndex(key, length)) {
        throw new ConfigError('Policy layers must not contain extra array properties')
      }
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!(descriptor?.enumerable && 'value' in descriptor)) {
        throw new ConfigError('Policy layers must contain enumerable data properties')
      }
      layers.push(descriptor.value)
    }
    return layers
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError('Invalid policy layer structure')
  }
}

function readLayerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError('Policy layer must be a plain object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ConfigError('Policy layer must be a plain object')
  }
  const record: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !LAYER_KEYS.has(key)) {
      throw new ConfigError('Policy layer contains an unsupported field')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!(descriptor?.enumerable && 'value' in descriptor)) {
      throw new ConfigError('Policy layer must contain enumerable data properties')
    }
    record[key] = descriptor.value
  }
  return record
}

function compileCompatibilityLayer(
  rules: InternalCompiledPolicyRule[],
  state: CompatibilityState,
  layer: ValidatedLayer,
): void {
  if (layer.mode !== undefined) {
    const clearsIgnore = state.mode.value === 'ignore' && layer.mode !== 'ignore'
    state.mode = { value: layer.mode, source: layer.source }
    compileMode(rules, state.mode, layer.source, clearsIgnore)
  }
  if (layer.packageModes !== undefined) {
    for (const { pattern, mode } of layer.packageModes) {
      state.packageModes.set(pattern, { pattern, mode, source: layer.source })
    }
    compilePackageModes(rules, [...state.packageModes.values()], layer.source)
  }
  if (layer.include !== undefined || layer.exclude !== undefined) {
    compileFilters(rules, layer.include, layer.exclude, layer.source)
  }
}

function compileMode(
  rules: InternalCompiledPolicyRule[],
  mode: Located<PolicyMode | 'ignore'>,
  snapshotSource: PolicyRuleSource,
  clearsIgnore: boolean,
): void {
  const id = `$${snapshotSource}:mode${mode.value === 'ignore' ? ':ignore' : ''}`
  let rule: PolicyRuleInput
  if (mode.value === 'ignore') {
    rule = { id, selectors: {}, action: 'exclude' }
  } else {
    rule = {
      id,
      selectors: {},
      ...(clearsIgnore ? { action: 'include' as const } : {}),
      mode: mode.value,
    }
  }
  addRule(
    rules,
    rule,
    mode.source,
    mode.source === 'defaults' ? 'default' : 'compatibility',
    undefined,
    mode.value === 'ignore' ? 'global-ignore' : clearsIgnore ? 'clear-global-ignore' : undefined,
  )
}

function compilePackageModes(
  rules: InternalCompiledPolicyRule[],
  entries: readonly PackageModeEntry[],
  snapshotSource: PolicyRuleSource,
): void {
  for (const [reverseIndex, entry] of [...entries].reverse().entries()) {
    try {
      patternToRegex(entry.pattern)
    } catch {
      continue
    }
    addPackageModeRule(rules, entry, entry.pattern, `${snapshotSource}:pattern:${reverseIndex}`)
  }
  for (const [index, entry] of entries.entries()) {
    addPackageModeRule(
      rules,
      entry,
      exactPattern(entry.pattern),
      `${snapshotSource}:exact:${index}`,
    )
  }
}

function addPackageModeRule(
  rules: InternalCompiledPolicyRule[],
  entry: PackageModeEntry,
  dependencyName: string,
  idSuffix: string,
): void {
  const id = `$packageMode:${idSuffix}`
  const selectors = { dependencyName }
  const rule: PolicyRuleInput =
    entry.mode === 'ignore'
      ? { id, selectors, action: 'exclude' }
      : { id, selectors, action: 'include', mode: entry.mode }
  addRule(
    rules,
    rule,
    entry.source,
    'compatibility',
    'resolution',
    entry.mode === 'ignore' ? 'package-ignore' : 'clear-any-ignore',
  )
}

function compileFilters(
  rules: InternalCompiledPolicyRule[],
  include: string[] | undefined,
  exclude: string[] | undefined,
  source: PolicyRuleSource,
): void {
  if (include?.length) {
    addRule(
      rules,
      {
        id: `$${source}:include:default`,
        selectors: {},
        action: 'exclude',
      },
      source,
      'compatibility',
      undefined,
      'include-default',
    )
    for (const [index, dependencyName] of include.entries()) {
      addRule(
        rules,
        {
          id: `$${source}:include:${index}`,
          selectors: { dependencyName },
          action: 'include',
        },
        source,
        'compatibility',
        undefined,
        'include-match',
      )
    }
  } else if (include) {
    addRule(
      rules,
      { id: `$${source}:include:reset`, selectors: {}, action: 'include' },
      source,
      'compatibility',
      undefined,
      'include-reset',
    )
  }
  if (exclude !== undefined) {
    addRule(
      rules,
      { id: `$${source}:exclude:reset`, selectors: {}, action: 'include' },
      source,
      'compatibility',
      undefined,
      'exclude-reset',
    )
    for (const [index, dependencyName] of exclude.entries()) {
      addRule(
        rules,
        {
          id: `$${source}:exclude:${index}`,
          selectors: { dependencyName },
          action: 'exclude',
        },
        source,
        'compatibility',
        undefined,
        'exclude-filter',
      )
    }
  }
}

function addRule(
  rules: InternalCompiledPolicyRule[],
  rule: PolicyRuleInput,
  source: PolicyRuleSource,
  kind: CompiledPolicyRule['provenance']['kind'],
  dependencyNameSource?: CompiledPolicyRule['dependencyNameSource'],
  compatibilityAction?: CompatibilityAction,
): void {
  rules.push({
    ...rule,
    ...(dependencyNameSource ? { dependencyNameSource } : {}),
    ...(compatibilityAction ? { compatibilityAction } : {}),
    provenance: { source, kind, index: rules.length },
  })
}

function readFilterList(value: unknown, label: 'include' | 'exclude'): string[] {
  if (!Array.isArray(value)) throw new ConfigError(`${label} must be an array of patterns`)
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !(lengthDescriptor && 'value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new ConfigError(`${label} must be a dense array of patterns`)
  }
  const length = lengthDescriptor.value
  const patterns: string[] = []
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !isDenseArrayIndex(key, length)) {
      throw new ConfigError(`${label} must not contain extra array properties`)
    }
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      !(descriptor?.enumerable && 'value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new ConfigError(`${label} must contain enumerable string patterns`)
    }
    patterns.push(descriptor.value)
  }
  for (const pattern of patterns) {
    try {
      patternToRegex(pattern)
    } catch (error) {
      throw new ConfigError('Invalid compatibility policy pattern', { cause: error })
    }
  }
  return patterns
}

function readPackageMode(value: unknown): Array<{ pattern: string; mode: PolicyMode | 'ignore' }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError('packageMode must be a plain object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ConfigError('packageMode must be a plain object')
  }
  const entries: Array<{ pattern: string; mode: PolicyMode | 'ignore' }> = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new ConfigError('packageMode must contain JSON-compatible entries')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!(descriptor?.enumerable && 'value' in descriptor)) {
      throw new ConfigError('packageMode must contain JSON-compatible entries')
    }
    validateLegacyMode(descriptor.value, 'packageMode')
    entries.push({ pattern: key, mode: descriptor.value })
  }
  return entries
}

function isDenseArrayIndex(value: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false
  const index = Number(value)
  return Number.isSafeInteger(index) && index >= 0 && index < length
}

function validateLegacyMode(
  value: unknown,
  label: 'mode' | 'packageMode',
): asserts value is PolicyMode | 'ignore' {
  if (typeof value !== 'string' || !LEGACY_MODES.has(value as PolicyMode | 'ignore')) {
    throw new ConfigError(`${label} contains an invalid mode`)
  }
}

function exactPattern(value: string): string {
  return `/^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$/u`
}

function assertUniqueSources(layers: readonly ValidatedLayer[]): void {
  const sources = new Set<PolicyRuleSource>()
  for (const layer of layers) {
    if (sources.has(layer.source)) throw new ConfigError('Policy source layers must be unique')
    sources.add(layer.source)
  }
}

function assertUniqueCompiledIds(rules: readonly InternalCompiledPolicyRule[]): void {
  const ids = new Set<string>()
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new ConfigError('Compiled policy contains a duplicate id')
    ids.add(rule.id)
  }
}
