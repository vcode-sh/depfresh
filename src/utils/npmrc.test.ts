import { describe, expect, it } from 'vitest'
import type { NpmrcConfig } from '../types'
import { getRegistryForPackage } from './npmrc'

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
