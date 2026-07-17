import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InvocationScopeExclusions } from './cli/scope-exclusions'
import { hashExactBytes } from './contracts/fingerprint'
import { ConfigError } from './errors'
import { type InternalCompiledPolicyRule, internalCatalogId } from './policy/internal-types'
import type { CompiledPolicy, PolicyDecision, RepositoryModel, RepositorySourceFile } from './types'

export interface SelectionReceiptRequest {
  kind: 'workspace' | 'catalog'
  value: string
  entityIds: string[]
  occurrenceIds: string[]
}

export interface SelectionReceipt {
  requests: SelectionReceiptRequest[]
  summary: {
    requestedWorkspaces: number
    requestedCatalogs: number
    matchedWorkspaces: number
    matchedCatalogNames: number
    matchedCatalogOwners: number
    excludedOccurrences: number
    eligibleSharedCatalogOwners: number
  }
}

const selectionReceiptKey = Symbol('depfresh.selectionReceipt')

type SelectionReceiptCarrier = object & { [selectionReceiptKey]?: SelectionReceipt }

export function attachInvocationSelectionReceipt(carrier: object, receipt: SelectionReceipt): void {
  const target = carrier as SelectionReceiptCarrier
  target[selectionReceiptKey] = receipt
}

export function readInvocationSelectionReceipt(carrier: object): SelectionReceipt | undefined {
  return (carrier as SelectionReceiptCarrier)[selectionReceiptKey]
}

interface BoundRequest {
  kind: SelectionReceiptRequest['kind']
  value: string
  entityIds: string[]
  ruleIds: string[]
}

export interface BoundInvocationSelection {
  requests: BoundRequest[]
  appendToPolicy(policy: CompiledPolicy): CompiledPolicy
}

function unprovenTarget(): ConfigError {
  return new ConfigError('A requested exclusion target could not be proven in this repository.', {
    reason: 'SELECTION_TARGET_UNPROVEN',
  })
}

function exactPattern(value: string): string {
  return `^${value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}$`
}

function ruleToken(value: string): string {
  return hashExactBytes(value).slice(0, 16)
}

export function workspaceSelectionRuleIds(
  workspacePath: string,
  packageId: string,
): readonly [string, string] {
  const token = ruleToken(`${workspacePath}\0${packageId}`)
  return [`$cli:exclude-workspace:${token}:direct`, `$cli:exclude-workspace:${token}:consumer`]
}

export function catalogSelectionRuleId(catalogName: string, catalogId: string): string {
  return `$cli:exclude-catalog:${ruleToken(`${catalogName}\0${catalogId}`)}`
}

