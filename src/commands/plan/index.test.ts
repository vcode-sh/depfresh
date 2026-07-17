import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalJson } from '../../contracts/canonical-json'
import { createPlanFingerprint, hashExactBytes } from '../../contracts/fingerprint'
import { validatePlanResult } from '../../contracts/validate'
import type { PackageData } from '../../types'

const { fetchPackageData } = vi.hoisted(() => ({
  fetchPackageData: vi.fn<(name: string) => Promise<PackageData>>(),
}))

vi.mock('../../io/registry', () => ({ fetchPackageData }))

import { plan, planForInvocation } from './index'

describe('plan contract', () => {
  beforeEach(() => {
    fetchPackageData.mockReset()
    fetchPackageData.mockImplementation(async (name: string) => ({
      name,
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('creates exact immutable operations with one terminal decision per occurrence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-'))
    const home = mkdtempSync(join(tmpdir(), 'depfresh-plan-home-'))
    const manifest = join(root, 'package.json')
    writeFileSync(manifest, '{\n  "name": "fixture",\n  "dependencies": { "alpha": "^1.0.0" }\n}\n')
    const before = readFileSync(manifest)
    vi.stubEnv('HOME', home)

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.contract).toBe('depfresh.plan')
    expect(result.schemaVersion).toBe(2)
    expect(result.selection).toEqual({
      requests: [],
      summary: {
        requestedWorkspaces: 0,
        requestedCatalogs: 0,
        matchedWorkspaces: 0,
        matchedCatalogNames: 0,
        matchedCatalogOwners: 0,
        excludedOccurrences: 0,
        eligibleSharedCatalogOwners: 0,
      },
    })
    expect(result.operations).toHaveLength(1)
    expect(result.decisions).toHaveLength(result.occurrences.length)
    expect(new Set(result.decisions.map((decision) => decision.occurrenceId))).toEqual(
      new Set(result.occurrences.map((occurrence) => occurrence.id)),
    )
    expect(result.operations[0]).toMatchObject({
      file: 'package.json',
      path: ['dependencies', 'alpha'],
      expectedValue: '^1.0.0',
      requestedValue: '^2.0.0',
    })
    expect(result.decisions[0]?.candidate?.targetVersion).toBe('2.0.0')
    expect(result.planFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.signals?.length).toBeGreaterThan(0)
    expect(result.signalEvidence?.length).toBeGreaterThan(0)
    expect(result.summary.signals?.total).toBe(result.signals?.length)
    expect(JSON.stringify(result)).not.toContain(root)
    expect(readFileSync(manifest)).toEqual(before)
    expect(existsSync(join(home, '.depfresh'))).toBe(false)
  })

  it('fingerprints CLI workspace selection and rejects forged receipt counts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-selection-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.0.0' } }),
    )

    const result = await planForInvocation({ cwd: root, mode: 'latest' }, 'cli', {
      workspaces: ['.'],
      catalogs: [],
    })

    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.operations).toEqual([])
    expect(result.selection).toMatchObject({
      requests: [
        {
          kind: 'workspace',
          value: '.',
          occurrenceIds: [result.occurrences[0]?.id],
        },
      ],
      summary: { excludedOccurrences: 1, eligibleSharedCatalogOwners: 0 },
    })
    expect(validatePlanResult(result)).toBe(true)

    const { planFingerprint: _fingerprint, ...forgedBase } = {
      ...result,
      selection: {
        ...result.selection,
        summary: { ...result.selection.summary, excludedOccurrences: 2 },
      },
    }
    expect(
      validatePlanResult({
        ...forgedBase,
        planFingerprint: createPlanFingerprint(forgedBase),
      }),
    ).toBe(false)

    const originalRuleId = result.decisions[0]?.policy.winningActionRuleId
    expect(originalRuleId).toMatch(/^\$cli:exclude-workspace:/u)
    const forgedRuleId = '$cli:exclude-workspace:forged:direct'
    const { planFingerprint: _ruleFingerprint, ...forgedRuleBase } = {
      ...result,
      decisions: result.decisions.map((decision) => ({
        ...decision,
        policy: {
          ...decision.policy,
          matchedRuleIds: decision.policy.matchedRuleIds.map((id) =>
            id === originalRuleId ? forgedRuleId : id,
          ),
          winningActionRuleId:
            decision.policy.winningActionRuleId === originalRuleId
              ? forgedRuleId
              : decision.policy.winningActionRuleId,
        },
      })),
    }
    expect(
      validatePlanResult({
        ...forgedRuleBase,
        planFingerprint: createPlanFingerprint(forgedRuleBase),
      }),
    ).toBe(false)
  })

  it('rejects release signals rebuilt from a target other than the decision candidate', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-release-forgery-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.0.0' } }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })
    const result = await plan({ cwd: root, mode: 'latest' })
    const releaseSignal = result.signals?.find((item) => item.reason === 'TARGET_STABLE')
    const releaseEvidence = result.signalEvidence?.find(
      (item) => item.id === releaseSignal?.evidenceRefs[0],
    )
    expect(result.decisions[0]?.candidate?.targetVersion).toBe('2.0.0')
    expect(releaseSignal).toBeDefined()
    expect(releaseEvidence).toBeDefined()

    const { id: _oldEvidenceId, ...evidenceBase } = releaseEvidence!
    const forgedEvidenceBase = {
      ...evidenceBase,
      facts: { ...evidenceBase.facts, targetVersion: '3.0.0' },
    }
    const forgedEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(forgedEvidenceBase)).slice(0, 24)}`,
      ...forgedEvidenceBase,
    }
    const { id: _oldSignalId, ...signalBase } = releaseSignal!
    const forgedSignalBase = {
      ...signalBase,
      evidenceRefs: [forgedEvidence.id],
    }
    const forgedSignal = {
      id: `signal-${hashExactBytes(canonicalJson(forgedSignalBase)).slice(0, 24)}`,
      ...forgedSignalBase,
    }
    const { planFingerprint: _oldFingerprint, ...planBase } = result
    const forgedBase = {
      ...planBase,
      signals: result
        .signals!.map((item) => (item.id === releaseSignal!.id ? forgedSignal : item))
        .sort((left, right) => left.id.localeCompare(right.id)),
      signalEvidence: result
        .signalEvidence!.map((item) => (item.id === releaseEvidence!.id ? forgedEvidence : item))
        .sort((left, right) => left.id.localeCompare(right.id)),
      summary: result.summary,
    }

    expect(
      validatePlanResult({ ...forgedBase, planFingerprint: createPlanFingerprint(forgedBase) }),
    ).toBe(false)
  })

  it('blocks divergent explicit cohorts without reselecting candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-cohort-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '^1.0.0', beta: '^1.0.0' },
      }),
    )
    fetchPackageData.mockImplementation(async (name: string) => ({
      name,
      versions: name === 'alpha' ? ['1.0.0', '2.0.0'] : ['1.0.0', '3.0.0'],
      distTags: { latest: name === 'alpha' ? '2.0.0' : '3.0.0' },
    }))

    const result = await plan({
      cwd: root,
      mode: 'latest',
      cohorts: [{ id: 'family', members: ['alpha', 'beta'], strategy: 'same-major' }],
    })

    expect(result.operations).toEqual([])
    expect(result.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'blocked', reason: 'SIGNAL_POLICY_BLOCKED' }),
        expect.objectContaining({ status: 'blocked', reason: 'SIGNAL_POLICY_BLOCKED' }),
      ]),
    )
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'cohort',
        state: 'fail',
        reason: 'COHORT_DIVERGED',
        effect: 'block',
      }),
    )

    const demoted = await plan({
      cwd: root,
      mode: 'latest',
      cohorts: [{ id: 'family', members: ['alpha', 'beta'], strategy: 'same-major' }],
      signalRules: [{ id: 'review-family', selectors: { cohortId: 'family' }, effect: 'warn' }],
    })
    const cohortSignal = demoted.signals?.find((item) => item.reason === 'COHORT_DIVERGED')
    const cohortEvidence = demoted.signalEvidence?.find(
      (item) => item.kind === 'explicit-cohort' && cohortSignal?.evidenceRefs.includes(item.id),
    )
    const betaOccurrence = demoted.occurrences.find((item) => item.name === 'beta')
    expect(cohortSignal).toBeDefined()
    expect(cohortEvidence).toBeDefined()
    expect(betaOccurrence).toBeDefined()
    const betaFact = `proposedVersion.${betaOccurrence!.id}`
    const { id: _oldCohortEvidenceId, ...cohortEvidenceBase } = cohortEvidence!
    const forgedCohortEvidenceBase = {
      ...cohortEvidenceBase,
      facts: { ...cohortEvidenceBase.facts, [betaFact]: '2.0.0' },
    }
    const forgedCohortEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(forgedCohortEvidenceBase)).slice(0, 24)}`,
      ...forgedCohortEvidenceBase,
    }
    const { id: _oldCohortSignalId, ...cohortSignalBase } = cohortSignal!
    const forgedCohortSignalBase = {
      ...cohortSignalBase,
      state: 'pass' as const,
      reason: 'COHORT_ALIGNED' as const,
      evidenceRefs: [forgedCohortEvidence.id],
      override: {
        ruleId: 'review-family',
        source: 'library' as const,
        from: 'none' as const,
        to: 'warn' as const,
      },
    }
    const forgedCohortSignal = {
      id: `signal-${hashExactBytes(canonicalJson(forgedCohortSignalBase)).slice(0, 24)}`,
      ...forgedCohortSignalBase,
    }
    const { planFingerprint: _oldDemotedFingerprint, ...demotedBase } = demoted
    const forgedBase = {
      ...demotedBase,
      signals: demoted
        .signals!.map((item) => (item.id === cohortSignal!.id ? forgedCohortSignal : item))
        .sort((left, right) => left.id.localeCompare(right.id)),
      signalEvidence: demoted
        .signalEvidence!.map((item) =>
          item.id === cohortEvidence!.id ? forgedCohortEvidence : item,
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
      summary: {
        ...demoted.summary,
        signals: {
          ...demoted.summary.signals!,
          pass: demoted.summary.signals!.pass + 1,
          fail: demoted.summary.signals!.fail - 1,
        },
      },
    }
    expect(
      validatePlanResult({ ...forgedBase, planFingerprint: createPlanFingerprint(forgedBase) }),
    ).toBe(false)
  })

  it('retains the causal blocking signal after rebuilding the planned peer graph', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-peer-block-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '^1.0.0', react: '^18.0.0' },
      }),
    )
    fetchPackageData.mockImplementation(
      async (name: string): Promise<PackageData> =>
        name === 'alpha'
          ? {
              name,
              versions: ['1.0.0', '2.0.0'],
              distTags: { latest: '2.0.0' },
              peerDependencies: { '2.0.0': { react: '^19.0.0' } },
              peerMetadata: { '2.0.0': 'present' },
            }
          : {
              name,
              versions: ['18.0.0'],
              distTags: { latest: '18.0.0' },
              peerMetadata: { '18.0.0': 'absent' },
            },
    )

    const result = await plan({
      cwd: root,
      mode: 'latest',
      signalRules: [
        {
          id: 'block-peer-failures',
          selectors: { family: 'peer', state: 'fail' },
          effect: 'block',
        },
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.decisions).toContainEqual(
      expect.objectContaining({ status: 'blocked', reason: 'SIGNAL_POLICY_BLOCKED' }),
    )
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'peer',
        state: 'fail',
        effect: 'block',
        winningRuleId: 'block-peer-failures',
      }),
    )
  })

  it('uses peer declarations as final planned provider constraints', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-peer-provider-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { 'react-dom': '^18.0.0' },
        peerDependencies: { react: '^18.0.0' },
      }),
    )
    fetchPackageData.mockImplementation(
      async (name: string): Promise<PackageData> =>
        name === 'react-dom'
          ? {
              name,
              versions: ['18.0.0', '19.0.0'],
              distTags: { latest: '19.0.0' },
              peerDependencies: { '19.0.0': { react: '^19.0.0' } },
              peerMetadata: { '19.0.0': 'present' },
            }
          : {
              name,
              versions: ['18.0.0', '19.0.0'],
              distTags: { latest: '19.0.0' },
              peerMetadata: { '19.0.0': 'absent' },
            },
    )

    const compatible = await plan({ cwd: root, mode: 'latest', peer: true })
    expect(compatible.signals).toContainEqual(
      expect.objectContaining({ family: 'peer', state: 'pass', reason: 'PEER_COMPATIBLE' }),
    )
    const disjoint = await plan({ cwd: root, mode: 'latest', peer: false })
    expect(disjoint.signals).toContainEqual(
      expect.objectContaining({ family: 'peer', state: 'fail', reason: 'PEER_INCOMPATIBLE' }),
    )
    expect(disjoint.signals).not.toContainEqual(
      expect.objectContaining({ family: 'peer', reason: 'PEER_REQUIRED_MISSING' }),
    )
    const peerSignal = disjoint.signals?.find((item) => item.reason === 'PEER_INCOMPATIBLE')
    const graphEvidence = disjoint.signalEvidence?.find(
      (item) => item.kind === 'planned-graph' && peerSignal?.evidenceRefs.includes(item.id),
    )
    expect(peerSignal).toBeDefined()
    expect(graphEvidence).toBeDefined()
    const { id: _oldGraphId, ...graphBase } = graphEvidence!
    const forgedGraphBase = {
      ...graphBase,
      facts: { ...graphBase.facts, providerRange: '>=19.0.0 <20.0.0-0' },
    }
    const forgedGraph = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(forgedGraphBase)).slice(0, 24)}`,
      ...forgedGraphBase,
    }
    const { id: _oldPeerId, ...peerBase } = peerSignal!
    const forgedPeerBase = {
      ...peerBase,
      state: 'pass' as const,
      reason: 'PEER_COMPATIBLE' as const,
      evidenceRefs: peerBase.evidenceRefs.map((id) =>
        id === graphEvidence!.id ? forgedGraph.id : id,
      ),
      effect: 'none' as const,
    }
    const forgedPeer = {
      id: `signal-${hashExactBytes(canonicalJson(forgedPeerBase)).slice(0, 24)}`,
      ...forgedPeerBase,
    }
    const { planFingerprint: _oldPlanFingerprint, ...disjointBase } = disjoint
    const forgedBase = {
      ...disjointBase,
      signals: disjoint
        .signals!.map((item) => (item.id === peerSignal!.id ? forgedPeer : item))
        .sort((left, right) => left.id.localeCompare(right.id)),
      signalEvidence: disjoint
        .signalEvidence!.map((item) => (item.id === graphEvidence!.id ? forgedGraph : item))
        .sort((left, right) => left.id.localeCompare(right.id)),
      summary: {
        ...disjoint.summary,
        signals: {
          ...disjoint.summary.signals!,
          pass: disjoint.summary.signals!.pass + 1,
          fail: disjoint.summary.signals!.fail - 1,
        },
      },
    }
    expect(
      validatePlanResult({ ...forgedBase, planFingerprint: createPlanFingerprint(forgedBase) }),
    ).toBe(false)
  })

  it('keeps override-constrained peer topology unknown instead of emitting a false pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-peer-override-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '^1.0.0', react: '^18.0.0' },
        overrides: { react: '18.0.0' },
      }),
    )
    fetchPackageData.mockImplementation(
      async (name: string): Promise<PackageData> =>
        name === 'alpha'
          ? {
              name,
              versions: ['1.0.0', '2.0.0'],
              distTags: { latest: '2.0.0' },
              peerDependencies: { '2.0.0': { react: '^19.0.0' } },
              peerMetadata: { '2.0.0': 'present' },
            }
          : {
              name,
              versions: ['18.0.0', '19.0.0'],
              distTags: { latest: '19.0.0' },
              peerMetadata: { '19.0.0': 'absent' },
            },
    )

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'peer',
        state: 'unknown',
        reason: 'PEER_EVIDENCE_UNKNOWN',
      }),
    )
    expect(result.signals).not.toContainEqual(
      expect.objectContaining({ family: 'peer', state: 'pass', reason: 'PEER_COMPATIBLE' }),
    )
  })

  it('withholds overlong runtime declarations and keeps compatibility unknown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-runtime-overlong-'))
    const hostileRuntime = 'x'.repeat(5000)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        engines: { node: hostileRuntime },
        dependencies: { alpha: '^1.0.0' },
      }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      engines: { '2.0.0': '>=20' },
      engineMetadata: { '2.0.0': 'present' },
    })

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'runtime',
        state: 'unknown',
        reason: 'RUNTIME_EVIDENCE_UNKNOWN',
      }),
    )
    expect(JSON.stringify(result)).not.toContain(hostileRuntime)
  })

  it('rejects runtime signals rebuilt from invented repository declaration facts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-runtime-forgery-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        engines: { node: '24.15.0' },
        dependencies: { alpha: '^1.0.0' },
      }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      engines: { '2.0.0': '>=20' },
      engineMetadata: { '2.0.0': 'present' },
    })
    const result = await plan({ cwd: root, mode: 'latest' })
    const runtimeSignal = result.signals?.find((item) => item.reason === 'RUNTIME_COMPATIBLE')
    const runtimeEvidence = result.signalEvidence?.find(
      (item) => item.id === runtimeSignal?.evidenceRefs[0],
    )
    expect(runtimeSignal).toBeDefined()
    expect(runtimeEvidence).toBeDefined()

    const rangeFact = Object.keys(runtimeEvidence!.facts).find((key) =>
      key.startsWith('repositoryRange.'),
    )!
    const { id: _oldEvidenceId, ...evidenceBase } = runtimeEvidence!
    const forgedEvidenceBase = {
      ...evidenceBase,
      facts: { ...evidenceBase.facts, [rangeFact]: '18.0.0' },
    }
    const forgedEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(forgedEvidenceBase)).slice(0, 24)}`,
      ...forgedEvidenceBase,
    }
    const { id: _oldSignalId, ...signalBase } = runtimeSignal!
    const forgedSignalBase = {
      ...signalBase,
      state: 'fail' as const,
      reason: 'RUNTIME_INCOMPATIBLE' as const,
      evidenceRefs: [forgedEvidence.id],
      effect: 'warn' as const,
    }
    const forgedSignal = {
      id: `signal-${hashExactBytes(canonicalJson(forgedSignalBase)).slice(0, 24)}`,
      ...forgedSignalBase,
    }
    const { planFingerprint: _oldFingerprint, ...planBase } = result
    const forgedBase = {
      ...planBase,
      signals: result
        .signals!.map((item) => (item.id === runtimeSignal!.id ? forgedSignal : item))
        .sort((left, right) => left.id.localeCompare(right.id)),
      signalEvidence: result
        .signalEvidence!.map((item) => (item.id === runtimeEvidence!.id ? forgedEvidence : item))
        .sort((left, right) => left.id.localeCompare(right.id)),
      summary: {
        ...result.summary,
        signals: {
          ...result.summary.signals!,
          pass: result.summary.signals!.pass - 1,
          fail: result.summary.signals!.fail + 1,
        },
      },
    }
    const forged = { ...forgedBase, planFingerprint: createPlanFingerprint(forgedBase) }

    expect(validatePlanResult(forged)).toBe(false)
  })

  it('withholds overlong dependency names without rejecting the plan contract', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-name-overlong-'))
    const hostileName = 'x'.repeat(5000)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { [hostileName]: '^1.0.0' } }),
    )

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.decisions).toContainEqual(
      expect.objectContaining({ status: 'blocked', reason: 'SENSITIVE_VALUE_REDACTED' }),
    )
    expect(JSON.stringify(result)).not.toContain(hostileName)
    expect(fetchPackageData).not.toHaveBeenCalled()
  })

  it('projects catalog consumers into the complete planned peer graph', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-catalog-peer-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        packageManager: 'bun@1.2.0',
        workspaces: {
          packages: ['.'],
          catalogs: { native: { react: '^18.0.0' } },
        },
        dependencies: { alpha: '^1.0.0', react: 'catalog:native' },
      }),
    )
    fetchPackageData.mockImplementation(async (name: string): Promise<PackageData> => {
      if (name === 'alpha') {
        return {
          name,
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
          peerDependencies: { '2.0.0': { react: '^19.0.0' } },
          peerMetadata: { '2.0.0': 'present' },
        }
      }
      if (name === 'react') {
        return {
          name,
          versions: ['18.0.0', '19.0.0'],
          distTags: { latest: '19.0.0' },
          peerMetadata: { '19.0.0': 'absent' },
        }
      }
      return { name, versions: ['1.2.0'], distTags: { latest: '1.2.0' } }
    })

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.signals).toContainEqual(
      expect.objectContaining({ family: 'peer', state: 'pass', reason: 'PEER_COMPATIBLE' }),
    )
    expect(result.signals).not.toContainEqual(
      expect.objectContaining({ family: 'peer', reason: 'PEER_REQUIRED_MISSING' }),
    )
  })

  it('evaluates explicit cohorts through physical catalog owners without consumer duplicates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-catalog-cohort-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        packageManager: 'bun@1.2.0',
        workspaces: {
          packages: ['.'],
          catalogs: { native: { react: '^18.0.0', 'react-dom': '^18.0.0' } },
        },
        dependencies: { react: 'catalog:native', 'react-dom': 'catalog:native' },
      }),
    )
    fetchPackageData.mockImplementation(
      async (name: string): Promise<PackageData> => ({
        name,
        versions: name === 'bun' ? ['1.2.0'] : ['18.0.0', '19.0.0'],
        distTags: { latest: name === 'bun' ? '1.2.0' : '19.0.0' },
      }),
    )

    const result = await plan({
      cwd: root,
      mode: 'latest',
      cohorts: [{ id: 'react-family', members: ['react', 'react-dom'], strategy: 'same-major' }],
    })

    expect(
      result.operations.filter((operation) => operation.name.startsWith('react')),
    ).toHaveLength(2)
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'cohort',
        state: 'pass',
        reason: 'COHORT_ALIGNED',
        effect: 'none',
      }),
    )
  })

  it('reports an explicit cohort with no repository members as unknown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-missing-cohort-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.0.0' } }),
    )

    const result = await plan({
      cwd: root,
      mode: 'latest',
      cohorts: [{ id: 'missing-family', members: ['beta', 'gamma'], strategy: 'same-version' }],
    })

    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'cohort',
        state: 'unknown',
        reason: 'COHORT_MEMBER_UNKNOWN',
        subject: expect.objectContaining({ occurrenceIds: [], cohortId: 'missing-family' }),
      }),
    )
  })

  it('fingerprints exact manager, lockfile, adapter, and verification phase intent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-phases-'))
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'fixture',
          packageManager: 'npm@11.0.0',
          dependencies: { alpha: '^1.0.0' },
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      join(root, 'package-lock.json'),
      `${JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: {} }, null, 2)}\n`,
    )

    const result = await plan({
      cwd: root,
      mode: 'latest',
      syncLockfile: true,
      verifyArgv: ['node', '--test', 'literal;not-a-shell'],
      phaseTimeout: 30_000,
    })

    expect(result.execution).toEqual({
      mode: 'sync-lockfile',
      status: 'ready',
      timeoutMs: 30_000,
      targets: [
        expect.objectContaining({
          boundaryPath: '.',
          manager: { name: 'npm', version: '11.0.0' },
          lockfile: expect.objectContaining({ path: 'package-lock.json' }),
          adapter: {
            executable: 'npm',
            args: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
            lifecycle: 'disabled-by-flag',
            permittedPaths: ['package-lock.json'],
            externalEffects: ['package-manager-cache'],
          },
        }),
      ],
      verification: {
        executable: 'node',
        args: ['--test', 'literal;not-a-shell'],
        cwd: '.',
        timeoutMs: 30_000,
        permittedPaths: [],
      },
    })
    expect(result.requiredCapabilities).toEqual([
      'filesystem-read',
      'registry-read',
      'file-write',
      'process-execute',
      'lockfile-write',
      'verify-command',
    ])
    expect(result.planFingerprint).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('changes the fingerprint when the requested manager phase changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-phase-fingerprint-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'pnpm@10.33.0',
        dependencies: { alpha: '^1.0.0' },
      }),
    )
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const sync = await plan({ cwd: root, mode: 'latest', syncLockfile: true })
    const install = await plan({ cwd: root, mode: 'latest', install: true })

    expect(sync.execution.mode).toBe('sync-lockfile')
    expect(install.execution.mode).toBe('install')
    expect(sync.planFingerprint).not.toBe(install.planFingerprint)
  })

  it('fingerprints exact npm artifact verification intent without treating presence as proof', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-artifact-verification-'))
    const integrity = `sha512-${Buffer.alloc(64, 5).toString('base64')}`
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'npm@11.12.1',
        dependencies: { alpha: '^1.0.0' },
      }),
    )
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: {} }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      registry: 'https://registry.npmjs.org/',
      artifactIntegrity: { '2.0.0': integrity },
      signaturePresence: { '2.0.0': 'present' },
      provenancePresence: { '2.0.0': 'present' },
    })

    const result = await plan({
      cwd: root,
      mode: 'latest',
      install: true,
      verifyArtifacts: true,
      phaseTimeout: 30_000,
    })

    expect(result.execution.artifactVerification).toEqual({
      kind: 'npm-audit-signatures-v1',
      timeoutMs: 30_000,
      isolatedHome: true,
      policySource: 'config',
      rules: [],
      targets: [
        {
          boundaryId: expect.any(String),
          cwd: '.',
          verifier: { name: 'npm', version: '11.12.1' },
          executable: 'npm',
          args: ['audit', 'signatures', '--json', '--include-attestations', '--ignore-scripts'],
          artifacts: [
            expect.objectContaining({
              occurrenceIds: [expect.any(String)],
              packageName: 'alpha',
              version: '2.0.0',
              registry: 'https://registry.npmjs.org/',
              integrity,
              signaturePresence: 'present',
              provenancePresence: 'present',
              evidenceRef: expect.stringMatching(/^signal-evidence-[a-f0-9]{24}$/u),
            }),
          ],
        },
      ],
    })
    const artifact = result.execution.artifactVerification?.targets[0]?.artifacts[0]
    const evidence = result.signalEvidence?.find((item) => item.id === artifact?.evidenceRef)
    expect(evidence).toMatchObject({
      kind: 'registry-artifact',
      status: 'observed',
      subject: artifact?.id,
      sourceRefs: artifact?.occurrenceIds,
      facts: {
        packageName: 'alpha',
        targetVersion: '2.0.0',
        registry: 'https://registry.npmjs.org/',
        integrity,
        signaturePresence: 'present',
        provenancePresence: 'present',
      },
    })
    expect(result.requiredCapabilities).toEqual(
      expect.arrayContaining(['artifact-verify', 'network-access', 'process-execute', 'install']),
    )
    expect(validatePlanResult(result)).toBe(true)

    const forged = structuredClone(result)
    const forgedArtifact = forged.execution.artifactVerification?.targets[0]?.artifacts[0]
    expect(forgedArtifact).toBeDefined()
    if (forgedArtifact) forgedArtifact.signaturePresence = 'absent'
    const { planFingerprint: _fingerprint, ...forgedSemantic } = forged
    expect(
      validatePlanResult({
        ...forgedSemantic,
        planFingerprint: createPlanFingerprint(forgedSemantic),
      }),
    ).toBe(false)
  })

  it('keeps unsupported manager execution blocked without weakening file operations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-phase-blocked-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'yarn@4.7.0',
        dependencies: { alpha: '^1.0.0' },
      }),
    )
    writeFileSync(join(root, 'yarn.lock'), '__metadata:\n  version: 8\n')

    const result = await plan({
      cwd: root,
      mode: 'latest',
      syncLockfile: true,
    })

    expect(result.operations).toHaveLength(1)
    expect(result.execution).toMatchObject({
      mode: 'sync-lockfile',
      status: 'blocked',
      reason: 'MANAGER_UNSUPPORTED',
    })
    expect(result.requiredCapabilities).toEqual(['filesystem-read', 'registry-read', 'file-write'])
    expect(result.risks).toContainEqual(
      expect.objectContaining({ code: 'MANAGER_UNSUPPORTED', severity: 'blocking' }),
    )
  })

  it('blocks manager execution when an operation kind lacks exact lockfile reconciliation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-phase-occurrence-blocked-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'npm@11.0.0',
        overrides: { alpha: '1.0.0' },
      }),
    )
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: {} }),
    )

    const result = await plan({
      cwd: root,
      mode: 'latest',
      includeLocked: true,
      syncLockfile: true,
    })

    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]?.path[0]).toBe('overrides')
    expect(result.execution).toMatchObject({
      mode: 'sync-lockfile',
      status: 'blocked',
      reason: 'LOCKFILE_OCCURRENCE_UNSUPPORTED',
    })
    expect(result.requiredCapabilities).toEqual(['filesystem-read', 'registry-read', 'file-write'])
  })

  it('blocks manager execution for dependency protocols without exact lockfile proof', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-phase-protocol-blocked-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'pnpm@10.33.0',
        dependencies: {
          workspaceAlpha: 'workspace:^1.0.0',
          jsrAlias: 'jsr:@scope/alpha@^1.0.0',
        },
      }),
    )
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const result = await plan({ cwd: root, mode: 'latest', syncLockfile: true })

    expect(result.operations).toHaveLength(2)
    expect(
      result.occurrences
        .filter((occurrence) =>
          result.operations.some((operation) => operation.occurrenceId === occurrence.id),
        )
        .map((occurrence) => occurrence.protocol),
    ).toEqual(expect.arrayContaining(['workspace', 'jsr']))
    expect(result.execution).toMatchObject({
      mode: 'sync-lockfile',
      status: 'blocked',
      reason: 'LOCKFILE_PROTOCOL_UNSUPPORTED',
    })
    expect(result.requiredCapabilities).toEqual(['filesystem-read', 'registry-read', 'file-write'])
  })

  it('never runs or requires manager phases for an operation-free plan', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-phase-noop-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'npm@11.0.0',
        dependencies: { alpha: '^2.0.0' },
      }),
    )
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: {} }),
    )

    const result = await plan({ cwd: root, syncLockfile: true })

    expect(result.operations).toHaveLength(0)
    expect(result.execution).toEqual({
      mode: 'sync-lockfile',
      status: 'not-needed',
      timeoutMs: 120_000,
      targets: [],
    })
    expect(result.requiredCapabilities).toEqual(['filesystem-read', 'registry-read'])
  })

  it('rejects ambiguous manager-phase requests and malformed verification argv', async () => {
    await expect(plan({ cwd: '.', syncLockfile: true, install: true })).rejects.toMatchObject({
      reason: 'INVALID_OPTION_VALUE',
    })
    await expect(plan({ cwd: '.', syncLockfile: true, verifyArgv: [] })).rejects.toMatchObject({
      reason: 'INVALID_OPTION_VALUE',
    })
    await expect(plan({ cwd: '.', verifyArgv: ['node', '--test'] })).rejects.toMatchObject({
      reason: 'INVALID_OPTION_VALUE',
    })
    await expect(
      plan({ cwd: '.', syncLockfile: true, verifyArgv: ['curl', '--token', 'super-secret-value'] }),
    ).rejects.toMatchObject({ reason: 'INVALID_OPTION_VALUE' })
    await expect(
      plan({
        cwd: '.',
        syncLockfile: true,
        verifyArgv: ['curl', '-H', 'Authorization:', 'Bearer', 'super-secret-value'],
      }),
    ).rejects.toMatchObject({ reason: 'INVALID_OPTION_VALUE' })
    for (const verifyArgv of [
      ['curl', '--client-secret', 'super-secret-value'],
      ['tool', '--password-file', 'credentials.txt'],
      ['tool', '--aws-secret-access-key', 'super-secret-value'],
      ['curl', '-u', 'alice:supersecret'],
      ['curl', '--user', 'alice:supersecret'],
      ['curl', '-ualice:pw'],
      ['curl', '-Uproxy:pw'],
      ['curl', 'ftp://alice:pw@example.test/file'],
      ['curl', 'sftp://alice:pw@example.test/file'],
      ['curl', 'alice:pw@example.test/file'],
      ['curl', '-H', 'X-Api-Key: literal-secret'],
      ['curl', '--header=X-Api-Key:literal-secret'],
      ['tool', '--passphrase=literal-secret'],
      ['curl', 'ftp://alice:pw@[::1]/file'],
      ['curl', 'ftp://alice:pw@例子.test/file'],
      ['curl', '-H', 'Cookie: session=literal-secret'],
      ['curl', '--cookie', 'session=literal-secret'],
      ['curl', '-bsession=literal-secret'],
      ['curl', '--proxy-header', 'X-Api-Key: abc123'],
      ['curl', '--proxy-header=X-Api-Key:abc123'],
      ['openssl', 'enc', '-pass', 'pass:abc123'],
      ['openssl', 'enc', '-passin', 'pass:abc123'],
      ['openssl', 'enc', '-passout', 'pass:abc123'],
      ['curl', 'ftp://:pw@example.test/file'],
      ['curl', 'ftp://alice:p@ss@example.test/file'],
      ['curl', '--cert', 'cert.pem:pw'],
      ['curl', '-sHX-Session:zzz'],
      ['curl', '-sHCookie:zzz'],
      ['http', 'GET', 'example.test', 'X-Api-Key:zzz'],
      ['http', 'GET', 'example.test', 'Cookie:session=zzz'],
      ['tool', 'X-Api-Key=zzz'],
    ]) {
      await expect(plan({ cwd: '.', syncLockfile: true, verifyArgv })).rejects.toMatchObject({
        reason: 'INVALID_OPTION_VALUE',
      })
    }
  })

  it('blocks credential-bearing values instead of leaking or weakening exact preconditions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-secret-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: 'https://user:secret@example.test/a.tgz?token=hidden' },
      }),
    )

    const result = await plan({ cwd: root })
    const serialized = JSON.stringify(result)

    expect(result.operations).toHaveLength(0)
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]).toMatchObject({
      status: 'blocked',
      reason: 'SENSITIVE_VALUE_REDACTED',
    })
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('hidden')
  })

  it('rejects credential-bearing policy identifiers before producing a plan', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-policy-secret-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '^1.0.0' },
        depfresh: {
          policyRules: [
            {
              id: 'token=supersecret',
              selectors: { dependencyName: 'alpha' },
              action: 'exclude',
            },
          ],
        },
      }),
    )

    await expect(plan({ cwd: root, mode: 'latest' })).rejects.toThrow(
      'Plan policy rule identifiers must be public and path-neutral.',
    )
  })

  it('rejects hostile option containers before invoking traps or accessors', async () => {
    let traps = 0
    const policyRules = new Proxy([], {
      ownKeys: () => {
        traps += 1
        throw new Error('token=must-not-leak')
      },
    })
    const include = Object.defineProperty([], '0', {
      enumerable: true,
      get: () => {
        traps += 1
        return 'alpha'
      },
    })

    await expect(plan({ cwd: '.', policyRules })).rejects.toMatchObject({
      code: 'ERR_CONFIG',
      reason: 'INVALID_CONFIG',
      message: 'Plan options must be plain JSON data.',
    })
    await expect(plan({ cwd: '.', include: include as string[] })).rejects.toMatchObject({
      code: 'ERR_CONFIG',
      reason: 'INVALID_CONFIG',
      message: 'Plan options must be plain JSON data.',
    })
    expect(traps).toBe(0)
  })

  it('blocks secret-bearing occurrence keys without exposing an inexact operation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-secret-key-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { 'token=supersecret': '^1.0.0' },
      }),
    )

    const result = await plan({ cwd: root, exclude: ['*'] })
    const serialized = JSON.stringify(result)

    expect(result.operations).toHaveLength(0)
    expect(result.decisions[0]).toMatchObject({
      status: 'blocked',
      reason: 'SENSITIVE_VALUE_REDACTED',
    })
    expect(serialized).not.toContain('supersecret')
  })

  it('retains successful operations when another registry resolution is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-partial-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '^1.0.0', beta: '^1.0.0' },
      }),
    )
    fetchPackageData.mockImplementation(async (name: string) => {
      if (name === 'beta') throw new Error('token=must-not-leak')
      return { name, versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } }
    })

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.operations.map((operation) => operation.name)).toEqual(['alpha'])
    expect(result.decisions.map((decision) => decision.status).sort()).toEqual([
      'operation',
      'unknown',
    ])
    expect(result.errors).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
  })

  it.each([
    ['NO_VALID_VERSIONS', { versions: [], distTags: {} }],
    [
      'MISSING_PUBLISH_TIME',
      { versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' }, time: {} },
    ],
    ['DIST_TAG_MISSING', { versions: ['1.0.0', '2.0.0'], distTags: {} }],
  ])('keeps incomplete candidate evidence unknown: %s', async (reason, packageData) => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-unknown-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.0.0' } }),
    )
    fetchPackageData.mockResolvedValue({ name: 'alpha', ...packageData })

    const result = await plan({
      cwd: root,
      mode: 'latest',
      ...(reason === 'MISSING_PUBLISH_TIME'
        ? { cooldown: 1, asOf: '2020-01-03T00:00:00.000Z' }
        : {}),
    })

    expect(result.decisions[0]).toMatchObject({ status: 'unknown', reason })
    expect(result.summary.unknown).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it('keeps safety-filtered candidates blocked instead of unchanged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-blocked-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.0.0' } }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['2.0.0-beta.1'],
      distTags: { latest: '2.0.0-beta.1' },
    })

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.decisions[0]).toMatchObject({
      status: 'blocked',
      reason: 'PRERELEASE_CHANNEL_BLOCKED',
    })
    expect(result.summary.blocked).toBe(1)
  })

  it('keeps dynamic and unsupported declarations as explicit skips', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-skips-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: 'latest', beta: '>=1.0.0 <2.0.0' },
      }),
    )

    const result = await plan({ cwd: root })

    expect(result.decisions.map((decision) => [decision.status, decision.reason])).toEqual(
      expect.arrayContaining([
        ['skipped', 'DYNAMIC_DIST_TAG'],
        ['skipped', 'COMPLEX_RANGE_UNSUPPORTED'],
      ]),
    )
  })

  it('retains the finalized candidate-unchanged policy trace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-final-policy-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.0.0' } }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['1.0.0'],
      distTags: { latest: '1.0.0' },
    })

    const result = await plan({ cwd: root })

    expect(result.decisions[0]).toMatchObject({
      status: 'unchanged',
      reason: 'CURRENT_VERSION_SELECTED',
      policy: {
        status: 'unchanged',
        reason: 'POLICY_CANDIDATE_UNCHANGED',
        candidateReason: 'CURRENT_VERSION_SELECTED',
      },
    })
  })

  it('uses declarative config policy without evaluating code', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-config-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '^1.0.0' },
        depfresh: { exclude: ['alpha'] },
      }),
    )

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(result.operations).toHaveLength(0)
    expect(result.decisions[0]).toMatchObject({ status: 'skipped', reason: 'POLICY_RULE_EXCLUDED' })
    expect(fetchPackageData).not.toHaveBeenCalled()
  })

  it('keeps configured signal-rule provenance when library cohorts are supplied directly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-signal-provenance-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '^1.0.0' },
        depfresh: {
          signalRules: [
            {
              id: 'review-stable',
              selectors: { family: 'release-channel', state: 'pass' },
              effect: 'warn',
            },
          ],
        },
      }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    })

    const result = await plan({ cwd: root, mode: 'latest', cohorts: [] })

    expect(result.signals).toContainEqual(
      expect.objectContaining({
        family: 'release-channel',
        winningRuleId: 'review-stable',
        override: expect.objectContaining({ source: 'config', from: 'none', to: 'warn' }),
      }),
    )
  })

  it('classifies locked and disabled fields without inventing resolution failures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-scope-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: {
          alpha: '1.0.0',
          npmAlias: 'npm:@scope/alpha@=1.0.0',
          jsrAlias: 'jsr:@scope/beta@2.0.0',
        },
        peerDependencies: { beta: '^1.0.0' },
      }),
    )

    const result = await plan({ cwd: root })

    expect(result.operations).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
    expect(result.decisions.map((decision) => [decision.status, decision.reason])).toEqual(
      expect.arrayContaining([
        ['skipped', 'LOCKED_DECLARATION_EXCLUDED'],
        ['skipped', 'RESOLUTION_SCOPE_EXCLUDED'],
      ]),
    )
    expect(fetchPackageData).not.toHaveBeenCalled()
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: 'current-deprecation',
          reason: 'CURRENT_DEPRECATION_UNKNOWN',
          subject: expect.objectContaining({ dependencyName: 'alpha' }),
        }),
        expect.objectContaining({
          family: 'release-channel',
          reason: 'TARGET_STABLE',
          subject: expect.objectContaining({ dependencyName: 'alpha' }),
        }),
        expect.objectContaining({
          family: 'release-channel',
          reason: 'TARGET_STABLE',
          subject: expect.objectContaining({ dependencyName: 'npmAlias' }),
        }),
        expect.objectContaining({
          family: 'release-channel',
          reason: 'TARGET_STABLE',
          subject: expect.objectContaining({ dependencyName: 'jsrAlias' }),
        }),
      ]),
    )
    expect(
      result.signals?.filter((signal) => signal.subject.dependencyName === 'alpha'),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'CURRENT_VERSION_UNKNOWN' }),
        expect.objectContaining({ reason: 'TARGET_VERSION_UNKNOWN' }),
      ]),
    )
  })

  it('preserves alias, workspace, and package-manager storage syntax in exact operations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-protocols-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        packageManager: 'pnpm@10.0.0+sha512.fixture',
        dependencies: {
          alias: 'npm:alpha@^1.0.0',
          workspaceAlpha: 'workspace:^1.0.0',
        },
      }),
    )
    fetchPackageData.mockImplementation(async (name: string) =>
      name === 'pnpm'
        ? { name, versions: ['10.0.0', '11.0.0'], distTags: { latest: '11.0.0' } }
        : { name, versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } },
    )

    const result = await plan({ cwd: root, mode: 'latest' })

    expect(
      result.operations.map(({ expectedValue, requestedValue }) => [expectedValue, requestedValue]),
    ).toEqual(
      expect.arrayContaining([
        ['npm:alpha@^1.0.0', 'npm:alpha@^2.0.0'],
        ['workspace:^1.0.0', 'workspace:^2.0.0'],
        ['pnpm@10.0.0+sha512.fixture', 'pnpm@11.0.0+sha512.fixture'],
      ]),
    )
  })

  it('plans a physical catalog owner once and keeps its consumer explanatory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-catalog-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        packageManager: 'bun@1.0.0',
        workspaces: {
          packages: ['.'],
          catalogs: { native: { react: '^18.0.0' } },
        },
        dependencies: { react: 'catalog:native' },
      }),
    )
    fetchPackageData.mockImplementation(async (name: string) =>
      name === 'bun'
        ? { name, versions: ['1.0.0', '2.0.0'], distTags: { latest: '2.0.0' } }
        : { name, versions: ['18.0.0', '19.0.0'], distTags: { latest: '19.0.0' } },
    )

    const result = await plan({ cwd: root, mode: 'latest' })
    const reactOperations = result.operations.filter((operation) => operation.name === 'react')
    const consumer = result.decisions.find(
      (decision) =>
        result.occurrences.find((occurrence) => occurrence.id === decision.occurrenceId)?.role ===
        'catalog-consumer',
    )

    expect(reactOperations).toHaveLength(1)
    expect(reactOperations[0]).toMatchObject({
      path: ['workspaces', 'catalogs', 'native', 'react'],
      expectedValue: '^18.0.0',
      requestedValue: '^19.0.0',
    })
    expect(consumer).toMatchObject({
      status: 'skipped',
      reason: 'CATALOG_CONSUMER_EXPLANATORY',
    })
  })

  it('requires a semantic time for cooldown and fingerprints it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depfresh-plan-time-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { alpha: '^1.0.0' } }),
    )
    fetchPackageData.mockResolvedValue({
      name: 'alpha',
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
      time: { '1.0.0': '2020-01-01T00:00:00.000Z', '2.0.0': '2020-01-02T00:00:00.000Z' },
    })

    await expect(plan({ cwd: root, cooldown: 1 })).rejects.toThrow(/--as-of/u)
    const first = await plan({
      cwd: root,
      cooldown: 1,
      mode: 'latest',
      asOf: '2020-01-04T00:00:00.000Z',
    })
    const second = await plan({
      cwd: root,
      cooldown: 1,
      mode: 'latest',
      asOf: '2020-01-05T00:00:00.000Z',
    })

    expect(first.planFingerprint).not.toBe(second.planFingerprint)
  })

  it('is byte-identical for cloned repositories with the same registry evidence', async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'depfresh-plan-clone-a-'))
    const secondRoot = mkdtempSync(join(tmpdir(), 'depfresh-plan-clone-b-'))
    const manifest = '{"name":"fixture","dependencies":{"alpha":"^1.0.0"}}\n'
    writeFileSync(join(firstRoot, 'package.json'), manifest)
    writeFileSync(join(secondRoot, 'package.json'), manifest)

    expect(JSON.stringify(await plan({ cwd: secondRoot, mode: 'latest' }))).toBe(
      JSON.stringify(await plan({ cwd: firstRoot, mode: 'latest' })),
    )
  })
})
