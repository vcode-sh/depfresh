import { defu } from 'defu'
import { loadConfig } from 'unconfig'
import type { BumpOptions } from './types'
import { DEFAULT_OPTIONS } from './types'
import { createLogger } from './utils/logger'

export async function resolveConfig(overrides: Partial<BumpOptions> = {}): Promise<BumpOptions> {
  const { config: fileConfig } = await loadConfig<Partial<BumpOptions>>({
    sources: [
      {
        files: ['bump.config', '.bumprc'],
      },
      {
        files: ['package.json'],
        rewrite(config) {
          return (config as Record<string, unknown>).bump as Partial<BumpOptions> | undefined
        },
      },
    ],
    cwd: overrides.cwd || process.cwd(),
  })

  const merged = defu(overrides, fileConfig ?? {}, DEFAULT_OPTIONS) as BumpOptions

  const logger = createLogger(merged.loglevel)
  logger.debug('Config resolved:', JSON.stringify(merged, null, 2))

  return merged
}
