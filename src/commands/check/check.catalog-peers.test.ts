import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'

interface JsonEnvelope {
  summary: {
    total: number
  }
  packages: Array<{
    name: string
    updates: Array<{
      name: string
      source: string
    }>
  }>
}

const TEST_ENV_KEYS = ['HOME', 'npm_config_userconfig'] as const

describe('check catalog peers behavior', () => {
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

  it('skips peers catalog updates unless --peer is enabled', async () => {
    const registry = await startMockRegistry({
      react: {
        versions: { '18.0.0': {}, '19.0.0': {} },
        'dist-tags': { latest: '19.0.0' },
      },
    })
    servers.push(registry.server)

    const cwd = createWorkspace(registry.url)

    const withoutPeer = await runCheck(cwd, { peer: false })
    expect(withoutPeer.exitCode).toBe(0)
    expect(withoutPeer.payload.summary.total).toBe(0)

    const withPeer = await runCheck(cwd, { peer: true })
    expect(withPeer.exitCode).toBe(1)
    expect(withPeer.payload.summary.total).toBe(1)
    const updates = withPeer.payload.packages.flatMap((pkg) => pkg.updates)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.name).toBe('react')
    expect(updates[0]?.source).toBe('catalog')
  })

  function createWorkspace(registryUrl: string): string {
    const cwd = mkdtempSync(join(tmpdir(), 'depfresh-catalog-peers-'))
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
          name: 'catalog-peers-fixture',
          private: true,
          peerDependencies: {
            react: 'catalog:peers',
          },
        },
        null,
        2,
      )}\n`,
      'utf-8',
    )

    writeFileSync(
      join(cwd, 'pnpm-workspace.yaml'),
      "packages:\n  - '.'\ncatalogs:\n  peers:\n    react: ^18.0.0\n",
      'utf-8',
    )

    writeFileSync(join(cwd, '.npmrc'), `registry=${registryUrl}\n`, 'utf-8')

    return cwd
  }
})

async function runCheck(
  cwd: string,
  overrides: Partial<depfreshOptions>,
): Promise<{ exitCode: number; payload: JsonEnvelope }> {
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
      retries: 0,
      recursive: true,
      ...overrides,
    }

    const exitCode = await check(options)
    const payload = JSON.parse(logs.join('\n')) as JsonEnvelope
    return { exitCode, payload }
  } finally {
    consoleSpy.mockRestore()
  }
}

async function startMockRegistry(
  packages: Record<string, Record<string, unknown>>,
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const packageName = decodePackageName(req)
    const pkgData = packages[packageName]

    if (!pkgData) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(pkgData))
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
  }
}

function decodePackageName(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://registry.local')
  const trimmed = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
  return decodeURIComponent(trimmed)
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}
