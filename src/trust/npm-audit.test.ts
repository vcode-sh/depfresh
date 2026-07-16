import { describe, expect, it } from 'vitest'
import type { ArtifactVerificationTarget } from '../types'
import { classifyNpmAuditSignaturesFailure, parseNpmAuditSignatures } from './npm-audit'

const integrityBytes = Buffer.alloc(64, 7)
const integrity = `sha512-${integrityBytes.toString('base64')}`
const digest = integrityBytes.toString('hex')

const artifact: ArtifactVerificationTarget = {
  id: 'artifact-alpha',
  occurrenceIds: ['occurrence-alpha'],
  boundaryId: 'boundary-root',
  location: 'node_modules/alpha',
  packageName: 'alpha',
  version: '2.0.0',
  registry: 'https://registry.npmjs.org/',
  integrity,
  signaturePresence: 'present',
  provenancePresence: 'present',
}

function provenancePayload(overrides: Record<string, unknown> = {}): string {
  return Buffer.from(
    JSON.stringify({
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: 'pkg:npm/alpha@2.0.0', digest: { sha512: digest } }],
      predicateType: 'https://slsa.dev/provenance/v1',
      ...overrides,
    }),
  ).toString('base64')
}

function verified(payload = provenancePayload()) {
  return {
    invalid: [] as unknown[],
    missing: [] as unknown[],
    verified: [
      {
        name: 'alpha',
        version: '2.0.0',
        registry: 'https://registry.npmjs.org/',
        location: 'node_modules/alpha',
        attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } },
        attestationBundles: [
          {
            predicateType: 'https://slsa.dev/provenance/v1',
            bundle: { dsseEnvelope: { payload } },
          },
        ],
      },
    ],
  }
}

