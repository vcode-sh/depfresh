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

export interface JsonExecutionState {
  scannedPackages: number
  packagesWithUpdates: number
  plannedUpdates: number
  appliedUpdates: number
  revertedUpdates: number
  noPackagesFound: boolean
  didWrite: boolean
}

interface JsonOutput {
  packages: JsonPackage[]
  summary: {
    total: number
    major: number
    minor: number
    patch: number
    packages: number
    scannedPackages: number
    packagesWithUpdates: number
    plannedUpdates: number
    appliedUpdates: number
    revertedUpdates: number
  }
  meta: {
    schemaVersion: number
    cwd: string
    mode: string
    timestamp: string
    noPackagesFound: boolean
    didWrite: boolean
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

export function outputJsonEnvelope(
  packages: JsonPackage[],
  options: depfreshOptions,
  executionState: JsonExecutionState,
): void {
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
      scannedPackages: executionState.scannedPackages,
      packagesWithUpdates: executionState.packagesWithUpdates,
      plannedUpdates: executionState.plannedUpdates,
      appliedUpdates: executionState.appliedUpdates,
      revertedUpdates: executionState.revertedUpdates,
    },
    meta: {
      schemaVersion: 1,
      cwd: options.cwd,
      mode: options.mode,
      timestamp: new Date().toISOString(),
      noPackagesFound: executionState.noPackagesFound,
      didWrite: executionState.didWrite,
    },
  }

  // biome-ignore lint/suspicious/noConsole: intentional JSON output
  console.log(JSON.stringify(output, null, 2))
}
