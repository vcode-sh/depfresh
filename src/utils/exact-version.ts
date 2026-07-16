import * as semver from 'semver'

export function exactDeclaredVersion(value: string | undefined, role?: string): string | undefined {
  if (!value) return undefined
  let normalized = value
  if (role === 'package-manager') {
    const separator = normalized.lastIndexOf('@')
    if (separator < 1) return undefined
    normalized = normalized.slice(separator + 1).split('+', 1)[0] ?? ''
  }
  if (normalized.startsWith('workspace:')) normalized = normalized.slice('workspace:'.length)
  if (normalized.startsWith('npm:') || normalized.startsWith('jsr:')) {
    const separator = normalized.lastIndexOf('@')
    if (separator < 4) return undefined
    normalized = normalized.slice(separator + 1)
  }
  if (normalized.startsWith('=')) normalized = normalized.slice(1)
  return semver.valid(normalized) ?? undefined
}
