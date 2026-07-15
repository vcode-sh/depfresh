import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export type ContainmentReason =
  | 'ROOT_NOT_FOUND'
  | 'PATH_NOT_FOUND'
  | 'PARENT_TRAVERSAL'
  | 'OUTSIDE_ROOT'
  | 'SYMLINK_ESCAPE'

export interface AllowedContainedPath {
  allowed: true
  root: string
  path: string
}

export interface BlockedContainedPath {
  allowed: false
  root: string
  path: string
  reason: ContainmentReason
}

export type ContainedPathResult = AllowedContainedPath | BlockedContainedPath

export function resolveContainedPath(root: string, candidate: string): ContainedPathResult {
  const lexicalRoot = resolve(root)
  const canonicalRoot = tryRealpath(lexicalRoot)
  const candidatePath = isAbsolute(candidate) ? resolve(candidate) : resolve(lexicalRoot, candidate)

  if (!canonicalRoot) {
    return blocked(lexicalRoot, candidatePath, 'ROOT_NOT_FOUND')
  }

  if (hasParentTraversal(candidate)) {
    return blocked(canonicalRoot, candidatePath, 'PARENT_TRAVERSAL')
  }

  if (
    !(
      isPathInsideRoot(lexicalRoot, candidatePath) || isPathInsideRoot(canonicalRoot, candidatePath)
    )
  ) {
    return blocked(canonicalRoot, candidatePath, 'OUTSIDE_ROOT')
  }

  const canonicalCandidate = tryRealpath(candidatePath)
  if (!canonicalCandidate) {
    return blocked(canonicalRoot, candidatePath, 'PATH_NOT_FOUND')
  }

  if (!isPathInsideRoot(canonicalRoot, canonicalCandidate)) {
    return blocked(canonicalRoot, candidatePath, 'SYMLINK_ESCAPE')
  }

  return {
    allowed: true,
    root: canonicalRoot,
    path: canonicalCandidate,
  }
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const difference = relative(root, candidate)
  const crossesParent = difference === '..' || difference.startsWith(`..${sep}`)
  return difference === '' || !(crossesParent || isAbsolute(difference))
}

function blocked(root: string, path: string, reason: ContainmentReason): BlockedContainedPath {
  return { allowed: false, root, path, reason }
}

function hasParentTraversal(candidate: string): boolean {
  return candidate.split(/[\\/]+/u).includes('..')
}

function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}
