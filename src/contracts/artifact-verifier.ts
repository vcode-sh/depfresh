export const NPM_ARTIFACT_VERIFIER_SUPPORT = {
  manager: 'npm',
  versionRange: '>=11.12.0 <12.0.0 || >=12.0.0 <12.1.0',
  registry: 'https://registry.npmjs.org/',
  integrity: 'sha512',
} as const

export const EXACT_SHA512_INTEGRITY_PATTERN = '^sha512-[A-Za-z0-9+/]+={0,2}$'
export const EXACT_SHA512_INTEGRITY_REGEX = /^sha512-([A-Za-z0-9+/]+={0,2})$/u
