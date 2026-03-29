import { ConfigError } from './errors'
import type { depfreshOptions } from './types'

export function validateOptions(options: Pick<depfreshOptions, 'interactive' | 'write'>): void {
  if (options.interactive && !options.write) {
    throw new ConfigError(
      'Interactive mode requires write mode. Pass `--write` with `--interactive`.',
    )
  }
}