function assertCurrentSource(root: string, source: RepositorySourceFile | undefined): void {
  if (!source) throw unprovenTarget()
  try {
    if (hashExactBytes(readFileSync(join(root, source.path))) !== source.byteHash) {
      throw unprovenTarget()
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw unprovenTarget()
  }
}

export function bindInvocationSelection(
  root: string,
  model: RepositoryModel,
  selection: InvocationScopeExclusions,
): BoundInvocationSelection {
  const sources = new Map(model.sourceFiles.map((source) => [source.id, source]))
  const requests: BoundRequest[] = []
  const rules: InternalCompiledPolicyRule[] = []

  for (const workspacePath of selection.workspaces) {
    const packages = model.packages.filter((pkg) => pkg.workspacePath === workspacePath)
    if (packages.length !== 1) throw unprovenTarget()
    const pkg = packages[0]
    if (!pkg) throw unprovenTarget()
    assertCurrentSource(root, sources.get(pkg.sourceFileId))
    const ruleIds = [...workspaceSelectionRuleIds(workspacePath, pkg.id)]
    rules.push(
      {
        id: ruleIds[0]!,
        selectors: { workspacePath: exactPattern(workspacePath), catalogRole: 'direct' },
        action: 'exclude',
        provenance: { source: 'cli', kind: 'explicit', index: 0 },
      },
      {
        id: ruleIds[1]!,
        selectors: { workspacePath: exactPattern(workspacePath), catalogRole: 'consumer' },
        action: 'exclude',
        provenance: { source: 'cli', kind: 'explicit', index: 0 },
      },
    )
    requests.push({ kind: 'workspace', value: workspacePath, entityIds: [pkg.id], ruleIds })
  }

  for (const catalogName of selection.catalogs) {
    const catalogs = model.catalogs
      .filter((catalog) => catalog.name === catalogName)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (catalogs.length === 0) throw unprovenTarget()
    const ruleIds: string[] = []
    for (const catalog of catalogs) {
      assertCurrentSource(root, sources.get(catalog.sourceFileId))
      const id = catalogSelectionRuleId(catalogName, catalog.id)
      ruleIds.push(id)
      rules.push({
        id,
        selectors: {},
        action: 'exclude',
        provenance: { source: 'cli', kind: 'explicit', index: 0 },
        [internalCatalogId]: catalog.id,
      })
    }
    requests.push({
      kind: 'catalog',
      value: catalogName,
      entityIds: catalogs.map((catalog) => catalog.id),
      ruleIds,
    })
  }

  return {
    requests,
    appendToPolicy: (policy) => ({
      rules: [
        ...policy.rules,
        ...rules.map((rule, offset) => ({
          ...rule,
          provenance: { ...rule.provenance, index: policy.rules.length + offset },
        })),
      ],
    }),
  }
}

export function createSelectionReceipt(
  bound: BoundInvocationSelection | undefined,
  model: RepositoryModel,
  decisions: readonly PolicyDecision[],
): SelectionReceipt {
  const requests = bound?.requests ?? []
  const decisionsById = new Map(decisions.map((decision) => [decision.occurrenceId, decision]))
  const receiptRequests = requests.map((request) => ({
    kind: request.kind,
    value: request.value,
    entityIds: [...request.entityIds],
    occurrenceIds: model.occurrences
      .filter((occurrence) =>
        request.ruleIds.some((ruleId) =>
          decisionsById.get(occurrence.id)?.matchedRuleIds.includes(ruleId),
        ),
      )
      .map((occurrence) => occurrence.id),
  }))
  const reservedRuleIds = new Set(requests.flatMap((request) => request.ruleIds))
  const excludedOccurrences = new Set(
    decisions
      .filter(
        (decision) =>
          decision.status === 'skipped' &&
          decision.matchedRuleIds.some((ruleId) => reservedRuleIds.has(ruleId)),
      )
      .map((decision) => decision.occurrenceId),
  )
  const workspaceRuleIds = new Set(
    requests
      .filter((request) => request.kind === 'workspace')
      .flatMap((request) => request.ruleIds),
  )
  const catalogRuleIds = new Set(
    requests.filter((request) => request.kind === 'catalog').flatMap((request) => request.ruleIds),
  )
  const sharedCatalogIds = new Set<string>()
  for (const relationship of model.relationships.catalogConsumers) {
    const consumerDecision = decisionsById.get(relationship.occurrenceId)
    if (!consumerDecision?.matchedRuleIds.some((ruleId) => workspaceRuleIds.has(ruleId))) continue
    const ownerIds =
      model.catalogs
        .find((catalog) => catalog.id === relationship.catalogId)
        ?.entries.map((entry) => entry.occurrenceId) ?? []
    if (
      ownerIds.some((id) => {
        const decision = decisionsById.get(id)
        return (
          decision?.status === 'selected' &&
          !decision.matchedRuleIds.some((ruleId) => catalogRuleIds.has(ruleId))
        )
      })
    ) {
      sharedCatalogIds.add(relationship.catalogId)
    }
  }

  return {
    requests: receiptRequests,
    summary: {
      requestedWorkspaces: requests.filter((request) => request.kind === 'workspace').length,
      requestedCatalogs: requests.filter((request) => request.kind === 'catalog').length,
      matchedWorkspaces: requests
        .filter((request) => request.kind === 'workspace')
        .reduce((sum, request) => sum + request.entityIds.length, 0),
      matchedCatalogNames: requests.filter((request) => request.kind === 'catalog').length,
      matchedCatalogOwners: requests
        .filter((request) => request.kind === 'catalog')
        .reduce((sum, request) => sum + request.entityIds.length, 0),
      excludedOccurrences: excludedOccurrences.size,
      eligibleSharedCatalogOwners: sharedCatalogIds.size,
    },
  }
}
