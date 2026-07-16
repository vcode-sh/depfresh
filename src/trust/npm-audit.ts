import type {
  ArtifactTrustDimensionResult,
  ArtifactTrustResult,
  ArtifactVerificationTarget,
} from '../types'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_RECORDS = 10_000
const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1'

interface AuditRecord {
  code?: string
  name: string
  version: string
  registry: string
  location: string
  integrity?: string
  attestations?: { provenance?: { predicateType?: string } }
  attestationBundles?: Array<{
    predicateType?: string
    bundle?: { dsseEnvelope?: { payload?: string } }
  }>
}

interface AuditOutput {
  invalid: AuditRecord[]
  missing: AuditRecord[]
  verified: AuditRecord[]
}

export function parseNpmAuditSignatures(
  stdout: string,
  artifacts: readonly ArtifactVerificationTarget[],
): ArtifactTrustResult[] {
  const output = parseOutput(stdout)
  return artifacts.map((artifact) => ({
    artifactId: artifact.id,
    location: artifact.location,
    signature: signatureResult(output, artifact),
    provenance: provenanceResult(output, artifact),
  }))
}

export function classifyNpmAuditSignaturesFailure(stdout: string): 'offline' | 'stale' | 'error' {
  try {
    const parsed: unknown = JSON.parse(stdout)
    const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined
    const code = error && typeof error.code === 'string' ? error.code : undefined
    if (
      code &&
      ['ENETUNREACH', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)
    ) {
      return 'offline'
    }
    if (code === 'EEXPIREDSIGNATUREKEY') return 'stale'
  } catch {}
  return 'error'
}

function signatureResult(
  output: AuditOutput,
  artifact: ArtifactVerificationTarget,
): ArtifactTrustDimensionResult {
  if (
    output.invalid.some(
      (record) => record.code === 'EINTEGRITYSIGNATURE' && matchesArtifact(record, artifact),
    )
  ) {
    return { state: 'fail', reason: 'SIGNATURE_INVALID' }
  }
  if (output.missing.some((record) => matchesArtifact(record, artifact))) {
    return { state: 'fail', reason: 'SIGNATURE_MISSING' }
  }
  return { state: 'unknown', reason: 'SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE' }
}

function provenanceResult(
  output: AuditOutput,
  artifact: ArtifactVerificationTarget,
): ArtifactTrustDimensionResult {
  if (
    output.invalid.some(
      (record) => record.code === 'EATTESTATIONVERIFY' && matchesArtifact(record, artifact),
    )
  ) {
    return { state: 'fail', reason: 'PROVENANCE_INVALID' }
  }
  if (artifact.provenancePresence === 'absent') {
    return { state: 'not-applicable', reason: 'PROVENANCE_NOT_PRESENT' }
  }
  const matching = output.verified.filter((record) => matchesIdentity(record, artifact))
  if (matching.length !== 1) {
    return {
      state: 'unknown',
      reason:
        artifact.provenancePresence === 'present'
          ? 'PROVENANCE_VERIFICATION_UNAVAILABLE'
          : 'PROVENANCE_PRESENCE_UNKNOWN',
    }
  }
  return hasExactProvenanceSubject(matching[0]!, artifact)
    ? { state: 'pass', reason: 'PROVENANCE_VERIFIED' }
    : { state: 'unknown', reason: 'PROVENANCE_ARTIFACT_MISMATCH' }
}

function hasExactProvenanceSubject(
  record: AuditRecord,
  artifact: ArtifactVerificationTarget,
): boolean {
  if (record.attestations?.provenance?.predicateType !== PROVENANCE_PREDICATE) return false
  const bundles = (record.attestationBundles ?? []).filter(
    (bundle) => bundle.predicateType === PROVENANCE_PREDICATE,
  )
  if (bundles.length !== 1) return false
  const payload = bundles[0]?.bundle?.dsseEnvelope?.payload
  if (!(payload && payload.length <= 512 * 1024)) return false
  try {
    const decoded = Buffer.from(payload, 'base64')
    if (decoded.toString('base64').replace(/=+$/u, '') !== payload.replace(/=+$/u, '')) return false
    const statement: unknown = JSON.parse(decoded.toString('utf8'))
    if (
      !isRecord(statement) ||
      statement._type !== 'https://in-toto.io/Statement/v1' ||
      statement.predicateType !== PROVENANCE_PREDICATE
    ) {
      return false
    }
    const subjects = statement.subject
    if (!Array.isArray(subjects) || subjects.length !== 1 || !isRecord(subjects[0])) return false
    const subject = subjects[0]
    const digest = isRecord(subject.digest) ? subject.digest.sha512 : undefined
    return subject.name === artifactPurl(artifact) && digest === integrityHex(artifact.integrity)
  } catch {
    return false
  }
}

function artifactPurl(artifact: ArtifactVerificationTarget): string {
  const name = artifact.packageName.startsWith('@')
    ? `%40${artifact.packageName.slice(1)}`
    : artifact.packageName
  return `pkg:npm/${name}@${artifact.version}`
}

function integrityHex(integrity: string): string | undefined {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(integrity)
  if (!match?.[1]) return undefined
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length !== 64 || bytes.toString('base64') !== match[1]) return undefined
  return bytes.toString('hex')
}

function matchesArtifact(record: AuditRecord, artifact: ArtifactVerificationTarget): boolean {
  return matchesIdentity(record, artifact) && record.integrity === artifact.integrity
}

function matchesIdentity(record: AuditRecord, artifact: ArtifactVerificationTarget): boolean {
  return (
    record.name === artifact.packageName &&
    record.version === artifact.version &&
    record.registry === artifact.registry &&
    record.location === artifact.location
  )
}

function parseOutput(stdout: string): AuditOutput {
  if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) throw invalidOutput()
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw invalidOutput()
  }
  if (!isRecord(parsed)) throw invalidOutput()
  const invalid = parseRecords(parsed.invalid)
  const missing = parseRecords(parsed.missing)
  const verified = parseRecords(parsed.verified)
  if (!(invalid && missing && verified)) throw invalidOutput()
  return { invalid, missing, verified }
}

function parseRecords(value: unknown): AuditRecord[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) return undefined
  const records: AuditRecord[] = []
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.name !== 'string' ||
      typeof item.version !== 'string' ||
      typeof item.registry !== 'string' ||
      typeof item.location !== 'string'
    ) {
      return undefined
    }
    records.push(item as unknown as AuditRecord)
  }
  return records
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidOutput(): Error {
  return new Error('Invalid npm verifier output')
}
