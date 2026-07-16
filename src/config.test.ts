import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig, resolveConfigForSource } from './config'
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

  it('rejects interactive mode without write enabled', async () => {
    await expect(
      resolveConfig({
        cwd: '/tmp',
        loglevel: 'silent',
        interactive: true,
      }),
    ).rejects.toThrow('Interactive mode requires write mode')
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
    expect(config.effectiveRoot).toBe(realpathSync(tmpDir))
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

    expect(config.effectiveRoot).toBe(realpathSync(tmpDir))
    expect(config.discoveryMode).toBe('inside-project')
    expect(config.mode).toBe('minor')
  })
})

describe('invalid numeric config values', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it.each([
    ['concurrency', 'abc', 'Invalid value for --concurrency'],
    ['timeout', 'abc', 'Invalid value for --timeout'],
    ['retries', 'abc', 'Invalid value for --retries'],
    ['cacheTTL', 'abc', 'Invalid value for --cacheTTL'],
    ['cooldown', 'abc', 'Invalid value for --cooldown'],
  ])('rejects non-numeric %s from package.json depfresh config', async (key, value, message) => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-invalid-number-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', depfresh: { [key]: value } }, null, 2),
    )

    await expect(resolveConfig({ cwd: tmpDir, loglevel: 'silent' })).rejects.toThrow(message)
  })
})

describe('invalid enum config values', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it.each([
    ['mode', 'everything', '--mode'],
    ['output', 'xml', '--output'],
    ['sort', 'random', '--sort'],
    ['loglevel', 'trace', '--loglevel'],
  ])('rejects invalid %s from package.json config', async (key, value, flag) => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-invalid-enum-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', depfresh: { [key]: value } }, null, 2),
    )

    await expect(resolveConfig({ cwd: tmpDir })).rejects.toMatchObject({
      reason: 'INVALID_OPTION_VALUE',
      message: expect.stringContaining(flag),
    })
  })

  it('assigns CONFIG_PARSE_FAILED to malformed JSON without exposing its contents', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-malformed-json-'))
    writeFileSync(join(tmpDir, '.depfreshrc.json'), '{"token":"top-secret",')

    await expect(resolveConfig({ cwd: tmpDir })).rejects.toMatchObject({
      reason: 'CONFIG_PARSE_FAILED',
      message: expect.not.stringContaining('top-secret'),
    })
  })
})

describe('invalid option combinations from config', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('does not let package.json config grant write authority', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-invalid-combo-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'root',
          depfresh: {
            write: true,
            install: true,
            syncLockfile: true,
            update: true,
            execute: 'touch should-not-run',
            verify: true,
            verifyArgv: ['touch', 'should-not-run'],
            phaseTimeout: 1,
            verifyCommand: 'touch should-not-run',
            strictPostWrite: true,
          },
        },
        null,
        2,
      ),
    )

    const config = await resolveConfig({ cwd: tmpDir, loglevel: 'silent' })

    expect(config).toMatchObject({ write: false, install: false, update: false })
    expect(config.syncLockfile).toBeUndefined()
    expect(config.execute).toBeUndefined()
    expect(config.verify).toBeUndefined()
    expect(config.verifyArgv).toBeUndefined()
    expect(config.phaseTimeout).toBeUndefined()
    expect(config.verifyCommand).toBeUndefined()
    expect(config.strictPostWrite).toBe(false)
  })

  it('does not let config select a global write target', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-global-authority-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', depfresh: { global: true, globalAll: true } }, null, 2),
    )

    const config = await resolveConfig({ cwd: tmpDir, loglevel: 'silent', write: true })

    expect(config.write).toBe(true)
    expect(config.global).toBe(false)
    expect(config.globalAll).toBe(false)
  })

  it('rejects retired side-effect values supplied explicitly by the library caller', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-explicit-authority-'))
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }))

    await expect(
      resolveConfig({
        cwd: tmpDir,
        loglevel: 'silent',
        write: true,
        install: true,
        execute: 'pnpm test',
        verifyCommand: 'pnpm typecheck',
        global: true,
      }),
    ).rejects.toMatchObject({ reason: 'UNSUPPORTED_COMBINATION' })
  })
})

describe('CLI array overrides', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('lets CLI array options override config arrays instead of concatenating them', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-config-array-override-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'root',
          depfresh: {
            include: ['from-config'],
            exclude: ['exclude-config'],
            ignorePaths: ['**/config-only/**'],
          },
        },
        null,
        2,
      ),
    )

    const config = await resolveConfig({
      cwd: tmpDir,
      loglevel: 'silent',
      include: ['from-cli'],
      exclude: ['exclude-cli'],
      ignorePaths: ['**/cli-only/**'],
    })

    expect(config.include).toEqual(['from-cli'])
    expect(config.exclude).toEqual(['exclude-cli'])
    expect(config.ignorePaths).toEqual(['**/cli-only/**'])
  })
})

describe('policy configuration', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('compiles config and CLI compatibility layers with explicit provenance', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-policy-config-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        depfresh: {
          mode: 'latest',
          include: ['from-config'],
          exclude: ['excluded-by-config'],
          policyRules: [
            {
              id: 'native-minor',
              selectors: { catalogName: 'native' },
              mode: 'minor',
            },
          ],
        },
      }),
    )

    const config = await resolveConfigForSource(
      {
        cwd: tmpDir,
        loglevel: 'silent',
        mode: 'patch',
        include: ['from-cli'],
        exclude: ['excluded-by-cli'],
      },
      'cli',
    )

    expect(config.compiledPolicy?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'native-minor',
          provenance: expect.objectContaining({ source: 'config', kind: 'explicit' }),
        }),
        expect.objectContaining({
          id: '$cli:mode',
          provenance: expect.objectContaining({ source: 'cli' }),
        }),
        expect.objectContaining({ id: '$cli:include:0' }),
        expect.objectContaining({ id: '$cli:exclude:0' }),
      ]),
    )
    expect(config.compiledPolicy?.rules.map((rule) => rule.id)).not.toContain('$config:include:0')
    expect(config.compiledPolicy?.rules.map((rule) => rule.id)).not.toContain('$config:exclude:0')
  })

  it('rejects invalid and authority-shaped policy rules loaded from config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'depfresh-policy-invalid-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        depfresh: {
          policyRules: [
            {
              id: 'unsafe',
              selectors: {},
              action: 'include',
              execute: 'untrusted command',
            },
          ],
        },
      }),
    )

    await expect(resolveConfig({ cwd: tmpDir, loglevel: 'silent' })).rejects.toMatchObject({
      code: 'ERR_CONFIG',
      reason: 'INVALID_CONFIG',
    })
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
