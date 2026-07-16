import { ConfigError } from '../errors'
import { args } from './args-schema'

interface CliOptionDefinition {
  name: string
  type: 'boolean' | 'string'
}

const optionDefinitions = new Map<string, CliOptionDefinition>()
const numericOptionNames = new Set(['concurrency', 'cooldown'])
const commandNames = new Set(['capabilities', 'inspect', 'plan', 'apply'])

for (const [name, rawDefinition] of Object.entries(args)) {
  if (rawDefinition.type !== 'boolean' && rawDefinition.type !== 'string') continue
  const definition: CliOptionDefinition = { name, type: rawDefinition.type }
  optionDefinitions.set(name, definition)
  const aliases = Array.isArray(rawDefinition.alias)
    ? rawDefinition.alias
    : rawDefinition.alias
      ? [rawDefinition.alias]
      : []
  for (const alias of aliases) optionDefinitions.set(alias, definition)
}

optionDefinitions.set('help', { name: 'help', type: 'boolean' })
optionDefinitions.set('h', { name: 'help', type: 'boolean' })
optionDefinitions.set('version', { name: 'version', type: 'boolean' })

function unknownOption(option: string): ConfigError {
  return new ConfigError(`Unknown option: ${option}`, { reason: 'UNKNOWN_OPTION' })
}

function missingValue(name: string): ConfigError {
  return new ConfigError(`Missing value for --${name}`, { reason: 'MISSING_OPTION_VALUE' })
}

function recordOccurrence(
  occurrences: Map<string, string | boolean>,
  name: string,
  value: string | boolean,
): void {
  const previous = occurrences.get(name)
  if (previous !== undefined && previous !== value) {
    throw new ConfigError(
      `Conflicting values for --${name}: ${JSON.stringify(previous)} and ${JSON.stringify(value)}`,
      { reason: 'CONFLICTING_OPTION' },
    )
  }
  occurrences.set(name, value)
}

function parseBooleanAssignment(name: string, value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new ConfigError(`Invalid boolean value for --${name}: ${JSON.stringify(value)}`, {
    reason: 'INVALID_BOOLEAN',
  })
}

function isAllowedOptionValue(definition: CliOptionDefinition, value: string): boolean {
  if (!value.startsWith('-')) return true
  return numericOptionNames.has(definition.name) && /^-\d/u.test(value)
}

function normalizeLongOption(
  rawArgs: string[],
  index: number,
  normalized: string[],
  occurrences: Map<string, string | boolean>,
): number {
  const token = rawArgs[index] ?? ''
  const equalsIndex = token.indexOf('=')
  const optionToken = equalsIndex === -1 ? token : token.slice(0, equalsIndex)
  const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1)
  const rawName = optionToken.slice(2)

  if (rawName.startsWith('no-')) {
    const name = rawName.slice(3)
    const definition = optionDefinitions.get(name)
    if (!definition || name.length === 1) throw unknownOption(optionToken)
    if (definition.type !== 'boolean') {
      throw new ConfigError(`Option --${definition.name} is not boolean`, {
        reason: 'INVALID_BOOLEAN',
      })
    }
    if (inlineValue !== undefined) {
      throw new ConfigError(`Invalid boolean value for --${definition.name}`, {
        reason: 'INVALID_BOOLEAN',
      })
    }
    recordOccurrence(occurrences, definition.name, false)
    normalized.push(`--no-${definition.name}`)
    return index
  }

  const definition = optionDefinitions.get(rawName)
  if (!definition || rawName.length === 1) throw unknownOption(optionToken)

  if (definition.type === 'boolean') {
    const value =
      inlineValue === undefined ? true : parseBooleanAssignment(definition.name, inlineValue)
    recordOccurrence(occurrences, definition.name, value)
    normalized.push(value ? `--${definition.name}` : `--no-${definition.name}`)
    return index
  }

  if (inlineValue !== undefined) {
    if (inlineValue.length === 0) throw missingValue(definition.name)
    recordOccurrence(occurrences, definition.name, inlineValue)
    normalized.push(token)
    return index
  }

  const value = rawArgs[index + 1]
  if (value === undefined || !isAllowedOptionValue(definition, value)) {
    throw missingValue(definition.name)
  }
  recordOccurrence(occurrences, definition.name, value)
  normalized.push(token, value)
  return index + 1
}

function normalizeShortOption(
  rawArgs: string[],
  index: number,
  normalized: string[],
  occurrences: Map<string, string | boolean>,
): number {
  const token = rawArgs[index] ?? ''
  const firstAlias = token[1]
  if (!firstAlias) throw unknownOption(token)
  const firstDefinition = optionDefinitions.get(firstAlias)
  if (!firstDefinition) throw unknownOption(`-${firstAlias}`)

  const attached = token.slice(2)
  if (firstDefinition.type === 'string') {
    const value = attached || rawArgs[index + 1]
    if (!(value && isAllowedOptionValue(firstDefinition, value)) || value.startsWith('=')) {
      throw missingValue(firstDefinition.name)
    }
    recordOccurrence(occurrences, firstDefinition.name, value)
    if (attached) {
      normalized.push(token)
      return index
    }
    normalized.push(token, value)
    return index + 1
  }

  if (attached.startsWith('=')) {
    const value = parseBooleanAssignment(firstDefinition.name, attached.slice(1))
    recordOccurrence(occurrences, firstDefinition.name, value)
    normalized.push(value ? `--${firstDefinition.name}` : `--no-${firstDefinition.name}`)
    return index
  }

  for (const alias of token.slice(1)) {
    const definition = optionDefinitions.get(alias)
    if (!definition) throw unknownOption(`-${alias}`)
    if (definition.type !== 'boolean') {
      throw new ConfigError(`Option -${alias} requires a value and cannot be grouped`, {
        reason: 'MISSING_OPTION_VALUE',
      })
    }
    recordOccurrence(occurrences, definition.name, true)
  }
  normalized.push(token)
  return index
}

export function normalizeCliRawArgs(rawArgs: string[]): string[] {
  const input = rawArgs[0] === 'help' ? ['--help', ...rawArgs.slice(1)] : rawArgs
  const normalized: string[] = []
  const occurrences = new Map<string, string | boolean>()
  let positional: string | undefined

  for (let index = 0; index < input.length; index++) {
    const token = input[index] ?? ''
    if (token === '--') {
      const trailing = input[index + 1]
      if (trailing !== undefined) {
        throw new ConfigError(`Unexpected positional argument: ${trailing}`, {
          reason: 'INVALID_OPTION_VALUE',
        })
      }
      normalized.push(token)
      continue
    }
    if (token.startsWith('--')) {
      index = normalizeLongOption(input, index, normalized, occurrences)
      continue
    }
    if (token.startsWith('-') && token !== '-') {
      index = normalizeShortOption(input, index, normalized, occurrences)
      continue
    }

    if (positional !== undefined) {
      throw new ConfigError(`Unexpected positional argument: ${token}`, {
        reason: 'INVALID_OPTION_VALUE',
      })
    }
    positional = token
    recordOccurrence(occurrences, commandNames.has(token) ? 'command' : 'mode', token)
    normalized.push(token)
  }

  if (occurrences.get('version') === true && input.length !== 1) {
    throw new ConfigError('--version cannot be combined with other arguments.', {
      reason: 'UNSUPPORTED_COMBINATION',
    })
  }

  return normalized
}
