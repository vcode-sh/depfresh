import { describe, expect, it } from 'vitest'
import type { ResolutionTrace } from '../io/resolve/context'
import type { PackageData } from '../types'
import { evaluatePlanSignals, validateSignalConfiguration } from './index'

const occurrences = [
  {
    id: 'occ-alpha',
    ownerId: 'package-root',
    name: 'alpha',
    field: 'dependencies',
    role: 'dependency',
    protocol: 'semver',
    declaredValue: '^1.0.0',
  },
  {
    id: 'occ-react',
    ownerId: 'package-root',
    name: 'react',
    field: 'dependencies',
    role: 'dependency',
    protocol: 'semver',
    declaredValue: '^18.0.0',
  },
]

const repository = {
  packages: [{ id: 'package-root', workspacePath: '.' }],
  runtimeDeclarations: [
    {
      id: 'runtime-root',
      boundaryId: 'boundary-root',
      kind: 'engines-node' as const,
      path: 'package.json',
      field: 'engines.node',
      declaredText: '24.15.0',
    },
  ],
  relationships: {
    boundaryPackages: [{ boundaryId: 'boundary-root', packageId: 'package-root' }],
  },
}

function packageData(overrides: Partial<PackageData> = {}): PackageData {
  return {
    name: 'alpha',
    versions: ['1.0.0', '2.0.0'],
    distTags: { latest: '2.0.0' },
    time: { '2.0.0': '2026-01-01T00:00:00.000Z' },
    engines: { '2.0.0': '>=20' },
    engineMetadata: { '2.0.0': 'present' },
    peerDependencies: { '2.0.0': { react: '^19.0.0' } },
    peerMetadata: { '2.0.0': 'present' },
    deprecationPresence: { '2.0.0': 'absent' },
    signaturePresence: { '2.0.0': 'unknown' },
    provenancePresence: { '2.0.0': 'unknown' },
    ...overrides,
  }
}

function evaluate(
  provider = '^19.0.0',
  repositoryInput = repository,
  runtimeEvidence: Array<{
    id: string
    kind: 'runtime'
    boundaryId?: string
    status: 'confirmed' | 'ambiguous' | 'missing' | 'unsupported' | 'unavailable'
  }> = [
    {
      id: 'runtime-conclusion-root',
      kind: 'runtime',
      boundaryId: 'boundary-root',
      status: 'confirmed',
    },
  ],
) {
  const traces = new Map<string, ResolutionTrace>([
    [
      'occ-alpha',
      {
        occurrenceId: 'occ-alpha',
        status: 'selected',
        reason: 'SELECTED',
        eligibleVersions: ['2.0.0'],
        targetVersion: '2.0.0',
      },
    ],
    [
      'occ-react',
      {
        occurrenceId: 'occ-react',
        status: 'selected',
        reason: 'SELECTED',
        eligibleVersions: ['19.0.0'],
        targetVersion: '19.0.0',
      },
    ],
  ])
  const metadata = new Map([
    ['occ-alpha', { packageName: 'alpha', currentVersion: '^1.0.0', data: packageData() }],
    [
      'occ-react',
      {
        packageName: 'react',
        currentVersion: '^18.0.0',
        data: packageData({
          name: 'react',
          versions: ['18.0.0', '19.0.0'],
          peerMetadata: { '19.0.0': 'absent' },
          peerDependencies: undefined,
          engines: undefined,
          engineMetadata: { '19.0.0': 'absent' },
          deprecationPresence: { '19.0.0': 'absent' },
          signaturePresence: { '19.0.0': 'absent' },
          provenancePresence: { '19.0.0': 'unknown' },
        }),
      },
    ],
  ])
  return evaluatePlanSignals({
    repository: repositoryInput,
    occurrences,
    operations: [
      { occurrenceId: 'occ-alpha', requestedValue: '^2.0.0' },
      { occurrenceId: 'occ-react', requestedValue: provider },
    ],
    traces,
    metadata,
    cohorts: [],
    rules: [],
    policySource: 'library',
    runtimeEvidence,
    asOf: '2026-07-16T00:00:00.000Z',
    cooldownDays: 30,
  })
}

