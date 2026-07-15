import type { Dirent } from 'node:fs'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import YAML from 'yaml'
import { resolveContainedPath } from '../io/packages/containment'
import { parsePackageManagerField } from '../io/packages/package-manager-field'
import type { DiscoveryReport } from '../types/options'
import type { PackageManagerField } from '../types/package'
import type {
  RepositoryBoundary,
  RepositoryBoundaryMarker,
  RepositoryDiagnostic,
  RepositoryDiagnosticCode,
  RepositoryEvidenceConclusion,
  RepositoryEvidenceDiagnostic,
  RepositoryEvidenceKind,
  RepositoryEvidenceSource,
  RepositoryLockfile,
  RepositoryLockfileManager,
  RepositoryPackageManifest,
  RepositoryRootEvidence,
  RepositoryRuntimeDeclaration,
  RepositorySourceFile,
  RepositoryVcsEvidence,
} from '../types/repository'
import { createRepositoryId, hashSourceBytes } from './identity'
import { collectVcsEvidence } from './vcs'

const LOCKFILE_NAMES = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
} as const satisfies Record<string, RepositoryLockfileManager>

const BOUNDARY_CANDIDATE_NAMES = [
  'package.json',
  'package.yaml',
  'pnpm-workspace.yaml',
  '.yarnrc.yml',
  ...Object.keys(LOCKFILE_NAMES),
  '.nvmrc',
  '.node-version',
  '.tool-versions',
] as const

interface ParsedManifest {
  path: string
  raw?: Record<string, unknown>
  byteHash: string
}

interface RepositoryWalk {
  files: string[]
  unavailableDirectories: string[]
}

interface LockfileAliasConflict {
  boundaryId: string
  path: string
  manager: RepositoryLockfileManager
}

interface EvidenceExtension {
  root: RepositoryRootEvidence
  boundaries: RepositoryBoundary[]
  lockfiles: RepositoryLockfile[]
  runtimeDeclarations: RepositoryRuntimeDeclaration[]
  vcs: RepositoryVcsEvidence
  evidence: RepositoryEvidenceConclusion[]
  boundaryPackages: Array<{ boundaryId: string; packageId: string }>
  lockfileBoundaries: Array<{ lockfileId: string; boundaryId: string }>
}

export function collectRepositoryEvidence(
  root: string,
  report: DiscoveryReport,
  sourceFiles: RepositorySourceFile[],
  packages: RepositoryPackageManifest[],
  diagnostics: RepositoryDiagnostic[],
  ignorePaths: readonly string[],
): EvidenceExtension {
  const walk = walkRepository(root, ignorePaths, diagnostics)
  const files = walk.files
  const modeledSourcePaths = new Set(sourceFiles.map((source) => source.path))
  const parsedManifests = collectManifests(root, files, modeledSourcePaths)
  const boundaries = collectBoundaries(root, files, parsedManifests, diagnostics)
  const lockfileCollection = collectLockfiles(root, files, boundaries, diagnostics)
  const lockfiles = lockfileCollection.lockfiles
  const runtimeDeclarations = collectRuntimeDeclarations(
    root,
    boundaries,
    parsedManifests,
    diagnostics,
  )
  const rootMissing = report.skippedManifests.some((entry) =>
    entry.reason.includes('ROOT_NOT_FOUND'),
  )
  const rootUnavailable = walk.unavailableDirectories.includes('.')
  const rootDiagnostics = rootMissing
    ? [createEvidenceDiagnostic('ROOT_NOT_FOUND', '.')]
    : rootUnavailable
      ? [createEvidenceDiagnostic('REPOSITORY_DIRECTORY_UNAVAILABLE', '.')]
      : []
  const rootEvidence = createConclusion(
    'root',
    undefined,
    rootMissing || rootUnavailable ? 'unavailable' : 'confirmed',
    rootMissing || rootUnavailable ? [] : [{ path: '.', discoveryMode: report.discoveryMode }],
    [createProbeSource('discovery')],
    rootDiagnostics,
  )
  const rootEntity: RepositoryRootEvidence = {
    id: createRepositoryId('root', '.'),
    path: '.',
    discoveryMode: report.discoveryMode,
    evidenceId: rootEvidence.id,
  }
  const evidence: RepositoryEvidenceConclusion[] = [rootEvidence]

  for (const boundary of boundaries) {
    evidence.push(
      createWorkspaceConclusion(
        boundary,
        boundaries,
        root,
        parsedManifests,
        diagnostics,
        walk.unavailableDirectories,
      ),
    )
    evidence.push(
      createManagerConclusion(
        boundary,
        boundaries,
        parsedManifests,
        lockfiles,
        lockfileCollection.aliasConflicts,
        diagnostics,
        walk.unavailableDirectories,
      ),
    )
    evidence.push(
      createLockfileConclusion(
        boundary,
        boundaries,
        lockfiles,
        lockfileCollection.aliasConflicts,
        diagnostics,
        walk.unavailableDirectories,
      ),
    )
    evidence.push(
      createRuntimeConclusion(
        boundary,
        boundaries,
        runtimeDeclarations,
        diagnostics,
        walk.unavailableDirectories,
      ),
    )
  }

  const modeledTargetPaths = new Set(sourceFiles.map((source) => source.path))
  for (const lockfile of lockfiles) modeledTargetPaths.add(lockfile.path)
  for (const runtime of runtimeDeclarations) modeledTargetPaths.add(runtime.path)
  const targetPaths = new Set(modeledTargetPaths)
  for (const boundary of boundaries) {
    for (const filename of BOUNDARY_CANDIDATE_NAMES) {
      targetPaths.add(joinRelative(boundary.path, filename))
    }
  }
  const vcs = collectBoundaryVcsEvidence(
    root,
    boundaries,
    [...targetPaths].sort((a, b) => a.localeCompare(b)),
    [...modeledTargetPaths].sort((a, b) => a.localeCompare(b)),
  )
  const vcsEvidence = createConclusion(
    'vcs',
    undefined,
    vcs.status,
    [
      {
        ...(vcs.shallow === undefined ? {} : { shallow: vcs.shallow }),
        repositories: vcs.repositories ?? [],
        targetFiles: vcs.targetFiles,
        unrelatedDirtyPaths: vcs.unrelatedDirtyPaths,
      },
    ],
    [createProbeSource('git')],
    vcs.diagnostics,
  )
  evidence.push(vcsEvidence)
  addEvidenceDiagnostics(diagnostics, vcs.diagnostics)

  evidence.sort(compareEvidence)
  return {
    root: rootEntity,
    boundaries,
    lockfiles,
    runtimeDeclarations,
    vcs,
    evidence,
    boundaryPackages: packages
      .map((pkg) => ({
        boundaryId: owningBoundary(boundaries, pkg.workspacePath).id,
        packageId: pkg.id,
      }))
      .sort(compareRelationship),
    lockfileBoundaries: lockfiles
      .map((lockfile) => ({ lockfileId: lockfile.id, boundaryId: lockfile.boundaryId }))
      .sort((a, b) => a.lockfileId.localeCompare(b.lockfileId)),
  }
}

