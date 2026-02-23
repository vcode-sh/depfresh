import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'

interface JsonEnvelope {
  summary: {
    total: number
    appliedUpdates: number
  }
  packages: Array<{
    updates: Array<{
      name: string
      current: string
      target: string
      source: string
    }>
  }>
}

describe('check github dependency integration', () => {
  const tmpDirs: string[] = []
  const originalFetch = globalThis.fetch

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch

    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves and writes github semver-tag dependencies', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'depfresh-github-integration-'))
    tmpDirs.push(cwd)

    writeFileSync(
      join(cwd, 'package.json'),
      `${JSON.stringify(
        {
          name: 'github-fixture',
          private: true,
          dependencies: {
            'uWebSockets.js': 'github:uNetworking/uWebSockets.js#v20.51.0',
          },
        },
        null,
        2,
      )}\n`,
      'utf-8',
    )

    globalThis.fetch = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input)
      if (
        url === 'https://api.github.com/repos/uNetworking/uWebSockets.js/tags?per_page=100&page=1'
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          json: async () => [{ name: 'v20.51.0' }, { name: 'v20.52.0' }],
        } satisfies Partial<Response>)
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        json: async () => ({ message: 'not found' }),
      } satisfies Partial<Response>)
    }) as typeof globalThis.fetch

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
        includeLocked: true,
        write: true,
        retries: 0,
      }

      const exitCode = await check(options)
      const payload = JSON.parse(logs.join('\n')) as JsonEnvelope

      expect(exitCode).toBe(0)
      expect(payload.summary.total).toBe(1)
      expect(payload.summary.appliedUpdates).toBe(1)
      expect(payload.packages[0]?.updates[0]).toEqual({
        name: 'uWebSockets.js',
        current: '20.51.0',
        target: '20.52.0',
        diff: 'minor',
        source: 'dependencies',
      })

      const updated = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as {
        dependencies: Record<string, string>
      }
      expect(updated.dependencies['uWebSockets.js']).toBe(
        'github:uNetworking/uWebSockets.js#v20.52.0',
      )
    } finally {
      consoleSpy.mockRestore()
    }
  })
})
