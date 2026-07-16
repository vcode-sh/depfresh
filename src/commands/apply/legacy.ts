import { readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { version } from '../../../package.json' with { type: 'json' }
import { canonicalJson } from '../../contracts/canonical-json'
import {
  createPlanFingerprint,
  createRepositoryFingerprint,
  hashExactBytes,
} from '../../contracts/fingerprint'
import type { PlanResult } from '../../contracts/schemas'
import { assertPlanResult } from '../../contracts/validate'
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
  ResolvedDepChange,
  WriteOutcome,
} from '../../types'
import { apply } from './index'

interface LegacyOperationInput {
  filepath: string
  path: string[]
  change: ResolvedDepChange
  expectedValue: string
  requestedValue: string
}

export async function applyLegacyPackageWrite(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
  _loglevel: 'silent' | 'info' | 'debug',
  authority: InvocationAuthority,
): Promise<WriteOutcome[]> {
  const collected = collectInputs(pkg, changes)
  if (!collected.ok) return collected.outcomes
  const { inputs } = collected
  const root = commonRoot(inputs.map((input) => input.filepath))
  const plan = createLegacyPlan(root, inputs)
  const result = await apply(plan, { cwd: root }, authority)
  return result.operations.map((operation) => ({
    name: operation.name,
    occurrence: { file: resolve(root, operation.file), path: [...operation.path] },
    expectedValue: operation.expectedValue,
    requestedValue: operation.requestedValue,
    ...(operation.observedValue === undefined ? {} : { observedValue: operation.observedValue }),
    status: operation.status,
    reason: toLegacyReason(operation.reason),
  }))
}

function collectInputs(
  pkg: PackageMeta,
  changes: ResolvedDepChange[],
): { ok: true; inputs: LegacyOperationInput[] } | { ok: false; outcomes: WriteOutcome[] } {
  const inputs: LegacyOperationInput[] = []
  const failures: WriteOutcome[] = []
  for (const change of changes) {
    if (pkg.type === 'package.json' || pkg.type === 'package.yaml') {
      const request = createPackageWriteRequest(pkg, change)
      const values = resolvePhysicalValues(request, undefined)
      inputs.push({
        filepath: request.occurrence.file,
        path: request.occurrence.path,
        change,
        ...values,
      })
      continue
    }
    const matches = findCatalogMatches(pkg.catalogs ?? [], change)
    if (matches.length !== 1) {
      failures.push({
        name: change.name,
        occurrence: { file: pkg.filepath, path: [...change.parents, change.name] },
        expectedValue: change.rawVersion ?? change.currentVersion,
        requestedValue: change.targetVersion,
        status: 'failed',
        reason: matches.length > 1 ? 'AMBIGUOUS_OCCURRENCE' : 'OCCURRENCE_NOT_FOUND',
      })
      continue
    }
    const request = createCatalogWriteRequest(matches[0]!, change)
    const values = resolvePhysicalValues(request, undefined)
    inputs.push({
      filepath: request.occurrence.file,
      path: request.occurrence.path,
      change,
      ...values,
    })
  }
  if (failures.length === 0) return { ok: true, inputs }
  return {
    ok: false,
    outcomes: changes.map((change) => {
      const failure = failures.find((candidate) => candidate.name === change.name)
      return (
        failure ?? {
          name: change.name,
          occurrence: { file: pkg.filepath, path: [change.source, ...change.parents, change.name] },
          expectedValue: change.rawVersion ?? change.currentVersion,
          requestedValue: change.targetVersion,
          status: 'failed',
          reason: 'UNSUPPORTED_WRITE_SOURCE',
        }
      )
    }),
  }
}

function createLegacyPlan(root: string, inputs: LegacyOperationInput[]): PlanResult {
  const files = [...new Set(inputs.map((input) => input.filepath))].sort()
  const sources = files.map((filepath) => {
    const bytes = readFileSync(filepath)
    return {
      filepath,
      path: repositoryRelative(root, filepath),
      bytes,
      byteHash: hashExactBytes(bytes),
    }
  })
  const sourceFiles = sources.map((source) => ({
    id: createRepositoryId('source', source.path),
    path: source.path,
    format: source.path.endsWith('.json') ? ('json' as const) : ('yaml' as const),
    byteHash: source.byteHash,
    parseState: 'parsed' as const,
    indent: '  ',
    newline: source.bytes.includes(Buffer.from('\r\n')) ? ('crlf' as const) : ('lf' as const),
    trailingNewline: source.bytes.toString('utf8').endsWith('\n'),
  }))
  const packages = sourceFiles.map((source, index) => ({
    id: createRepositoryId('package', source.path),
    sourceFileId: source.id,
    path: source.path,
    workspacePath: dirname(source.path) === '.' ? '.' : dirname(source.path),
    name: `legacy-${index}`,
    private: false,
  }))
  const operations = inputs.map((input, index) => {
    const source = sources.find((candidate) => candidate.filepath === input.filepath)!
    const sourceFile = sourceFiles.find((candidate) => candidate.path === source.path)!
    const occurrenceId = createRepositoryId(
      'occurrence',
      `${source.path}\0${JSON.stringify(input.path)}\0${index}`,
    )
    const base = {
      occurrenceId,
      sourceFileId: sourceFile.id,
      file: source.path,
      path: [...input.path],
      name: input.change.name,
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
    evidence: [],
    lockfiles: [],
    vcs,
    diagnostics: [],
    risks: [],
    errors: [],
    requiredCapabilities: [
      'filesystem-read' as const,
      'registry-read' as const,
      'file-write' as const,
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

function commonRoot(paths: string[]): string {
  const canonical = paths.map((path) => realpathSync.native(path))
  let root = dirname(canonical[0]!)
  while (canonical.some((path) => !inside(root, path))) {
    const parent = dirname(root)
    if (parent === root) break
    root = parent
  }
  return root
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
    'OBSERVATION_FAILED',
  ]
  return known.includes(reason as WriteOutcome['reason'])
    ? (reason as WriteOutcome['reason'])
    : 'WRITE_FAILED'
}
