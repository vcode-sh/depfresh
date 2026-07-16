import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json'
import { createPlanFingerprint, createRepositoryFingerprint, hashExactBytes } from './fingerprint'
import {
  applyResultSchema,
  commandErrorSchema,
  inspectResultSchema,
  planResultSchema,
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
    ['schemas/apply-v1.json', applyResultSchema],
    ['schemas/error-v1.json', commandErrorSchema],
  ])('matches the authoritative descriptor for %s', (path, schema) => {
    expect(JSON.parse(readFileSync(resolve(root, path), 'utf8'))).toEqual(schema)
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
