import type {
  DiffType,
  DiscoveryReport,
  depfreshOptions,
  ProfileReport,
  ResolvedDepChange,
  WriteOutcome,
} from '../../types'
import { getSafeErrorDetails, redactSensitiveText } from '../../utils/redact'

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

export interface JsonError {
  name: string
  source: string
  currentVersion: string
  message: string
}

export interface JsonExecutionState {
  scannedPackages: number
  packagesWithUpdates: number
  plannedUpdates: number
  appliedUpdates: number
  revertedUpdates: number
  skippedUpdates: number
  conflictedUpdates: number
  failedWrites: number
  unknownWrites: number
  writeOutcomes: WriteOutcome[]
  failedResolutions: number
  noPackagesFound: boolean
  didWrite: boolean
}

interface JsonOutput {
  packages: JsonPackage[]
  errors: JsonError[]
  writeOutcomes: WriteOutcome[]
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
    skippedUpdates: number
    conflictedUpdates: number
    failedWrites: number
    unknownWrites: number
    failedResolutions: number
  }
  meta: {
    schemaVersion: number
    cwd: string
    effectiveRoot: string
    mode: string
    timestamp: string
    noPackagesFound: boolean
    hadResolutionErrors: boolean
    didWrite: boolean
  }
  discovery?: DiscoveryReport
  profile?: ProfileReport
}

interface JsonErrorOutput {
  error: {
    code: string
    reason: string
    message: string
    retryable: boolean
  }
  meta: {
    schemaVersion: number
    cwd: string
    mode: string
    timestamp: string
  }
}

const RETRYABLE_CODES = new Set(['ERR_REGISTRY', 'ERR_CACHE'])

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
  errors: JsonError[] = [],
): void {
  const allUpdates = packages.flatMap((p) => p.updates)
  const count = (diff: DiffType) => allUpdates.filter((u) => u.diff === diff).length

  const output: JsonOutput = {
    packages,
    errors,
    writeOutcomes: executionState.writeOutcomes,
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
      skippedUpdates: executionState.skippedUpdates,
      conflictedUpdates: executionState.conflictedUpdates,
      failedWrites: executionState.failedWrites,
      unknownWrites: executionState.unknownWrites,
      failedResolutions: executionState.failedResolutions,
    },
    meta: {
      schemaVersion: 1,
      cwd: options.cwd,
      effectiveRoot: options.effectiveRoot ?? options.cwd,
      mode: redactSensitiveText(options.mode),
      timestamp: new Date().toISOString(),
      noPackagesFound: executionState.noPackagesFound,
      hadResolutionErrors: executionState.failedResolutions > 0,
      didWrite: executionState.didWrite,
    },
    ...(options.explainDiscovery && options.discoveryReport
      ? { discovery: options.discoveryReport }
      : {}),
    ...(options.profile && options.profileReport ? { profile: options.profileReport } : {}),
  }

  // biome-ignore lint/suspicious/noConsole: intentional JSON output
  console.log(JSON.stringify(output, null, 2))
}

export function outputJsonError(error: unknown, options: { cwd: string; mode: string }): void {
  const { code, message, reason } = getSafeErrorDetails(error)

  const output: JsonErrorOutput = {
    error: {
      code,
      reason,
      message,
      retryable: RETRYABLE_CODES.has(code),
    },
    meta: {
      schemaVersion: 1,
      cwd: redactSensitiveText(options.cwd),
      mode: redactSensitiveText(options.mode),
      timestamp: new Date().toISOString(),
    },
  }

  // biome-ignore lint/suspicious/noConsole: intentional JSON error output
  console.log(JSON.stringify(output, null, 2))
}
