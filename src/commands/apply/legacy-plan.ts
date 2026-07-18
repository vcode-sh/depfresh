import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import detectIndent from 'detect-indent'
import { version } from '../../../package.json' with { type: 'json' }
import { canonicalJson } from '../../contracts/canonical-json'
import {
  createPlanFingerprint,
  createRepositoryFingerprint,
  hashExactBytes,
} from '../../contracts/fingerprint'
import { sanitizeContractText } from '../../contracts/sanitize'
import type { ApplyResult, PlanResult } from '../../contracts/schemas'
import { assertPlanResult } from '../../contracts/validate'
import { ConfigError } from '../../errors'
import { snapshotInvocationAuthority } from '../../invocation-authority'
import {
  createCatalogWriteRequest,
  createPackageWriteRequest,
  resolvePhysicalValues,
} from '../../io/write/occurrence'
import { createRepositoryId } from '../../repository/identity'
import { collectVcsEvidence } from '../../repository/vcs'
import type {
  CatalogSource,
  InvocationAuthority,
  PackageMeta,
  RepositoryDiagnosticCode,
  ResolvedDepChange,
  WriteOutcome,
} from '../../types'
import { sanitizeTerminalText } from '../../utils/format'
import { applyWithExecutionEvidence } from './index'

export interface LegacyWriteDiagnostic {
  code: RepositoryDiagnosticCode
  target: {
    identity: string
    display: string
  }
}

export interface LegacyCommandSelection {
  packageIndex: number
  pkg: PackageMeta
  changes: ResolvedDepChange[]
}

interface LegacyCommandResultBase {
  packages: Array<{ packageIndex: number; outcomes: WriteOutcome[] }>
  diagnostics: LegacyWriteDiagnostic[]
  attempts: Array<{
    targetPath: string
    operationIds: string[]
    replacementAttempted: boolean
  }>
}

export type LegacyCommandApplyResult =
  | (LegacyCommandResultBase & { status: 'executed'; applyResult: ApplyResult })
  | (LegacyCommandResultBase & { status: 'blocked' })

interface LegacyOperationInput {
  filepath: string
  relativePath: string
  path: string[]
  name: string
  expectedValue: string
  requestedValue: string
  indent: string
  catalog?: { name: string; sourcePath: string }
}

interface LegacyProjection {
  packageIndex: number
  changeIndex: number
  change: ResolvedDepChange
  occurrence: { file: string; path: string[] }
  expectedValue: string
  requestedValue: string
  physicalKey?: string
  operationId?: string
  blockedOutcome?: WriteOutcome
  ownerLabel: string | undefined
  catalog?: { name: string; sourcePath: string }
}

export type LegacySelectionEvidenceResult =
  | { readonly status: 'ready'; readonly evidence: LegacySelectionEvidence }
  | {
      readonly status: 'unavailable'
      readonly reason:
        | 'UNSUPPORTED_WRITE_SOURCE'
        | 'UNBOUND_OPERATION'
        | 'INCONSISTENT_SELECTION_EVIDENCE'
    }

export interface LegacySelectionEvidence {
  readonly operations: readonly LegacySelectionEvidenceOperation[]
  readonly targets: readonly {
    readonly path: string
    readonly operationIds: readonly string[]
  }[]
}

export interface LegacySelectionEvidenceOperation {
  readonly operationId: string
  readonly packageIndex: number
  readonly changeIndex: number
  readonly ownerLabel: string
  readonly physicalTarget: string
  readonly occurrencePath: readonly string[]
  readonly name: string
  readonly current: string
  readonly target: string
  readonly diff: 'major' | 'minor' | 'patch'
  readonly publishedAt?: string
  readonly nodeCompatible?: boolean
  readonly nodeCompat?: string
  readonly catalog?: { readonly name: string; readonly sourcePath: string }
}

export interface LegacyPlanConstruction {
  plan: PlanResult
  projections: LegacyProjection[]
  blocked: boolean
  blockReason?: 'AMBIGUOUS_OCCURRENCE' | 'UNSUPPORTED_WRITE_SOURCE'
  selectionEvidence: LegacySelectionEvidenceResult
}

const LEGACY_VCS_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'VCS_EXECUTABLE_MISSING',
  'VCS_NOT_REPOSITORY',
  'VCS_OUTPUT_LIMIT_EXCEEDED',
  'VCS_PROBE_FAILED',
  'VCS_PROBE_DISABLED',
] satisfies RepositoryDiagnosticCode[])

