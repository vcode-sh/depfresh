import type { PassivePresence } from './registry'
import type { SignalReason, SignalState } from './signals'

export interface ArtifactVerificationTarget {
  id: string
  occurrenceIds: string[]
  boundaryId: string
  location: string
  packageName: string
  version: string
  registry: 'https://registry.npmjs.org/'
  integrity: string
  signaturePresence: PassivePresence
  provenancePresence: PassivePresence
}

export interface ArtifactTrustDimensionResult {
  state: SignalState
  reason: SignalReason
}

export interface ArtifactTrustResult {
  artifactId: string
  location: string
  signature: ArtifactTrustDimensionResult
  provenance: ArtifactTrustDimensionResult
}