describe('parseNpmAuditSignatures', () => {
  it('binds verified provenance to the exact planned name, version, registry, and digest', () => {
    const result = parseNpmAuditSignatures(JSON.stringify(verified()), [artifact])

    expect(result).toEqual([
      expect.objectContaining({
        artifactId: artifact.id,
        signature: expect.objectContaining({
          state: 'unknown',
          reason: 'SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE',
        }),
        provenance: expect.objectContaining({ state: 'pass', reason: 'PROVENANCE_VERIFIED' }),
      }),
    ])
  })

  it.each([
    ['wrong version', { subject: [{ name: 'pkg:npm/alpha@1.0.0', digest: { sha512: digest } }] }],
    ['wrong package', { subject: [{ name: 'pkg:npm/beta@2.0.0', digest: { sha512: digest } }] }],
    [
      'wrong digest',
      { subject: [{ name: 'pkg:npm/alpha@2.0.0', digest: { sha512: '00'.repeat(32) } }] },
    ],
    ['missing subject', { subject: [] }],
    ['wrong statement type', { _type: 'https://example.invalid/Statement' }],
  ])('never passes provenance with a %s', (_name, statement) => {
    const result = parseNpmAuditSignatures(JSON.stringify(verified(provenancePayload(statement))), [
      artifact,
    ])
    expect(result[0]?.provenance).toMatchObject({
      state: 'unknown',
      reason: 'PROVENANCE_ARTIFACT_MISMATCH',
    })
  })

  it('keeps exact signature and provenance failures independent', () => {
    const output = verified()
    output.invalid.push({
      code: 'EINTEGRITYSIGNATURE',
      name: 'alpha',
      version: '2.0.0',
      registry: 'https://registry.npmjs.org/',
      location: 'node_modules/alpha',
      integrity,
    })
    const [result] = parseNpmAuditSignatures(JSON.stringify(output), [artifact])
    expect(result?.signature).toMatchObject({ state: 'fail', reason: 'SIGNATURE_INVALID' })
    expect(result?.provenance).toMatchObject({ state: 'pass', reason: 'PROVENANCE_VERIFIED' })
  })

  it('maps exact missing signatures and absent provenance without inventing trust', () => {
    const target = { ...artifact, provenancePresence: 'absent' as const }
    const [result] = parseNpmAuditSignatures(
      JSON.stringify({
        invalid: [],
        missing: [
          {
            name: 'alpha',
            version: '2.0.0',
            registry: 'https://registry.npmjs.org/',
            location: 'node_modules/alpha',
            integrity,
          },
        ],
        verified: [],
      }),
      [target],
    )
    expect(result?.signature).toMatchObject({ state: 'fail', reason: 'SIGNATURE_MISSING' })
    expect(result?.provenance).toMatchObject({
      state: 'not-applicable',
      reason: 'PROVENANCE_NOT_PRESENT',
    })
  })

  it('never accepts a record from another installed location', () => {
    const output = verified()
    output.verified[0]!.location = 'node_modules/other/node_modules/alpha'

    const [result] = parseNpmAuditSignatures(JSON.stringify(output), [artifact])

    expect(result?.provenance).toMatchObject({
      state: 'unknown',
      reason: 'PROVENANCE_VERIFICATION_UNAVAILABLE',
    })
  })

  it('accounts for each exact installed location independently', () => {
    const nested = { ...artifact, location: 'packages/a/node_modules/alpha' }
    const output = verified()
    output.verified.push({
      ...structuredClone(output.verified[0]!),
      location: nested.location,
    })

    const result = parseNpmAuditSignatures(JSON.stringify(output), [artifact, nested])

    expect(result).toEqual([
      expect.objectContaining({
        location: artifact.location,
        provenance: expect.objectContaining({ state: 'pass' }),
      }),
      expect.objectContaining({
        location: nested.location,
        provenance: expect.objectContaining({ state: 'pass' }),
      }),
    ])
  })

  it('never passes duplicated provenance records for one location', () => {
    const output = verified()
    output.verified.push(structuredClone(output.verified[0]!))

    const [result] = parseNpmAuditSignatures(JSON.stringify(output), [artifact])

    expect(result?.provenance).toMatchObject({
      state: 'unknown',
      reason: 'PROVENANCE_VERIFICATION_UNAVAILABLE',
    })
  })

  it('requires exact integrity before applying an invalid signature record', () => {
    const output = verified()
    output.invalid.push({
      code: 'EINTEGRITYSIGNATURE',
      name: artifact.packageName,
      version: artifact.version,
      registry: artifact.registry,
      location: artifact.location,
      integrity: `sha512-${Buffer.alloc(64, 8).toString('base64')}`,
    })

    const [result] = parseNpmAuditSignatures(JSON.stringify(output), [artifact])

    expect(result?.signature).toMatchObject({
      state: 'unknown',
      reason: 'SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE',
    })
  })

  it('keeps an exact invalid provenance result independent from signature truth', () => {
    const output = verified()
    output.invalid.push({
      code: 'EATTESTATIONVERIFY',
      name: artifact.packageName,
      version: artifact.version,
      registry: artifact.registry,
      location: artifact.location,
      integrity,
    })

    const [result] = parseNpmAuditSignatures(JSON.stringify(output), [artifact])

    expect(result?.signature.state).toBe('unknown')
    expect(result?.provenance).toMatchObject({ state: 'fail', reason: 'PROVENANCE_INVALID' })
  })

  it('rejects verifier output above the private capture contract', () => {
    expect(() => parseNpmAuditSignatures('x'.repeat(8 * 1024 * 1024 + 1), [artifact])).toThrow(
      /verifier output/u,
    )
  })

  it.each(['not json', '{}', '{"invalid":[],"missing":[],"verified":"yes"}'])(
    'rejects malformed or incomplete verifier output',
    (output) => {
      expect(() => parseNpmAuditSignatures(output, [artifact])).toThrow(/verifier output/u)
    },
  )

  it.each([
    ['offline', 'ENETUNREACH'],
    ['offline', 'EAI_AGAIN'],
    ['stale', 'EEXPIREDSIGNATUREKEY'],
    ['error', 'EUNKNOWN'],
  ] as const)(
    'classifies a structured %s verifier failure without exposing details',
    (kind, code) => {
      expect(classifyNpmAuditSignaturesFailure(JSON.stringify({ error: { code } }))).toBe(kind)
    },
  )
})
