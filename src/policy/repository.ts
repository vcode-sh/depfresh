import { toRepositoryRelativePath } from '../repository/identity'
import type { CompiledPolicy, PackageMeta, PolicyDecision, RawDep, RepositoryModel } from '../types'
import { createPolicyContexts } from './context'
import { evaluatePolicy } from './matcher'

export function evaluateRepositoryPolicy(
  model: RepositoryModel,
  policy: CompiledPolicy,
): PolicyDecision[] {
  return createPolicyContexts(model).map((context) => evaluatePolicy(policy, context))
}

export function applyPolicyToProjection(
  root: string,
  packages: PackageMeta[],
  model: RepositoryModel,
  decisions: readonly PolicyDecision[],
): PackageMeta[] {
  const decisionsByOccurrence = new Map(
    decisions.map((decision) => [decision.occurrenceId, decision]),
  )
  const occurrencesBySourceAndPath = new Map<
    string,
    (typeof model.occurrences)[number] | undefined
  >()
  for (const occurrence of model.occurrences) {
    const key = sourcePathKey(occurrence.sourceFileId, occurrence.path)
    occurrencesBySourceAndPath.set(
      key,
      occurrencesBySourceAndPath.has(key) ? undefined : occurrence,
    )
  }
  const sourceIdsByPath = new Map(model.sourceFiles.map((source) => [source.path, source.id]))

  for (const pkg of packages) {
    const path = toRepositoryRelativePath(root, pkg.filepath)
    const sourceFileId = path ? sourceIdsByPath.get(path) : undefined
    if (!sourceFileId) {
      pkg.deps = []
      continue
    }
    pkg.deps = pkg.deps.flatMap((dep) => {
      const occurrencePath = projectionPath(pkg, dep)
      if (!occurrencePath) return []
      const occurrence = occurrencesBySourceAndPath.get(sourcePathKey(sourceFileId, occurrencePath))
      if (!occurrence) return []
      const decision = decisionsByOccurrence.get(occurrence.id)
      if (decision?.status !== 'selected') return []
      return [{ ...dep, occurrenceId: occurrence.id, policyDecision: decision }]
    })
    for (const catalog of pkg.catalogs ?? []) {
      catalog.deps = pkg.deps
    }
  }
  return packages
}

function projectionPath(pkg: PackageMeta, dep: RawDep): string[] | undefined {
  const catalogName = pkg.catalogs?.[0]?.name
  if (pkg.type === 'pnpm-workspace') {
    if (!catalogName) return undefined
    return catalogName === 'default' ? ['catalog', dep.name] : ['catalogs', catalogName, dep.name]
  }
  if (pkg.type === 'bun-workspace') {
    if (!catalogName) return undefined
    return catalogName === 'default'
      ? ['workspaces', 'catalog', dep.name]
      : ['workspaces', 'catalogs', catalogName, dep.name]
  }
  if (pkg.type === 'yarn-workspace') return ['catalog', dep.name]
  if (dep.source === 'packageManager') return ['packageManager']
  if (
    dep.source === 'overrides' ||
    dep.source === 'resolutions' ||
    dep.source === 'pnpm.overrides'
  ) {
    return [...dep.source.split('.'), ...dep.parents]
  }
  return [dep.source, dep.name]
}

function sourcePathKey(sourceFileId: string, path: readonly string[]): string {
  return `${sourceFileId}\0${JSON.stringify(path)}`
}