function walkRepository(
  root: string,
  ignorePaths: readonly string[],
  diagnostics: RepositoryDiagnostic[],
): RepositoryWalk {
  if (!existsSync(root)) return { files: [], unavailableDirectories: [] }
  const result: string[] = []
  const unavailableDirectories: string[] = []
  const visit = (directory: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    } catch {
      const path = repositoryPath(root, directory) ?? '.'
      unavailableDirectories.push(path)
      addTopDiagnostic(diagnostics, 'REPOSITORY_DIRECTORY_UNAVAILABLE', path)
      return
    }
    for (const entry of entries) {
      const filepath = join(directory, entry.name)
      const path = repositoryPath(root, filepath)
      if (path && isIgnoredPath(path, ignorePaths)) continue
      if (entry.name === '.git') {
        result.push(filepath)
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(filepath)
        continue
      }
      result.push(filepath)
    }
  }
  visit(root)
  return {
    files: result,
    unavailableDirectories: unavailableDirectories.sort((a, b) => a.localeCompare(b)),
  }
}

function isIgnoredPath(path: string, ignorePaths: readonly string[]): boolean {
  for (const pattern of ignorePaths) {
    if (matchesGlob(path, pattern)) return true
    let ancestor = dirname(path).split(sep).join('/')
    while (ancestor !== '.') {
      if (matchesGlob(`${ancestor}/__depfresh_ignore_probe__`, pattern)) return true
      const parent = dirname(ancestor).split(sep).join('/')
      if (parent === ancestor) break
      ancestor = parent
    }
  }
  return false
}