describe('evaluatePlanSignals', () => {
  it('uses repository runtime evidence and the complete planned peer graph', () => {
    const result = evaluate()
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'runtime', state: 'pass', reason: 'RUNTIME_COMPATIBLE' }),
        expect.objectContaining({ family: 'peer', state: 'pass', reason: 'PEER_COMPATIBLE' }),
        expect.objectContaining({
          family: 'evidence-staleness',
          state: 'not-applicable',
          reason: 'STALENESS_NOT_OBSERVED',
        }),
      ]),
    )
    expect(JSON.stringify(result)).not.toContain(process.version)
  })

  it('reports a final planned peer conflict without changing the target', () => {
    const result = evaluate('^18.0.0')
    expect(result.signals).toContainEqual(
      expect.objectContaining({ family: 'peer', state: 'fail', reason: 'PEER_INCOMPATIBLE' }),
    )
    expect(result.blockedOccurrenceIds).toEqual([])
  })

  it('keeps cross-workspace provider topology unknown without lock-resolution proof', () => {
    const workspaceOccurrences = [
      { ...occurrences[0]!, ownerId: 'package-workspace' },
      occurrences[1]!,
    ]
    const traces = new Map<string, ResolutionTrace>([
      [
        'occ-alpha',
        {
          occurrenceId: 'occ-alpha',
          status: 'selected',
          reason: 'SELECTED',
          eligibleVersions: ['2.0.0'],
          targetVersion: '2.0.0',
        },
      ],
      [
        'occ-react',
        {
          occurrenceId: 'occ-react',
          status: 'selected',
          reason: 'SELECTED',
          eligibleVersions: ['19.0.0'],
          targetVersion: '19.0.0',
        },
      ],
    ])
    const result = evaluatePlanSignals({
      repository: {
        ...repository,
        packages: [
          ...repository.packages,
          { id: 'package-workspace', workspacePath: 'packages/workspace' },
        ],
        relationships: {
          boundaryPackages: [
            ...repository.relationships.boundaryPackages,
            { boundaryId: 'boundary-root', packageId: 'package-workspace' },
          ],
        },
      },
      occurrences: workspaceOccurrences,
      operations: [
        { occurrenceId: 'occ-alpha', requestedValue: '^2.0.0' },
        { occurrenceId: 'occ-react', requestedValue: '^19.0.0' },
      ],
      traces,
      metadata: new Map([
        ['occ-alpha', { packageName: 'alpha', currentVersion: '^1.0.0', data: packageData() }],
      ]),
      cohorts: [],
      rules: [],
      policySource: 'library',
      asOf: '2026-07-16T00:00:00.000Z',
      cooldownDays: 0,
    })

    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'peer',
        state: 'unknown',
        reason: 'PEER_EVIDENCE_UNKNOWN',
      }),
    )
    expect(result.signals).not.toContainEqual(
      expect.objectContaining({ family: 'peer', reason: 'PEER_REQUIRED_MISSING' }),
    )
  })

  it('keeps conflicting repository runtime declarations unknown', () => {
    const result = evaluate('^19.0.0', {
      ...repository,
      runtimeDeclarations: [
        ...repository.runtimeDeclarations,
        {
          ...repository.runtimeDeclarations[0]!,
          id: 'runtime-conflict',
          kind: 'engines-node' as const,
          path: 'packages/other/package.json',
          field: 'engines.node',
          declaredText: '18.20.0',
        },
      ],
    })
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'runtime',
        state: 'unknown',
        reason: 'RUNTIME_EVIDENCE_UNKNOWN',
      }),
    )
  })

  it('does not override unsupported runtime evidence with a valid declaration', () => {
    const result = evaluate('^19.0.0', repository, [
      {
        id: 'runtime-conclusion-root',
        kind: 'runtime',
        boundaryId: 'boundary-root',
        status: 'unsupported',
      },
    ])
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'runtime',
        state: 'unknown',
        reason: 'RUNTIME_EVIDENCE_UNKNOWN',
      }),
    )
  })

  it('keeps missing runtime conclusions unknown even when declarations intersect', () => {
    const result = evaluate('^19.0.0', repository, [])
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'runtime',
        state: 'unknown',
        reason: 'RUNTIME_EVIDENCE_UNKNOWN',
      }),
    )
  })

  it('distinguishes malformed target engine metadata from an absent engine', () => {
    const result = evaluatePlanSignals({
      repository,
      occurrences: [occurrences[0]!],
      operations: [{ occurrenceId: 'occ-alpha', requestedValue: '^2.0.0' }],
      traces: new Map([
        [
          'occ-alpha',
          {
            occurrenceId: 'occ-alpha',
            status: 'selected',
            reason: 'SELECTED',
            eligibleVersions: ['2.0.0'],
            targetVersion: '2.0.0',
          },
        ],
      ]),
      metadata: new Map([
        [
          'occ-alpha',
          {
            packageName: 'alpha',
            currentVersion: '^1.0.0',
            data: packageData({
              engines: { '2.0.0': 'not-semver' },
              engineMetadata: { '2.0.0': 'present' },
            }),
          },
        ],
      ]),
      cohorts: [],
      rules: [],
      policySource: 'library',
      runtimeEvidence: [
        {
          id: 'runtime-conclusion-root',
          kind: 'runtime',
          boundaryId: 'boundary-root',
          status: 'confirmed',
        },
      ],
      asOf: '2026-07-16T00:00:00.000Z',
      cooldownDays: 0,
    })
    const signal = result.signals.find((item) => item.reason === 'TARGET_ENGINE_UNKNOWN')
    const evidence = result.evidence.find((item) => item.id === signal?.evidenceRefs[0])

    expect(signal).toMatchObject({ family: 'runtime', state: 'unknown' })
    expect(evidence?.facts.targetEngine).toBe('unknown')
  })

  it('keeps path-like direct peer metadata unknown at the evaluator boundary', () => {
    const evaluatePeer = (peerDependencies: PackageData['peerDependencies']) =>
      evaluatePlanSignals({
        repository,
        occurrences: [occurrences[0]!],
        operations: [{ occurrenceId: 'occ-alpha', requestedValue: '^2.0.0' }],
        traces: new Map([
          [
            'occ-alpha',
            {
              occurrenceId: 'occ-alpha',
              status: 'selected',
              reason: 'SELECTED',
              eligibleVersions: ['2.0.0'],
              targetVersion: '2.0.0',
            },
          ],
        ]),
        metadata: new Map([
          [
            'occ-alpha',
            {
              packageName: 'alpha',
              currentVersion: '^1.0.0',
              data: packageData({
                peerDependencies,
                peerMetadata: { '2.0.0': 'present' },
              }),
            },
          ],
        ]),
        cohorts: [],
        rules: [],
        policySource: 'library',
        runtimeEvidence: [
          {
            id: 'runtime-conclusion-root',
            kind: 'runtime',
            boundaryId: 'boundary-root',
            status: 'confirmed',
          },
        ],
        asOf: '2026-07-16T00:00:00.000Z',
        cooldownDays: 0,
      })
    const result = evaluatePeer({ '2.0.0': { '../escape': '^1.0.0' } })

    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'peer',
        state: 'unknown',
        reason: 'PEER_EVIDENCE_UNKNOWN',
      }),
    )
    expect(JSON.stringify(result)).not.toContain('../escape')
    for (const malformed of [{ '2.0.0': { react: 'not-semver' } }, undefined]) {
      const malformedResult = evaluatePeer(malformed)
      const signal = malformedResult.signals.find((item) => item.reason === 'PEER_EVIDENCE_UNKNOWN')
      const evidence = malformedResult.evidence.find((item) => item.id === signal?.evidenceRefs[0])
      expect(evidence?.facts.peerMetadata).toBe('unknown')
    }
  })

  it('keeps passive presence unknown and never labels it verified or safe', () => {
    const result = evaluate()
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'provenance-presence',
        state: 'unknown',
        reason: 'PROVENANCE_METADATA_UNKNOWN',
      }),
    )
    expect(JSON.stringify(result)).not.toMatch(/verified|trusted|safe/iu)
  })

  it('rejects malformed clocks and cooldowns at the public evaluator boundary', () => {
    const input = {
      repository,
      occurrences,
      operations: [],
      traces: new Map<string, ResolutionTrace>(),
      metadata: new Map(),
      cohorts: [],
      rules: [],
      policySource: 'library' as const,
      asOf: '2026-07-16T00:00:00.000Z',
      cooldownDays: 30,
    }
    expect(() => evaluatePlanSignals({ ...input, asOf: 'tomorrow' })).toThrow(/evaluation clock/u)
    expect(() => evaluatePlanSignals({ ...input, cooldownDays: -1 })).toThrow(/cooldown/u)
    expect(() => evaluatePlanSignals({ ...input, cooldownDays: Number.NaN })).toThrow(/cooldown/u)
    expect(() =>
      evaluatePlanSignals({
        ...input,
        occurrences: [{ ...occurrences[0]!, name: 'x'.repeat(5000) }],
      }),
    ).toThrow(/public evidence text/u)
  })

  it('blocks explicit divergent cohorts but permits a traced rule demotion', () => {
    const base = evaluate()
    const common = {
      repository,
      occurrences,
      operations: [
        { occurrenceId: 'occ-alpha', requestedValue: '^2.0.0' },
        { occurrenceId: 'occ-react', requestedValue: '^19.0.0' },
      ],
      traces: new Map(
        occurrences.map((occurrence) => [
          occurrence.id,
          {
            occurrenceId: occurrence.id,
            status: 'selected' as const,
            reason: 'SELECTED',
            eligibleVersions: [occurrence.name === 'alpha' ? '2.0.0' : '19.0.0'],
            targetVersion: occurrence.name === 'alpha' ? '2.0.0' : '19.0.0',
          },
        ]),
      ),
      metadata: new Map(),
      cohorts: [{ id: 'ui', members: ['alpha', 'react'], strategy: 'same-major' as const }],
      policySource: 'config' as const,
      asOf: '2026-07-16T00:00:00.000Z',
      cooldownDays: 0,
    }
    const blocked = evaluatePlanSignals({ ...common, rules: [] })
    expect(blocked.blockedOccurrenceIds).toEqual(['occ-alpha', 'occ-react'])
    const demoted = evaluatePlanSignals({
      ...common,
      rules: [{ id: 'review-ui', selectors: { cohortId: 'ui' }, effect: 'warn' as const }],
    })
    expect(demoted.blockedOccurrenceIds).toEqual([])
    expect(demoted.signals).toContainEqual(
      expect.objectContaining({
        family: 'cohort',
        state: 'fail',
        effect: 'warn',
        override: expect.objectContaining({ from: 'block', to: 'warn' }),
      }),
    )
    expect(base.signals.length).toBeGreaterThan(0)
  })

  it('keeps large explicit-cohort evidence individually bounded', () => {
    const members = Array.from({ length: 100 }, (_, index) => `package-${index}`)
    const cohortOccurrences = members.map((name, index) => ({
      id: `occurrence-${index}`,
      ownerId: 'package-root',
      name,
      field: 'dependencies',
      role: 'dependency',
      protocol: 'semver',
      declaredValue: '^1.0.0',
    }))
    const result = evaluatePlanSignals({
      repository,
      occurrences: cohortOccurrences,
      operations: cohortOccurrences.map((occurrence) => ({
        occurrenceId: occurrence.id,
        requestedValue: '^2.0.0',
      })),
      traces: new Map(
        cohortOccurrences.map((occurrence) => [
          occurrence.id,
          {
            occurrenceId: occurrence.id,
            status: 'selected' as const,
            reason: 'SELECTED',
            eligibleVersions: ['2.0.0'],
            targetVersion: '2.0.0',
          },
        ]),
      ),
      metadata: new Map(
        cohortOccurrences.map((occurrence) => [
          occurrence.id,
          {
            packageName: occurrence.name,
            currentVersion: '^1.0.0',
            data: packageData({ name: occurrence.name, peerMetadata: { '2.0.0': 'absent' } }),
          },
        ]),
      ),
      cohorts: [{ id: 'large-family', members, strategy: 'same-major' }],
      rules: [],
      policySource: 'library',
      runtimeEvidence: [
        {
          id: 'runtime-conclusion-root',
          kind: 'runtime',
          boundaryId: 'boundary-root',
          status: 'confirmed',
        },
      ],
      asOf: '2026-07-16T00:00:00.000Z',
      cooldownDays: 0,
    })
    const cohortEvidence = result.evidence.find((item) => item.kind === 'explicit-cohort')

    expect(result.signals).toContainEqual(
      expect.objectContaining({ family: 'cohort', state: 'pass', reason: 'COHORT_ALIGNED' }),
    )
    expect(
      Math.max(...Object.values(cohortEvidence?.facts ?? {}).map((value) => value.length)),
    ).toBeLessThanOrEqual(4096)
  })
})