const LOCAL_FILE_AUTHORITY: InvocationAuthority = {
  write: true,
  install: false,
  update: false,
  execute: false,
  processExecute: false,
  lockfileWrite: false,
  verifyCommand: false,
  artifactVerify: false,
  networkAccess: false,
  globalWrite: false,
}

export function createLegacyPlan(
  rootInput: string,
  selections: readonly LegacyCommandSelection[],
): LegacyPlanConstruction {
  const root = requireCanonicalRoot(rootInput)
  validateSelections(selections)
  const projections: LegacyProjection[] = []
  const inputs = new Map<string, LegacyOperationInput[]>()
  let hasUnsupportedInput = false

  for (const selection of selections) {
    const selectionProjections: LegacyProjection[] = []
    for (let changeIndex = 0; changeIndex < selection.changes.length; changeIndex += 1) {
      const change = selection.changes[changeIndex]!
      const collected = collectInput(root, selection.pkg, change)
      if (!collected.ok) {
        hasUnsupportedInput = true
        selectionProjections.push({
          packageIndex: selection.packageIndex,
          changeIndex,
          change,
          occurrence: collected.outcome.occurrence,
          expectedValue: collected.outcome.expectedValue,
          requestedValue: collected.outcome.requestedValue,
          blockedOutcome: collected.outcome,
          ownerLabel: selectionOwnerLabel(root, selection.pkg),
        })
        continue
      }
      const input = collected.input
      const physicalKey = physicalOccurrenceKey(input.relativePath, input.path)
      const candidates = inputs.get(physicalKey)
      if (candidates) candidates.push(input)
      else inputs.set(physicalKey, [input])
      selectionProjections.push({
        packageIndex: selection.packageIndex,
        changeIndex,
        change,
        occurrence: { file: input.filepath, path: [...input.path] },
        expectedValue: input.expectedValue,
        requestedValue: input.requestedValue,
        physicalKey,
        ownerLabel: selectionOwnerLabel(root, selection.pkg),
        ...(input.catalog ? { catalog: { ...input.catalog } } : {}),
      })
    }
    if (selectionProjections.some((projection) => projection.blockedOutcome)) {
      for (const projection of selectionProjections) {
        if (projection.blockedOutcome) continue
        projection.blockedOutcome = outcomeFromProjection(
          projection,
          'failed',
          'UNSUPPORTED_WRITE_SOURCE',
        )
      }
    }
    projections.push(...selectionProjections)
  }

  let hasConflict = false
  const physicalInputs: LegacyOperationInput[] = []
  const blockedOperationIds = new Map<string, string>()
  for (const [physicalKey, candidates] of [...inputs].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const valuePairs = new Set(
      candidates.map((candidate) =>
        canonicalJson([candidate.expectedValue, candidate.requestedValue]),
      ),
    )
    if (valuePairs.size > 1) {
      hasConflict = true
      blockedOperationIds.set(physicalKey, createBlockedOperationId(physicalKey, valuePairs))
      for (const projection of projections) {
        if (projection.physicalKey !== physicalKey) continue
        projection.blockedOutcome = outcomeFromProjection(
          projection,
          'conflicted',
          'AMBIGUOUS_OCCURRENCE',
        )
      }
      continue
    }
    physicalInputs.push(stableInput(candidates))
  }

  const plan = buildPlan(root, physicalInputs)
  const operationIds = new Map(
    plan.operations.map((operation) => [
      physicalOccurrenceKey(operation.file, operation.path),
      operation.id,
    ]),
  )
  for (const projection of projections) {
    if (projection.physicalKey) {
      projection.operationId =
        operationIds.get(projection.physicalKey) ??
        blockedOperationIds.get(projection.physicalKey) ??
        projection.operationId
    }
  }

  const blocked = hasConflict || hasUnsupportedInput
  if (blocked) {
    for (const projection of projections) {
      if (!projection.blockedOutcome) {
        projection.blockedOutcome = outcomeFromProjection(
          projection,
          'failed',
          hasConflict ? 'WRITE_FAILED' : 'UNSUPPORTED_WRITE_SOURCE',
        )
      }
    }
  }

  const selectionEvidence = createSelectionEvidence(root, projections, plan)
  return {
    plan,
    projections,
    blocked,
    selectionEvidence,
    ...(hasConflict
      ? { blockReason: 'AMBIGUOUS_OCCURRENCE' as const }
      : hasUnsupportedInput
        ? { blockReason: 'UNSUPPORTED_WRITE_SOURCE' as const }
        : {}),
  }
}