function collectManifests(
  root: string,
  files: string[],
  modeledSourcePaths: ReadonlySet<string>,
): ParsedManifest[] {
  return files
    .filter((filepath) => /(?:^|[/\\])package\.(?:json|yaml)$/u.test(filepath))
    .flatMap((filepath) => {
      const contained = resolveContainedPath(root, filepath)
      if (!contained.allowed) return []
      const path = repositoryPath(root, contained.path)
      if (!(path && modeledSourcePaths.has(path))) return []
      let content: Buffer
      try {
        content = readFileSync(contained.path)
      } catch {
        return []
      }
      let raw: Record<string, unknown> | undefined
      try {
        const parsed = path.endsWith('.json')
          ? JSON.parse(content.toString('utf-8'))
          : YAML.parse(content.toString('utf-8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed
      } catch {
        // The source-file model owns manifest parse diagnostics.
      }
      return [{ path, raw, byteHash: hashSourceBytes(content) }]
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

function collectBoundaries(
  root: string,
  files: string[],
  manifests: ParsedManifest[],
  diagnostics: RepositoryDiagnostic[],
): RepositoryBoundary[] {
  const markersByPath = new Map<string, RepositoryBoundaryMarker[]>()
  markersByPath.set('.', [])
  const addMarker = (
    boundaryPath: string,
    kind: RepositoryBoundaryMarker['kind'],
    path: string,
  ): void => {
    const markers = markersByPath.get(boundaryPath) ?? []
    const id = createRepositoryId('boundary-marker', `${boundaryPath}\0${kind}\0${path}`)
    if (!markers.some((marker) => marker.id === id)) markers.push({ id, kind, path })
    markersByPath.set(boundaryPath, markers)
  }

  for (const manifest of manifests) {
    if (manifest.raw?.workspaces !== undefined) {
      addMarker(directoryPath(manifest.path), 'manifest-workspaces', manifest.path)
    }
  }
  for (const filepath of files) {
    const name = filepath.split(sep).at(-1)
    let kind: RepositoryBoundaryMarker['kind'] | undefined
    if (name === 'pnpm-workspace.yaml') kind = 'pnpm-workspace'
    else if (name === '.yarnrc.yml') kind = 'yarn-workspace'
    else if (name === '.git') kind = 'git-repo'
    if (!kind) continue
    const contained = resolveContainedPath(root, filepath)
    if (!contained.allowed) {
      addTopDiagnostic(diagnostics, 'SOURCE_OUTSIDE_ROOT', lexicalPath(root, filepath))
      continue
    }
    const path = repositoryPath(root, contained.path)
    if (!path) continue
    addMarker(directoryPath(path), kind, path)
  }

  return [...markersByPath.entries()]
    .map(([path, markers]) => ({
      id: createRepositoryId('boundary', path),
      path,
      classification:
        path === '.'
          ? ('effective-root' as const)
          : markers.some((marker) => marker.kind === 'git-repo')
            ? ('nested-git' as const)
            : ('nested-workspace' as const),
      markers: markers.sort(compareMarker),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function collectLockfiles(
  root: string,
  files: string[],
  boundaries: RepositoryBoundary[],
  diagnostics: RepositoryDiagnostic[],
): { lockfiles: RepositoryLockfile[]; aliasConflicts: LockfileAliasConflict[] } {
  const lockfiles: RepositoryLockfile[] = []
  const aliasConflicts: LockfileAliasConflict[] = []
  const candidatesByPhysicalPath = new Map<
    string,
    Array<{
      filepath: string
      path: string
      filename: keyof typeof LOCKFILE_NAMES
      manager: RepositoryLockfileManager
      isSymbolicLink?: boolean
    }>
  >()
  for (const filepath of files) {
    const filename = filepath.split(sep).at(-1)
    const manager = filename ? LOCKFILE_NAMES[filename as keyof typeof LOCKFILE_NAMES] : undefined
    if (!(filename && manager)) continue
    const contained = resolveContainedPath(root, filepath)
    if (!contained.allowed) {
      addTopDiagnostic(diagnostics, 'LOCKFILE_OUTSIDE_ROOT', lexicalPath(root, filepath))
      continue
    }
    const path = repositoryPath(root, filepath)
    if (!path) continue
    let isSymbolicLink: boolean | undefined
    try {
      isSymbolicLink = lstatSync(filepath).isSymbolicLink()
    } catch {
      addTopDiagnostic(diagnostics, 'LOCKFILE_UNAVAILABLE', path)
    }
    const candidates = candidatesByPhysicalPath.get(contained.path) ?? []
    candidates.push({
      filepath,
      path,
      filename: filename as keyof typeof LOCKFILE_NAMES,
      manager,
      ...(isSymbolicLink === undefined ? {} : { isSymbolicLink }),
    })
    candidatesByPhysicalPath.set(contained.path, candidates)
  }

  for (const [physicalPath, unsortedCandidates] of candidatesByPhysicalPath) {
    const candidates = unsortedCandidates.sort((a, b) => a.path.localeCompare(b.path))
    const direct = candidates.filter((candidate) => candidate.isSymbolicLink === false)
    const selected =
      direct.length === 1 ? direct[0] : candidates.length === 1 ? candidates[0] : undefined
    for (const duplicate of candidates) {
      if (duplicate !== selected) {
        addTopDiagnostic(diagnostics, 'LOCKFILE_DUPLICATE_IDENTITY', duplicate.path)
      }
    }
    if (!selected) {
      for (const candidate of candidates) {
        aliasConflicts.push({
          boundaryId: owningBoundary(boundaries, directoryPath(candidate.path)).id,
          path: candidate.path,
          manager: candidate.manager,
        })
      }
      continue
    }

    if (selected.isSymbolicLink === undefined) {
      lockfiles.push({
        id: createRepositoryId('lockfile', selected.path),
        boundaryId: owningBoundary(boundaries, directoryPath(selected.path)).id,
        manager: selected.manager,
        path: selected.path,
        parseState: 'unavailable',
      })
      continue
    }

    let content: Buffer
    try {
      content = readFileSync(physicalPath)
    } catch {
      lockfiles.push({
        id: createRepositoryId('lockfile', selected.path),
        boundaryId: owningBoundary(boundaries, directoryPath(selected.path)).id,
        manager: selected.manager,
        path: selected.path,
        parseState: 'unavailable',
      })
      addTopDiagnostic(diagnostics, 'LOCKFILE_UNAVAILABLE', selected.path)
      continue
    }
    const parsed = parseLockfile(selected.filename, content)
    const boundary = owningBoundary(boundaries, directoryPath(selected.path))
    const lockfile: RepositoryLockfile = {
      id: createRepositoryId('lockfile', selected.path),
      boundaryId: boundary.id,
      manager: selected.manager,
      path: selected.path,
      byteHash: hashSourceBytes(content),
      parseState: parsed.state,
      ...(parsed.version ? { formatVersion: parsed.version } : {}),
    }
    lockfiles.push(lockfile)
    if (parsed.state === 'error') {
      addTopDiagnostic(diagnostics, 'LOCKFILE_PARSE_FAILED', selected.path)
    }
    if (parsed.state === 'unsupported') {
      addTopDiagnostic(diagnostics, 'LOCKFILE_UNSUPPORTED', selected.path)
    }
  }
  return {
    lockfiles: lockfiles.sort((a, b) => a.path.localeCompare(b.path)),
    aliasConflicts: aliasConflicts.sort(
      (a, b) => a.path.localeCompare(b.path) || a.manager.localeCompare(b.manager),
    ),
  }
}

function parseLockfile(
  filename: string,
  content: Buffer,
): { state: RepositoryLockfile['parseState']; version?: string } {
  if (filename === 'bun.lockb') return { state: 'unsupported' }
  const text = content.toString('utf-8')
  try {
    if (
      filename === 'package-lock.json' ||
      filename === 'npm-shrinkwrap.json' ||
      filename === 'bun.lock'
    ) {
      const errors: Array<{ error: number; offset: number; length: number }> = []
      const parsed = (
        filename === 'bun.lock'
          ? parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false })
          : JSON.parse(text)
      ) as Record<string, unknown>
      if (errors.length > 0) return { state: 'error' }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'error' }
      const version = parsed.lockfileVersion
      if (!(typeof version === 'string' || typeof version === 'number')) {
        return { state: 'error' }
      }
      return {
        state: 'parsed',
        version: String(version),
      }
    }
    if (filename === 'pnpm-lock.yaml') {
      const document = YAML.parseDocument(text)
      if (document.errors.length > 0) return { state: 'error' }
      const parsed = document.toJSON() as Record<string, unknown> | null
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'error' }
      const version = parsed.lockfileVersion
      if (!(typeof version === 'string' || typeof version === 'number')) {
        return { state: 'error' }
      }
      return {
        state: 'parsed',
        version: String(version),
      }
    }
    if (text.startsWith('# yarn lockfile v1')) {
      return isValidYarnV1(text) ? { state: 'parsed', version: '1' } : { state: 'error' }
    }
    const document = YAML.parseDocument(text)
    if (document.errors.length > 0) return { state: 'error' }
    const parsed = document.toJSON() as Record<string, unknown> | null
    const metadata = parsed?.__metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
      return { state: 'error' }
    const version = (metadata as Record<string, unknown>).version
    if (!(typeof version === 'string' || typeof version === 'number')) {
      return { state: 'error' }
    }
    return {
      state: 'parsed',
      version: String(version),
    }
  } catch {
    return { state: 'error' }
  }
}

function isValidYarnV1(text: string): boolean {
  let hasEntry = false
  for (const line of text.split(/\r?\n/u).slice(1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!/^\s/u.test(line)) {
      if (!line.endsWith(':')) return false
      hasEntry = true
      continue
    }
    if (!hasEntry) return false
  }
  return true
}

function collectRuntimeDeclarations(
  root: string,
  boundaries: RepositoryBoundary[],
  manifests: ParsedManifest[],
  diagnostics: RepositoryDiagnostic[],
): RepositoryRuntimeDeclaration[] {
  const declarations: RepositoryRuntimeDeclaration[] = []
  for (const boundary of boundaries) {
    for (const manifest of manifestsAtBoundary(manifests, boundary)) {
      const engines = manifest.raw?.engines
      const node =
        engines && typeof engines === 'object' && !Array.isArray(engines)
          ? (engines as Record<string, unknown>).node
          : undefined
      if (typeof node === 'string' && node.length > 0) {
        declarations.push({
          id: createRepositoryId('runtime', `${manifest.path}\0engines.node`),
          boundaryId: boundary.id,
          kind: 'engines-node',
          path: manifest.path,
          field: 'engines.node',
          declaredText: node,
        })
      }
    }
    for (const filename of ['.nvmrc', '.node-version', '.tool-versions'] as const) {
      const lexical = join(root, boundary.path === '.' ? '' : boundary.path, filename)
      if (!existsSync(lexical)) continue
      const contained = resolveContainedPath(root, lexical)
      if (!contained.allowed) {
        addTopDiagnostic(diagnostics, 'RUNTIME_DECLARATION_UNSUPPORTED', lexicalPath(root, lexical))
        continue
      }
      const path = repositoryPath(root, contained.path)
      if (!path) continue
      let content: Buffer
      try {
        content = readFileSync(contained.path)
      } catch {
        addTopDiagnostic(diagnostics, 'RUNTIME_DECLARATION_UNAVAILABLE', path)
        continue
      }
      const text = content.toString('utf-8')
      if (filename === '.tool-versions') {
        const nodeLines = text
          .split(/\r?\n/u)
          .filter((line) => /^nodejs(?:\s|$)/u.test(line.trim()))
        if (nodeLines.length === 0) continue
        if (nodeLines.length > 1) {
          addTopDiagnostic(diagnostics, 'RUNTIME_DECLARATION_UNSUPPORTED', path)
          continue
        }
        for (const line of nodeLines) {
          const match = line.trim().match(/^nodejs\s+(.+)$/u)
          if (!match?.[1]) {
            addTopDiagnostic(diagnostics, 'RUNTIME_DECLARATION_UNSUPPORTED', path)
            continue
          }
          declarations.push({
            id: createRepositoryId('runtime', `${path}\0nodejs`),
            boundaryId: boundary.id,
            kind: 'tool-versions-nodejs',
            path,
            field: 'nodejs',
            declaredText: match[1],
            byteHash: hashSourceBytes(content),
          })
        }
        continue
      }
      const value = text.trim()
      if (!value || /\s/u.test(value)) {
        addTopDiagnostic(diagnostics, 'RUNTIME_DECLARATION_UNSUPPORTED', path)
        continue
      }
      declarations.push({
        id: createRepositoryId('runtime', path),
        boundaryId: boundary.id,
        kind: filename === '.nvmrc' ? 'nvmrc' : 'node-version',
        path,
        declaredText: value,
        byteHash: hashSourceBytes(content),
      })
    }
  }
  return declarations.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind))
}

function collectBoundaryVcsEvidence(
  root: string,
  boundaries: RepositoryBoundary[],
  targetPaths: string[],
  cleanTargetPaths: string[],
): RepositoryVcsEvidence {
  const rootBoundary = boundaries.find((boundary) => boundary.path === '.') ?? boundaries[0]
  if (!rootBoundary) return collectVcsEvidence(root, targetPaths, { cleanTargetPaths })
  const probes = [
    rootBoundary,
    ...boundaries.filter(
      (boundary) => boundary.path !== '.' && boundary.classification === 'nested-git',
    ),
  ].sort((a, b) => a.path.localeCompare(b.path))
  const targetOwner = (path: string): RepositoryBoundary =>
    [...probes]
      .filter((boundary) => isPathOwnedByBoundary(directoryPath(path), boundary.path))
      .sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))[0] ??
    rootBoundary
  const results = probes.map((boundary) => {
    const ownedTargets = targetPaths.filter((path) => targetOwner(path).id === boundary.id)
    const ownedCleanTargets = cleanTargetPaths.filter(
      (path) => targetOwner(path).id === boundary.id,
    )
    const result = collectVcsEvidence(root, ownedTargets, {
      cleanTargetPaths: ownedCleanTargets,
      worktreePath: join(root, boundary.path === '.' ? '' : boundary.path),
      diagnosticPath: boundary.path,
    })
    return { boundary, result }
  })
  const targetFiles = results
    .flatMap(({ result }) => result.targetFiles)
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.state.localeCompare(b.state) ||
        (a.originalPath ?? '').localeCompare(b.originalPath ?? ''),
    )
    .filter((target, index, values) => {
      const previous = values[index - 1]
      return !(
        previous &&
        previous.path === target.path &&
        previous.state === target.state &&
        previous.originalPath === target.originalPath
      )
    })
  const unrelatedDirtyPaths = [
    ...new Set(results.flatMap(({ result }) => result.unrelatedDirtyPaths)),
  ].sort((a, b) => a.localeCompare(b))
  const diagnostics = results
    .flatMap(({ result }) => result.diagnostics)
    .sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
  return {
    status: results.every(({ result }) => result.status === 'confirmed')
      ? 'confirmed'
      : 'unavailable',
    ...(results[0]?.result.shallow === undefined ? {} : { shallow: results[0].result.shallow }),
    targetFiles,
    unrelatedDirtyPaths,
    diagnostics,
    repositories: results.map(({ boundary, result }) => ({
      boundaryId: boundary.id,
      path: boundary.path,
      status: result.status,
      ...(result.shallow === undefined ? {} : { shallow: result.shallow }),
      diagnostics: result.diagnostics,
    })),
  }
}