describe('validateSignalConfiguration', () => {
  it('rejects duplicate cohort members and rules for unknown cohorts', () => {
    expect(() =>
      validateSignalConfiguration(
        [{ id: 'ui', members: ['alpha', 'alpha'], strategy: 'same-version' }],
        [],
      ),
    ).toThrow(/unique public package names/u)
    expect(() =>
      validateSignalConfiguration(
        [],
        [{ id: 'block', selectors: { cohortId: 'missing' }, effect: 'block' }],
      ),
    ).toThrow(/unknown explicit cohort/u)
  })

  it('rejects path-like package names in cohorts and selectors', () => {
    expect(() =>
      validateSignalConfiguration(
        [{ id: 'ui', members: ['alpha', '../escape'], strategy: 'same-version' }],
        [],
      ),
    ).toThrow(/public package names/u)
    expect(() =>
      validateSignalConfiguration(
        [],
        [
          {
            id: 'block',
            selectors: { dependencyName: 'not a package' },
            effect: 'block',
          },
        ],
      ),
    ).toThrow(/public package name/u)
    for (const workspacePath of ['../escape', '/absolute', 'packages\\web']) {
      expect(() =>
        validateSignalConfiguration(
          [],
          [{ id: 'block', selectors: { workspacePath }, effect: 'block' }],
        ),
      ).toThrow(/repository-relative/u)
    }
  })
})
