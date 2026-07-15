import { access, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { defu } from 'defu'
import { join } from 'pathe'
import { ConfigError } from './errors'
import { resolveDiscoveryContext } from './io/packages/root-detection'
import type { depfreshOptions } from './types'
import { DEFAULT_OPTIONS } from './types'
import { createLogger } from './utils/logger'
import { redactSensitiveValue } from './utils/redact'
import { validateOptions } from './validate-options'

const TS_RE = /\.[mc]?ts$/
const JS_RE = /\.[mc]?js$/
export const INVOCATION_ONLY_OPTIONS = [
  'write',
  'install',
  'update',
  'execute',
  'verifyCommand',
  'global',
  'globalAll',
] as const

export const CONFIG_FILES = [
  'depfresh.config.ts',
  'depfresh.config.mts',
  'depfresh.config.cts',
  'depfresh.config.js',
  'depfresh.config.mjs',
  'depfresh.config.cjs',
  'depfresh.config.json',
  '.depfreshrc.ts',
  '.depfreshrc.mts',
  '.depfreshrc.cts',
  '.depfreshrc.js',
  '.depfreshrc.mjs',
  '.depfreshrc.cjs',
  '.depfreshrc.json',
  '.depfreshrc',
]

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadTsFile(filePath: string): Promise<Partial<depfreshOptions> | undefined> {
  try {
    const { createJiti } = await import('jiti')
    const jiti = createJiti(import.meta.url)
    const mod = (await jiti.import(filePath)) as Record<string, unknown>
    return (mod.default ?? mod) as Partial<depfreshOptions>
  } catch (error) {
    throw new ConfigError(`Failed to load config file ${filePath}`, {
      cause: error,
      reason: 'CONFIG_LOAD_FAILED',
    })
  }
}

async function loadJsFile(filePath: string): Promise<Partial<depfreshOptions> | undefined> {
  try {
    const mod = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>
    return (mod.default ?? mod) as Partial<depfreshOptions>
  } catch (error) {
    throw new ConfigError(`Failed to load config file ${filePath}`, {
      cause: error,
      reason: 'CONFIG_LOAD_FAILED',
    })
  }
}

async function loadJsonFile(filePath: string): Promise<Partial<depfreshOptions> | undefined> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as Partial<depfreshOptions>
  } catch (error) {
    throw new ConfigError(`Failed to parse JSON config ${filePath}`, {
      cause: error,
      reason: 'CONFIG_PARSE_FAILED',
    })
  }
}

async function loadConfigFile(cwd: string): Promise<Partial<depfreshOptions> | undefined> {
  for (const file of CONFIG_FILES) {
    const filePath = join(cwd, file)
    if (!(await exists(filePath))) continue

    if (TS_RE.test(file)) return loadTsFile(filePath)
    if (JS_RE.test(file)) return loadJsFile(filePath)
    return loadJsonFile(filePath)
  }

  const pkgPath = join(cwd, 'package.json')
  if (await exists(pkgPath)) {
    try {
      const content = await readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(content) as Record<string, unknown>
      if (pkg.depfresh) return pkg.depfresh as Partial<depfreshOptions>
    } catch (error) {
      throw new ConfigError(`Failed to parse package.json at ${pkgPath}`, {
        cause: error,
        reason: 'CONFIG_PARSE_FAILED',
      })
    }
  }

  return undefined
}

function removeInvocationOnlyOptions(
  config: Partial<depfreshOptions> | undefined,
): Partial<depfreshOptions> {
  if (!config) return {}
  const safeConfig = { ...config }
  for (const option of INVOCATION_ONLY_OPTIONS) {
    delete safeConfig[option]
  }
  return safeConfig
}

export async function resolveConfig(
  overrides: Partial<depfreshOptions> = {},
): Promise<depfreshOptions> {
  const requestedCwd = overrides.cwd || process.cwd()
  const discovery = resolveDiscoveryContext(requestedCwd)
  const fileConfig = await loadConfigFile(discovery.effectiveRoot)
  const merged = defu(
    overrides,
    removeInvocationOnlyOptions(fileConfig),
    DEFAULT_OPTIONS,
  ) as depfreshOptions
  if (overrides.include !== undefined) {
    merged.include = overrides.include
  }
  if (overrides.exclude !== undefined) {
    merged.exclude = overrides.exclude
  }
  if (overrides.ignorePaths !== undefined) {
    merged.ignorePaths = overrides.ignorePaths
  }
  merged.cwd = discovery.inputCwd
  merged.inputCwd = discovery.inputCwd
  merged.effectiveRoot = discovery.effectiveRoot
  merged.discoveryMode = discovery.discoveryMode
  validateOptions(merged)

  const logger = createLogger(merged.loglevel)
  logger.debug('Config resolved:', JSON.stringify(redactSensitiveValue(merged), null, 2))

  return merged
}
