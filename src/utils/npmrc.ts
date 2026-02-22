import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'pathe'
import { parse as parseIni } from 'ini'
import { findUpSync } from 'find-up-simple'
import type { NpmrcConfig, RegistryConfig } from '../types'

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

export function loadNpmrc(cwd: string): NpmrcConfig {
  const config: NpmrcConfig = {
    registries: new Map(),
    defaultRegistry: DEFAULT_REGISTRY,
    strictSsl: true,
  }

  // Load in order: builtin defaults -> global -> user -> project
  const globalPath = join(homedir(), '.npmrc')
  const projectFile = findUpSync('.npmrc', { cwd })

  loadNpmrcFile(globalPath, config)
  if (projectFile) {
    loadNpmrcFile(projectFile, config)
  }

  // Environment variable overrides
  applyEnvOverrides(config)

  return config
}

function loadNpmrcFile(filepath: string, config: NpmrcConfig): void {
  let content: string
  try {
    content = readFileSync(filepath, 'utf-8')
  } catch {
    return
  }

  const parsed = parseIni(content)

  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'registry' && typeof value === 'string') {
      config.defaultRegistry = ensureTrailingSlash(value)
      continue
    }

    if (key === 'proxy' && typeof value === 'string') {
      config.proxy = value
      continue
    }

    if (key === 'https-proxy' && typeof value === 'string') {
      config.httpsProxy = value
      continue
    }

    if (key === 'strict-ssl' && typeof value === 'string') {
      config.strictSsl = value !== 'false'
      continue
    }

    if (key === 'cafile' && typeof value === 'string') {
      config.cafile = resolve(filepath, '..', value)
      continue
    }

    // Scoped registry: @scope:registry = https://...
    const scopedMatch = key.match(/^(@[^:]+):registry$/)
    if (scopedMatch && typeof value === 'string') {
      const scope = scopedMatch[1]!
      const url = ensureTrailingSlash(value)
      const existing = config.registries.get(scope) ?? { url }
      existing.url = url
      config.registries.set(scope, existing)
      continue
    }

    // Auth tokens: //registry.example.com/:_authToken = xxx
    const tokenMatch = key.match(/^\/\/(.+)\/:_authToken$/)
    if (tokenMatch && typeof value === 'string') {
      const host = tokenMatch[1]!
      // Find which scope this registry belongs to
      for (const [scope, reg] of config.registries) {
        if (reg.url.includes(host)) {
          reg.token = value
          reg.authType = 'bearer'
        }
      }
      // Also check if it's the default registry
      if (config.defaultRegistry.includes(host)) {
        const defaultReg = config.registries.get('default') ?? {
          url: config.defaultRegistry,
        }
        defaultReg.token = value
        defaultReg.authType = 'bearer'
        config.registries.set('default', defaultReg)
      }
      continue
    }
  }
}

function applyEnvOverrides(config: NpmrcConfig): void {
  const envRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY
  if (envRegistry) {
    config.defaultRegistry = ensureTrailingSlash(envRegistry)
  }

  const envProxy = process.env.npm_config_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (envProxy) {
    config.proxy = envProxy
  }

  const envHttpsProxy =
    process.env.npm_config_https_proxy || process.env.HTTPS_PROXY || process.env.https_proxy
  if (envHttpsProxy) {
    config.httpsProxy = envHttpsProxy
  }
}

export function getRegistryForPackage(name: string, config: NpmrcConfig): RegistryConfig {
  // Check scoped registry first
  const scopeMatch = name.match(/^(@[^/]+)\//)
  if (scopeMatch) {
    const scoped = config.registries.get(scopeMatch[1]!)
    if (scoped) return scoped
  }

  // Default registry
  const defaultReg = config.registries.get('default')
  if (defaultReg) return defaultReg

  return { url: config.defaultRegistry }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}
