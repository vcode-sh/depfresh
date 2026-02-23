export function rebuildVersion(original: string, newVersion: string): string {
  // Preserve protocol prefixes like npm:@scope/name@
  const npmMatch = original.match(/^(npm:.+@)/)
  if (npmMatch) return `${npmMatch[1]}${newVersion}`

  const jsrMatch = original.match(/^(jsr:.+@)/)
  if (jsrMatch) return `${jsrMatch[1]}${newVersion}`

  // Preserve GitHub ref format, including optional refs/tags/ and v prefix
  const githubMatch = original.match(/^(github:[^#]+#)(refs\/tags\/)?(v?)(.+)$/)
  if (githubMatch) {
    const [, prefix, tagPrefix = '', vPrefix = ''] = githubMatch
    return `${prefix}${tagPrefix}${vPrefix}${newVersion}`
  }

  return newVersion
}
