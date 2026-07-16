import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import detectIndent from 'detect-indent'
import YAML from 'yaml'
import { resolveContainedPath } from '../io/packages/containment'
import type { PackageMeta } from '../types'
import type { DiscoveryReport } from '../types/options'
import type {
  RepositoryCatalog,
  RepositoryDependencyOccurrence,
  RepositoryDependencyProtocol,
  RepositoryDiagnostic,
  RepositoryModel,
  RepositoryOccurrenceRole,
  RepositoryPackageManifest,
  RepositorySourceFile,
} from '../types/repository'
import { REPOSITORY_MODEL_SCHEMA_VERSION } from '../types/repository'
import { collectRepositoryEvidence } from './evidence'
import { createRepositoryId, hashSourceBytes, toRepositoryRelativePath } from './identity'

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

const OVERRIDE_FIELDS = [
  { field: 'overrides', path: ['overrides'] },
  { field: 'resolutions', path: ['resolutions'] },
  { field: 'pnpm.overrides', path: ['pnpm', 'overrides'] },
] as const

interface ParsedSource {
  source: RepositorySourceFile
  raw?: Record<string, unknown>
}

interface CatalogDefinition {
  catalog: RepositoryCatalog
  entries: Array<{ name: string; declaredText: string; path: string[] }>
}

export function buildRepositoryModel(
  root: string,
  projection: PackageMeta[],
  report: DiscoveryReport,
  ignorePaths: readonly string[] = [],
): RepositoryModel {
  const diagnostics = diagnosticsFromDiscovery(root, report)
  const sourcePaths = collectSourcePaths(root, projection, report)
  const parsedSourceCandidates = sourcePaths.flatMap((filepath) => {
    const parsed = parseSource(root, filepath, diagnostics)
    return parsed ? [parsed] : []
  })
  const parsedSources = [
    ...new Map(parsedSourceCandidates.map((parsed) => [parsed.source.path, parsed])).values(),
  ]
  const sourcesByPath = new Map(parsedSources.map((parsed) => [parsed.source.path, parsed]))
  const packages = buildPackages(root, projection, sourcesByPath)
  const catalogDefinitions = buildCatalogDefinitions(parsedSources)
  const catalogs = catalogDefinitions.map((definition) => definition.catalog)
  const catalogsByName = new Map<string, RepositoryCatalog[]>()
  for (const catalog of catalogs) {
    const matching = catalogsByName.get(catalogKey(catalog.name)) ?? []
    matching.push(catalog)
    catalogsByName.set(catalogKey(catalog.name), matching)
  }
  const occurrences: RepositoryDependencyOccurrence[] = []

  for (const manifest of packages) {
    const parsed = sourcesByPath.get(manifest.path)
    if (!parsed?.raw) continue
    collectManifestOccurrences(
      manifest,
      parsed.source,
      parsed.raw,
      catalogsByName,
      occurrences,
      diagnostics,
    )
  }

  for (const definition of catalogDefinitions) {
    const { catalog } = definition
    const source = parsedSources.find((candidate) => candidate.source.id === catalog.sourceFileId)
    if (!source) continue
    for (const entry of definition.entries) {
      const occurrence = createOccurrence({
        ownerId: catalog.id,
        sourceFileId: source.source.id,
        sourcePath: source.source.path,
        name: entry.name,
        path: entry.path,
        field: 'catalog',
        role: 'catalog-owner',
        protocol: detectProtocol(entry.declaredText),
        declaredText: entry.declaredText,
        catalogId: catalog.id,
        writeable: true,
      })
      occurrences.push(occurrence)
      catalog.entries.push({ name: entry.name, occurrenceId: occurrence.id })
    }
    catalog.entries.sort(compareCatalogEntries)
  }

  const workspaceMembers = buildWorkspaceRelationships(packages, sourcesByPath)
  const catalogConsumers = occurrences
    .filter((occurrence) => occurrence.role === 'catalog-consumer' && occurrence.catalogId)
    .map((occurrence) => ({ catalogId: occurrence.catalogId!, occurrenceId: occurrence.id }))
    .sort(
      (a, b) =>
        a.catalogId.localeCompare(b.catalogId) || a.occurrenceId.localeCompare(b.occurrenceId),
    )

  const sourceFiles = parsedSources.map((parsed) => parsed.source).sort(compareByPath)
  const sortedPackages = packages.sort(compareByPath)
  const extension = collectRepositoryEvidence(
    root,
    report,
    sourceFiles,
    sortedPackages,
    diagnostics,
    ignorePaths,
  )

  const model: RepositoryModel = {
    schemaVersion: REPOSITORY_MODEL_SCHEMA_VERSION,
    rootId: createRepositoryId('repository', '.'),
    root: extension.root,
    boundaries: extension.boundaries,
    sourceFiles,
    packages: sortedPackages,
    catalogs: catalogs.sort((a, b) => a.id.localeCompare(b.id)),
    lockfiles: extension.lockfiles,
    runtimeDeclarations: extension.runtimeDeclarations,
    vcs: extension.vcs,
    evidence: extension.evidence,
    occurrences: occurrences.sort((a, b) => a.id.localeCompare(b.id)),
    relationships: {
      workspaceMembers,
      catalogConsumers,
      boundaryPackages: extension.boundaryPackages,
      lockfileBoundaries: extension.lockfileBoundaries,
    },
    diagnostics: diagnostics.sort(compareDiagnostics),
    evidenceRefs: extension.evidence.map((conclusion) => conclusion.id),
  }
  recordIdCollisions(model)
  model.diagnostics.sort(compareDiagnostics)
  return model
}