function createWorkspaceConclusion(
  boundary: RepositoryBoundary,
  boundaries: RepositoryBoundary[],
  root: string,
  manifests: ParsedManifest[],
  diagnostics: RepositoryDiagnostic[],
  unavailableDirectories: string[],
): RepositoryEvidenceConclusion {
  const candidates: Array<{ marker: string; declaration: unknown }> = []
  const sources: RepositoryEvidenceSource[] = []
  const evidenceDiagnostics: RepositoryEvidenceDiagnostic[] = []
  const directoryDiagnostics = unavailableDirectoryDiagnostics(
    boundary,
    boundaries,
    unavailableDirectories,
  )
  for (const marker of boundary.markers) {
    if (marker.kind === 'git-repo') continue
    let declaration: unknown = marker.kind
    if (marker.kind === 'manifest-workspaces') {
      declaration = manifests.find((manifest) => manifest.path === marker.path)?.raw?.workspaces
      if (!isSupportedWorkspaceDeclaration(declaration)) {
        evidenceDiagnostics.push(
          createEvidenceDiagnostic('WORKSPACE_DECLARATION_UNSUPPORTED', marker.path),
        )
      }
    } else {
      const filepath = join(root, marker.path)
      let content: string
      try {
        content = readFileSync(filepath, 'utf-8')
      } catch {
        declaration = undefined
        evidenceDiagnostics.push(
          createEvidenceDiagnostic('WORKSPACE_DECLARATION_UNAVAILABLE', marker.path),
        )
        candidates.push({ marker: marker.kind, declaration })
        sources.push(createFileSource(marker.path))
        continue
      }
      const document = YAML.parseDocument(content)
      if (document.errors.length > 0) {
        declaration = undefined
        evidenceDiagnostics.push(
          createEvidenceDiagnostic('WORKSPACE_DECLARATION_UNSUPPORTED', marker.path),
        )
      } else if (marker.kind === 'pnpm-workspace') {
        const parsed = document.toJSON() as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          declaration = undefined
          evidenceDiagnostics.push(
            createEvidenceDiagnostic('WORKSPACE_DECLARATION_UNSUPPORTED', marker.path),
          )
        } else {
          const packages = (parsed as Record<string, unknown>).packages
          declaration = packages ?? []
          if (packages !== undefined && !isWorkspacePatterns(packages)) {
            declaration = undefined
            evidenceDiagnostics.push(
              createEvidenceDiagnostic('WORKSPACE_DECLARATION_UNSUPPORTED', marker.path),
            )
          }
        }
      } else {
        const parsed = document.toJSON() as unknown
        declaration = []
        if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          declaration = undefined
          evidenceDiagnostics.push(
            createEvidenceDiagnostic('WORKSPACE_DECLARATION_UNSUPPORTED', marker.path),
          )
        }
      }
    }
    candidates.push({ marker: marker.kind, declaration })
    sources.push(
      marker.kind === 'manifest-workspaces'
        ? createFieldSource(marker.path, ['workspaces'])
        : createFileSource(marker.path),
    )
  }
  const authoritative = candidates.filter((candidate) => candidate.marker !== 'yarn-workspace')
  const unique = new Set(authoritative.map((candidate) => JSON.stringify(candidate.declaration)))
  const hasUnavailable = evidenceDiagnostics.some(
    (diagnostic) => diagnostic.code === 'WORKSPACE_DECLARATION_UNAVAILABLE',
  )
  const hasUnsupported = evidenceDiagnostics.some(
    (diagnostic) => diagnostic.code === 'WORKSPACE_DECLARATION_UNSUPPORTED',
  )
  const status =
    hasUnavailable || (candidates.length === 0 && directoryDiagnostics.length > 0)
      ? 'unavailable'
      : hasUnsupported
        ? 'unsupported'
        : candidates.length === 0
          ? 'missing'
          : authoritative.length > 0 && unique.size > 1
            ? 'ambiguous'
            : 'confirmed'
  if (status === 'ambiguous') {
    evidenceDiagnostics.push(
      createEvidenceDiagnostic('WORKSPACE_DECLARATION_CONFLICT', boundary.path),
    )
  }
  evidenceDiagnostics.push(...directoryDiagnostics)
  addEvidenceDiagnostics(diagnostics, evidenceDiagnostics)
  return createConclusion(
    'workspace',
    boundary.id,
    status,
    candidates,
    sources,
    evidenceDiagnostics,
  )
}

