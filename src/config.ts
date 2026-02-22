import { loadConfig } from 'c12'
import { defu } from 'defu'
import type { BumpOptions } from './types'
import { DEFAULT_OPTIONS } from './types'
import { createLogger } from './utils/logger'

export async function resolveConfig(
  overrides: Partial<BumpOptions> = {},
): Promise<BumpOptions> {
  const { config: fileConfig } = await loadConfig<Partial<BumpOptions>>({
    name: 'bump',
    cwd: overrides.cwd || process.cwd(),
    rcFile: '.bumprc',
    packageJson: 'bump',
    defaults: {},
  })

  const merged = defu(overrides, fileConfig ?? {}, DEFAULT_OPTIONS) as BumpOptions

  const logger = createLogger(merged.loglevel)
  logger.debug('Config resolved:', JSON.stringify(merged, null, 2))

  return merged
}
