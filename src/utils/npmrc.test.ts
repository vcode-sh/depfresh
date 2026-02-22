import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, describe, expect, it } from 'vitest'
import type { NpmrcConfig } from '../types'
import { getRegistryForPackage, loadNpmrc } from './npmrc'

describe('getRegistryForPackage', () => {
  const config: NpmrcConfig = {
    registries: new Map([
      ['@myorg', { url: 'https://npm.myorg.com/', token: 'secret', authType: 'bearer' }],
      ['@private', { url: 'https://private.registry.io/' }],
    ]),
    defaultRegistry: 'https://registry.npmjs.org/',
    strictSsl: true,
  }

  it('returns scoped registry for scoped package', () => {
    const reg = getRegistryForPackage('@myorg/utils', config)
    expect(reg.url).toBe('https://npm.myorg.com/')
    expect(reg.token).toBe('secret')
  })

  it('returns default registry for unscoped package', () => {
    const reg = getRegistryForPackage('lodash', config)
    expect(reg.url).toBe('https://registry.npmjs.org/')
  })

  it('returns default registry for unknown scope', () => {
    const reg = getRegistryForPackage('@unknown/pkg', config)
    expect(reg.url).toBe('https://registry.npmjs.org/')
  })

  it('returns correct registry for second scope', () => {
    const reg = getRegistryForPackage('@private/thing', config)
    expect(reg.url).toBe('https://private.registry.io/')
  })
})

describe('loadNpmrc npm_config_userconfig', () => {
  const savedUserconfig = process.env.npm_config_userconfig
  const savedRegistry = process.env.npm_config_registry
  const savedRegistryUpper = process.env.NPM_CONFIG_REGISTRY

  afterEach(() => {
    // Restore all env vars that could affect registry resolution
    for (const [key, val] of [
      ['npm_config_userconfig', savedUserconfig],
      ['npm_config_registry', savedRegistry],
      ['NPM_CONFIG_REGISTRY', savedRegistryUpper],
    ] as const) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }
  })

  it('uses npm_config_userconfig env var for global config path', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'npmrc-test-'))
    const customRcPath = join(tmpDir, 'custom-npmrc')
    writeFileSync(customRcPath, 'registry=https://custom.registry.example.com/\n')

    process.env.npm_config_userconfig = customRcPath
    // Clear registry env vars so applyEnvOverrides doesn't clobber the file config
    // (pnpm sets npm_config_registry when running scripts)
    // biome-ignore lint/performance/noDelete: must actually remove env var
    delete process.env.npm_config_registry
    // biome-ignore lint/performance/noDelete: must actually remove env var
    delete process.env.NPM_CONFIG_REGISTRY

    const config = loadNpmrc(tmpDir)
    expect(config.defaultRegistry).toBe('https://custom.registry.example.com/')
  })

  it('falls back to ~/.npmrc when env var is not set', () => {
    // biome-ignore lint/performance/noDelete: must actually remove env var, not set to "undefined"
    delete process.env.npm_config_userconfig

    // loadNpmrc should not throw even if ~/.npmrc doesn't exist
    const tmpDir = mkdtempSync(join(tmpdir(), 'npmrc-test-'))
    const config = loadNpmrc(tmpDir)
    expect(config.defaultRegistry).toBeDefined()
  })
})
