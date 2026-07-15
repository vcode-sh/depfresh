import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { join } from 'pathe'
import { parsePnpmWorkspaceYaml } from 'pnpm-workspace-yaml'
import YAML from 'yaml'
import type { ContainmentReason } from './containment'
import { resolveContainedPath } from './containment'

const ROOT_MANIFESTS = ['package.json', 'package.yaml'] as const

export interface WorkspaceDiscoveryResult {
  patterns: string[]
  source: 'pnpm-workspace' | 'manifest-workspaces' | null
  blockedPatterns: Array<{ pattern: string; reason: WorkspacePatternReason }>
  blockedPaths: Array<{ path: string; reason: ContainmentReason }>
}

export type WorkspacePatternReason = 'ABSOLUTE_PATTERN' | 'PARENT_TRAVERSAL'

export function getWorkspaceManifestPatterns(rootDir: string): WorkspaceDiscoveryResult {
  const blockedPaths: WorkspaceDiscoveryResult['blockedPaths'] = []
  const pnpmWorkspacePath = join(rootDir, 'pnpm-workspace.yaml')
  if (existsSync(pnpmWorkspacePath)) {
    const contained = resolveContainedPath(rootDir, pnpmWorkspacePath)
    if (contained.allowed) {
      try {
        const content = readFileSync(contained.path, 'utf-8')
        const workspace = parsePnpmWorkspaceYaml(content).toJSON()
        const result = sanitizeWorkspacePatterns(normalizeWorkspacePatterns(workspace.packages))
        if (result.patterns.length > 0 || result.blockedPatterns.length > 0) {
          return {
            patterns: buildManifestPatterns(result.patterns),
            source: 'pnpm-workspace',
            blockedPatterns: result.blockedPatterns,
            blockedPaths,
          }
        }
      } catch {
        // Fall through to manifest-based workspaces.
      }
    } else {
      blockedPaths.push({ path: pnpmWorkspacePath, reason: contained.reason })
    }
  }

  const rootManifest = readRootManifest(rootDir, blockedPaths)
  if (!rootManifest) {
    return { patterns: [], source: null, blockedPatterns: [], blockedPaths }
  }

  const result = sanitizeWorkspacePatterns(extractManifestWorkspacePatterns(rootManifest))
  if (result.patterns.length === 0 && result.blockedPatterns.length === 0) {
    return {
      patterns: [],
      source: null,
      blockedPatterns: result.blockedPatterns,
      blockedPaths,
    }
  }

  return {
    patterns: buildManifestPatterns(result.patterns),
    source: 'manifest-workspaces',
    blockedPatterns: result.blockedPatterns,
    blockedPaths,
  }
}

function readRootManifest(
  rootDir: string,
  blockedPaths: WorkspaceDiscoveryResult['blockedPaths'],
): Record<string, unknown> | null {
  for (const filename of ROOT_MANIFESTS) {
    const filepath = join(rootDir, filename)
    if (!existsSync(filepath)) continue

    const contained = resolveContainedPath(rootDir, filepath)
    if (!contained.allowed) {
      blockedPaths.push({ path: filepath, reason: contained.reason })
      continue
    }

    try {
      const content = readFileSync(contained.path, 'utf-8')
      if (filename.endsWith('.yaml')) {
        const doc = YAML.parseDocument(content)
        if (doc.errors.length > 0) return null
        const parsed = doc.toJSON()
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
      }

      return JSON.parse(content) as Record<string, unknown>
    } catch {
      return null
    }
  }

  return null
}

function sanitizeWorkspacePatterns(patterns: string[]): {
  patterns: string[]
  blockedPatterns: WorkspaceDiscoveryResult['blockedPatterns']
} {
  const safePatterns: string[] = []
  const blockedPatterns: WorkspaceDiscoveryResult['blockedPatterns'] = []

  for (const pattern of patterns) {
    const body = pattern.startsWith('!') ? pattern.slice(1) : pattern
    if (isAbsoluteWorkspacePattern(body)) {
      blockedPatterns.push({ pattern, reason: 'ABSOLUTE_PATTERN' })
    } else if (body.split(/[\\/]+/u).includes('..')) {
      blockedPatterns.push({ pattern, reason: 'PARENT_TRAVERSAL' })
    } else {
      safePatterns.push(pattern)
    }
  }

  return { patterns: safePatterns, blockedPatterns }
}

function isAbsoluteWorkspacePattern(pattern: string): boolean {
  return isAbsolute(pattern) || pattern.startsWith('\\\\') || /^[A-Za-z]:[\\/]/u.test(pattern)
}

function extractManifestWorkspacePatterns(raw: Record<string, unknown>): string[] {
  const workspaces = raw.workspaces
  if (Array.isArray(workspaces)) {
    return normalizeWorkspacePatterns(workspaces)
  }

  if (workspaces && typeof workspaces === 'object') {
    const packages = (workspaces as Record<string, unknown>).packages
    if (Array.isArray(packages)) {
      return normalizeWorkspacePatterns(packages)
    }
  }

  return []
}

function normalizeWorkspacePatterns(input: unknown): string[] {
  if (!Array.isArray(input)) return []

  return input.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  )
}

function buildManifestPatterns(workspacePatterns: string[]): string[] {
  const manifestPatterns: string[] = [...ROOT_MANIFESTS]

  for (const pattern of workspacePatterns) {
    const negated = pattern.startsWith('!')
    const body = negated ? pattern.slice(1) : pattern
    const normalized = body.endsWith('/') ? body.slice(0, -1) : body

    if (normalized.endsWith('package.json') || normalized.endsWith('package.yaml')) {
      manifestPatterns.push(pattern)
      continue
    }

    for (const manifest of ROOT_MANIFESTS) {
      const candidate = `${normalized}/${manifest}`
      manifestPatterns.push(negated ? `!${candidate}` : candidate)
    }
  }

  return manifestPatterns
}
