import * as semver from 'semver'

interface ParsedProtocol {
  protocol?: 'npm' | 'jsr' | 'github' | 'workspace'
  currentVersion: string
  aliasName?: string
}

interface ParsedGithubSpec {
  aliasName: string
  currentVersion: string
}

export interface GithubRepositoryIdentity {
  owner: string
  repository: string
}

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u

export function parseGithubRepositoryIdentity(value: string): GithubRepositoryIdentity | null {
  const segments = value.split('/')
  if (segments.length !== 2) return null

  const [owner, repository] = segments
  if (!(owner && repository)) return null
  if (!GITHUB_OWNER_PATTERN.test(owner)) return null
  if (!GITHUB_REPOSITORY_PATTERN.test(repository)) return null
  if (repository === '.' || repository === '..') return null

  return { owner, repository }
}

export function parseGithubSpec(version: string): ParsedGithubSpec | null {
  const githubMatch = version.match(/^github:([^#]+)#(.+)$/)
  if (!githubMatch) {
    return null
  }

  const repository = githubMatch[1]
  const ref = githubMatch[2]?.trim()
  if (!(repository && ref && parseGithubRepositoryIdentity(repository))) {
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
  const workspaceMatch = version.match(/^workspace:(.*)$/)
  if (workspaceMatch) {
    return {
      protocol: 'workspace',
      currentVersion: workspaceMatch[1] ?? '',
    }
  }

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