function isSupportedWorkspaceDeclaration(value: unknown): boolean {
  if (isWorkspacePatterns(value)) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return isWorkspacePatterns((value as Record<string, unknown>).packages)
}

function isWorkspacePatterns(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function createManagerConclusion(
  boundary: RepositoryBoundary,
  boundaries: RepositoryBoundary[],
  manifests: ParsedManifest[],
  lockfiles: RepositoryLockfile[],
  aliasConflicts: LockfileAliasConflict[],
  diagnostics: RepositoryDiagnostic[],
  unavailableDirectories: string[],
): RepositoryEvidenceConclusion<
  PackageManagerField | { name: RepositoryLockfileManager } | { raw: string }
> {
  const declarations = manifestsAtBoundary(manifests, boundary).flatMap((manifest) => {
    const raw = manifest.raw?.packageManager
    if (typeof raw !== 'string') return []
    return [{ manifest, raw, parsed: parsePackageManagerField(raw) }]
  })
  const boundaryLockfiles = lockfiles.filter((lockfile) => lockfile.boundaryId === boundary.id)
  const boundaryAliases = aliasConflicts.filter((candidate) => candidate.boundaryId === boundary.id)
  const evidenceDiagnostics: RepositoryEvidenceDiagnostic[] = []
  const directoryDiagnostics = unavailableDirectoryDiagnostics(
    boundary,
    boundaries,
    unavailableDirectories,
  )
  let status: RepositoryEvidenceConclusion['status']
  let value: Array<PackageManagerField | { name: RepositoryLockfileManager } | { raw: string }>
  let sources: RepositoryEvidenceSource[]

  if (declarations.length > 0) {
    const invalid = declarations.filter((declaration) => !declaration.parsed)
    value = declarations.map((declaration) => declaration.parsed ?? { raw: declaration.raw })
    const unique = new Set(declarations.map((declaration) => declaration.raw))
    status = invalid.length > 0 ? 'unsupported' : unique.size > 1 ? 'ambiguous' : 'confirmed'
    sources = declarations.map((declaration) =>
      createFieldSource(
        declaration.manifest.path,
        ['packageManager'],
        declaration.manifest.byteHash,
      ),
    )
    if (invalid.length > 0) {
      for (const candidate of [...boundaryLockfiles, ...boundaryAliases]) {
        value.push({ name: candidate.manager })
        sources.push(createFileSource(candidate.path, candidateByteHash(candidate)))
      }
    }
    for (const declaration of invalid) {
      evidenceDiagnostics.push(
        createEvidenceDiagnostic('PACKAGE_MANAGER_INVALID', declaration.manifest.path),
      )
    }
    const declaredManagers = new Set(
      declarations.flatMap((declaration) => declaration.parsed?.name ?? []),
    )
    if (
      [...boundaryLockfiles, ...boundaryAliases].some(
        (candidate) => declaredManagers.size > 0 && !declaredManagers.has(candidate.manager),
      )
    ) {
      evidenceDiagnostics.push(
        createEvidenceDiagnostic('PACKAGE_MANAGER_LOCKFILE_MISMATCH', boundary.path),
      )
    }
  } else {
    const managerCandidates = [...boundaryLockfiles, ...boundaryAliases]
    const managers = [...new Set(managerCandidates.map((candidate) => candidate.manager))].sort()
    value = managers.map((name) => ({ name }))
    status =
      directoryDiagnostics.length > 0
        ? 'unavailable'
        : managers.length === 0
          ? 'missing'
          : managers.length === 1
            ? 'confirmed'
            : 'ambiguous'
    sources = managerCandidates.map((candidate) =>
      createFileSource(candidate.path, candidateByteHash(candidate)),
    )
  }

  evidenceDiagnostics.push(...directoryDiagnostics)

  addEvidenceDiagnostics(diagnostics, evidenceDiagnostics)
  return createConclusion(
    'package-manager',
    boundary.id,
    status,
    deduplicateManagerValues(value.sort(compareManagerValues)),
    sources,
    evidenceDiagnostics,
  )
}

function createLockfileConclusion(
  boundary: RepositoryBoundary,
  boundaries: RepositoryBoundary[],
  lockfiles: RepositoryLockfile[],
  aliasConflicts: LockfileAliasConflict[],
  diagnostics: RepositoryDiagnostic[],
  unavailableDirectories: string[],
): RepositoryEvidenceConclusion<string> {
  const candidates = lockfiles.filter((lockfile) => lockfile.boundaryId === boundary.id)
  const boundaryAliases = aliasConflicts.filter((candidate) => candidate.boundaryId === boundary.id)
  const evidenceDiagnostics = candidates.flatMap((lockfile) => {
    if (lockfile.parseState === 'error') {
      return [createEvidenceDiagnostic('LOCKFILE_PARSE_FAILED', lockfile.path)]
    }
    if (lockfile.parseState === 'unsupported') {
      return [createEvidenceDiagnostic('LOCKFILE_UNSUPPORTED', lockfile.path)]
    }
    if (lockfile.parseState === 'unavailable') {
      return [createEvidenceDiagnostic('LOCKFILE_UNAVAILABLE', lockfile.path)]
    }
    return []
  })
  const directoryDiagnostics = unavailableDirectoryDiagnostics(
    boundary,
    boundaries,
    unavailableDirectories,
  )
  evidenceDiagnostics.push(
    ...boundaryAliases.map((candidate) =>
      createEvidenceDiagnostic('LOCKFILE_DUPLICATE_IDENTITY', candidate.path),
    ),
  )
  evidenceDiagnostics.push(...directoryDiagnostics)
  const status =
    directoryDiagnostics.length > 0
      ? 'unavailable'
      : boundaryAliases.length > 0
        ? 'ambiguous'
        : candidates.length === 0
          ? directoryDiagnostics.length > 0
            ? 'unavailable'
            : 'missing'
          : candidates.length > 1
            ? 'ambiguous'
            : candidates[0]?.parseState === 'parsed'
              ? 'confirmed'
              : candidates[0]?.parseState === 'unavailable'
                ? 'unavailable'
                : 'unsupported'
  addEvidenceDiagnostics(diagnostics, evidenceDiagnostics)
  return createConclusion(
    'lockfile-selection',
    boundary.id,
    status,
    [
      ...candidates.map((lockfile) => lockfile.id),
      ...boundaryAliases.map((candidate) => candidate.path),
    ],
    [
      ...candidates.map((lockfile) => createFileSource(lockfile.path, lockfile.byteHash)),
      ...boundaryAliases.map((candidate) => createFileSource(candidate.path)),
    ],
    evidenceDiagnostics,
  )
}

function createRuntimeConclusion(
  boundary: RepositoryBoundary,
  boundaries: RepositoryBoundary[],
  declarations: RepositoryRuntimeDeclaration[],
  diagnostics: RepositoryDiagnostic[],
  unavailableDirectories: string[],
): RepositoryEvidenceConclusion<string> {
  const candidates = declarations.filter((declaration) => declaration.boundaryId === boundary.id)
  const unsupported = diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === 'RUNTIME_DECLARATION_UNSUPPORTED' &&
      owningBoundary(boundaries, directoryPath(diagnostic.path)).id === boundary.id,
  )
  const unavailable = diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === 'RUNTIME_DECLARATION_UNAVAILABLE' &&
      owningBoundary(boundaries, directoryPath(diagnostic.path)).id === boundary.id,
  )
  const evidenceDiagnostics = [...unsupported, ...unavailable].map((diagnostic) =>
    createEvidenceDiagnostic(diagnostic.code, diagnostic.path, diagnostic.detail),
  )
  const directoryDiagnostics = unavailableDirectoryDiagnostics(
    boundary,
    boundaries,
    unavailableDirectories,
  )
  evidenceDiagnostics.push(...directoryDiagnostics)
  const unique = new Set(candidates.map((candidate) => candidate.declaredText))
  const status =
    unavailable.length > 0 || directoryDiagnostics.length > 0
      ? 'unavailable'
      : unsupported.length > 0
        ? 'unsupported'
        : candidates.length === 0
          ? 'missing'
          : unique.size > 1
            ? 'ambiguous'
            : 'confirmed'
  return createConclusion(
    'runtime',
    boundary.id,
    status,
    candidates.map((candidate) => candidate.id),
    candidates.map((candidate) =>
      candidate.field
        ? createFieldSource(candidate.path, candidate.field.split('.'), candidate.byteHash)
        : createFileSource(candidate.path, candidate.byteHash),
    ),
    evidenceDiagnostics,
  )
}

