import { describe, expect, it } from 'vitest'
import { createRepositoryId } from '../../../repository/identity'
import { sanitizeTerminalText } from '../../../utils/format'
import {
  type CheckRunCatalogEvidence,
  type CheckRunChange,
  type CheckRunInsightEvidence,
  type CheckRunOwnerReference,
  type CheckRunSnapshot,
  type CheckRunTarget,
  createCheckRunState,
  reduceCheckRun,
} from '../run-model'
import { buildVisualPlusInsights, VisualPlusInsightError } from './insights'

const MAJOR_AGE_MS = 432_000_000
const OWNER_CAPACITIES = [6, ...Array.from({ length: 14 }, () => 5)] as const

interface FixtureOwner {
  readonly owner: CheckRunOwnerReference
  readonly catalog: CheckRunCatalogEvidence
}

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object
      ? Mutable<T[Key]>
      : T[Key]
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
    owner: {
      id,
      role: 'catalog',
      label: name,
      path,
      order,
      physicalTarget: path,
    },
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
    const capacity = OWNER_CAPACITIES[ownerIndex]!
    if (ownerIndex === 14) assigned[ownerIndex]!.push('nanoid')
    while (assigned[ownerIndex]!.length < capacity) {
      assigned[ownerIndex]!.push(`unique-${String(unique).padStart(2, '0')}`)
      unique += 1
    }
  }
  return assigned
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
      const ageMs = major ? MAJOR_AGE_MS : null
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

function fixture(): CheckRunSnapshot {
  const inventory = fixtureInventory()
  let state = createCheckRunState({ mode: 'major', write: false })
  state = reduceCheckRun(state, { type: 'packages-discovered', packages: 66, declared: 616 })
  state = reduceCheckRun(state, {
    type: 'resolution-completed',
    eligible: 612,
    unresolved: 0,
    updates: 76,
  })
  return reduceCheckRun(state, {
    type: 'selection-completed',
    operations: 76,
    targets: 14,
    changes: inventory.changes,
    selectedTargets: inventory.targets,
  })
}

function mutableFixture(): CheckRunSnapshot {
  return structuredClone(fixture())
}

function insight(snapshot: CheckRunSnapshot, operationId: string): CheckRunInsightEvidence {
  return snapshot.changes.find((change) => change.id === operationId)!.insight!
}