function validateSelections(selections: readonly LegacyCommandSelection[]): void {
  const packageIndexes = new Set<number>()
  for (const selection of selections) {
    if (
      !Number.isSafeInteger(selection.packageIndex) ||
      selection.packageIndex < 0 ||
      packageIndexes.has(selection.packageIndex)
    ) {
      throw new ConfigError(
        'Legacy command package indexes must be unique non-negative integers.',
        {
          reason: 'INVALID_CONFIG',
        },
      )
    }
    packageIndexes.add(selection.packageIndex)
  }
}

function createSelectionEvidence(
  root: string,
  projections: readonly LegacyProjection[],
  plan: PlanResult,
): LegacySelectionEvidenceResult {
  const unsupported = projections.some(
    (projection) => projection.blockedOutcome?.reason === 'UNSUPPORTED_WRITE_SOURCE',
  )
  if (unsupported) return freezeEvidenceUnavailable('UNSUPPORTED_WRITE_SOURCE')
  if (
    projections.some(
      (projection) =>
        projection.physicalKey === undefined ||
        projection.operationId === undefined ||
        projection.ownerLabel === undefined,
    )
  ) {
    return freezeEvidenceUnavailable('UNBOUND_OPERATION')
  }

  const byPhysicalKey = new Map<string, LegacyProjection[]>()
  for (const projection of projections) {
    const candidates = byPhysicalKey.get(projection.physicalKey!)
    if (candidates) candidates.push(projection)
    else byPhysicalKey.set(projection.physicalKey!, [projection])
  }

  const canonicalByOperationId = new Map<string, LegacySelectionEvidenceOperation>()
  const blockedOperationIds: string[] = []
  for (const [, candidates] of [...byPhysicalKey].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const facts = candidates.map((projection) => evidenceFacts(root, projection))
    if (facts.some((fact) => fact === undefined)) {
      return freezeEvidenceUnavailable('UNBOUND_OPERATION')
    }
    const distinctFacts = new Set(facts.map((fact) => canonicalJson(fact)))
    if (distinctFacts.size !== 1) {
      return freezeEvidenceUnavailable('INCONSISTENT_SELECTION_EVIDENCE')
    }
    const operationIds = new Set(candidates.map((projection) => projection.operationId))
    if (operationIds.size !== 1) {
      return freezeEvidenceUnavailable('INCONSISTENT_SELECTION_EVIDENCE')
    }
    const canonical = [...candidates].sort(
      (left, right) =>
        left.packageIndex - right.packageIndex || left.changeIndex - right.changeIndex,
    )[0]!
    const fact = facts[0]!
    const operationId = canonical.operationId!
    const operation: LegacySelectionEvidenceOperation = {
      operationId,
      packageIndex: canonical.packageIndex,
      changeIndex: canonical.changeIndex,
      ownerLabel: canonical.ownerLabel!,
      physicalTarget: fact.physicalTarget,
      occurrencePath: [...fact.occurrencePath],
      name: fact.name,
      current: fact.current,
      target: fact.target,
      diff: fact.diff,
      ...(fact.publishedAt === undefined ? {} : { publishedAt: fact.publishedAt }),
      ...(fact.nodeCompatible === undefined ? {} : { nodeCompatible: fact.nodeCompatible }),
      ...(fact.nodeCompat === undefined ? {} : { nodeCompat: fact.nodeCompat }),
      ...(fact.catalog === undefined ? {} : { catalog: { ...fact.catalog } }),
    }
    canonicalByOperationId.set(operationId, operation)
    if (!plan.operations.some((candidate) => candidate.id === operationId)) {
      blockedOperationIds.push(operationId)
    }
  }

  const orderedIds = [...plan.operations.map((operation) => operation.id), ...blockedOperationIds]
  if (orderedIds.length !== canonicalByOperationId.size) {
    return freezeEvidenceUnavailable('UNBOUND_OPERATION')
  }
  const operations = orderedIds.map((operationId) => canonicalByOperationId.get(operationId)!)
  if (operations.some((operation) => operation === undefined)) {
    return freezeEvidenceUnavailable('UNBOUND_OPERATION')
  }
  const targetsByPath = new Map<string, string[]>()
  for (const operation of operations) {
    const operationIds = targetsByPath.get(operation.physicalTarget)
    if (operationIds) operationIds.push(operation.operationId)
    else targetsByPath.set(operation.physicalTarget, [operation.operationId])
  }
  const evidence: LegacySelectionEvidence = {
    operations: operations.map((operation) => ({ ...operation })),
    targets: [...targetsByPath]
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, operationIds]) => ({ path, operationIds: [...operationIds] })),
  }
  return deepFreezeEvidence({ status: 'ready', evidence })
}

