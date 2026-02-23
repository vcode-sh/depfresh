import * as semver from 'semver'

interface ParsedProtocol {
  protocol?: 'npm' | 'jsr' | 'github'
  currentVersion: string
  aliasName?: string
}

interface ParsedGithubSpec {
  aliasName: string
  currentVersion: string
}

export function parseGithubSpec(version: string): ParsedGithubSpec | null {
  const githubMatch = version.match(/^github:([^#]+)#(.+)$/)
  if (!githubMatch) {
    return null
  }

  const repository = githubMatch[1]?.trim()
  const ref = githubMatch[2]?.trim()
  if (!(repository && ref)) {
    return null
  }

  const withoutTagPrefix = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : ref
  const normalized = withoutTagPrefix.startsWith('v') ? withoutTagPrefix.slice(1) : withoutTagPrefix

  const valid = semver.valid(normalized)
  if (!valid) {
    return null
  }

  return {
    aliasName: `github:${repository}`,
    currentVersion: valid,
  }
}

export function parseProtocol(version: string): ParsedProtocol {
  // npm:@scope/name@version or npm:name@version
  const npmMatch = version.match(/^npm:(.+)@(.+)$/)
  if (npmMatch) {
    return {
      protocol: 'npm',
      aliasName: npmMatch[1]!,
      currentVersion: npmMatch[2]!,
    }
  }

  // jsr:@scope/name@version
  const jsrMatch = version.match(/^jsr:(.+)@(.+)$/)
  if (jsrMatch) {
    return {
      protocol: 'jsr',
      aliasName: `jsr:${jsrMatch[1]!}`,
      currentVersion: jsrMatch[2]!,
    }
  }

  const githubSpec = parseGithubSpec(version)
  if (githubSpec) {
    return {
      protocol: 'github',
      aliasName: githubSpec.aliasName,
      currentVersion: githubSpec.currentVersion,
    }
  }

  return { currentVersion: version }
}
