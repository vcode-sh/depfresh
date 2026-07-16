import { VALID_LOG_LEVELS, VALID_MODES, VALID_OUTPUTS, VALID_SORT_OPTIONS } from './cli/arg-values'
import { ConfigError } from './errors'
import { validateInvocationAuthority } from './invocation-authority'
import type { depfreshOptions, InvocationAuthority } from './types'

function validateEnumOption(value: unknown, flagName: string, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ConfigError(
      `Invalid value for ${flagName}: ${JSON.stringify(value)}. Expected one of: ${allowed.join(', ')}.`,
      { reason: 'INVALID_OPTION_VALUE' },
    )
  }
}

export function parseIntegerOption(value: unknown, flagName: string, minimum: number): number {
  const normalized =
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? value : Number.NaN

  const parsed =
    typeof normalized === 'number'
      ? normalized
      : /^-?\d+$/.test(normalized)
        ? Number(normalized)
        : Number.NaN

  if (!Number.isInteger(parsed) || parsed < minimum) {
    const descriptor = minimum === 0 ? 'a non-negative integer' : 'a positive integer'
    throw new ConfigError(
      `Invalid value for ${flagName}: "${String(value)}". Expected ${descriptor}.`,
      { reason: 'INVALID_OPTION_VALUE' },
    )
  }

  return parsed
}

export function validateOptions(
  options: Pick<
    depfreshOptions,
    | 'interactive'
    | 'write'
    | 'mode'
    | 'output'
    | 'sort'
    | 'loglevel'
    | 'execute'
    | 'install'
    | 'update'
    | 'concurrency'
    | 'timeout'
    | 'retries'
    | 'cacheTTL'
    | 'cooldown'
  > &
    Partial<Pick<depfreshOptions, 'verifyCommand' | 'strictPostWrite' | 'global' | 'globalAll'>>,
  authority?: InvocationAuthority,
): void {
  validateEnumOption(options.mode, '--mode', VALID_MODES)
  validateEnumOption(options.output, '--output', VALID_OUTPUTS)
  validateEnumOption(options.sort, '--sort', VALID_SORT_OPTIONS)
  validateEnumOption(options.loglevel, '--loglevel', VALID_LOG_LEVELS)

  const retiredPhaseOptions: Array<[unknown, string]> = [
    [options.install, '--install'],
    [options.update, '--update'],
    [options.execute, '--execute'],
    [options.verifyCommand, '--verify-command'],
    [options.strictPostWrite, '--strict-post-write'],
  ]
  for (const [enabled, flag] of retiredPhaseOptions) {
    if (enabled) {
      throw new ConfigError(
        `${flag} is only supported by the explicit plan/apply phase workflow.`,
        { reason: 'UNSUPPORTED_COMBINATION' },
      )
    }
  }

  if (options.interactive && !options.write) {
    throw new ConfigError(
      'Interactive mode requires write mode. Pass `--write` with `--interactive`.',
      { reason: 'UNSUPPORTED_COMBINATION' },
    )
  }

  if (options.interactive && options.output === 'json') {
    throw new ConfigError(
      'Interactive mode cannot be used with JSON output. Pass `--output table` or disable `--interactive`.',
      { reason: 'UNSUPPORTED_COMBINATION' },
    )
  }

  if (authority) {
    validateInvocationAuthority(options as depfreshOptions, authority)
  }

  parseIntegerOption(options.concurrency, '--concurrency', 1)
  parseIntegerOption(options.timeout, '--timeout', 0)
  parseIntegerOption(options.retries, '--retries', 0)
  parseIntegerOption(options.cacheTTL, '--cacheTTL', 0)
  parseIntegerOption(options.cooldown, '--cooldown', 0)
}
