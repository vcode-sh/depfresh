import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { depfreshOptions, PackageMeta } from '../../types'
import { DEFAULT_OPTIONS } from '../../types'
import type { Logger } from '../../utils/logger'
import { discoverPackages } from './discovery'

const loadPackageMock = vi.hoisted(() => vi.fn())
const loadCatalogsMock = vi.hoisted(() => vi.fn())

vi.mock('./load-package', () => ({ loadPackage: loadPackageMock }))
vi.mock('../catalogs/index', () => ({ loadCatalogs: loadCatalogsMock }))

function createTestLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn()
  return {
    logger: {
      info: vi.fn(),
      warn,
      error: vi.fn(),
      debug: vi.fn(),
      success: vi.fn(),
    },
    warn,
  }
}

function makePackage(filepath: string): PackageMeta {
  return {
    name: 'fixture',
    type: 'package.json',
    filepath,
    deps: [],
    resolved: [],
    raw: {},
    indent: '  ',
  }
}

function makeCredentialError(message: string, stackSentinel: string): Error {
  const error = new Error(message)
  error.stack = `${stackSentinel}\n    at raw-discovery-boundary (${message})`
  return error
}

function expectSafeWarning(
  warn: ReturnType<typeof vi.fn>,
  secret: string,
  stackSentinel: string,
): void {
  const args = warn.mock.calls.flat()
  const consoleLikeOutput = args
    .map((value) => (value instanceof Error ? (value.stack ?? value.message) : String(value)))
    .join(' ')

  expect(args.some((value) => value instanceof Error)).toBe(false)
  expect(consoleLikeOutput).toContain('[REDACTED]')
  expect(consoleLikeOutput).not.toContain(secret)
  expect(consoleLikeOutput).not.toContain(stackSentinel)
}

describe('discovery error redaction', () => {
  let root: string

  beforeEach(() => {
    vi.clearAllMocks()
    root = mkdtempSync(join(tmpdir(), 'depfresh-discovery-redaction-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
    loadCatalogsMock.mockResolvedValue([])
    loadPackageMock.mockImplementation((filepath: string) => makePackage(filepath))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('redacts package manifest load failures before warning output', async () => {
    const secret = 'package-manifest-secret'
    const stackSentinel = 'PACKAGE_MANIFEST_RAW_STACK'
    loadPackageMock.mockImplementation(() => {
      throw makeCredentialError(`Authorization: Bearer ${secret}`, stackSentinel)
    })
    const { logger, warn } = createTestLogger()

    await expect(
      discoverPackages(
        { ...DEFAULT_OPTIONS, cwd: root, recursive: true } as depfreshOptions,
        undefined,
        logger,
      ),
    ).resolves.toEqual([])

    expectSafeWarning(warn, secret, stackSentinel)
  })

  it('redacts workspace catalog load failures before warning output', async () => {
    const secret = 'workspace-catalog-secret'
    const stackSentinel = 'WORKSPACE_CATALOG_RAW_STACK'
    loadCatalogsMock.mockRejectedValue(makeCredentialError(`NPM_TOKEN=${secret}`, stackSentinel))
    const { logger, warn } = createTestLogger()

    await expect(
      discoverPackages(
        { ...DEFAULT_OPTIONS, cwd: root, recursive: true } as depfreshOptions,
        undefined,
        logger,
      ),
    ).resolves.toEqual([expect.objectContaining({ name: 'fixture' })])

    expectSafeWarning(warn, secret, stackSentinel)
  })
})
