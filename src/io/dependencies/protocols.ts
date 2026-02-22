export function parseProtocol(version: string): { protocol?: string; currentVersion: string } {
  // npm:@scope/name@version or npm:name@version
  const npmMatch = version.match(/^npm:(.+)@(.+)$/)
  if (npmMatch) {
    return { protocol: 'npm', currentVersion: npmMatch[2]! }
  }

  // jsr:@scope/name@version
  const jsrMatch = version.match(/^jsr:(.+)@(.+)$/)
  if (jsrMatch) {
    return { protocol: 'jsr', currentVersion: jsrMatch[2]! }
  }

  return { currentVersion: version }
}
