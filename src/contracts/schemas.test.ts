import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json'
import { createPlanFingerprint, createRepositoryFingerprint, hashExactBytes } from './fingerprint'
import { globalApplySchema, globalPlanSchema } from './global-schemas'
import type { ApplyResult } from './schemas'
import {
  applyResultSchema,
  commandErrorSchema,
  inspectResultSchema,
  planResultSchema,
  planResultV2Schema,
} from './schemas'
import { validateApplyResult, validateInspectResult, validatePlanResult } from './validate'

const root = resolve(import.meta.dirname, '../..')

function repository(sources: Array<{ path: string; byteHash: string }> = []) {
  const identity = 'root'
  return {
    identity,
    fingerprint: createRepositoryFingerprint({
      schemaVersion: 1,
      rootIdentity: identity,
      sources,
    }),
    modelSchemaVersion: 1,
    sources,
    boundaries: [],
    sourceFiles: [],
    packages: [],
    catalogs: [],
    runtimeDeclarations: [],
    relationships: {
      workspaceMembers: [],
      catalogConsumers: [],
      boundaryPackages: [],
      lockfileBoundaries: [],
    },
  }
}

describe('shipped contract schemas', () => {
  it.each([
    ['schemas/inspect-v1.json', inspectResultSchema],
    ['schemas/plan-v1.json', planResultSchema],
    ['schemas/plan-v2.json', planResultV2Schema],
    ['schemas/apply-v1.json', applyResultSchema],
    ['schemas/error-v1.json', commandErrorSchema],
    ['schemas/global-plan-v1.json', globalPlanSchema],
    ['schemas/global-apply-v1.json', globalApplySchema],
  ])('matches the authoritative descriptor for %s', (path, schema) => {
    expect(JSON.parse(readFileSync(resolve(root, path), 'utf8'))).toEqual(schema)
  })

  it('keeps published v1 plan and capabilities schema bytes stable', () => {
    const hashes = {
      'schemas/plan-v1.json': '1f9d8c19d4eb56cfd0fa98a16244c877fc75a538106297f8135bdc7d2d64a5bd',
      'schemas/capabilities-v1.json':
        '5c6ef7fdc9cb75325a6a711ae6f0311a948a25000bae5cc75a68e9bf2925e2ec',
    }

    for (const [path, expected] of Object.entries(hashes)) {
      const bytes = readFileSync(resolve(root, path))
      expect(createHash('sha256').update(bytes).digest('hex'), path).toBe(expected)
    }
  })

  it('rejects additional inspect fields and absolute source paths', () => {
    const base = {
      contract: 'depfresh.inspect',
      schemaVersion: 1,
      toolVersion: '1.2.0',
      repository: repository(),
      occurrences: [],
      evidence: [],
      lockfiles: [],
      vcs: { status: 'unavailable', targetFiles: [], unrelatedDirtyPaths: [], diagnostics: [] },
      diagnostics: [],
      risks: [],
      errors: [],
      requiredCapabilities: ['filesystem-read'],
    }

    expect(validateInspectResult(base)).toBe(true)
    expect(validateInspectResult({ ...base, extra: true })).toBe(false)
    expect(
      validateInspectResult({
        ...base,
        repository: {
          ...base.repository,
          sources: [{ path: '/tmp/package.json', byteHash: 'a'.repeat(64) }],
        },
      }),
    ).toBe(false)
  })

  it('rejects plan operations without exact preconditions', () => {
    const invalid = {
      contract: 'depfresh.plan',
      schemaVersion: 1,
      toolVersion: '1.2.0',
      repository: repository(),
      asOf: '1970-01-01T00:00:00.000Z',
      occurrences: [],
      decisions: [],
      operations: [{ occurrenceId: 'missing-preconditions' }],
      execution: { mode: 'file-only', status: 'ready', timeoutMs: 120_000, targets: [] },
      evidence: [],
      lockfiles: [],
      vcs: { status: 'unavailable', targetFiles: [], unrelatedDirtyPaths: [], diagnostics: [] },
      diagnostics: [],
      risks: [],
      errors: [],
      requiredCapabilities: ['filesystem-read'],
      summary: {
        total: 0,
        operations: 0,
        unchanged: 0,
        skipped: 0,
        blocked: 0,
        unknown: 0,
        errors: 0,
      },
      planFingerprint: 'a'.repeat(64),
    }

    expect(validatePlanResult(invalid)).toBe(false)
  })

  it('reconciles apply operation outcomes, summary, status, and capabilities', () => {
    const base = {
      contract: 'depfresh.apply',
      schemaVersion: 1,
      toolVersion: '1.2.0',
      planFingerprint: 'a'.repeat(64),
      repositoryIdentity: 'repository:fixture',
      status: 'applied',
      operations: [
        {
          operationId: 'operation-1',
          occurrenceId: 'occurrence-1',
          sourceFileId: 'source-1',
          file: 'package.json',
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
          observedValue: '2.0.0',
          observedByteHash: 'b'.repeat(64),
          status: 'applied',
          reason: 'APPLIED',
        },
      ],
      phases: [{ name: 'inspect', status: 'passed', reason: 'FINAL_STATE_OBSERVED' }],
      summary: {
        planned: 1,
        applied: 1,
        skipped: 0,
        conflicted: 0,
        reverted: 0,
        failed: 0,
        unknown: 0,
      },
      recovery: { status: 'not-needed' },
      requiredCapabilities: ['filesystem-read', 'file-write'],
    }

    expect(validateApplyResult(base)).toBe(true)
    expect(validateApplyResult({ ...base, status: 'unknown' })).toBe(false)
    expect(
      validateApplyResult({
        ...base,
        summary: { ...base.summary, applied: 0, unknown: 1 },
      }),
    ).toBe(false)
    expect(validateApplyResult({ ...base, requiredCapabilities: ['file-write'] })).toBe(false)
    expect(
      validateApplyResult({
        ...base,
        phases: [
          {
            name: 'sync-lockfile',
            status: 'passed',
            reason: 'MANAGER_PHASE_COMPLETED',
            commands: [
              {
                boundaryId: 'boundary-root',
                manager: 'npm',
                managerVersion: '11.0.0',
                lifecycle: 'disabled-by-flag',
                cwd: '.',
                executable: 'npm',
                args: ['install', '--package-lock-only', '--ignore-scripts'],
                termination: 'exit',
                terminationConfirmed: true,
                exitCode: 0,
                changedPaths: ['package-lock.json'],
                unexpectedPaths: [],
                externalEffects: ['package-manager-cache'],
              },
            ],
          },
        ],
      }),
    ).toBe(false)
    const {
      observedValue: _observedValue,
      observedByteHash: _observedByteHash,
      ...unobserved
    } = base.operations[0]!
    expect(
      validateApplyResult({
        ...base,
        operations: [
          {
            ...unobserved,
            reason: 'NOT_OBSERVED',
          },
        ],
        phases: [{ name: 'preflight', status: 'failed', reason: 'FAILED' }],
        recovery: { status: 'partial' },
      }),
    ).toBe(false)
  })

  it('rejects artifact evidence without an exact completed npm install and verifier command', () => {
    const forged = {
      contract: 'depfresh.apply',
      schemaVersion: 1,
      toolVersion: '1.2.0',
      planFingerprint: 'a'.repeat(64),
      repositoryIdentity: 'repository:fixture',
      status: 'noop',
      operations: [],
      phases: [
        {
          name: 'artifact-verify',
          status: 'passed',
          reason: 'ARTIFACT_VERIFICATION_RECORDED',
          artifactResults: [
            {
              artifactId: `artifact-${'b'.repeat(24)}`,
              boundaryId: 'boundary-root',
              location: 'node_modules/alpha',
              packageName: 'alpha',
              version: 'not-semver',
              registry: 'https://registry.npmjs.org/',
              integrity: 'sha512-A',
              lockfile: { path: 'package-lock.json', byteHash: 'c'.repeat(64) },
              verifier: { name: 'npm', version: '11.12.1' },
              observedAt: '1970-01-01T00:00:00.000Z',
              signature: {
                state: 'unknown',
                reason: 'SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE',
                effect: 'warn',
                matchedRuleIds: [],
              },
              provenance: {
                state: 'not-applicable',
                reason: 'PROVENANCE_NOT_PRESENT',
                effect: 'none',
                matchedRuleIds: [],
              },
            },
          ],
        },
      ],
      summary: {
        planned: 0,
        applied: 0,
        skipped: 0,
        conflicted: 0,
        reverted: 0,
        failed: 0,
        unknown: 0,
      },
      recovery: { status: 'not-needed' },
      requiredCapabilities: ['filesystem-read', 'file-write', 'artifact-verify', 'network-access'],
    }

    expect(validateApplyResult(forged)).toBe(false)
  })

  it('accepts exact artifact evidence for npm shrinkwrap and workspace-local installs', () => {
    const integrity = `sha512-${Buffer.alloc(64, 3).toString('base64')}`
    const identity = {
      packageName: 'alpha',
      version: '2.0.0',
      registry: 'https://registry.npmjs.org/',
      integrity,
    }
    const artifactId = `artifact-${hashExactBytes(canonicalJson(identity)).slice(0, 24)}`
    const commandBase = {
      boundaryId: 'boundary-service',
      manager: 'npm' as const,
      managerVersion: '11.12.1',
      cwd: 'apps/service',
      executable: 'npm',
      termination: 'exit' as const,
      terminationConfirmed: true,
      exitCode: 0,
      changedPaths: [] as string[],
      unexpectedPaths: [] as string[],
      lockfile: {
        path: 'apps/service/npm-shrinkwrap.json',
        byteHash: 'd'.repeat(64),
        parseState: 'parsed' as const,
        occurrences: 'matched' as const,
      },
      externalEffects: [] as string[],
    }
    const result = {
      contract: 'depfresh.apply',
      schemaVersion: 1,
      toolVersion: '1.2.0',
      planFingerprint: 'a'.repeat(64),
      repositoryIdentity: 'repository:fixture',
      status: 'applied',
      operations: [
        {
          operationId: 'operation-alpha',
          occurrenceId: 'occurrence-alpha',
          sourceFileId: 'source-service',
          file: 'apps/service/packages/a/package.json',
          path: ['dependencies', 'alpha'],
          name: 'alpha',
          expectedValue: '1.0.0',
          requestedValue: '2.0.0',
          observedValue: '2.0.0',
          observedByteHash: 'e'.repeat(64),
          status: 'applied',
          reason: 'APPLIED',
        },
      ],
      phases: [
        {
          name: 'install',
          status: 'passed',
          reason: 'MANAGER_PHASE_COMPLETED',
          commands: [
            {
              ...commandBase,
              lifecycle: 'disabled-by-flag',
              args: ['install', '--ignore-scripts'],
              externalEffects: ['package-manager-cache', 'dependency-install-state'],
            },
          ],
        },
        {
          name: 'artifact-verify',
          status: 'passed',
          reason: 'ARTIFACT_VERIFICATION_RECORDED',
          commands: [
            {
              ...commandBase,
              args: ['audit', 'signatures', '--json', '--include-attestations', '--ignore-scripts'],
            },
          ],
          artifactResults: [
            {
              artifactId,
              boundaryId: 'boundary-service',
              location: 'packages/a/node_modules/alpha',
              ...identity,
              lockfile: {
                path: 'apps/service/npm-shrinkwrap.json',
                byteHash: 'd'.repeat(64),
              },
              verifier: { name: 'npm', version: '11.12.1' },
              observedAt: '1970-01-01T00:00:00.000Z',
              signature: {
                state: 'unknown',
                reason: 'SIGNATURE_POSITIVE_COVERAGE_UNAVAILABLE',
                effect: 'warn',
                matchedRuleIds: [],
              },
              provenance: {
                state: 'not-applicable',
                reason: 'PROVENANCE_NOT_PRESENT',
                effect: 'none',
                matchedRuleIds: [],
              },
            },
          ],
        },
      ],
      summary: {
        planned: 1,
        applied: 1,
        skipped: 0,
        conflicted: 0,
        reverted: 0,
        failed: 0,
        unknown: 0,
      },
      recovery: { status: 'not-needed' },
      requiredCapabilities: [
        'filesystem-read',
        'file-write',
        'process-execute',
        'lockfile-write',
        'install',
        'artifact-verify',
        'network-access',
      ],
    }

    expect(validateApplyResult(result)).toBe(true)

    const forgedTimeout = structuredClone(result) as ApplyResult
    const forgedCommand = forgedTimeout.phases[1]!.commands![0]!
    forgedCommand.termination = 'timeout'
    forgedCommand.exitCode = undefined
    forgedTimeout.phases[1]!.artifactResults![0]!.provenance = {
      state: 'pass',
      reason: 'PROVENANCE_VERIFIED',
      effect: 'none',
      matchedRuleIds: [],
    }
    expect(validateApplyResult(forgedTimeout)).toBe(false)

    const cleanupFailure = structuredClone(result) as ApplyResult
    cleanupFailure.status = 'unknown'
    cleanupFailure.operations[0]!.status = 'unknown'
    cleanupFailure.operations[0]!.reason = 'NOT_OBSERVED'
    cleanupFailure.operations[0]!.observedValue = undefined
    cleanupFailure.operations[0]!.observedByteHash = undefined
    cleanupFailure.phases[1]!.status = 'unknown'
    cleanupFailure.phases[1]!.reason = 'ARTIFACT_VERIFIER_CLEANUP_FAILED'
    cleanupFailure.summary.applied = 0
    cleanupFailure.summary.unknown = 1
    cleanupFailure.recovery.status = 'unknown'

    expect(validateApplyResult(cleanupFailure)).toBe(true)
  })

  it('rejects cross-platform absolute paths', () => {
    const base = {
      contract: 'depfresh.inspect',
      schemaVersion: 1,
      toolVersion: '1.2.0',
      repository: repository(),
      occurrences: [],
      evidence: [],
      lockfiles: [],
      vcs: { status: 'unavailable', targetFiles: [], unrelatedDirtyPaths: [], diagnostics: [] },
      diagnostics: [],
      risks: [],
      errors: [],
      requiredCapabilities: ['filesystem-read'],
    }

    expect(
      validateInspectResult({
        ...base,
        repository: {
          ...base.repository,
          sources: [{ path: 'C:/Users/alice/package.json', byteHash: 'a'.repeat(64) }],
        },
      }),
    ).toBe(false)
  })

  it('enforces plan semantic links, summaries, canonical time, and fingerprint', () => {
    const semantic = {
      contract: 'depfresh.plan',
      schemaVersion: 1,
      toolVersion: '1.2.0',
      repository: {
        ...repository([{ path: 'package.json', byteHash: 'b'.repeat(64) }]),
        sourceFiles: [
          {
            id: 'source-1',
            path: 'package.json',
            format: 'json',
            byteHash: 'b'.repeat(64),
            parseState: 'parsed',
            indent: '  ',
            newline: 'lf',
            trailingNewline: true,
          },
        ],
        packages: [
          {
            id: 'package-1',
            sourceFileId: 'source-1',
            path: 'package.json',
            workspacePath: '.',
            name: 'fixture',
            private: false,
          },
        ],
      },
      asOf: '1970-01-01T00:00:00.000Z',
      occurrences: [
        {
          id: 'occurrence-1',
          ownerId: 'package-1',
          sourceFileId: 'source-1',
          file: 'package.json',
          name: 'alpha',
          path: ['dependencies', 'alpha'],
          field: 'dependencies',
          role: 'dependency',
          protocol: 'semver',
          declaredValue: '1.0.0',
          writeable: true,
        },
      ],
      decisions: [
        {
          occurrenceId: 'occurrence-1',
          status: 'unchanged',
          reason: 'CURRENT_VALUE_SELECTED',
          policy: {
            status: 'unchanged',
            reason: 'POLICY_CANDIDATE_UNCHANGED',
            action: 'include',
            mode: 'default',
            matchedRuleIds: ['$defaults:mode'],
            indeterminateRuleIds: [],
          },
        },
      ],
      operations: [],
      execution: { mode: 'file-only', status: 'ready', timeoutMs: 120_000, targets: [] },
      evidence: [],
      lockfiles: [],
      vcs: { status: 'unavailable', targetFiles: [], unrelatedDirtyPaths: [], diagnostics: [] },
      diagnostics: [],
      risks: [],
      errors: [],
      requiredCapabilities: ['filesystem-read', 'registry-read'],
      summary: {
        total: 1,
        operations: 0,
        unchanged: 1,
        skipped: 0,
        blocked: 0,
        unknown: 0,
        errors: 0,
      },
    }
    const valid = { ...semantic, planFingerprint: createPlanFingerprint(semantic) }
    const withoutDecision = {
      ...valid,
      decisions: [],
      summary: { ...valid.summary, total: 0, unchanged: 0 },
    }
    const invalidTime = { ...valid, asOf: '2026-99-99T99:99:99.999Z' }

    expect(validatePlanResult(valid)).toBe(true)
    expect(
      validatePlanResult({
        ...withoutDecision,
        planFingerprint: createPlanFingerprint(withoutDecision),
      }),
    ).toBe(false)
    expect(
      validatePlanResult({ ...invalidTime, planFingerprint: createPlanFingerprint(invalidTime) }),
    ).toBe(false)
    expect(validatePlanResult({ ...valid, planFingerprint: 'c'.repeat(64) })).toBe(false)

    const signalEvidenceBase = {
      kind: 'registry-version' as const,
      status: 'unknown' as const,
      subject: 'occurrence-1',
      sourceRefs: ['occurrence-1'],
      facts: { metadata: 'unavailable' },
    }
    const signalEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(signalEvidenceBase)).slice(0, 24)}`,
      ...signalEvidenceBase,
    }
    const signalBase = {
      family: 'evidence-completeness' as const,
      state: 'unknown' as const,
      reason: 'REGISTRY_EVIDENCE_UNKNOWN',
      subject: { occurrenceIds: ['occurrence-1'], dependencyName: 'alpha', workspacePath: '.' },
      evidenceRefs: [signalEvidence.id],
      effect: 'warn' as const,
      matchedRuleIds: [],
    }
    const signal = {
      id: `signal-${hashExactBytes(canonicalJson(signalBase)).slice(0, 24)}`,
      ...signalBase,
    }
    const signalPlan = {
      ...semantic,
      signals: [signal],
      signalEvidence: [signalEvidence],
      summary: {
        ...semantic.summary,
        signals: {
          total: 1,
          pass: 0,
          warn: 0,
          fail: 0,
          unknown: 1,
          notApplicable: 0,
          blocking: 0,
        },
      },
    }
    expect(
      validatePlanResult({ ...signalPlan, planFingerprint: createPlanFingerprint(signalPlan) }),
    ).toBe(true)
    const contradictorySignalBase = {
      ...signalBase,
      family: 'release-channel' as const,
      state: 'pass' as const,
      reason: 'TARGET_PRERELEASE' as const,
    }
    const contradictorySignal = {
      id: `signal-${hashExactBytes(canonicalJson(contradictorySignalBase)).slice(0, 24)}`,
      ...contradictorySignalBase,
    }
    const contradictorySignalPlan = {
      ...signalPlan,
      signals: [contradictorySignal],
      summary: {
        ...signalPlan.summary,
        signals: { ...signalPlan.summary.signals, unknown: 0, pass: 1 },
      },
    }
    expect(
      validatePlanResult({
        ...contradictorySignalPlan,
        planFingerprint: createPlanFingerprint(contradictorySignalPlan),
      }),
    ).toBe(false)
    const mismatchedEvidenceSignalBase = {
      ...signalBase,
      family: 'signature-presence' as const,
      state: 'warn' as const,
      reason: 'SIGNATURE_PRESENT_UNVERIFIED' as const,
    }
    const mismatchedEvidenceSignal = {
      id: `signal-${hashExactBytes(canonicalJson(mismatchedEvidenceSignalBase)).slice(0, 24)}`,
      ...mismatchedEvidenceSignalBase,
    }
    const mismatchedEvidencePlan = {
      ...signalPlan,
      signals: [mismatchedEvidenceSignal],
      summary: {
        ...signalPlan.summary,
        signals: { ...signalPlan.summary.signals, unknown: 0, warn: 1 },
      },
    }
    expect(
      validatePlanResult({
        ...mismatchedEvidencePlan,
        planFingerprint: createPlanFingerprint(mismatchedEvidencePlan),
      }),
    ).toBe(false)
    const unknownTargetSignatureEvidenceBase = {
      kind: 'registry-version' as const,
      status: 'unknown' as const,
      subject: 'occurrence-1',
      sourceRefs: ['occurrence-1'],
      facts: { targetVersion: 'unknown', signaturePresence: 'present' },
    }
    const unknownTargetSignatureEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(unknownTargetSignatureEvidenceBase)).slice(0, 24)}`,
      ...unknownTargetSignatureEvidenceBase,
    }
    const unknownTargetSignatureBase = {
      ...mismatchedEvidenceSignalBase,
      evidenceRefs: [unknownTargetSignatureEvidence.id],
    }
    const unknownTargetSignature = {
      id: `signal-${hashExactBytes(canonicalJson(unknownTargetSignatureBase)).slice(0, 24)}`,
      ...unknownTargetSignatureBase,
    }
    const unknownTargetSignaturePlan = {
      ...mismatchedEvidencePlan,
      signals: [unknownTargetSignature],
      signalEvidence: [unknownTargetSignatureEvidence],
    }
    expect(
      validatePlanResult({
        ...unknownTargetSignaturePlan,
        planFingerprint: createPlanFingerprint(unknownTargetSignaturePlan),
      }),
    ).toBe(false)
    const forgedSubjectSignalBase = {
      ...signalBase,
      subject: { ...signalBase.subject, dependencyName: 'beta' },
    }
    const forgedSubjectSignal = {
      id: `signal-${hashExactBytes(canonicalJson(forgedSubjectSignalBase)).slice(0, 24)}`,
      ...forgedSubjectSignalBase,
    }
    const forgedSubjectPlan = { ...signalPlan, signals: [forgedSubjectSignal] }
    expect(
      validatePlanResult({
        ...forgedSubjectPlan,
        planFingerprint: createPlanFingerprint(forgedSubjectPlan),
      }),
    ).toBe(false)
    const peerRegistryBase = {
      kind: 'registry-version' as const,
      status: 'observed' as const,
      subject: 'occurrence-1',
      sourceRefs: ['occurrence-1'],
      facts: { targetVersion: '1.0.0', peerMetadata: 'present' },
    }
    const peerRegistryEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(peerRegistryBase)).slice(0, 24)}`,
      ...peerRegistryBase,
    }
    const missingPeerGraphBase = {
      kind: 'planned-graph' as const,
      status: 'absent' as const,
      subject: 'occurrence-1:occurrence-1:react',
      sourceRefs: ['occurrence-1'],
      facts: {
        peer: 'react',
        requiredRange: '^19.0.0',
        providerRange: 'missing',
        providers: '0',
        boundaryProviders: '0',
        overrideConstraints: '0',
        optional: 'no',
      },
    }
    const missingPeerGraphEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(missingPeerGraphBase)).slice(0, 24)}`,
      ...missingPeerGraphBase,
    }
    const forgedOptionalPeerBase = {
      family: 'peer' as const,
      state: 'not-applicable' as const,
      reason: 'PEER_OPTIONAL_MISSING' as const,
      subject: { occurrenceIds: ['occurrence-1'], dependencyName: 'alpha', workspacePath: '.' },
      evidenceRefs: [peerRegistryEvidence.id, missingPeerGraphEvidence.id],
      effect: 'none' as const,
      matchedRuleIds: [],
    }
    const forgedOptionalPeer = {
      id: `signal-${hashExactBytes(canonicalJson(forgedOptionalPeerBase)).slice(0, 24)}`,
      ...forgedOptionalPeerBase,
    }
    const requiredPeerBase = {
      ...forgedOptionalPeerBase,
      state: 'fail' as const,
      reason: 'PEER_REQUIRED_MISSING' as const,
      effect: 'warn' as const,
    }
    const requiredPeer = {
      id: `signal-${hashExactBytes(canonicalJson(requiredPeerBase)).slice(0, 24)}`,
      ...requiredPeerBase,
    }
    const forgedOptionalPeerPlan = {
      ...semantic,
      signals: [forgedOptionalPeer],
      signalEvidence: [peerRegistryEvidence, missingPeerGraphEvidence].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      summary: {
        ...semantic.summary,
        signals: {
          total: 1,
          pass: 0,
          warn: 0,
          fail: 0,
          unknown: 0,
          notApplicable: 1,
          blocking: 0,
        },
      },
    }
    const requiredPeerPlan = {
      ...forgedOptionalPeerPlan,
      signals: [requiredPeer],
      summary: {
        ...forgedOptionalPeerPlan.summary,
        signals: {
          ...forgedOptionalPeerPlan.summary.signals,
          fail: 1,
          notApplicable: 0,
        },
      },
    }
    expect(
      validatePlanResult({
        ...requiredPeerPlan,
        planFingerprint: createPlanFingerprint(requiredPeerPlan),
      }),
    ).toBe(true)
    expect(
      validatePlanResult({
        ...forgedOptionalPeerPlan,
        planFingerprint: createPlanFingerprint(forgedOptionalPeerPlan),
      }),
    ).toBe(false)
    const enabledMaturityEvidenceBase = {
      kind: 'registry-version' as const,
      status: 'observed' as const,
      subject: 'occurrence-1',
      sourceRefs: ['occurrence-1'],
      facts: {
        targetVersion: '1.0.0',
        publishedAt: '2026-07-15T00:00:00.000Z',
        asOf: '2026-07-16T00:00:00.000Z',
        cooldownDays: '30',
      },
    }
    const enabledMaturityEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(enabledMaturityEvidenceBase)).slice(0, 24)}`,
      ...enabledMaturityEvidenceBase,
    }
    const forgedDisabledMaturityBase = {
      family: 'maturity' as const,
      state: 'not-applicable' as const,
      reason: 'MATURITY_POLICY_DISABLED' as const,
      subject: { occurrenceIds: ['occurrence-1'], dependencyName: 'alpha', workspacePath: '.' },
      evidenceRefs: [enabledMaturityEvidence.id],
      effect: 'none' as const,
      matchedRuleIds: [],
    }
    const forgedDisabledMaturity = {
      id: `signal-${hashExactBytes(canonicalJson(forgedDisabledMaturityBase)).slice(0, 24)}`,
      ...forgedDisabledMaturityBase,
    }
    const tooNewMaturityBase = {
      ...forgedDisabledMaturityBase,
      state: 'fail' as const,
      reason: 'TARGET_TOO_NEW' as const,
      effect: 'warn' as const,
    }
    const tooNewMaturity = {
      id: `signal-${hashExactBytes(canonicalJson(tooNewMaturityBase)).slice(0, 24)}`,
      ...tooNewMaturityBase,
    }
    const forgedDisabledMaturityPlan = {
      ...semantic,
      signals: [forgedDisabledMaturity],
      signalEvidence: [enabledMaturityEvidence],
      summary: {
        ...semantic.summary,
        signals: {
          total: 1,
          pass: 0,
          warn: 0,
          fail: 0,
          unknown: 0,
          notApplicable: 1,
          blocking: 0,
        },
      },
    }
    const tooNewMaturityPlan = {
      ...forgedDisabledMaturityPlan,
      signals: [tooNewMaturity],
      summary: {
        ...forgedDisabledMaturityPlan.summary,
        signals: {
          ...forgedDisabledMaturityPlan.summary.signals,
          fail: 1,
          notApplicable: 0,
        },
      },
    }
    expect(
      validatePlanResult({
        ...tooNewMaturityPlan,
        planFingerprint: createPlanFingerprint(tooNewMaturityPlan),
      }),
    ).toBe(true)
    expect(
      validatePlanResult({
        ...forgedDisabledMaturityPlan,
        planFingerprint: createPlanFingerprint(forgedDisabledMaturityPlan),
      }),
    ).toBe(false)
    const unknownCurrentEvidenceBase = {
      kind: 'registry-version' as const,
      status: 'unknown' as const,
      subject: 'occurrence-1',
      sourceRefs: ['occurrence-1'],
      facts: {
        targetVersion: 'unknown',
        deprecation: 'unknown',
        versionRole: 'current',
      },
    }
    const unknownCurrentEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(unknownCurrentEvidenceBase)).slice(0, 24)}`,
      ...unknownCurrentEvidenceBase,
    }
    const unknownCurrentVersionBase = {
      family: 'current-deprecation' as const,
      state: 'unknown' as const,
      reason: 'CURRENT_VERSION_UNKNOWN' as const,
      subject: { occurrenceIds: ['occurrence-1'], dependencyName: 'alpha', workspacePath: '.' },
      evidenceRefs: [unknownCurrentEvidence.id],
      effect: 'warn' as const,
      matchedRuleIds: [],
    }
    const unknownCurrentVersion = {
      id: `signal-${hashExactBytes(canonicalJson(unknownCurrentVersionBase)).slice(0, 24)}`,
      ...unknownCurrentVersionBase,
    }
    const unknownCurrentVersionPlan = {
      ...semantic,
      occurrences: semantic.occurrences.map((occurrence) => ({
        ...occurrence,
        declaredValue: '^1.0.0',
      })),
      signals: [unknownCurrentVersion],
      signalEvidence: [unknownCurrentEvidence],
      summary: {
        ...semantic.summary,
        signals: {
          total: 1,
          pass: 0,
          warn: 0,
          fail: 0,
          unknown: 1,
          notApplicable: 0,
          blocking: 0,
        },
      },
    }
    expect(
      validatePlanResult({
        ...unknownCurrentVersionPlan,
        planFingerprint: createPlanFingerprint(unknownCurrentVersionPlan),
      }),
    ).toBe(true)
    const forgedCurrentVersionEvidenceBase = {
      ...unknownCurrentEvidenceBase,
      status: 'observed' as const,
      facts: {
        targetVersion: '9.0.0',
        deprecation: 'absent',
        versionRole: 'current',
      },
    }
    const forgedCurrentVersionEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(forgedCurrentVersionEvidenceBase)).slice(0, 24)}`,
      ...forgedCurrentVersionEvidenceBase,
    }
    const forgedCurrentVersionSignalBase = {
      ...unknownCurrentVersionBase,
      state: 'pass' as const,
      reason: 'CURRENT_NOT_DEPRECATED' as const,
      evidenceRefs: [forgedCurrentVersionEvidence.id],
      effect: 'none' as const,
    }
    const forgedCurrentVersionSignal = {
      id: `signal-${hashExactBytes(canonicalJson(forgedCurrentVersionSignalBase)).slice(0, 24)}`,
      ...forgedCurrentVersionSignalBase,
    }
    const forgedCurrentVersionPlan = {
      ...unknownCurrentVersionPlan,
      occurrences: semantic.occurrences,
      signals: [forgedCurrentVersionSignal],
      signalEvidence: [forgedCurrentVersionEvidence],
      summary: {
        ...unknownCurrentVersionPlan.summary,
        signals: {
          ...unknownCurrentVersionPlan.summary.signals,
          pass: 1,
          unknown: 0,
        },
      },
    }
    expect(
      validatePlanResult({
        ...forgedCurrentVersionPlan,
        planFingerprint: createPlanFingerprint(forgedCurrentVersionPlan),
      }),
    ).toBe(false)
    const exactCurrentVersionEvidenceBase = {
      ...forgedCurrentVersionEvidenceBase,
      facts: { ...forgedCurrentVersionEvidenceBase.facts, targetVersion: '1.0.0' },
    }
    const exactCurrentVersionEvidence = {
      id: `signal-evidence-${hashExactBytes(canonicalJson(exactCurrentVersionEvidenceBase)).slice(0, 24)}`,
      ...exactCurrentVersionEvidenceBase,
    }
    const exactCurrentVersionSignalBase = {
      ...forgedCurrentVersionSignalBase,
      evidenceRefs: [exactCurrentVersionEvidence.id],
    }
    const exactCurrentVersionSignal = {
      id: `signal-${hashExactBytes(canonicalJson(exactCurrentVersionSignalBase)).slice(0, 24)}`,
      ...exactCurrentVersionSignalBase,
    }
    const exactCurrentVersionPlan = {
      ...forgedCurrentVersionPlan,
      signals: [exactCurrentVersionSignal],
      signalEvidence: [exactCurrentVersionEvidence],
    }
    expect(
      validatePlanResult({
        ...exactCurrentVersionPlan,
        planFingerprint: createPlanFingerprint(exactCurrentVersionPlan),
      }),
    ).toBe(true)
    for (const [protocol, declaredValue] of [
      ['npm', 'npm:@scope/alpha@=1.0.0'],
      ['jsr', 'jsr:@scope/alpha@=1.0.0'],
    ] as const) {
      const protocolCurrentVersionPlan = {
        ...exactCurrentVersionPlan,
        occurrences: exactCurrentVersionPlan.occurrences.map((occurrence) => ({
          ...occurrence,
          protocol,
          declaredValue,
        })),
      }
      expect(
        validatePlanResult({
          ...protocolCurrentVersionPlan,
          planFingerprint: createPlanFingerprint(protocolCurrentVersionPlan),
        }),
      ).toBe(true)
    }
    const forgedCurrentDeprecationBase = {
      ...unknownCurrentVersionBase,
      reason: 'CURRENT_DEPRECATION_UNKNOWN' as const,
    }
    const forgedCurrentDeprecation = {
      id: `signal-${hashExactBytes(canonicalJson(forgedCurrentDeprecationBase)).slice(0, 24)}`,
      ...forgedCurrentDeprecationBase,
    }
    const forgedCurrentDeprecationPlan = {
      ...unknownCurrentVersionPlan,
      signals: [forgedCurrentDeprecation],
    }
    expect(
      validatePlanResult({
        ...forgedCurrentDeprecationPlan,
        planFingerprint: createPlanFingerprint(forgedCurrentDeprecationPlan),
      }),
    ).toBe(false)
    const forgedSignalSummary = {
      ...signalPlan,
      summary: {
        ...signalPlan.summary,
        signals: { ...signalPlan.summary.signals, unknown: 0, pass: 1 },
      },
    }
    expect(
      validatePlanResult({
        ...forgedSignalSummary,
        planFingerprint: createPlanFingerprint(forgedSignalSummary),
      }),
    ).toBe(false)
    const forgedEvidenceRef = {
      ...signalPlan,
      signals: [{ ...signal, evidenceRefs: ['signal-evidence-deadbeefdeadbeefdeadbeef'] }],
    }
    expect(
      validatePlanResult({
        ...forgedEvidenceRef,
        planFingerprint: createPlanFingerprint(forgedEvidenceRef),
      }),
    ).toBe(false)

    const operationBase = {
      occurrenceId: 'occurrence-1',
      sourceFileId: 'source-1',
      file: 'package.json',
      path: ['dependencies', 'alpha'],
      name: 'alpha',
      sourceByteHash: 'b'.repeat(64),
      expectedValue: '1.0.0',
      requestedValue: '2.0.0',
    }
    const operation = {
      id: `operation-${hashExactBytes(canonicalJson(operationBase)).slice(0, 24)}`,
      ...operationBase,
    }
    const operationPlan = {
      ...semantic,
      decisions: [
        {
          ...semantic.decisions[0],
          status: 'operation',
          reason: 'SELECTED',
          operationId: operation.id,
          candidate: {
            reason: 'SELECTED',
            eligibleVersions: ['2.0.0'],
            targetVersion: '2.0.0',
          },
        },
      ],
      operations: [operation],
      requiredCapabilities: ['filesystem-read', 'registry-read', 'file-write'],
      summary: { ...semantic.summary, operations: 1, unchanged: 0 },
    }
    const validOperationPlan = {
      ...operationPlan,
      planFingerprint: createPlanFingerprint(operationPlan),
    }
    const contradictoryBase = { ...operationBase, expectedValue: '9.9.9' }
    const contradictoryOperation = {
      id: `operation-${hashExactBytes(canonicalJson(contradictoryBase)).slice(0, 24)}`,
      ...contradictoryBase,
    }
    const contradictoryPlan = {
      ...operationPlan,
      decisions: [
        {
          ...operationPlan.decisions[0],
          operationId: contradictoryOperation.id,
        },
      ],
      operations: [contradictoryOperation],
    }

    expect(validatePlanResult(validOperationPlan)).toBe(true)
    const blockingSignalBase = {
      ...signalBase,
      effect: 'block' as const,
      matchedRuleIds: ['block-unknown'],
      winningRuleId: 'block-unknown',
      override: {
        ruleId: 'block-unknown',
        source: 'library' as const,
        from: 'warn' as const,
        to: 'block' as const,
      },
    }
    const blockingSignal = {
      id: `signal-${hashExactBytes(canonicalJson(blockingSignalBase)).slice(0, 24)}`,
      ...blockingSignalBase,
    }
    const blockingButExecutable = {
      ...operationPlan,
      signals: [blockingSignal],
      signalEvidence: [signalEvidence],
      summary: {
        ...operationPlan.summary,
        signals: {
          total: 1,
          pass: 0,
          warn: 0,
          fail: 0,
          unknown: 1,
          notApplicable: 0,
          blocking: 1,
        },
      },
    }
    expect(
      validatePlanResult({
        ...blockingButExecutable,
        planFingerprint: createPlanFingerprint(blockingButExecutable),
      }),
    ).toBe(false)
    const duplicateSourcePath = {
      ...validOperationPlan,
      repository: {
        ...validOperationPlan.repository,
        sourceFiles: [
          ...validOperationPlan.repository.sourceFiles,
          { ...validOperationPlan.repository.sourceFiles[0]!, id: 'source-duplicate' },
        ],
      },
    }
    expect(
      validatePlanResult({
        ...duplicateSourcePath,
        planFingerprint: createPlanFingerprint(duplicateSourcePath),
      }),
    ).toBe(false)
    const duplicateVcs = {
      ...validOperationPlan,
      vcs: {
        status: 'confirmed' as const,
        targetFiles: [
          { path: 'package.json', state: 'unstaged' as const },
          { path: 'package.json', state: 'clean' as const },
        ],
        unrelatedDirtyPaths: [],
        diagnostics: [],
      },
    }
    expect(
      validatePlanResult({
        ...duplicateVcs,
        planFingerprint: createPlanFingerprint(duplicateVcs),
      }),
    ).toBe(false)
    expect(
      validatePlanResult({
        ...contradictoryPlan,
        planFingerprint: createPlanFingerprint(contradictoryPlan),
      }),
    ).toBe(false)
  })
})
