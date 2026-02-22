import { describe, expect, it } from 'vitest'
import { resolveConfig } from './config'

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
