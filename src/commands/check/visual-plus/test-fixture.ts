import { createRepositoryId } from '../../../repository/identity'
import { sanitizeTerminalText } from '../../../utils/format'
import type {
  CheckRunCatalogEvidence,
  CheckRunChange,
  CheckRunInsightEvidence,
  CheckRunOwnerReference,
  CheckRunSnapshot,
  CheckRunTarget,
} from '../run-model'
import type { VisualPlusCapabilities } from './capabilities'
import type { VisualPlusSectionInput } from './input'

export const VISUAL_PLUS_MAJOR_AGE_MS = 432_000_000
export const VISUAL_PLUS_OWNER_CAPACITIES = [6, ...Array.from({ length: 14 }, () => 5)] as const

interface FixtureOwner {
  readonly owner: CheckRunOwnerReference
  readonly catalog: CheckRunCatalogEvidence
}

export function createVisualPlusFixtureSnapshot(): CheckRunSnapshot {
  const inventory = fixtureInventory()
  return {
    sequence: 4,
    mode: 'major',
    write: false,
    phases: [
      { name: 'discover', status: 'passed' },
      { name: 'inspect', status: 'passed' },
      { name: 'resolve', status: 'passed' },
      { name: 'review', status: 'active' },
      { name: 'preflight', status: 'pending' },
      { name: 'stage', status: 'pending' },
      { name: 'apply', status: 'pending' },
      { name: 'observe', status: 'pending' },
      { name: 'recover', status: 'pending' },
      { name: 'complete', status: 'pending' },
    ],
    counts: {
      packages: 66,
      declared: 616,
      eligible: 612,
      unresolved: 0,
      updates: 76,
      operations: 76,
      targets: 14,
    },
    changes: inventory.changes,
    targets: inventory.targets,
    diagnostics: [],
    results: {
      operations: [],
      targets: [],
      totals: emptyTotals(),
      targetTotals: emptyTotals(),
    },
    recovery: { executed: false, status: 'not-needed', restoredPaths: [], unrecoveredPaths: [] },
    elapsedMs: null,
    exitCode: null,
    terminalEvents: [],
  }
}

export function createVisualPlusFixtureInput(
  capabilities: VisualPlusCapabilities,
): VisualPlusSectionInput {
  const snapshot = createVisualPlusFixtureSnapshot()
  return {
    snapshot,
    capabilities,
    run: {
      repository: { name: 'visual-plus-fixture', relativePath: '.' },
      workspaceScope: 'workspace',
      packageManager: {
        status: 'observed',
        name: 'pnpm',
        version: '10.33.0',
        sources: ['package.json'],
      },
    },
    changes: snapshot.changes.map((change) => {
      const insight = change.insight!
      return {
        operationId: change.id,
        ownerGroup: {
          id: insight.owner.id,
          label: insight.owner.label,
          order: insight.owner.order,
          physicalTarget: insight.owner.physicalTarget,
        },
        ageMs: insight.ageMs,
        compatibility: { ...insight.compatibility },
        ...(insight.catalog.role === 'owner'
          ? { catalog: { name: insight.catalog.name, sourcePath: insight.catalog.sourcePath } }
          : {}),
      }
    }),
  }
}