function unavailableDirectoryDiagnostics(
  boundary: RepositoryBoundary,
  boundaries: RepositoryBoundary[],
  unavailableDirectories: string[],
): RepositoryEvidenceDiagnostic[] {
  return unavailableDirectories
    .filter((path) => owningBoundary(boundaries, path).id === boundary.id)
    .map((path) => createEvidenceDiagnostic('REPOSITORY_DIRECTORY_UNAVAILABLE', path))
}

function createConclusion<T>(
  kind: RepositoryEvidenceKind,
  boundaryId: string | undefined,
  status: RepositoryEvidenceConclusion['status'],
  value: T[],
  sources: RepositoryEvidenceSource[],
  diagnostics: RepositoryEvidenceDiagnostic[],
): RepositoryEvidenceConclusion<T> {
  const identity = `${kind}\0${boundaryId ?? '.'}`
  return {
    id: createRepositoryId('evidence', identity),
    kind,
    ...(boundaryId ? { boundaryId } : {}),
    status,
    value,
    sources: sortSources(sources),
    diagnostics: sortEvidenceDiagnostics(diagnostics),
  }
}

function createFileSource(path: string, byteHash?: string): RepositoryEvidenceSource {
  return {
    id: createRepositoryId('evidence-source', `file\0${path}`),
    kind: 'file',
    path,
    ...(byteHash ? { byteHash } : {}),
  }
}