function collectSourcePaths(
  root: string,
  projection: PackageMeta[],
  report: DiscoveryReport,
): string[] {
  const paths = new Set(report.matchedManifests)
  for (const pkg of projection) {
    if (pkg.type !== 'global') paths.add(pkg.filepath)
    for (const catalog of pkg.catalogs ?? []) paths.add(catalog.filepath)
  }
  for (const filename of ['pnpm-workspace.yaml', '.yarnrc.yml']) {
    const filepath = join(root, filename)
    if (existsSync(filepath)) paths.add(filepath)
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

function parseSource(
  root: string,
  filepath: string,
  diagnostics: RepositoryDiagnostic[],
): ParsedSource | undefined {
  const contained = resolveContainedPath(root, filepath)
  if (!contained.allowed) {
    diagnostics.push({ code: 'SOURCE_OUTSIDE_ROOT', path: lexicalRelativePath(root, filepath) })
    return undefined
  }
  const path = toRepositoryRelativePath(root, contained.path)
  if (!path) return undefined

  let content: Buffer
  try {
    content = readFileSync(contained.path)
  } catch {
    diagnostics.push({ code: 'SOURCE_PARSE_FAILED', path })
    return undefined
  }
  const text = content.toString('utf-8')
  const format = path.endsWith('.json') ? 'json' : 'yaml'
  let raw: Record<string, unknown> | undefined
  let parseState: RepositorySourceFile['parseState'] = 'parsed'
  try {
    const value = format === 'json' ? JSON.parse(text) : YAML.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      raw = value as Record<string, unknown>
    } else {
      parseState = 'error'
    }
  } catch {
    parseState = 'error'
  }
  if (parseState === 'error') diagnostics.push({ code: 'SOURCE_PARSE_FAILED', path })

  return {
    source: {
      id: createRepositoryId('source', path),
      path,
      format,
      byteHash: hashSourceBytes(content),
      parseState,
      indent: detectIndent(text).indent || '  ',
      newline: detectNewline(text),
      trailingNewline: /\r?\n$/u.test(text),
    },
    raw,
  }
}

function buildPackages(
  root: string,
  projection: PackageMeta[],
  sourcesByPath: Map<string, ParsedSource>,
): RepositoryPackageManifest[] {
  return projection.flatMap((pkg) => {
    if (pkg.type !== 'package.json' && pkg.type !== 'package.yaml') return []
    const path = toRepositoryRelativePath(root, pkg.filepath)
    if (!path) return []
    const source = sourcesByPath.get(path)
    if (!source) return []
    return [
      {
        id: createRepositoryId('package', path),
        sourceFileId: source.source.id,
        path,
        workspacePath: normalizeWorkspacePath(dirname(path)),
        name:
          typeof source.raw?.name === 'string'
            ? source.raw.name
            : normalizeWorkspacePath(dirname(path)),
        private: source.raw?.private === true,
      },
    ]
  })
}

function buildCatalogDefinitions(parsedSources: ParsedSource[]): CatalogDefinition[] {
  const definitions: CatalogDefinition[] = []
  for (const parsed of parsedSources) {
    if (!parsed.raw) continue
    if (parsed.source.path.endsWith('pnpm-workspace.yaml')) {
      addCatalogSections(definitions, parsed, 'pnpm', ['catalog'], ['catalogs'])
    } else if (parsed.source.path.endsWith('.yarnrc.yml')) {
      addCatalogSections(definitions, parsed, 'yarn', ['catalog'])
    } else if (parsed.source.path.endsWith('package.json')) {
      addCatalogSections(
        definitions,
        parsed,
        'bun',
        ['workspaces', 'catalog'],
        ['workspaces', 'catalogs'],
      )
    }
  }
  return definitions.sort((a, b) => a.catalog.id.localeCompare(b.catalog.id))
}

function addCatalogSections(
  definitions: CatalogDefinition[],
  parsed: ParsedSource,
  manager: RepositoryCatalog['manager'],
  defaultPath: string[],
  namedPath?: string[],
): void {
  const defaultCatalog = getAtPath(parsed.raw!, defaultPath)
  if (defaultCatalog) {
    definitions.push(
      createCatalogDefinition(parsed, manager, 'default', defaultPath, defaultCatalog),
    )
  }

  if (!namedPath) return
  const namedCatalogs = getAtPath(parsed.raw!, namedPath)
  if (!namedCatalogs) return
  for (const [name, value] of Object.entries(namedCatalogs)) {
    const section = asRecord(value)
    if (section) {
      definitions.push(
        createCatalogDefinition(parsed, manager, name, [...namedPath, name], section),
      )
    }
  }
}

function createCatalogDefinition(
  parsed: ParsedSource,
  manager: RepositoryCatalog['manager'],
  name: string,
  path: string[],
  section: Record<string, unknown>,
): CatalogDefinition {
  const id = createRepositoryId('catalog', `${parsed.source.path}\0${manager}\0${name}`)
  const entries = Object.entries(section).flatMap(([entryName, declaredText]) =>
    typeof declaredText === 'string'
      ? [{ name: entryName, declaredText, path: [...path, entryName] }]
      : [],
  )
  return {
    catalog: {
      id,
      sourceFileId: parsed.source.id,
      manager,
      format: parsed.source.format,
      name,
      entries: [],
    },
    entries,
  }
}

function collectManifestOccurrences(
  manifest: RepositoryPackageManifest,
  source: RepositorySourceFile,
  raw: Record<string, unknown>,
  catalogs: Map<string, RepositoryCatalog[]>,
  occurrences: RepositoryDependencyOccurrence[],
  diagnostics: RepositoryDiagnostic[],
): void {
  for (const field of DEPENDENCY_FIELDS) {
    const section = asRecord(raw[field])
    if (!section) continue
    for (const [name, declaredText] of Object.entries(section)) {
      if (typeof declaredText !== 'string') continue
      const catalogName = getCatalogReference(declaredText)
      const matchingCatalogs =
        catalogName === undefined ? [] : (catalogs.get(catalogKey(catalogName)) ?? [])
      const catalog = matchingCatalogs.length === 1 ? matchingCatalogs[0] : undefined
      const role: RepositoryOccurrenceRole =
        catalogName === undefined ? 'dependency' : 'catalog-consumer'
      if (catalogName !== undefined && !catalog) {
        diagnostics.push({
          code:
            matchingCatalogs.length > 1
              ? 'CATALOG_REFERENCE_AMBIGUOUS'
              : 'CATALOG_REFERENCE_UNRESOLVED',
          path: source.path,
          detail: `${field}.${name}`,
        })
      }
      occurrences.push(
        createOccurrence({
          ownerId: manifest.id,
          sourceFileId: source.id,
          sourcePath: source.path,
          name,
          path: [field, name],
          field,
          role,
          protocol: detectProtocol(declaredText),
          declaredText,
          catalogId: catalog?.id,
          writeable: role === 'dependency' && isWriteableDeclaration(declaredText),
        }),
      )
    }
  }

  if (typeof raw.packageManager === 'string') {
    occurrences.push(
      createOccurrence({
        ownerId: manifest.id,
        sourceFileId: source.id,
        sourcePath: source.path,
        name: raw.packageManager.split('@')[0] ?? 'packageManager',
        path: ['packageManager'],
        field: 'packageManager',
        role: 'package-manager',
        protocol: 'semver',
        declaredText: raw.packageManager,
        writeable: true,
      }),
    )
  }

  for (const override of OVERRIDE_FIELDS) {
    const section = getAtPath(raw, override.path)
    if (!section) continue
    collectOverrideOccurrences(
      manifest,
      source,
      override.field,
      override.path,
      section,
      occurrences,
    )
  }
}

function collectOverrideOccurrences(
  manifest: RepositoryPackageManifest,
  source: RepositorySourceFile,
  field: string,
  path: readonly string[],
  section: Record<string, unknown>,
  occurrences: RepositoryDependencyOccurrence[],
): void {
  for (const [key, value] of Object.entries(section)) {
    if (typeof value === 'string') {
      occurrences.push(
        createOccurrence({
          ownerId: manifest.id,
          sourceFileId: source.id,
          sourcePath: source.path,
          name: parseOverrideName(key),
          path: [...path, key],
          field,
          role: 'override',
          protocol: detectProtocol(value),
          declaredText: value,
          writeable: isWriteableDeclaration(value),
        }),
      )
    } else {
      const nested = asRecord(value)
      if (nested) {
        collectOverrideOccurrences(manifest, source, field, [...path, key], nested, occurrences)
      }
    }
  }
}

interface OccurrenceInput {
  ownerId: string
  sourceFileId: string
  sourcePath: string
  name: string
  path: string[]
  field: string
  role: RepositoryOccurrenceRole
  protocol: RepositoryDependencyProtocol
  declaredText: string
  catalogId?: string
  writeable: boolean
}

function createOccurrence(input: OccurrenceInput): RepositoryDependencyOccurrence {
  const identity = `${input.sourcePath}\0${input.ownerId}\0${JSON.stringify(input.path)}`
  return {
    id: createRepositoryId('occurrence', identity),
    ownerId: input.ownerId,
    sourceFileId: input.sourceFileId,
    name: input.name,
    path: input.path,
    field: input.field,
    role: input.role,
    protocol: input.protocol,
    declaredText: input.declaredText,
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
    writeable: input.writeable,
  }
}

function buildWorkspaceRelationships(
  packages: RepositoryPackageManifest[],
  sourcesByPath: Map<string, ParsedSource>,
) {
  const rootPackage = packages.find((pkg) => pkg.workspacePath === '.')
  if (!rootPackage) return []
  const rootSource = sourcesByPath.get(rootPackage.path)
  const declaresWorkspace =
    rootSource?.raw?.workspaces !== undefined || sourcesByPath.has('pnpm-workspace.yaml')
  if (!declaresWorkspace) return []
  return packages
    .filter((pkg) => pkg.id !== rootPackage.id)
    .map((pkg) => ({ workspaceId: rootPackage.id, packageId: pkg.id }))
    .sort((a, b) => a.packageId.localeCompare(b.packageId))
}

function diagnosticsFromDiscovery(root: string, report: DiscoveryReport): RepositoryDiagnostic[] {
  const diagnostics: RepositoryDiagnostic[] = []
  for (const entry of report.skippedManifests) {
    if (entry.reason.includes('ROOT_NOT_FOUND')) {
      diagnostics.push({ code: 'ROOT_NOT_FOUND', path: lexicalRelativePath(root, entry.path) })
      continue
    }
    if (/SYMLINK_ESCAPE|OUTSIDE_ROOT|PARENT_TRAVERSAL/u.test(entry.reason)) {
      diagnostics.push({
        code: 'SOURCE_OUTSIDE_ROOT' as const,
        path: lexicalRelativePath(root, entry.path),
        detail: entry.reason,
      })
    }
  }
  return diagnostics
}

function lexicalRelativePath(root: string, filepath: string): string {
  const relativePath = toRepositoryRelativePath(root, filepath)
  return relativePath ?? filepath.split(/[\\/]/u).at(-1) ?? '.'
}

function recordIdCollisions(model: RepositoryModel): void {
  const identities = [
    ...model.sourceFiles.map((value) => ({ id: value.id, path: value.path })),
    ...model.packages.map((value) => ({ id: value.id, path: value.path })),
    ...model.catalogs.map((value) => ({ id: value.id, path: value.sourceFileId })),
    ...model.occurrences.map((value) => ({ id: value.id, path: value.sourceFileId })),
    ...(model.boundaries ?? []).flatMap((boundary) => [
      { id: boundary.id, path: boundary.path },
      ...boundary.markers.map((marker) => ({ id: marker.id, path: marker.path })),
    ]),
    ...(model.lockfiles ?? []).map((value) => ({ id: value.id, path: value.path })),
    ...(model.runtimeDeclarations ?? []).map((value) => ({ id: value.id, path: value.path })),
    ...(model.evidence ?? []).map((conclusion) => ({
      id: conclusion.id,
      path: conclusion.boundaryId ?? '.',
    })),
  ]
  const seen = new Set<string>()
  for (const identity of identities) {
    if (seen.has(identity.id)) {
      model.diagnostics.push({ code: 'ID_COLLISION', path: identity.path, detail: identity.id })
    }
    seen.add(identity.id)
  }
}

function getAtPath(raw: Record<string, unknown>, path: readonly string[]) {
  let current: unknown = raw
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return asRecord(current)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function getCatalogReference(value: string): string | undefined {
  if (!value.startsWith('catalog:')) return undefined
  return value.slice('catalog:'.length) || 'default'
}

function catalogKey(name: string): string {
  return name || 'default'
}

function detectProtocol(value: string): RepositoryDependencyProtocol {
  if (value.startsWith('workspace:')) return 'workspace'
  if (value.startsWith('catalog:')) return 'catalog'
  if (value.startsWith('npm:')) return 'npm'
  if (value.startsWith('jsr:')) return 'jsr'
  if (value.startsWith('github:')) return 'github'
  if (value.startsWith('file:')) return 'file'
  if (value.startsWith('link:')) return 'link'
  if (/^(?:git|git\+[^:]+):/u.test(value)) return 'git'
  if (/^https?:/u.test(value)) return 'http'
  return value.length > 0 ? 'semver' : 'unknown'
}

function isWriteableDeclaration(value: string): boolean {
  return !/^(?:catalog|file|link|git|git\+[^:]+|https?):/u.test(value)
}

function parseOverrideName(key: string): string {
  if (key.startsWith('@')) {
    const separator = key.indexOf('@', 1)
    return separator === -1 ? key : key.slice(0, separator)
  }
  const separator = key.indexOf('@')
  return separator === -1 ? key : key.slice(0, separator)
}

function normalizeWorkspacePath(path: string): string {
  return path === '' ? '.' : path.split('\\').join('/')
}

function detectNewline(value: string): RepositorySourceFile['newline'] {
  const crlf = (value.match(/\r\n/gu) ?? []).length
  const lf = (value.match(/(?<!\r)\n/gu) ?? []).length
  if (crlf > 0 && lf > 0) return 'mixed'
  if (crlf > 0) return 'crlf'
  if (lf > 0) return 'lf'
  return 'none'
}

function compareByPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path)
}

function compareCatalogEntries(
  left: { name: string; occurrenceId: string },
  right: { name: string; occurrenceId: string },
): number {
  return left.name.localeCompare(right.name) || left.occurrenceId.localeCompare(right.occurrenceId)
}

function compareDiagnostics(left: RepositoryDiagnostic, right: RepositoryDiagnostic): number {
  return (
    left.path.localeCompare(right.path) ||
    left.code.localeCompare(right.code) ||
    (left.detail ?? '').localeCompare(right.detail ?? '')
  )
}
