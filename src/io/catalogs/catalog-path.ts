import { existsSync, realpathSync } from 'node:fs'
import { findUpSync } from 'find-up-simple'
import { resolve } from 'pathe'
import type { depfreshOptions } from '../../types'
import type { AllowedContainedPath } from '../packages/containment'
import { resolveContainedPath } from '../packages/containment'
import { resolveDiscoveryContext } from '../packages/root-detection'

export interface CatalogSearchContext {
  root: string
  start: string
}

export function resolveCatalogSearchContext(
  cwd: string,
  options: depfreshOptions | undefined,
): CatalogSearchContext | null {
  const requestedRoot =
    options?.effectiveRoot ??
    options?.discoveryReport?.effectiveRoot ??
    resolveDiscoveryContext(cwd).effectiveRoot
  const rootResult = resolveContainedPath(requestedRoot, requestedRoot)
  if (!rootResult.allowed) {
    recordBlockedCatalogPath(options, rootResult.path, rootResult.reason)
    return null
  }

  const canonicalStart = canonicalizeExistingPath(cwd)
  const startResult = resolveContainedPath(rootResult.path, canonicalStart)
  if (!startResult.allowed) {
    recordBlockedCatalogPath(options, startResult.path, startResult.reason)
    return null
  }

  return { root: rootResult.path, start: startResult.path }
}

function canonicalizeExistingPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

export function findContainedCatalogFile(
  filename: string,
  cwd: string,
  options: depfreshOptions | undefined,
): string | undefined {
  const context = resolveCatalogSearchContext(cwd, options)
  if (!context) return undefined

  const candidate = findUpSync(filename, {
    cwd: context.start,
    stopAt: context.root,
  })
  if (!candidate) return undefined

  const contained = resolveCatalogCandidate(context.root, candidate, options)
  return contained?.path
}

export function resolveCatalogCandidate(
  root: string,
  candidate: string,
  options: depfreshOptions | undefined,
): AllowedContainedPath | undefined {
  const contained = resolveContainedPath(root, candidate)
  if (!contained.allowed) {
    recordBlockedCatalogPath(options, resolve(candidate), contained.reason)
    return undefined
  }
  return contained
}

export function catalogCandidateExists(candidate: string): boolean {
  return existsSync(candidate)
}

export function recordBlockedCatalogPath(
  options: depfreshOptions | undefined,
  path: string,
  reason: string,
): void {
  const skipped = options?.discoveryReport?.skippedManifests
  if (!skipped) return

  const entry = { path, reason: `catalog:${reason}` }
  if (
    !skipped.some((candidate) => candidate.path === entry.path && candidate.reason === entry.reason)
  ) {
    skipped.push(entry)
  }
}
