import { ConfigError } from './errors'
import type { depfreshOptions } from './types'

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
    )
  }

  return parsed
}

export function validateOptions(
  options: Pick<
    depfreshOptions,
    | 'interactive'
    | 'write'
    | 'output'
    | 'execute'
    | 'install'
    | 'update'
    | 'concurrency'
    | 'timeout'
    | 'retries'
    | 'cacheTTL'
    | 'cooldown'
  >,
): void {
  if (options.interactive && !options.write) {
    throw new ConfigError(
      'Interactive mode requires write mode. Pass `--write` with `--interactive`.',
    )
  }

  if (options.interactive && options.output === 'json') {
    throw new ConfigError(
      'Interactive mode cannot be used with JSON output. Pass `--output table` or disable `--interactive`.',
    )
  }

  if (
    options.output === 'json' &&
    options.write &&
    (options.execute || options.install || options.update)
  ) {
    throw new ConfigError(
      'JSON output cannot be used with --execute, --install, or --update. Pass `--output table` or disable post-write commands.',
    )
  }

  parseIntegerOption(options.concurrency, '--concurrency', 1)
  parseIntegerOption(options.timeout, '--timeout', 0)
  parseIntegerOption(options.retries, '--retries', 0)
  parseIntegerOption(options.cacheTTL, '--cacheTTL', 0)
  parseIntegerOption(options.cooldown, '--cooldown', 0)
}