function evidenceFacts(
  root: string,
  projection: LegacyProjection,
):
  | Omit<
      LegacySelectionEvidenceOperation,
      'operationId' | 'packageIndex' | 'changeIndex' | 'ownerLabel'
    >
  | undefined {
  const diff = projection.change.diff
  if (diff !== 'major' && diff !== 'minor' && diff !== 'patch') return undefined
  const canonical = canonicalContainedSource(root, projection.occurrence.file)
  if (!canonical) return undefined
  const physicalTarget = repositoryRelative(root, canonical)
  if (projection.catalog && projection.catalog.sourcePath !== physicalTarget) return undefined
  return {
    physicalTarget,
    occurrencePath: [...projection.occurrence.path],
    name: projection.change.name,
    current: projection.expectedValue,
    target: projection.requestedValue,
    diff,
    ...(projection.change.publishedAt === undefined
      ? {}
      : { publishedAt: projection.change.publishedAt }),
    ...(projection.change.nodeCompatible === undefined
      ? {}
      : { nodeCompatible: projection.change.nodeCompatible }),
    ...(projection.change.nodeCompat === undefined
      ? {}
      : { nodeCompat: projection.change.nodeCompat }),
    ...(projection.catalog === undefined ? {} : { catalog: { ...projection.catalog } }),
  }
}

function selectionOwnerLabel(root: string, pkg: PackageMeta): string | undefined {
  const safeName = sanitizeTerminalText(pkg.name).trim()
  if (safeName.length > 0) return safeName
  const canonical = canonicalContainedSource(root, pkg.filepath)
  return canonical ? repositoryRelative(root, canonical) : undefined
}

function freezeEvidenceUnavailable(
  reason: Extract<LegacySelectionEvidenceResult, { status: 'unavailable' }>['reason'],
): LegacySelectionEvidenceResult {
  return Object.freeze({ status: 'unavailable' as const, reason })
}

function deepFreezeEvidence<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreezeEvidence(nested)
  return Object.freeze(value)
}

export async function applyLegacyCommandWrite(
  root: string,
  selections: readonly LegacyCommandSelection[],
  requestedAuthority: InvocationAuthority,
  observer?: (evidence: LegacySelectionEvidenceResult) => void,
): Promise<LegacyCommandApplyResult> {
  const authority = snapshotInvocationAuthority(requestedAuthority)
  if (!authority.write) {
    throw new ConfigError('Writing requires explicit invocation authority.', {
      reason: 'AUTHORITY_REQUIRED',
    })
  }
  const construction = createLegacyPlan(root, selections)
  observer?.(construction.selectionEvidence)
  const blockedAttempts = createAttemptEvidence(root, construction.projections)

  if (construction.blocked) {
    return {
      status: 'blocked',
      packages: projectBlockedPackages(selections, construction.projections),
      diagnostics: [],
      attempts: sortedAttempts(blockedAttempts),
    }
  }

  const { applyResult, evidence, vcsEvidence } = await applyWithExecutionEvidence(
    construction.plan,
    { cwd: root },
    LOCAL_FILE_AUTHORITY,
  )
  return {
    status: 'executed',
    applyResult,
    packages: projectAppliedPackages(selections, construction.projections, applyResult),
    diagnostics: toLegacyDiagnostics(
      vcsEvidence?.diagnostics ?? construction.plan.vcs.diagnostics,
      applyResult.operations,
      root,
    ),
    attempts: [...evidence].sort((left, right) => compareText(left.targetPath, right.targetPath)),
  }
}