function createFieldSource(
  path: string,
  field: string[],
  byteHash?: string,
): RepositoryEvidenceSource {
  return {
    id: createRepositoryId('evidence-source', `field\0${path}\0${JSON.stringify(field)}`),
    kind: 'field',
    path,
    field,
    ...(byteHash ? { byteHash } : {}),
  }
}

function createProbeSource(probe: 'discovery' | 'git'): RepositoryEvidenceSource {
  return {
    id: createRepositoryId('evidence-source', `probe\0${probe}`),
    kind: 'probe',
    path: '.',
    probe,
  }
}

function createEvidenceDiagnostic(
  code: RepositoryDiagnosticCode,
  path: string,
  detail?: string,
): RepositoryEvidenceDiagnostic {
  return {
    id: createRepositoryId('evidence-diagnostic', `${code}\0${path}\0${detail ?? ''}`),
    code,
    path,
    ...(detail ? { detail } : {}),
  }
}

function addEvidenceDiagnostics(
  diagnostics: RepositoryDiagnostic[],
  evidenceDiagnostics: RepositoryEvidenceDiagnostic[],
): void {
  for (const diagnostic of evidenceDiagnostics) {
    addTopDiagnostic(diagnostics, diagnostic.code, diagnostic.path, diagnostic.detail)
  }
}

