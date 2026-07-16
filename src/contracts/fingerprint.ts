import { createHash } from 'node:crypto'
import { isAbsolute, posix, win32 } from 'node:path'
import { canonicalJson } from './canonical-json'

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

export interface RepositoryFingerprintSource {
  path: string
  byteHash: string
}

export interface RepositoryFingerprintInput {
  schemaVersion: number
  rootIdentity: string
  sources: RepositoryFingerprintSource[]
}

export function hashExactBytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertRepositoryRelativePath(path: string): void {
  const normalized = posix.normalize(path)
  if (
    path.length === 0 ||
    path.includes('\\') ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    normalized !== path ||
    path === '..' ||
    path.startsWith('../')
  ) {
    throw new TypeError(
      `Fingerprint source path must be canonical and repository-relative: ${path}`,
    )
  }
}

export function createRepositoryFingerprint(input: RepositoryFingerprintInput): string {
  const seen = new Set<string>()
  const sources = input.sources
    .map((source) => {
      assertRepositoryRelativePath(source.path)
      if (!SHA256_PATTERN.test(source.byteHash)) {
        throw new TypeError(`Invalid SHA-256 source hash for ${source.path}`)
      }
      if (seen.has(source.path)) {
        throw new TypeError(`Duplicate fingerprint source path: ${source.path}`)
      }
      seen.add(source.path)
      return { path: source.path, byteHash: source.byteHash }
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

  return hashExactBytes(
    canonicalJson({
      schemaVersion: input.schemaVersion,
      rootIdentity: input.rootIdentity,
      sources,
    }),
  )
}

export function createPlanFingerprint(plan: object): string {
  const {
    planFingerprint: _planFingerprint,
    generatedAt: _generatedAt,
    presentation: _presentation,
    ...semanticPlan
  } = plan as Record<string, unknown>
  return hashExactBytes(canonicalJson(semanticPlan))
}