function collectInput(
  root: string,
  pkg: PackageMeta,
  change: ResolvedDepChange,
): { ok: true; input: LegacyOperationInput } | { ok: false; outcome: WriteOutcome } {
  let request: ReturnType<typeof createPackageWriteRequest>
  let indent = pkg.indent
  let catalogEvidence: LegacyOperationInput['catalog']
  if (pkg.type === 'package.json' || pkg.type === 'package.yaml') {
    if (!canonicalContainedSource(root, pkg.filepath)) {
      return { ok: false, outcome: unsupportedOutcome(pkg.filepath, change) }
    }
    request = createPackageWriteRequest(pkg, change)
  } else {
    const rawMatches = findCatalogMatches(pkg.catalogs ?? [], change)
    const unsafeMatch = rawMatches.find(
      (catalog) => !canonicalContainedSource(root, catalog.filepath),
    )
    if (unsafeMatch) {
      return { ok: false, outcome: unsupportedOutcome(unsafeMatch.filepath, change) }
    }
    const matches = deduplicateCatalogMatches(rawMatches, change)
    if (matches.length !== 1) {
      const values = legacyPhysicalValues(change)
      return {
        ok: false,
        outcome: {
          name: change.name,
          occurrence: { file: pkg.filepath, path: [...change.parents, change.name] },
          ...values,
          status: 'failed',
          reason: matches.length > 1 ? 'AMBIGUOUS_OCCURRENCE' : 'OCCURRENCE_NOT_FOUND',
        },
      }
    }
    const catalog = matches[0]!
    const canonicalCatalogSource = canonicalContainedSource(root, catalog.filepath)
    if (!canonicalCatalogSource) {
      return { ok: false, outcome: unsupportedOutcome(catalog.filepath, change) }
    }
    request = createCatalogWriteRequest(catalog, change)
    indent = catalog.indent
    catalogEvidence = {
      name: catalog.name,
      sourcePath: repositoryRelative(root, canonicalCatalogSource),
    }
  }
  const values = resolvePhysicalValues(request, undefined)
  const canonical = canonicalContainedSource(root, request.occurrence.file)
  if (!canonical) {
    return {
      ok: false,
      outcome: {
        name: change.name,
        occurrence: { file: request.occurrence.file, path: [...request.occurrence.path] },
        ...values,
        status: 'failed',
        reason: 'UNSUPPORTED_WRITE_SOURCE',
      },
    }
  }
  return {
    ok: true,
    input: {
      filepath: canonical,
      relativePath: repositoryRelative(root, canonical),
      path: [...request.occurrence.path],
      name: change.name,
      ...values,
      indent,
      ...(catalogEvidence ? { catalog: catalogEvidence } : {}),
    },
  }
}

function unsupportedOutcome(filepath: string, change: ResolvedDepChange): WriteOutcome {
  return {
    name: change.name,
    occurrence: { file: filepath, path: [change.source, ...change.parents, change.name] },
    ...legacyPhysicalValues(change),
    status: 'failed',
    reason: 'UNSUPPORTED_WRITE_SOURCE',
  }
}

function legacyPhysicalValues(change: ResolvedDepChange): {
  expectedValue: string
  requestedValue: string
} {
  return resolvePhysicalValues(
    {
      change,
      occurrence: { file: '', path: [] },
      exactExpectedValue: change.rawVersion,
    },
    undefined,
  )
}

function deduplicateCatalogMatches(
  catalogs: readonly CatalogSource[],
  change: ResolvedDepChange,
): CatalogSource[] {
  const matches = new Map<string, CatalogSource>()
  for (const catalog of catalogs) {
    const request = createCatalogWriteRequest(catalog, change)
    const key = physicalOccurrenceKey(request.occurrence.file, request.occurrence.path)
    if (!matches.has(key)) matches.set(key, catalog)
  }
  return [...matches.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, catalog]) => catalog)
}