function fixtureInventory(): { changes: CheckRunChange[]; targets: CheckRunTarget[] } {
  const fixtureOwners = owners()
  const names = assignedNames()
  const changes: CheckRunChange[] = []
  let nonMajor = 0

  for (let ownerIndex = 0; ownerIndex < fixtureOwners.length; ownerIndex += 1) {
    const fixtureOwner = fixtureOwners[ownerIndex]!
    const rawNames = names[ownerIndex]!
    for (let item = 0; item < rawNames.length; item += 1) {
      const rawName = rawNames[item]!
      const major = rawName === 'react-dropzone' || rawName === 'nanoid'
      const diff = major ? 'major' : nonMajor < 37 ? 'minor' : 'patch'
      if (!major) nonMajor += 1
      const current =
        rawName === 'react-dropzone' ? '^15' : rawName === 'nanoid' ? '^5.1.16' : '^1.0.0'
      const target =
        rawName === 'react-dropzone'
          ? '^17'
          : rawName === 'nanoid'
            ? '^6.0.0'
            : diff === 'minor'
              ? '^1.1.0'
              : '^1.0.1'
      const sourcePath = fixtureOwner.owner.physicalTarget
      const ageMs = major ? VISUAL_PLUS_MAJOR_AGE_MS : null
      const insight: CheckRunInsightEvidence = {
        dependencyId: createRepositoryId('dependency', rawName),
        rawName,
        sourceFileId: createRepositoryId('source', sourcePath),
        sourcePath,
        occurrencePath:
          fixtureOwner.catalog.role === 'owner'
            ? ['catalogs', fixtureOwner.catalog.name, rawName]
            : ['dependencies', rawName],
        owner: { ...fixtureOwner.owner },
        catalog: { ...fixtureOwner.catalog },
        ageMs,
        compatibility: { status: 'unknown' },
      }
      changes.push({
        id: `operation-${ownerIndex}-${item}`,
        name: sanitizeTerminalText(rawName),
        owner: sourcePath,
        current,
        target,
        diff,
        ...(ageMs === null ? {} : { ageMs }),
        insight,
      })
    }
  }

  const byTarget = new Map<string, string[]>()
  for (const change of changes) {
    const operationIds = byTarget.get(change.owner)
    if (operationIds) operationIds.push(change.id)
    else byTarget.set(change.owner, [change.id])
  }
  const targets = [...byTarget]
    .sort(([left], [right]) => compareText(left, right))
    .map(([path, operationIds]) => ({ path, operationIds }))
  return { changes, targets }
}

function catalogOwner(
  path: string,
  name: string,
  order: number,
  manager: 'pnpm' | 'bun' | 'yarn' = 'bun',
): FixtureOwner {
  const sourceFileId = createRepositoryId('source', path)
  const id = createRepositoryId('catalog', `${path}\0${manager}\0${name}`)
  return {
    owner: { id, role: 'catalog', label: name, path, order, physicalTarget: path },
    catalog: { role: 'owner', id, manager, name, sourceFileId, sourcePath: path },
  }
}

function manifestOwner(path: string, label: string, order: number): FixtureOwner {
  return {
    owner: {
      id: createRepositoryId('package', path),
      role: 'manifest',
      label,
      path,
      order,
      physicalTarget: path,
    },
    catalog: { role: 'direct' },
  }
}

function owners(): readonly FixtureOwner[] {
  const result: FixtureOwner[] = [
    manifestOwner('packages/00-lab-editor/package.json', 'lab-editor', 0),
    manifestOwner('packages/01-web/package.json', 'web', 1),
  ]
  for (let index = 2; index < 12; index += 1) {
    const padded = String(index).padStart(2, '0')
    result.push(
      manifestOwner(`packages/${padded}-workspace/package.json`, `workspace-${index}`, index),
    )
  }
  result[11] = manifestOwner('packages/11-workspace/package.json', 'shared-owner', 11)
  result.push(manifestOwner('packages/12-workspace/package.json', 'shared-owner', 12))
  result.push(catalogOwner('z-workspace.yaml', 'auxiliary-catalog', 13, 'yarn'))
  result.push(catalogOwner('z-workspace.yaml', 'root-catalog', 14, 'yarn'))
  return result
}

function assignedNames(): readonly (readonly string[])[] {
  const assigned = Array.from({ length: 15 }, () => [] as string[])
  for (let repeated = 0; repeated < 18; repeated += 1) {
    const rawName =
      repeated === 0
        ? 'react-dropzone'
        : repeated === 1
          ? 'same-display\u0001'
          : repeated === 2
            ? 'same-display\u0002'
            : repeated <= 3
              ? `shared-triple-${repeated}`
              : `shared-pair-${repeated}`
    assigned[repeated % 13]!.push(rawName)
    assigned[(repeated + 1) % 13]!.push(rawName)
    if (repeated >= 1 && repeated <= 3) assigned[(repeated + 2) % 13]!.push(rawName)
  }

  let unique = 0
  for (let ownerIndex = 0; ownerIndex < assigned.length; ownerIndex += 1) {
    const capacity = VISUAL_PLUS_OWNER_CAPACITIES[ownerIndex]!
    if (ownerIndex === 14) assigned[ownerIndex]!.push('nanoid')
    while (assigned[ownerIndex]!.length < capacity) {
      assigned[ownerIndex]!.push(`unique-${String(unique).padStart(2, '0')}`)
      unique += 1
    }
  }
  return assigned
}

function emptyTotals() {
  return {
    applied: 0,
    skipped: 0,
    mixed: 0,
    blocked: 0,
    notAttempted: 0,
    failed: 0,
    reverted: 0,
    unknown: 0,
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
