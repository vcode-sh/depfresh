import { describe, expect, it } from 'vitest'
import { resolveConfig } from './config'
import { defineConfig } from './index'

describe('resolveConfig', () => {
  it('returns default options when no config file', async () => {
    const config = await resolveConfig({ cwd: '/tmp', loglevel: 'silent' })

    expect(config.mode).toBe('default')
    expect(config.concurrency).toBe(16)
    expect(config.timeout).toBe(10_000)
    expect(config.retries).toBe(2)
    expect(config.recursive).toBe(true)
    expect(config.write).toBe(false)
    expect(config.interactive).toBe(false)
  })

  it('overrides merge correctly', async () => {
    const config = await resolveConfig({
      cwd: '/tmp',
      mode: 'latest',
      concurrency: 32,
      loglevel: 'silent',
    })

    expect(config.mode).toBe('latest')
    expect(config.concurrency).toBe(32)
  })
})

describe('defineConfig', () => {
  it('returns the config object as-is', () => {
    const config = defineConfig({ mode: 'major', concurrency: 8 })

    expect(config.mode).toBe('major')
    expect(config.concurrency).toBe(8)
  })

  it('returns an empty object when called with empty', () => {
    const config = defineConfig({})
    expect(config).toEqual({})
  })

  it('preserves all BumpOptions fields', () => {
    const config = defineConfig({
      cwd: '/my/project',
      recursive: false,
      write: true,
      interactive: true,
      mode: 'latest',
      include: ['react', 'typescript'],
      exclude: ['@types/*'],
      force: true,
      peer: true,
      loglevel: 'debug',
    })

    expect(config.cwd).toBe('/my/project')
    expect(config.recursive).toBe(false)
    expect(config.write).toBe(true)
    expect(config.mode).toBe('latest')
    expect(config.include).toEqual(['react', 'typescript'])
    expect(config.loglevel).toBe('debug')
  })
})