function buildPlan(root: string, inputs: readonly LegacyOperationInput[]): PlanResult {
  const files = [...new Set(inputs.map((input) => input.filepath))].sort((left, right) =>
    compareText(repositoryRelative(root, left), repositoryRelative(root, right)),
  )
  const sources = files.map((filepath) => {
    const bytes = readFileSync(filepath)
    return {
      filepath,
      path: repositoryRelative(root, filepath),
      bytes,
      byteHash: hashExactBytes(bytes),
      indent: inputs.find((input) => input.filepath === filepath)?.indent ?? '  ',
    }
  })
  const sourceFiles = sources.map((source) => ({
    id: createRepositoryId('source', source.path),
    path: source.path,
    format: source.path.endsWith('.json') ? ('json' as const) : ('yaml' as const),
    byteHash: source.byteHash,
    parseState: 'parsed' as const,
    indent: detectIndent(source.bytes.toString('utf8')).indent || source.indent,
    newline: detectNewline(source.bytes.toString('utf8')),
    trailingNewline: /\r?\n$/u.test(source.bytes.toString('utf8')),
  }))
  const packages = sourceFiles.map((source, index) => ({
    id: createRepositoryId('package', source.path),
    sourceFileId: source.id,
    path: source.path,
    workspacePath: dirname(source.path) === '.' ? '.' : dirname(source.path),
    name: `legacy-${index}`,
    private: false,
  }))
  const sortedInputs = [...inputs].sort((left, right) =>
    compareText(
      physicalOccurrenceKey(left.relativePath, left.path),
      physicalOccurrenceKey(right.relativePath, right.path),
    ),
  )
  const operations = sortedInputs.map((input) => {
    const source = sources.find((candidate) => candidate.filepath === input.filepath)!
    const sourceFile = sourceFiles.find((candidate) => candidate.path === source.path)!
    const occurrenceId = createRepositoryId(
      'occurrence',
      canonicalJson({ file: source.path, path: input.path }),
    )
    const base = {
      occurrenceId,
      sourceFileId: sourceFile.id,
      file: source.path,
      path: [...input.path],
      name: input.name,
      sourceByteHash: source.byteHash,
      expectedValue: input.expectedValue,
      requestedValue: input.requestedValue,
    }
    return { id: `operation-${hashExactBytes(canonicalJson(base)).slice(0, 24)}`, ...base }
  })
  const occurrences = operations.map((operation) => ({
    id: operation.occurrenceId,
    ownerId: packages.find((pkg) => pkg.sourceFileId === operation.sourceFileId)!.id,
    sourceFileId: operation.sourceFileId,
    file: operation.file,
    name: operation.name,
    path: [...operation.path],
    field: operation.path[0] ?? 'dependencies',
    role: 'dependency' as const,
    protocol: 'semver' as const,
    declaredValue: operation.expectedValue,
    writeable: true,
  }))
  const identity = createRepositoryId('repository', '.')
  const repositorySources = sources.map(({ path, byteHash }) => ({ path, byteHash }))
  const repository = {
    identity,
    fingerprint: createRepositoryFingerprint({
      schemaVersion: 1,
      rootIdentity: identity,
      sources: repositorySources,
    }),
    modelSchemaVersion: 1 as const,
    sources: repositorySources,
    boundaries: [],
    sourceFiles,
    packages,
    catalogs: [],
    runtimeDeclarations: [],
    relationships: {
      workspaceMembers: [],
      catalogConsumers: [],
      boundaryPackages: [],
      lockfileBoundaries: [],
    },
  }
  const rawVcs = collectVcsEvidence(
    root,
    sources.map((source) => source.path),
  )
  const vcs = {
    status: rawVcs.status,
    ...(rawVcs.shallow === undefined ? {} : { shallow: rawVcs.shallow }),
    targetFiles: rawVcs.targetFiles.map((target) => ({
      path: target.path,
      state: target.state,
      ...(target.originalPath === undefined ? {} : { originalPath: target.originalPath }),
    })),
    unrelatedDirtyPaths: [...rawVcs.unrelatedDirtyPaths],
    diagnostics: rawVcs.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      path: diagnostic.path,
      ...(diagnostic.detail === undefined ? {} : { detail: diagnostic.detail }),
    })),
  }
  const decisions = operations.map((operation) => ({
    occurrenceId: operation.occurrenceId,
    status: 'operation' as const,
    reason: 'LEGACY_WRITE_SELECTED',
    operationId: operation.id,
    policy: {
      status: 'selected' as const,
      reason: 'POLICY_DEFAULT_INCLUDED' as const,
      action: 'include' as const,
      mode: 'default' as const,
      matchedRuleIds: [],
      indeterminateRuleIds: [],
    },
  }))
  const semantic = {
    contract: 'depfresh.plan' as const,
    schemaVersion: 1 as const,
    toolVersion: version,
    repository,
    asOf: '1970-01-01T00:00:00.000Z',
    occurrences,
    decisions,
    operations,
    execution: {
      mode: 'file-only' as const,
      status: 'ready' as const,
      timeoutMs: 120_000,
      targets: [],
    },
    evidence: [],
    lockfiles: [],
    vcs,
    diagnostics: [],
    risks: [],
    errors: [],
    requiredCapabilities: [
      'filesystem-read' as const,
      'registry-read' as const,
      ...(operations.length === 0 ? [] : (['file-write'] as const)),
    ],
    summary: {
      total: operations.length,
      operations: operations.length,
      unchanged: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      errors: 0,
    },
  }
  const plan = { ...semantic, planFingerprint: createPlanFingerprint(semantic) }
  assertPlanResult(plan)
  return plan
}

