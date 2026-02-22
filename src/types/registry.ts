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