function change(snapshot: CheckRunSnapshot, operationId: string): CheckRunChange {
  return snapshot.changes.find((candidate) => candidate.id === operationId)!
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

describe('buildVisualPlusInsights', () => {
  it('builds the exact deterministic 66/616/612/76/14 relationship model', () => {
    const result = buildVisualPlusInsights(fixture())

    expect(result.topology).toEqual({
      packages: 66,
      declared: 616,
      eligible: 612,
      updates: 76,
      files: 14,
    })
    expect(result.distribution).toEqual({ major: 3, minor: 37, patch: 36 })
    expect(result.owners).toHaveLength(15)
    expect(result.owners.map((owner) => owner.updates)).toEqual([6, ...Array(14).fill(5)])
    expect(new Set(result.owners.map((owner) => owner.owner.physicalTarget))).toHaveLength(14)
    expect(result.owners[12]?.owner).toMatchObject({
      id: createRepositoryId('package', 'packages/12-workspace/package.json'),
      role: 'manifest',
      path: 'packages/12-workspace/package.json',
      physicalTarget: 'packages/12-workspace/package.json',
      order: 12,
    })
    expect(result.owners[13]?.owner).toEqual({
      id: createRepositoryId('catalog', 'z-workspace.yaml\0yarn\0auxiliary-catalog'),
      role: 'catalog',
      label: 'auxiliary-catalog',
      path: 'z-workspace.yaml',
      order: 13,
      physicalTarget: 'z-workspace.yaml',
    })
    expect(result.owners[14]?.owner).toEqual({
      id: createRepositoryId('catalog', 'z-workspace.yaml\0yarn\0root-catalog'),
      role: 'catalog',
      label: 'root-catalog',
      path: 'z-workspace.yaml',
      order: 14,
      physicalTarget: 'z-workspace.yaml',
    })
    expect(result.owners[13]?.owner.id).not.toBe(result.owners[14]?.owner.id)
    expect(result.owners[12]?.owner.physicalTarget).not.toBe(
      result.owners[13]?.owner.physicalTarget,
    )
    expect(result.owners.flatMap((owner) => owner.operationIds)).toHaveLength(76)
    expect(new Set(result.owners.flatMap((owner) => owner.operationIds))).toHaveLength(76)

    expect(result.shared).toHaveLength(18)
    expect(result.shared.reduce((total, surface) => total + surface.occurrences.length, 0)).toBe(39)
    expect(result.majors).toHaveLength(2)
    expect(result.majors.flatMap((card) => card.operationIds)).toHaveLength(3)
  })

  it('retains exact major blast radius, age, compatibility, and catalog ownership', () => {
    const result = buildVisualPlusInsights(fixture())
    const react = result.majors.find((card) => card.name === 'react-dropzone')!
    const nanoid = result.majors.find((card) => card.name === 'nanoid')!

    expect(react).toMatchObject({
      current: '^15',
      target: '^17',
      age: { state: 'known', ageMs: MAJOR_AGE_MS },
      compatibility: { compatible: 0, incompatible: 0, unknown: 2 },
    })
    expect(react.owners.map((owner) => owner.label)).toEqual(['lab-editor', 'web'])
    expect(nanoid).toMatchObject({
      current: '^5.1.16',
      target: '^6.0.0',
      age: { state: 'known', ageMs: MAJOR_AGE_MS },
      compatibility: { compatible: 0, incompatible: 0, unknown: 1 },
    })
    expect(nanoid.occurrences[0]?.catalog).toMatchObject({
      role: 'owner',
      manager: 'yarn',
      name: 'root-catalog',
      sourcePath: 'z-workspace.yaml',
    })
  })

  it('keeps equal display names and equal owner labels as separate identities', () => {
    const result = buildVisualPlusInsights(fixture())
    const sameDisplay = result.shared.filter((surface) => surface.name === 'same-display')
    const sameLabel = result.owners.filter((owner) => owner.owner.label === 'shared-owner')

    expect(sameDisplay).toHaveLength(2)
    expect(new Set(sameDisplay.map((surface) => surface.dependencyId))).toHaveLength(2)
    expect(sameLabel).toHaveLength(2)
    expect(new Set(sameLabel.map((owner) => owner.owner.id))).toHaveLength(2)
  })

  it('is invariant to input, target, and membership permutations', () => {
    const original = fixture()
    const permuted = mutableFixture()
    ;(permuted.changes as unknown as CheckRunChange[]).reverse()
    ;(permuted.targets as unknown as CheckRunTarget[]).reverse()
    for (const target of permuted.targets) {
      ;(target.operationIds as string[]).reverse()
    }

    expect(buildVisualPlusInsights(permuted)).toEqual(buildVisualPlusInsights(original))
  })

  it('reports known, unknown, and mixed major ages without inventing values', () => {
    const known = buildVisualPlusInsights(fixture())
    const unknownInput = mutableFixture()
    const nanoidChange = change(unknownInput, 'operation-14-0')
    ;(nanoidChange as { ageMs?: number }).ageMs = undefined
    ;(nanoidChange.insight as { ageMs: number | null }).ageMs = null
    const mixedInput = mutableFixture()
    const secondReact = change(mixedInput, 'operation-1-0')
    ;(secondReact as { ageMs?: number }).ageMs = undefined
    ;(secondReact.insight as { ageMs: number | null }).ageMs = null

    expect(known.majors.find((card) => card.name === 'react-dropzone')?.age).toEqual({
      state: 'known',
      ageMs: MAJOR_AGE_MS,
    })
    expect(
      buildVisualPlusInsights(unknownInput).majors.find((card) => card.name === 'nanoid')?.age,
    ).toEqual({ state: 'unknown' })
    expect(
      buildVisualPlusInsights(mixedInput).majors.find((card) => card.name === 'react-dropzone')
        ?.age,
    ).toEqual({ state: 'mixed' })
  })

  it('counts independent compatibility states on a major card', () => {
    const input = mutableFixture()
    ;(insight(input, 'operation-0-0') as Mutable<CheckRunInsightEvidence>).compatibility.status =
      'compatible'
    ;(insight(input, 'operation-1-0') as Mutable<CheckRunInsightEvidence>).compatibility.status =
      'incompatible'

    expect(
      buildVisualPlusInsights(input).majors.find((card) => card.name === 'react-dropzone')
        ?.compatibility,
    ).toEqual({ compatible: 1, incompatible: 1, unknown: 0 })
  })

  it('deep-copies and freezes output without freezing caller-owned evidence', () => {
    const input = mutableFixture()
    const originalPath = [...insight(input, 'operation-0-0').occurrencePath]
    const nanoidInsight = insight(input, 'operation-14-0') as Mutable<CheckRunInsightEvidence>
    nanoidInsight.compatibility.detail = 'repository runtime unavailable'
    const result = buildVisualPlusInsights(input)

    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(insight(input, 'operation-0-0').occurrencePath)).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.owners)).toBe(true)
    expect(Object.isFrozen(result.shared[0]?.occurrences)).toBe(true)
    expect(Object.isFrozen(result.majors[0]?.occurrences[0]?.owner)).toBe(true)

    ;(insight(input, 'operation-0-0').occurrencePath as string[]).push('mutated')
    ;(insight(input, 'operation-0-0') as Mutable<CheckRunInsightEvidence>).owner.label = 'mutated'
    ;(nanoidInsight.catalog as Mutable<Extract<CheckRunCatalogEvidence, { role: 'owner' }>>).name =
      'mutated'
    nanoidInsight.compatibility.detail = 'mutated'
    expect(
      result.shared
        .flatMap((surface) => surface.occurrences)
        .find((occurrence) => occurrence.operationId === 'operation-0-0')?.occurrencePath,
    ).toEqual(originalPath)
    const nanoid = result.majors.find((card) => card.name === 'nanoid')!.occurrences[0]!
    expect(nanoid.catalog).toMatchObject({ name: 'root-catalog' })
    expect(nanoid.compatibility.detail).toBe('repository runtime unavailable')
  })

  it.each([
    [
      'missing insight inventory',
      (input: CheckRunSnapshot) => {
        ;(change(input, 'operation-0-0') as { insight?: CheckRunInsightEvidence }).insight =
          undefined
      },
      /relationship insight inventory is incomplete/u,
    ],
    [
      'unsupported diff',
      (input: CheckRunSnapshot) => {
        ;(change(input, 'operation-0-0') as { diff: string }).diff = 'unknown'
      },
      /selected differences must be major, minor, or patch/u,
    ],
    [
      'dependency identity mismatch',
      (input: CheckRunSnapshot) => {
        ;(insight(input, 'operation-0-0') as { dependencyId: string }).dependencyId = 'wrong'
      },
      /dependency identifier is inconsistent/u,
    ],
    [
      'dependency display mismatch',
      (input: CheckRunSnapshot) => {
        ;(change(input, 'operation-0-0') as { name: string }).name = 'wrong'
      },
      /dependency display is inconsistent/u,
    ],
    [
      'source identity mismatch',
      (input: CheckRunSnapshot) => {
        ;(insight(input, 'operation-0-0') as { sourceFileId: string }).sourceFileId = 'wrong'
      },
      /source identifier is inconsistent/u,
    ],
    [
      'empty occurrence path',
      (input: CheckRunSnapshot) => {
        ;(insight(input, 'operation-0-0') as Mutable<CheckRunInsightEvidence>).occurrencePath = []
      },
      /occurrence path cannot be empty/u,
    ],
    [
      'unsafe source path',
      (input: CheckRunSnapshot) => {
        ;(insight(input, 'operation-0-0') as { sourcePath: string }).sourcePath = '../outside'
      },
      /source path is unsafe/u,
    ],
    [
      'physical target mismatch',
      (input: CheckRunSnapshot) => {
        ;(
          insight(input, 'operation-0-0') as Mutable<CheckRunInsightEvidence>
        ).owner.physicalTarget = 'other/package.json'
      },
      /owner physical target is inconsistent/u,
    ],
    [
      'manifest owner mismatch',
      (input: CheckRunSnapshot) => {
        ;(insight(input, 'operation-0-0') as Mutable<CheckRunInsightEvidence>).owner.role =
          'catalog'
      },
      /manifest owner evidence is inconsistent/u,
    ],
    [
      'catalog owner mismatch',
      (input: CheckRunSnapshot) => {
        ;(
          (insight(input, 'operation-14-0') as Mutable<CheckRunInsightEvidence>).catalog as Mutable<
            Extract<CheckRunCatalogEvidence, { role: 'owner' }>
          >
        ).name = 'wrong'
      },
      /catalog owner label is inconsistent|catalog owner evidence is inconsistent/u,
    ],
    [
      'catalog source mismatch',
      (input: CheckRunSnapshot) => {
        const catalog = (insight(input, 'operation-14-0') as Mutable<CheckRunInsightEvidence>)
          .catalog as Mutable<Extract<CheckRunCatalogEvidence, { role: 'owner' }>>
        catalog.sourcePath = 'other-workspace.yaml'
      },
      /catalog owner evidence is inconsistent/u,
    ],
    [
      'catalog identifier mismatch',
      (input: CheckRunSnapshot) => {
        const catalog = (insight(input, 'operation-14-0') as Mutable<CheckRunInsightEvidence>)
          .catalog as Mutable<Extract<CheckRunCatalogEvidence, { role: 'owner' }>>
        catalog.id = 'wrong-catalog'
      },
      /catalog owner evidence is inconsistent/u,
    ],
    [
      'contradictory owner facts',
      (input: CheckRunSnapshot) => {
        const selected = insight(input, 'operation-0-1')
        ;(selected as { owner: CheckRunOwnerReference }).owner = {
          ...selected.owner,
          label: 'different',
        }
      },
      /owner evidence is contradictory/u,
    ],
    [
      'noncanonical owner order',
      (input: CheckRunSnapshot) => {
        for (const selected of input.changes) {
          const selectedInsight = selected.insight
          if (selectedInsight?.owner.order === 0 || selectedInsight?.owner.order === 1) {
            ;(selectedInsight as { owner: CheckRunOwnerReference }).owner = {
              ...selectedInsight.owner,
              order: selectedInsight.owner.order === 0 ? 1 : 0,
            }
          }
        }
      },
      /owner group order is not canonical/u,
    ],
    [
      'tied owner order',
      (input: CheckRunSnapshot) => {
        for (const selected of input.changes) {
          const selectedInsight = selected.insight
          if (selectedInsight?.owner.order === 1) {
            ;(selectedInsight as { owner: CheckRunOwnerReference }).owner = {
              ...selectedInsight.owner,
              order: 0,
            }
          }
        }
      },
      /owner group order is tied/u,
    ],
    [
      'duplicate physical occurrence',
      (input: CheckRunSnapshot) => {
        const first = insight(input, 'operation-0-0')
        ;(insight(input, 'operation-0-1') as { occurrencePath: readonly string[] }).occurrencePath =
          [...first.occurrencePath]
      },
      /physical occurrences must be unique/u,
    ],
    [
      'invalid age',
      (input: CheckRunSnapshot) => {
        ;(insight(input, 'operation-2-0') as { ageMs: number | null }).ageMs = -1
      },
      /relationship age is invalid/u,
    ],
    [
      'invalid compatibility',
      (input: CheckRunSnapshot) => {
        ;(insight(input, 'operation-2-0').compatibility as { status: string }).status = 'maybe'
      },
      /compatibility state is invalid/u,
    ],
  ])('fails closed for %s', (_label, mutate, expected) => {
    const input = mutableFixture()
    mutate(input)
    expect(() => buildVisualPlusInsights(input)).toThrow(VisualPlusInsightError)
    expect(() => buildVisualPlusInsights(input)).toThrow(expected)
  })

  it.each([
    [
      'operation count mismatch',
      (input: CheckRunSnapshot) => {
        ;(input.counts as Mutable<CheckRunSnapshot['counts']>).operations = 75
      },
      /selected operation inventory does not match operation count/u,
    ],
    [
      'target count mismatch',
      (input: CheckRunSnapshot) => {
        ;(input.counts as Mutable<CheckRunSnapshot['counts']>).targets = 13
      },
      /selected target inventory does not match target count/u,
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    const input = mutableFixture()
    mutate(input)
    expect(() => buildVisualPlusInsights(input)).toThrow(VisualPlusInsightError)
    expect(() => buildVisualPlusInsights(input)).toThrow(expected)
  })

  it.each([
    [
      'duplicate operation ID',
      (input: CheckRunSnapshot) => {
        ;(change(input, 'operation-0-1') as Mutable<CheckRunChange>).id = 'operation-0-0'
      },
    ],
    [
      'duplicate target path',
      (input: CheckRunSnapshot) => {
        ;(input.targets[1] as Mutable<CheckRunTarget>).path = input.targets[0]!.path
      },
    ],
    [
      'duplicate target membership',
      (input: CheckRunSnapshot) => {
        ;(input.targets[0]!.operationIds as string[]).push(input.targets[0]!.operationIds[0]!)
      },
    ],
    [
      'missing target membership',
      (input: CheckRunSnapshot) => {
        ;(input.targets[0]!.operationIds as string[]).pop()
      },
    ],
    [
      'unknown target operation',
      (input: CheckRunSnapshot) => {
        ;(input.targets[0]!.operationIds as string[])[0] = 'unknown-operation'
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const input = mutableFixture()
    mutate(input)
    expect(() => buildVisualPlusInsights(input)).toThrow(VisualPlusInsightError)
    expect(() => buildVisualPlusInsights(input)).toThrow(/target membership is inconsistent/u)
  })
})