function projectAppliedPackages(
  selections: readonly LegacyCommandSelection[],
  projections: readonly LegacyProjection[],
  result: ApplyResult,
): Array<{ packageIndex: number; outcomes: WriteOutcome[] }> {
  const operations = new Map(
    result.operations.map((operation) => [operation.operationId, operation]),
  )
  return selections.map((selection) => ({
    packageIndex: selection.packageIndex,
    outcomes: projections
      .filter((projection) => projection.packageIndex === selection.packageIndex)
      .sort((left, right) => left.changeIndex - right.changeIndex)
      .map((projection) => {
        const operation = projection.operationId
          ? operations.get(projection.operationId)
          : undefined
        if (!operation) return outcomeFromProjection(projection, 'failed', 'WRITE_FAILED')
        return {
          name: projection.change.name,
          occurrence: { file: projection.occurrence.file, path: [...projection.occurrence.path] },
          expectedValue: projection.expectedValue,
          requestedValue: projection.requestedValue,
          ...(operation.observedValue === undefined
            ? {}
            : { observedValue: operation.observedValue }),
          status: operation.status,
          reason: toLegacyReason(operation.reason),
        }
      }),
  }))
}

function projectBlockedPackages(
  selections: readonly LegacyCommandSelection[],
  projections: readonly LegacyProjection[],
): Array<{ packageIndex: number; outcomes: WriteOutcome[] }> {
  return selections.map((selection) => ({
    packageIndex: selection.packageIndex,
    outcomes: projections
      .filter((projection) => projection.packageIndex === selection.packageIndex)
      .sort((left, right) => left.changeIndex - right.changeIndex)
      .map(
        (projection) =>
          projection.blockedOutcome ?? outcomeFromProjection(projection, 'failed', 'WRITE_FAILED'),
      ),
  }))
}

function createAttemptEvidence(
  root: string,
  projections: readonly LegacyProjection[],
): Map<string, LegacyCommandResultBase['attempts'][number]> {
  const attempts = new Map<string, LegacyCommandResultBase['attempts'][number]>()
  const seen = new Set<string>()
  const ordered = projections
    .filter(
      (projection): projection is LegacyProjection & { physicalKey: string; operationId: string } =>
        projection.physicalKey !== undefined && projection.operationId !== undefined,
    )
    .sort((left, right) => compareText(left.physicalKey, right.physicalKey))
  for (const projection of ordered) {
    if (seen.has(projection.operationId)) continue
    seen.add(projection.operationId)
    const targetPath = repositoryRelative(root, projection.occurrence.file)
    const attempt = attempts.get(targetPath)
    if (attempt) attempt.operationIds.push(projection.operationId)
    else {
      attempts.set(targetPath, {
        targetPath,
        operationIds: [projection.operationId],
        replacementAttempted: false,
      })
    }
  }
  return attempts
}

function createBlockedOperationId(physicalKey: string, valuePairs: ReadonlySet<string>): string {
  const evidence = canonicalJson({
    kind: 'legacy-blocked-operation',
    physicalKey,
    valuePairs: [...valuePairs].sort(compareText),
  })
  return `operation-${hashExactBytes(evidence).slice(0, 24)}`
}

function sortedAttempts(
  attempts: ReadonlyMap<string, LegacyCommandResultBase['attempts'][number]>,
): LegacyCommandResultBase['attempts'] {
  return [...attempts.values()].sort((left, right) =>
    compareText(left.targetPath, right.targetPath),
  )
}

function outcomeFromProjection(
  projection: LegacyProjection,
  status: WriteOutcome['status'],
  reason: WriteOutcome['reason'],
): WriteOutcome {
  return {
    name: projection.change.name,
    occurrence: { file: projection.occurrence.file, path: [...projection.occurrence.path] },
    expectedValue: projection.expectedValue,
    requestedValue: projection.requestedValue,
    status,
    reason,
  }
}

