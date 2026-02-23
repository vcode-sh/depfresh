import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'

interface MockRouteResult {
  status?: number
  body: Record<string, unknown>
}

type MockRouteHandler = (
  attempt: number,
  req: IncomingMessage,
) => MockRouteResult | Promise<MockRouteResult>

interface RegistryRequest {
  packageName: string
  path: string
  headers: IncomingHttpHeaders
}

interface MockRegistry {
  server: Server
  url: string
  requests: RegistryRequest[]
  count: (packageName: string) => number
}

interface JsonUpdate {
  name: string
}

interface JsonPackage {
  updates: JsonUpdate[]
}

interface JsonError {
  name: string
}

interface JsonSummary {
  total: number
}

interface JsonEnvelope {
  packages: JsonPackage[]
  errors: JsonError[]
  summary: JsonSummary
}

const TEST_ENV_KEYS = [
  'HOME',
  'npm_config_userconfig',
  'npm_config_registry',
  'NPM_CONFIG_REGISTRY',
  'npm_config_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'npm_config_https_proxy',
  'HTTPS_PROXY',
  'https_proxy',
] as const

describe('check registry integration (mocked real registries)', () => {
  const tmpDirs: string[] = []
  const servers: Server[] = []
  const originalEnv: Partial<Record<(typeof TEST_ENV_KEYS)[number], string>> = {}

  beforeEach(() => {
    for (const key of TEST_ENV_KEYS) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    for (const server of servers.splice(0)) {
      await closeServer(server)
    }

    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }

    for (const key of TEST_ENV_KEYS) {
      const value = originalEnv[key]
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('recovers from transient 500 registry failures and still emits valid JSON output', async () => {
    const registry = await startMockRegistry({
      'left-pad': (attempt) => {
        if (attempt === 1) {
          return {
            status: 500,
            body: { error: 'temporary failure' },
          }
        }

        return {
          body: npmMetadata(['1.0.0', '1.1.0']),
        }
      },
    })
    servers.push(registry.server)

    const cwd = createWorkspace({
      dependencies: {
        'left-pad': '^1.0.0',
      },
      npmrcLines: [`registry=${registry.url}`],
    })

    const { exitCode, payload, rawOutput } = await runCheck(cwd, {
      retries: 2,
    })

    expect(exitCode).toBe(1)
    expect(registry.count('left-pad')).toBe(2)
    expect(payload.summary.total).toBe(1)
    expect(payload.errors).toHaveLength(0)
    expect(rawOutput).not.toContain('\u001b[')
  })

  it('routes scoped packages to scoped registry and forwards auth token from npmrc', async () => {
    const publicRegistry = await startMockRegistry({
      lodash: () => ({ body: npmMetadata(['4.17.0', '4.18.0']) }),
    })
    const privateRegistry = await startMockRegistry({
      '@private/pkg': () => ({ body: npmMetadata(['1.0.0', '1.5.0']) }),
    })

    servers.push(publicRegistry.server, privateRegistry.server)

    const privateHost = new URL(privateRegistry.url).host
    const cwd = createWorkspace({
      dependencies: {
        lodash: '^4.17.0',
        '@private/pkg': '^1.0.0',
      },
      npmrcLines: [
        `registry=${publicRegistry.url}`,
        `@private:registry=${privateRegistry.url}`,
        `//${privateHost}/:_authToken=super-secret`,
      ],
    })

    const { exitCode, payload } = await runCheck(cwd)

    expect(exitCode).toBe(1)
    expect(payload.summary.total).toBe(2)
    expect(publicRegistry.count('lodash')).toBe(1)
    expect(privateRegistry.count('@private/pkg')).toBe(1)

    const publicAuth = publicRegistry.requests[0]?.headers.authorization
    const privateAuth = privateRegistry.requests[0]?.headers.authorization

    expect(publicAuth).toBeUndefined()
    expect(privateAuth).toBe('Bearer super-secret')
  })

  it('keeps processing healthy dependencies when another dependency returns 404', async () => {
    const registry = await startMockRegistry({
      'good-pkg': () => ({ body: npmMetadata(['1.0.0', '2.0.0']) }),
    })
    servers.push(registry.server)

    const cwd = createWorkspace({
      dependencies: {
        'good-pkg': '^1.0.0',
        'missing-pkg': '^1.0.0',
      },
      npmrcLines: [`registry=${registry.url}`],
    })

    const { exitCode, payload } = await runCheck(cwd, {
      retries: 0,
    })

    expect(exitCode).toBe(1)
    expect(payload.summary.total).toBe(1)
    expect(payload.errors).toHaveLength(1)
    expect(payload.errors[0]?.name).toBe('missing-pkg')
    expect(payload.packages[0]?.updates).toHaveLength(1)
    expect(payload.packages[0]?.updates[0]?.name).toBe('good-pkg')
    expect(registry.count('good-pkg')).toBe(1)
    expect(registry.count('missing-pkg')).toBe(1)
  })

  it('returns non-fatal JSON error entries when all deps fail to resolve', async () => {
    const registry = await startMockRegistry({})
    servers.push(registry.server)

    const cwd = createWorkspace({
      dependencies: {
        'missing-only': '^1.0.0',
      },
      npmrcLines: [`registry=${registry.url}`],
    })

    const { exitCode, payload } = await runCheck(cwd, {
      retries: 0,
    })

    expect(exitCode).toBe(0)
    expect(payload.summary.total).toBe(0)
    expect(payload.errors).toHaveLength(1)
    expect(payload.errors[0]?.name).toBe('missing-only')
    expect(registry.count('missing-only')).toBe(1)
  })

  function createWorkspace(input: {
    dependencies: Record<string, string>
    npmrcLines: string[]
  }): string {
    const cwd = mkdtempSync(join(tmpdir(), 'depfresh-registry-integration-'))
    tmpDirs.push(cwd)

    const homeDir = join(cwd, '.home')
    mkdirSync(homeDir, { recursive: true })

    const userNpmrc = join(homeDir, '.npmrc')
    writeFileSync(userNpmrc, '\n', 'utf-8')

    process.env.HOME = homeDir
    process.env.npm_config_userconfig = userNpmrc

    writeFileSync(
      join(cwd, 'package.json'),
      `${JSON.stringify(
        {
          name: 'integration-fixture',
          private: true,
          dependencies: input.dependencies,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    )

    writeFileSync(join(cwd, '.npmrc'), `${input.npmrcLines.join('\n')}\n`, 'utf-8')

    return cwd
  }
})

async function runCheck(
  cwd: string,
  overrides: Partial<depfreshOptions> = {},
): Promise<{ exitCode: number; payload: JsonEnvelope; rawOutput: string }> {
  const logs: string[] = []
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation((value) => {
    logs.push(String(value ?? ''))
  })

  try {
    vi.resetModules()
    const { check } = await import('./index')

    const options: depfreshOptions = {
      ...(DEFAULT_OPTIONS as depfreshOptions),
      cwd,
      mode: 'latest',
      output: 'json',
      loglevel: 'silent',
      failOnOutdated: true,
      timeout: 1_000,
      retries: 1,
      ...overrides,
    }

    const exitCode = await check(options)

    const rawOutput = logs.join('\n')
    const payload = JSON.parse(rawOutput) as JsonEnvelope

    return {
      exitCode,
      payload,
      rawOutput,
    }
  } finally {
    consoleSpy.mockRestore()
  }
}

async function startMockRegistry(routes: Record<string, MockRouteHandler>): Promise<MockRegistry> {
  const attempts = new Map<string, number>()
  const requests: RegistryRequest[] = []

  const server = createServer(async (req, res) => {
    const path = getPathname(req.url)
    const packageName = decodePackageName(path)
    const attempt = (attempts.get(packageName) ?? 0) + 1
    attempts.set(packageName, attempt)

    requests.push({
      packageName,
      path,
      headers: req.headers,
    })

    const route = routes[packageName]
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    const result = await route(attempt, req)
    const status = result.status ?? 200

    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result.body))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address() as AddressInfo | null
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start mock registry server')
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
    requests,
    count: (packageName: string) => attempts.get(packageName) ?? 0,
  }
}

function getPathname(url: string | undefined): string {
  return new URL(url ?? '/', 'http://registry.local').pathname
}

function decodePackageName(pathname: string): string {
  const trimmed = pathname.startsWith('/') ? pathname.slice(1) : pathname
  return decodeURIComponent(trimmed)
}

function npmMetadata(versions: string[]): Record<string, unknown> {
  const versionMap: Record<string, Record<string, unknown>> = {}

  for (const version of versions) {
    versionMap[version] = {}
  }

  return {
    versions: versionMap,
    'dist-tags': {
      latest: versions[versions.length - 1],
    },
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