function addTopDiagnostic(
  diagnostics: RepositoryDiagnostic[],
  code: RepositoryDiagnosticCode,
  path: string,
  detail?: string,
): void {
  if (
    diagnostics.some(
      (candidate) =>
        candidate.code === code && candidate.path === path && candidate.detail === detail,
    )
  ) {
    return
  }
  diagnostics.push({ code, path, ...(detail ? { detail } : {}) })
}

function manifestsAtBoundary(
  manifests: ParsedManifest[],
  boundary: RepositoryBoundary,
): ParsedManifest[] {
  return manifests.filter((manifest) => directoryPath(manifest.path) === boundary.path)
}

function owningBoundary(boundaries: RepositoryBoundary[], path: string): RepositoryBoundary {
  const candidates = boundaries
    .filter((boundary) => isPathOwnedByBoundary(path, boundary.path))
    .sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))
  return candidates[0] ?? boundaries[0]!
}

function isPathOwnedByBoundary(path: string, boundaryPath: string): boolean {
  return boundaryPath === '.' || path === boundaryPath || path.startsWith(`${boundaryPath}/`)
}

function directoryPath(path: string): string {
  const directory = dirname(path).split(sep).join('/')
  return directory === '' ? '.' : directory
}

function repositoryPath(root: string, filepath: string): string | undefined {
  const value = relative(root, filepath)
  if (value === '..' || value.startsWith(`..${sep}`)) return undefined
  return value === '' ? '.' : value.split(sep).join('/')
}

function lexicalPath(root: string, filepath: string): string {
  return repositoryPath(resolve(root), resolve(filepath)) ?? filepath.split(sep).at(-1) ?? '.'
}

function joinRelative(parent: string, child: string): string {
  return parent === '.' ? child : `${parent}/${child}`
}

function compareMarker(left: RepositoryBoundaryMarker, right: RepositoryBoundaryMarker): number {
  return left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
}

function compareEvidence(
  left: RepositoryEvidenceConclusion,
  right: RepositoryEvidenceConclusion,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    (left.boundaryId ?? '').localeCompare(right.boundaryId ?? '')
  )
}

function compareRelationship(
  left: { boundaryId: string; packageId: string },
  right: { boundaryId: string; packageId: string },
): number {
  return (
    left.boundaryId.localeCompare(right.boundaryId) || left.packageId.localeCompare(right.packageId)
  )
}

function compareManagerValues(
  left: PackageManagerField | { name: RepositoryLockfileManager } | { raw: string },
  right: PackageManagerField | { name: RepositoryLockfileManager } | { raw: string },
): number {
  const leftKey = 'raw' in left ? left.raw : left.name
  const rightKey = 'raw' in right ? right.raw : right.name
  return leftKey.localeCompare(rightKey)
}

function deduplicateManagerValues(
  values: Array<PackageManagerField | { name: RepositoryLockfileManager } | { raw: string }>,
): Array<PackageManagerField | { name: RepositoryLockfileManager } | { raw: string }> {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function candidateByteHash(
  candidate: RepositoryLockfile | LockfileAliasConflict,
): string | undefined {
  return 'id' in candidate ? candidate.byteHash : undefined
}

function sortSources(sources: RepositoryEvidenceSource[]): RepositoryEvidenceSource[] {
  return [...sources].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      JSON.stringify(a.field ?? []).localeCompare(JSON.stringify(b.field ?? [])) ||
      a.id.localeCompare(b.id),
  )
}

function sortEvidenceDiagnostics(
  diagnostics: RepositoryEvidenceDiagnostic[],
): RepositoryEvidenceDiagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code) ||
      (a.detail ?? '').localeCompare(b.detail ?? ''),
  )
}
