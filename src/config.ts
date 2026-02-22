import { access, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { defu } from 'defu'
import { join } from 'pathe'
import type { BumpOptions } from './types'
import { DEFAULT_OPTIONS } from './types'
import { createLogger } from './utils/logger'

const TS_RE = /\.[mc]?ts$/
const JS_RE = /\.[mc]?js$/

const CONFIG_FILES = [
  'bump.config.ts',
  'bump.config.mts',
  'bump.config.cts',
  'bump.config.js',
  'bump.config.mjs',
  'bump.config.cjs',
  'bump.config.json',
  '.bumprc.ts',
  '.bumprc.mts',
  '.bumprc.cts',
  '.bumprc.js',
  '.bumprc.mjs',
  '.bumprc.cjs',
  '.bumprc.json',
  '.bumprc',
]

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadTsFile(filePath: string): Promise<Partial<BumpOptions> | undefined> {
  const { createJiti } = await import('jiti')
  const jiti = createJiti(import.meta.url)
  const mod = (await jiti.import(filePath)) as Record<string, unknown>
  return (mod.default ?? mod) as Partial<BumpOptions>
}

async function loadJsFile(filePath: string): Promise<Partial<BumpOptions> | undefined> {
  const mod = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>
  return (mod.default ?? mod) as Partial<BumpOptions>
}

async function loadJsonFile(filePath: string): Promise<Partial<BumpOptions> | undefined> {
  const content = await readFile(filePath, 'utf-8')
  return JSON.parse(content) as Partial<BumpOptions>
}

async function loadConfigFile(cwd: string): Promise<Partial<BumpOptions> | undefined> {
  for (const file of CONFIG_FILES) {
    const filePath = join(cwd, file)
    if (!(await exists(filePath))) continue

    if (TS_RE.test(file)) return loadTsFile(filePath)
    if (JS_RE.test(file)) return loadJsFile(filePath)
    return loadJsonFile(filePath)
  }

  const pkgPath = join(cwd, 'package.json')
  if (await exists(pkgPath)) {
    const content = await readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(content) as Record<string, unknown>
    if (pkg.bump) return pkg.bump as Partial<BumpOptions>
  }

  return undefined
}

export async function resolveConfig(overrides: Partial<BumpOptions> = {}): Promise<BumpOptions> {
  const cwd = overrides.cwd || process.cwd()
  const fileConfig = await loadConfigFile(cwd)
  const merged = defu(overrides, fileConfig ?? {}, DEFAULT_OPTIONS) as BumpOptions

  const logger = createLogger(merged.loglevel)
  logger.debug('Config resolved:', JSON.stringify(merged, null, 2))

  return merged
}
