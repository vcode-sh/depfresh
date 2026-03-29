import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { findUpSync } from 'find-up-simple'
import { parse as parseIni } from 'ini'
import { join, resolve } from 'pathe'
import type { NpmrcConfig, RegistryConfig } from '../types'

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

interface RegistryAuthConfig {
  token: string
  authType: 'bearer' | 'basic'
}

interface PartialBasicAuth {
  username?: string
  password?: string
}

export function loadNpmrc(cwd: string): NpmrcConfig {
  const config: NpmrcConfig = {
    registries: new Map(),
    defaultRegistry: DEFAULT_REGISTRY,
    strictSsl: true,
  }
  const authConfigs = new Map<string, RegistryAuthConfig>()
  const partialBasicAuth = new Map<string, PartialBasicAuth>()

  // Load in order: builtin defaults -> global -> user -> project
  const globalPath = process.env.npm_config_userconfig || join(homedir(), '.npmrc')
  const projectFile = findUpSync('.npmrc', { cwd })

  loadNpmrcFile(globalPath, config, authConfigs, partialBasicAuth)
  if (projectFile) {
    loadNpmrcFile(projectFile, config, authConfigs, partialBasicAuth)
  }

  // Environment variable overrides
  applyEnvOverrides(config)
  applyAuthConfigs(config, authConfigs)

  return config
}

function loadNpmrcFile(
  filepath: string,
  config: NpmrcConfig,
  authConfigs: Map<string, RegistryAuthConfig>,
  partialBasicAuth: Map<string, PartialBasicAuth>,
): void {
  let content: string
  try {
    content = readFileSync(filepath, 'utf-8')
  } catch {
    return
  }

  const parsed = parseIni(content)

  for (const [key, value] of Object.entries(parsed)) {
    const resolvedValue = typeof value === 'string' ? expandEnvVariables(value) : value

    if (key === 'registry' && typeof resolvedValue === 'string') {
      config.defaultRegistry = ensureTrailingSlash(resolvedValue)
      continue
    }

    if (key === 'proxy' && typeof resolvedValue === 'string') {
      config.proxy = resolvedValue
      continue
    }

    if (key === 'https-proxy' && typeof resolvedValue === 'string') {
      config.httpsProxy = resolvedValue
      continue
    }

    if (key === 'strict-ssl') {
      config.strictSsl = parseStrictSsl(resolvedValue, config.strictSsl)
      continue
    }

    if (key === 'cafile' && typeof resolvedValue === 'string') {
      config.cafile = resolve(filepath, '..', resolvedValue)
      continue
    }

    // Scoped registry: @scope:registry = https://...
    const scopedMatch = key.match(/^(@[^:]+):registry$/)
    if (scopedMatch && typeof resolvedValue === 'string') {
      const scope = scopedMatch[1]!
      const url = ensureTrailingSlash(resolvedValue)
      const existing = config.registries.get(scope) ?? { url }
      existing.url = url
      config.registries.set(scope, existing)
      continue
    }

    // Auth tokens: //registry.example.com/:_authToken = xxx
    const tokenMatch = key.match(/^\/\/(.+)\/:_authToken$/)
    if (tokenMatch && typeof resolvedValue === 'string') {
      authConfigs.set(normalizeAuthorityKey(tokenMatch[1]!), {
        token: resolvedValue,
        authType: 'bearer',
      })
      continue
    }

    const authMatch = key.match(/^\/\/(.+)\/:_auth$/)
    if (authMatch && typeof resolvedValue === 'string') {
      authConfigs.set(normalizeAuthorityKey(authMatch[1]!), {
        token: resolvedValue,
        authType: 'basic',
      })
      continue
    }

    const usernameMatch = key.match(/^\/\/(.+)\/:username$/)
    if (usernameMatch && typeof resolvedValue === 'string') {
      const authKey = normalizeAuthorityKey(usernameMatch[1]!)
      const current = partialBasicAuth.get(authKey) ?? {}
      current.username = resolvedValue
      partialBasicAuth.set(authKey, current)
      syncPartialBasicAuth(authKey, authConfigs, partialBasicAuth)
      continue
    }

    const passwordMatch = key.match(/^\/\/(.+)\/:_password$/)
    if (passwordMatch && typeof resolvedValue === 'string') {
      const authKey = normalizeAuthorityKey(passwordMatch[1]!)
      const current = partialBasicAuth.get(authKey) ?? {}
      current.password = decodePassword(resolvedValue)
      partialBasicAuth.set(authKey, current)
      syncPartialBasicAuth(authKey, authConfigs, partialBasicAuth)
    }
  }
}

function expandEnvVariables(value: string): string {
  return value.replaceAll(/\$\{([^}]+)\}/g, (_match, name: string) => process.env[name] ?? '')
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

function applyAuthConfigs(config: NpmrcConfig, authConfigs: Map<string, RegistryAuthConfig>): void {
  for (const [_scope, registry] of config.registries) {
    const auth = authConfigs.get(normalizeRegistryUrl(registry.url))
    if (!auth) continue
    registry.token = auth.token
    registry.authType = auth.authType
  }

  const defaultAuth = authConfigs.get(normalizeRegistryUrl(config.defaultRegistry))
  if (defaultAuth) {
    const defaultReg = config.registries.get('default') ?? {
      url: config.defaultRegistry,
    }
    defaultReg.token = defaultAuth.token
    defaultReg.authType = defaultAuth.authType
    config.registries.set('default', defaultReg)
  }
}

function syncPartialBasicAuth(
  authKey: string,
  authConfigs: Map<string, RegistryAuthConfig>,
  partialBasicAuth: Map<string, PartialBasicAuth>,
): void {
  const partial = partialBasicAuth.get(authKey)
  if (!(partial?.username && partial.password)) return

  authConfigs.set(authKey, {
    token: Buffer.from(`${partial.username}:${partial.password}`, 'utf-8').toString('base64'),
    authType: 'basic',
  })
}

function normalizeAuthorityKey(rawAuthority: string): string {
  return normalizeRegistryUrl(`https://${rawAuthority}`)
}

function normalizeRegistryUrl(url: string): string {
  try {
    const parsed = new URL(ensureTrailingSlash(url))
    const pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
    return `${parsed.host.toLowerCase()}${pathname}`
  } catch {
    return ensureTrailingSlash(url)
  }
}

function decodePassword(encoded: string): string {
  try {
    return Buffer.from(encoded, 'base64').toString('utf-8')
  } catch {
    return encoded
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function parseStrictSsl(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value.toLowerCase() !== 'false'
  }
  return fallback
}
