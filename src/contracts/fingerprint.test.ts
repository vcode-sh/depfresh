import { describe, expect, it } from 'vitest'
import { createPlanFingerprint, createRepositoryFingerprint, hashExactBytes } from './fingerprint'

describe('contract fingerprints', () => {
  it('hashes exact bytes', () => {
    expect(hashExactBytes('a')).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    )
    expect(hashExactBytes('a\n')).not.toBe(hashExactBytes('a\r\n'))
  })

  it('sorts repository sources while retaining every semantic input', () => {
    const first = createRepositoryFingerprint({
      schemaVersion: 1,
      rootIdentity: 'repository-v1',
      sources: [
        { path: 'z/package.json', byteHash: 'b'.repeat(64) },
        { path: 'package.json', byteHash: 'a'.repeat(64) },
      ],
    })
    const reversed = createRepositoryFingerprint({
      schemaVersion: 1,
      rootIdentity: 'repository-v1',
      sources: [
        { path: 'package.json', byteHash: 'a'.repeat(64) },
        { path: 'z/package.json', byteHash: 'b'.repeat(64) },
      ],
    })

    expect(reversed).toBe(first)
    expect(() =>
      createRepositoryFingerprint({
        schemaVersion: 1,
        rootIdentity: 'repository-v1',
        sources: [{ path: '/absolute/package.json', byteHash: 'a'.repeat(64) }],
      }),
    ).toThrow(/relative/i)
    expect(() =>
      createRepositoryFingerprint({
        schemaVersion: 1,
        rootIdentity: 'repository-v1',
        sources: [{ path: 'C:/Users/alice/package.json', byteHash: 'a'.repeat(64) }],
      }),
    ).toThrow(/relative/i)
  })

  it('excludes only top-level volatile plan fields', () => {
    const base = {
      contract: 'depfresh.plan',
      schemaVersion: 1,
      generatedAt: 'first',
      presentation: { color: true },
      planFingerprint: 'untrusted',
      repository: { identity: 'root', nested: { generatedAt: 'semantic' } },
      operations: [{ occurrenceId: 'one', path: ['dependencies', 'a'] }],
    }
    const same = {
      ...base,
      generatedAt: 'second',
      presentation: { color: false },
      planFingerprint: 'different',
    }

    expect(createPlanFingerprint(same)).toBe(createPlanFingerprint(base))
    expect(
      createPlanFingerprint({
        ...base,
        repository: { identity: 'root', nested: { generatedAt: 'changed' } },
      }),
    ).not.toBe(createPlanFingerprint(base))
  })
})
