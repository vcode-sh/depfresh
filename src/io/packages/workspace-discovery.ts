import { existsSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { parsePnpmWorkspaceYaml } from 'pnpm-workspace-yaml'
import YAML from 'yaml'

const ROOT_MANIFESTS = ['package.json', 'package.yaml'] as const

export interface WorkspaceDiscoveryResult {
  patterns: string[]
  source: 'pnpm-workspace' | 'manifest-workspaces'
}

export function getWorkspaceManifestPatterns(rootDir: string): WorkspaceDiscoveryResult | null {
  const pnpmWorkspacePath = join(rootDir, 'pnpm-workspace.yaml')
  if (existsSync(pnpmWorkspacePath)) {
    try {
      const content = readFileSync(pnpmWorkspacePath, 'utf-8')
      const workspace = parsePnpmWorkspaceYaml(content).toJSON()
      const patterns = normalizeWorkspacePatterns(workspace.packages)
      if (patterns.length > 0) {
        return {
          patterns: buildManifestPatterns(patterns),
          source: 'pnpm-workspace',
        }
      }
    } catch {
      // Fall through to manifest-based workspaces.
    }
  }

  const rootManifest = readRootManifest(rootDir)
  if (!rootManifest) {
    return null
  }

  const patterns = extractManifestWorkspacePatterns(rootManifest)
  if (patterns.length === 0) {
    return null
  }

  return {
    patterns: buildManifestPatterns(patterns),
    source: 'manifest-workspaces',
  }
}

function readRootManifest(rootDir: string): Record<string, unknown> | null {
  for (const filename of ROOT_MANIFESTS) {
    const filepath = join(rootDir, filename)
    if (!existsSync(filepath)) continue

    try {
      const content = readFileSync(filepath, 'utf-8')
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
