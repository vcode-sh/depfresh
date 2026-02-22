import type { DiffType, depfreshOptions, ResolvedDepChange } from '../../types'

export interface JsonPackage {
  name: string
  updates: Array<{
    name: string
    current: string
    target: string
    diff: string
    source: string
    deprecated?: string | boolean
    publishedAt?: string
    currentVersionTime?: string
  }>
}

interface JsonOutput {
  packages: JsonPackage[]
  summary: {
    total: number
    major: number
    minor: number
    patch: number
    packages: number
  }
  meta: {
    cwd: string
    mode: string
    timestamp: string
  }
}

export function buildJsonPackage(name: string, updates: ResolvedDepChange[]): JsonPackage {
  return {
    name,
    updates: updates.map((u) => ({
      name: u.name,
      current: u.currentVersion,
      target: u.targetVersion,
      diff: u.diff,
      source: u.source,
      ...(u.deprecated ? { deprecated: u.deprecated } : {}),
      ...(u.publishedAt ? { publishedAt: u.publishedAt } : {}),
      ...(u.currentVersionTime ? { currentVersionTime: u.currentVersionTime } : {}),
    })),
  }
}

export function outputJsonEnvelope(packages: JsonPackage[], options: depfreshOptions): void {
  const allUpdates = packages.flatMap((p) => p.updates)
  const count = (diff: DiffType) => allUpdates.filter((u) => u.diff === diff).length

  const output: JsonOutput = {
    packages,
    summary: {
      total: allUpdates.length,
      major: count('major'),
      minor: count('minor'),
      patch: count('patch'),
      packages: packages.length,
    },
    meta: {
      cwd: options.cwd,
      mode: options.mode,
      timestamp: new Date().toISOString(),
    },
  }

  // biome-ignore lint/suspicious/noConsole: intentional JSON output
  console.log(JSON.stringify(output, null, 2))
}
