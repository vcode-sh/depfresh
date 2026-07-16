export type PassivePresence = 'present' | 'absent' | 'unknown'
export type SignaturePresence = PassivePresence

/** @deprecated Legacy caller input only; labels do not prove provenance or trust. */
export type ProvenanceLevel = 'trusted' | 'attested' | 'none'

export interface PackageData {
  name: string
  versions: string[]
  distTags: Record<string, string>
  time?: Record<string, string>
  deprecated?: Record<string, string>
  description?: string
  homepage?: string
  repository?: string
  signaturePresence?: Record<string, SignaturePresence>
  provenancePresence?: Record<string, PassivePresence>
  artifactIntegrity?: Record<string, string>
  registry?: string
  deprecationPresence?: Record<string, PassivePresence>
  engineMetadata?: Record<string, PassivePresence>
  peerDependencies?: Record<string, Record<string, string>>
  optionalPeerDependencies?: Record<string, string[]>
  peerMetadata?: Record<string, PassivePresence>
  /** @deprecated Legacy caller input only. Use provenancePresence for passive evidence. */
  provenance?: Record<string, ProvenanceLevel>
  engines?: Record<string, string>
}

export interface RegistryConfig {
  url: string
  token?: string
  authType?: 'bearer' | 'basic'
  scope?: string
}

export interface NpmrcConfig {
  registries: Map<string, RegistryConfig>
  defaultRegistry: string
  proxy?: string
  httpsProxy?: string
  strictSsl: boolean
  cafile?: string
}
