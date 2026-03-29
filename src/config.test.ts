import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

describe('Phase 5 option defaults', () => {
  it('failOnOutdated defaults to false', async () => {
    const config = await resolveConfig({ cwd: '/tmp', loglevel: 'silent' })

    expect(config.failOnOutdated).toBe(false)
  })

  it('ignoreOtherWorkspaces defaults to true', async () => {
    const config = await resolveConfig({ cwd: '/tmp', loglevel: 'silent' })

    expect(config.ignoreOtherWorkspaces).toBe(true)
  })

  it('failOnOutdated can be overridden to true', async () => {
    const config = await resolveConfig({
      cwd: '/tmp',
      loglevel: 'silent',
      failOnOutdated: true,
    })

    expect(config.failOnOutdated).toBe(true)
  })

  it('ignoreOtherWorkspaces can be overridden to false', async () => {
    const config = await resolveConfig({
      cwd: '/tmp',
      loglevel: 'silent',
      ignoreOtherWorkspaces: false,
    })

    expect(config.ignoreOtherWorkspaces).toBe(false)
  })
})

describe('cwd option', () => {
  it('uses cwd override when provided', async () => {
    const config = await resolveConfig({ cwd: '/tmp/my-project', loglevel: 'silent' })

    expect(config.cwd).toBe('/tmp/my-project')
  })

  it('falls back to default cwd when not provided', async () => {
    const config = await resolveConfig({ loglevel: 'silent' })

    expect(config.cwd).toBe(process.cwd())
    expect(config.inputCwd).toBe(process.cwd())
    expect(config.effectiveRoot).toBe(process.cwd())
  })

  it('passes cwd through to config resolution', async () => {
    const config = await resolveConfig({
      cwd: '/tmp/test-workspace',
      mode: 'latest',
      loglevel: 'silent',
    })

    expect(config.cwd).toBe('/tmp/test-workspace')
    expect(config.mode).toBe('latest')
  })
})

describe('root auto-detection in config resolution', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('loads root package config when cwd is a child directory', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-root-'))
    mkdirSync(join(tmpDir, 'src', 'deep'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', depfresh: { mode: 'latest', concurrency: 4 } }, null, 2),
    )

    const config = await resolveConfig({
      cwd: join(tmpDir, 'src', 'deep'),
      loglevel: 'silent',
    })

    expect(config.cwd).toBe(join(tmpDir, 'src', 'deep'))
    expect(config.inputCwd).toBe(join(tmpDir, 'src', 'deep'))
    expect(config.effectiveRoot).toBe(tmpDir)
    expect(config.discoveryMode).toBe('inside-project')
    expect(config.mode).toBe('latest')
    expect(config.concurrency).toBe(4)
  })

  it('prefers workspace root config over nested package roots', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-workspace-root-'))
    mkdirSync(join(tmpDir, 'packages', 'app', 'src'), { recursive: true })
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'workspace-root',
          workspaces: ['packages/*'],
          depfresh: { mode: 'minor' },
        },
        null,
        2,
      ),
    )
    writeFileSync(join(tmpDir, 'packages', 'app', 'package.json'), JSON.stringify({ name: 'app' }))

    const config = await resolveConfig({
      cwd: join(tmpDir, 'packages', 'app', 'src'),
      loglevel: 'silent',
    })

    expect(config.effectiveRoot).toBe(tmpDir)
    expect(config.discoveryMode).toBe('inside-project')
    expect(config.mode).toBe('minor')
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

  it('preserves all depfreshOptions fields', () => {
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