function requireCanonicalRoot(root: string): string {
  if (!isAbsolute(root)) {
    throw new ConfigError('Legacy apply root must be an existing canonical directory.', {
      reason: 'INVALID_CONFIG',
    })
  }
  const resolved = resolve(root)
  try {
    const lexical = lstatSync(resolved)
    const canonical = realpathSync.native(resolved)
    if (!lexical.isDirectory() || lexical.isSymbolicLink() || canonical !== resolved) {
      throw new ConfigError('Legacy apply root must be an existing canonical directory.', {
        reason: 'INVALID_CONFIG',
      })
    }
    return canonical
  } catch {
    throw new ConfigError('Legacy apply root must be an existing canonical directory.', {
      reason: 'INVALID_CONFIG',
    })
  }
}

function canonicalContainedSource(root: string, filepath: string): string | undefined {
  const lexicalPath = resolve(filepath)
  try {
    const lexical = lstatSync(lexicalPath)
    if (!lexical.isFile() || lexical.isSymbolicLink()) return undefined
    const canonical = realpathSync.native(lexicalPath)
    if (!inside(root, canonical)) return undefined
    return canonical
  } catch {
    return undefined
  }
}

function stableInput(inputs: readonly LegacyOperationInput[]): LegacyOperationInput {
  return [...inputs].sort((left, right) => {
    const leftValue = canonicalJson({
      name: left.name,
      expectedValue: left.expectedValue,
      requestedValue: left.requestedValue,
      indent: left.indent,
    })
    const rightValue = canonicalJson({
      name: right.name,
      expectedValue: right.expectedValue,
      requestedValue: right.requestedValue,
      indent: right.indent,
    })
    return compareText(leftValue, rightValue)
  })[0]!
}

function physicalOccurrenceKey(file: string, path: readonly string[]): string {
  return canonicalJson({ file, path })
}

function detectNewline(value: string): 'crlf' | 'lf' | 'mixed' | 'none' {
  const crlf = (value.match(/\r\n/gu) ?? []).length
  const lf = (value.match(/(?<!\r)\n/gu) ?? []).length
  if (crlf > 0 && lf > 0) return 'mixed'
  if (crlf > 0) return 'crlf'
  if (lf > 0) return 'lf'
  return 'none'
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function inside(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || !(value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value))
}

function repositoryRelative(root: string, filepath: string): string {
  return relative(root, filepath).split(sep).join('/')
}

function findCatalogMatches(catalogs: CatalogSource[], change: ResolvedDepChange): CatalogSource[] {
  return catalogs.filter((catalog) =>
    catalog.deps.some(
      (dependency) =>
        dependency.name === change.name &&
        (change.parents.length === 0 ||
          (dependency.parents.length === change.parents.length &&
            dependency.parents.every((parent, index) => parent === change.parents[index]))),
    ),
  )
}

function toLegacyReason(reason: string): WriteOutcome['reason'] {
  const known: WriteOutcome['reason'][] = [
    'APPLIED',
    'NO_CHANGE',
    'EXPECTED_VALUE_MISMATCH',
    'OCCURRENCE_NOT_FOUND',
    'AMBIGUOUS_OCCURRENCE',
    'READ_FAILED',
    'PARSE_FAILED',
    'WRITE_FAILED',
    'VCS_UNAVAILABLE',
    'OBSERVATION_FAILED',
  ]
  return known.includes(reason as WriteOutcome['reason'])
    ? (reason as WriteOutcome['reason'])
    : 'WRITE_FAILED'
}

function toLegacyDiagnostics(
  diagnostics: PlanResult['vcs']['diagnostics'],
  operations: Array<{ file: string; reason: string }>,
  root: string,
): LegacyWriteDiagnostic[] {
  const unavailableTargets = [
    ...new Set(
      operations
        .filter((operation) => operation.reason === 'VCS_UNAVAILABLE')
        .map((operation) => operation.file),
    ),
  ]
  const projected = new Map<string, LegacyWriteDiagnostic>()
  for (const diagnostic of diagnostics) {
    if (!LEGACY_VCS_DIAGNOSTIC_CODES.has(diagnostic.code)) continue
    for (const file of unavailableTargets) {
      const identity = resolve(root, file)
      projected.set(canonicalJson([diagnostic.code, identity]), {
        code: diagnostic.code as RepositoryDiagnosticCode,
        target: {
          identity,
          display: sanitizeContractText(file),
        },
      })
    }
  }
  return [...projected.values()]
}
