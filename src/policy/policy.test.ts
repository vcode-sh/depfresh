import { describe, expect, it } from 'vitest'
import { ConfigError } from '../errors'
import type { PolicyCandidateReason, PolicyOccurrenceContext, PolicyRuleInput } from '../types'
import { compilePolicy, evaluatePolicy, finalizePolicyDecision } from './index'

const baseContext: PolicyOccurrenceContext = {
  occurrenceId: 'occurrence:react',
  dependencyName: 'react',
  workspacePath: 'apps/web',
  packageName: '@example/web',
  catalogRole: 'direct',
  field: 'dependencies',
  role: 'dependency',
  protocol: 'semver',
  currentVersion: '18.3.1',
  currentChannel: 'stable',
  specifierStatus: 'locked',
  manager: 'pnpm',
  managerEvidenceStatus: 'confirmed',
}

describe('policy schema and compiler', () => {
  it('rejects unknown, authority-shaped, non-JSON, duplicate, and invalid rule input', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const accessor = Object.defineProperty({}, 'id', {
      enumerable: true,
      get: () => 'secret-from-getter',
    })
    const hiddenAuthority = Object.defineProperty(
      { id: 'hidden-authority', selectors: {}, action: 'include' },
      'write',
      { value: true, enumerable: false },
    )
    const symbolAuthority = {
      id: 'symbol-authority',
      selectors: {},
      action: 'include',
      [Symbol('write')]: true,
    }
    const invalidRules: unknown[] = [
      { id: 'unknown', selectors: {}, action: 'include', surprise: true },
      { id: 'authority', selectors: {}, action: 'include', write: true },
      { id: 'nested-authority', selectors: { execute: 'rm -rf .' }, action: 'include' },
      { id: 'non-json', selectors: {}, action: 'include', value: () => true },
      { id: 'empty', selectors: {} },
      { id: 'conflict', selectors: {}, action: 'exclude', mode: 'minor' },
      { id: 'bad-pattern', selectors: { dependencyName: '/[/' }, action: 'include' },
      { id: 'date', selectors: {}, action: 'include', metadata: new Date() },
      { id: 'cycle', selectors: {}, action: 'include', metadata: cyclic },
      accessor,
      hiddenAuthority,
      symbolAuthority,
    ]

    for (const policyRule of invalidRules) {
      expect(() =>
        compilePolicy([{ source: 'library', policyRules: [policyRule] as PolicyRuleInput[] }]),
      ).toThrow(ConfigError)
    }

    expect(() =>
      compilePolicy([
        {
          source: 'library',
          policyRules: [
            { id: 'duplicate', selectors: {}, action: 'include' },
            { id: 'duplicate', selectors: {}, mode: 'minor' },
          ],
        },
      ]),
    ).toThrow(/duplicate/u)
  })

  it('preserves legacy invalid packageMode pattern skipping while retaining literal exact lookup', () => {
    const policy = compilePolicy([
      { source: 'defaults', mode: 'default' },
      { source: 'library', packageMode: { '/[/': 'minor' } },
    ])

    expect(evaluatePolicy(policy, { ...baseContext, dependencyName: 'react' })).toMatchObject({
      mode: 'default',
    })
    expect(evaluatePolicy(policy, { ...baseContext, dependencyName: '/[/' })).toMatchObject({
      mode: 'minor',
    })
  })

  it('rejects invalid legacy packageMode values before they become decision modes', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const accessor = Object.defineProperty({}, 'react', {
      enumerable: true,
      get: () => {
        throw new Error('must not execute')
      },
    })

    expect(() =>
      compilePolicy([
        {
          source: 'library',
          packageMode: { react: 'unsupported-mode' } as never,
        },
      ]),
    ).toThrow(ConfigError)
    expect(() => compilePolicy([{ source: 'library', mode: 'unsupported-mode' as never }])).toThrow(
      ConfigError,
    )
    expect(() => compilePolicy([{ source: 'library', include: ['react', 42] as never }])).toThrow(
      ConfigError,
    )
    expect(() => compilePolicy([{ source: 'library', packageMode: new Date() as never }])).toThrow(
      ConfigError,
    )
    expect(() =>
      compilePolicy([{ source: 'library', packageMode: revoked.proxy as never }]),
    ).toThrow(ConfigError)
    expect(() => compilePolicy([{ source: 'library', packageMode: accessor as never }])).toThrow(
      ConfigError,
    )
  })

  it('rejects invalid legacy include and exclude patterns during compilation', () => {
    expect(() => compilePolicy([{ source: 'library', include: ['/[/'] }])).toThrow(ConfigError)
    expect(() => compilePolicy([{ source: 'library', exclude: ['/[/'] }])).toThrow(ConfigError)
  })

  it('rejects hostile compatibility arrays without invoking accessors or leaking errors', () => {
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    const accessor: string[] = []
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get: () => {
        throw new Error('secret getter value')
      },
    })

    for (const value of [revoked.proxy, accessor]) {
      for (const field of ['include', 'exclude'] as const) {
        let caught: unknown
        try {
          compilePolicy([{ source: 'library', [field]: value as string[] }])
        } catch (error) {
          caught = error
        }
        expect(caught).toBeInstanceOf(ConfigError)
        expect((caught as Error).message).not.toContain('secret getter value')
        expect((caught as Error & { cause?: unknown }).cause).toBeUndefined()
      }
    }
  })

  it('rejects hostile layer containers without invoking accessors or leaking errors', () => {
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    const layer = Object.defineProperty({}, 'source', {
      enumerable: true,
      get: () => {
        throw new Error('secret layer getter')
      },
    })

    for (const value of [revoked.proxy, [layer]]) {
      let caught: unknown
      try {
        compilePolicy(value as never)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ConfigError)
      expect((caught as Error).message).not.toContain('secret layer getter')
      expect((caught as Error & { cause?: unknown }).cause).toBeUndefined()
    }
  })

  it('lets a concrete packageMode override legacy ignore while preserving later filters', () => {
    const globalIgnore = compilePolicy([
      { source: 'library', mode: 'ignore', packageMode: { react: 'latest' } },
    ])
    const patternIgnore = compilePolicy([
      {
        source: 'library',
        mode: 'latest',
        packageMode: { 'react*': 'ignore', react: 'minor' },
      },
    ])
    const filtered = compilePolicy([
      {
        source: 'library',
        packageMode: { react: 'latest' },
        exclude: ['react'],
      },
    ])

    expect(evaluatePolicy(globalIgnore, baseContext)).toMatchObject({
      status: 'selected',
      action: 'include',
      mode: 'latest',
    })
    expect(evaluatePolicy(patternIgnore, baseContext)).toMatchObject({
      status: 'selected',
      action: 'include',
      mode: 'minor',
    })
    expect(evaluatePolicy(filtered, baseContext)).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      mode: 'latest',
    })
  })

  it('does not let compatibility include allow-lists override legacy ignore sentinels', () => {
    const globalIgnore = compilePolicy([{ source: 'library', mode: 'ignore', include: ['react'] }])
    const packageIgnore = compilePolicy([
      {
        source: 'library',
        packageMode: { react: 'ignore' },
        include: ['react'],
      },
    ])
    const explicitInclude = compilePolicy([
      {
        source: 'library',
        mode: 'ignore',
        policyRules: [
          { id: 'react-include', selectors: { dependencyName: 'react' }, action: 'include' },
        ],
      },
    ])

    expect(evaluatePolicy(globalIgnore, baseContext)).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      winningActionRuleId: '$library:mode:ignore',
    })
    expect(evaluatePolicy(packageIgnore, baseContext)).toMatchObject({
      status: 'skipped',
      action: 'exclude',
    })
    expect(evaluatePolicy(explicitInclude, baseContext)).toMatchObject({
      status: 'selected',
      action: 'include',
      winningActionRuleId: 'react-include',
    })
  })

  it('preserves merged cross-layer exact priority and inherited filters', () => {
    const crossLayer = compilePolicy([
      { source: 'config', packageMode: { react: 'minor' }, include: ['react'] },
      { source: 'library', packageMode: { 'react*': 'patch', vue: 'minor' } },
    ])

    expect(evaluatePolicy(crossLayer, baseContext)).toMatchObject({
      status: 'selected',
      mode: 'minor',
    })
    expect(evaluatePolicy(crossLayer, { ...baseContext, dependencyName: 'vue' })).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      mode: 'minor',
    })
  })

  it('canonicalizes public input layers to defaults, config, library, and CLI order', () => {
    const policy = compilePolicy([
      {
        source: 'cli',
        mode: 'patch',
        policyRules: [{ id: 'cli-include', selectors: {}, action: 'include' }],
      },
      {
        source: 'config',
        mode: 'latest',
        policyRules: [{ id: 'config-exclude', selectors: {}, action: 'exclude' }],
      },
      { source: 'defaults', mode: 'major' },
    ])
    const decision = evaluatePolicy(policy, baseContext)

    expect(policy.rules.map((rule) => rule.id)).toEqual([
      '$defaults:mode',
      '$config:mode',
      'config-exclude',
      '$cli:mode',
      'cli-include',
    ])
    expect(decision).toMatchObject({
      status: 'selected',
      mode: 'patch',
      winningActionRuleId: 'cli-include',
      winningModeRuleId: '$cli:mode',
    })
  })

  it('does not replay compatibility state across independent source-layer dimensions', () => {
    const actionOnlyOverride = compilePolicy([
      {
        source: 'config',
        mode: 'latest',
        policyRules: [{ id: 'config-minor', selectors: {}, mode: 'minor' }],
      },
      { source: 'library', include: ['react'] },
    ])
    const modeOnlyOverride = compilePolicy([
      {
        source: 'config',
        include: ['vue'],
        policyRules: [
          { id: 'config-react-include', selectors: { dependencyName: 'react' }, action: 'include' },
        ],
      },
      { source: 'library', mode: 'patch' },
    ])

    expect(evaluatePolicy(actionOnlyOverride, baseContext)).toMatchObject({
      status: 'selected',
      mode: 'minor',
      winningModeRuleId: 'config-minor',
    })
    expect(evaluatePolicy(actionOnlyOverride, baseContext).matchedRuleIds).toEqual(
      expect.arrayContaining(['$defaults:mode', '$config:mode', 'config-minor']),
    )
    expect(evaluatePolicy(modeOnlyOverride, baseContext)).toMatchObject({
      status: 'selected',
      mode: 'patch',
      winningActionRuleId: 'config-react-include',
    })
  })

  it('keeps ordinary mode changes action-neutral while clearing legacy global ignore', () => {
    const ordinaryMode = compilePolicy([
      {
        source: 'config',
        policyRules: [
          { id: 'config-react-exclude', selectors: { dependencyName: 'react' }, action: 'exclude' },
        ],
      },
      { source: 'library', mode: 'patch' },
    ])
    const ignoreCleared = compilePolicy([
      { source: 'config', mode: 'ignore' },
      { source: 'library', mode: 'patch' },
    ])

    expect(evaluatePolicy(ordinaryMode, baseContext)).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      mode: 'patch',
      winningActionRuleId: 'config-react-exclude',
    })
    expect(evaluatePolicy(ignoreCleared, baseContext)).toMatchObject({
      status: 'selected',
      action: 'include',
      mode: 'patch',
      winningActionRuleId: '$library:mode',
    })
  })

  it('clears only compatible ignore exclusions without bypassing explicit action rules', () => {
    const packageIgnoreSurvivesMode = compilePolicy([
      { source: 'config', packageMode: { react: 'ignore' } },
      { source: 'library', mode: 'patch' },
    ])
    const explicitExcludeSurvivesPackageMode = compilePolicy([
      {
        source: 'config',
        policyRules: [
          { id: 'config-react-exclude', selectors: { dependencyName: 'react' }, action: 'exclude' },
        ],
      },
      { source: 'library', packageMode: { react: 'patch' } },
    ])

    expect(evaluatePolicy(packageIgnoreSurvivesMode, baseContext)).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      mode: 'patch',
    })
    expect(evaluatePolicy(explicitExcludeSurvivesPackageMode, baseContext)).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      winningActionRuleId: 'config-react-exclude',
    })
  })

  it('preserves legacy filters and first-pattern package modes in one ordered rule list', () => {
    const policy = compilePolicy([
      { source: 'defaults', mode: 'default' },
      {
        source: 'config',
        mode: 'latest',
        packageMode: {
          'eslint-*': 'patch',
          'eslint-plugin-*': 'minor',
          react: 'major',
        },
        include: ['react', 'eslint-*'],
        exclude: ['eslint-config-*'],
      },
    ])

    expect(
      evaluatePolicy(policy, { ...baseContext, dependencyName: 'eslint-plugin-react' }),
    ).toMatchObject({ status: 'selected', action: 'include', mode: 'patch' })
    expect(evaluatePolicy(policy, { ...baseContext, dependencyName: 'react' })).toMatchObject({
      status: 'selected',
      action: 'include',
      mode: 'major',
    })
    expect(
      evaluatePolicy(policy, { ...baseContext, dependencyName: 'eslint-config-standard' }),
    ).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      reason: 'POLICY_RULE_EXCLUDED',
    })
    expect(evaluatePolicy(policy, { ...baseContext, dependencyName: 'vue' })).toMatchObject({
      status: 'skipped',
      action: 'exclude',
      reason: 'POLICY_RULE_EXCLUDED',
    })
  })

  it('reports the last matching compatibility include rule as the action winner', () => {
    const decision = evaluatePolicy(
      compilePolicy([{ source: 'library', include: ['rea*', 'react'] }]),
      baseContext,
    )

    expect(decision).toMatchObject({
      status: 'selected',
      winningActionRuleId: '$library:include:1',
    })
    expect(decision.matchedRuleIds).toEqual(
      expect.arrayContaining(['$library:include:0', '$library:include:1']),
    )
  })

  it('evaluates action and mode last-match-wins independently with complete traces', () => {
    const policy = compilePolicy([
      { source: 'defaults', mode: 'default' },
      {
        source: 'library',
        include: ['@example/*'],
        policyRules: [
          {
            id: 'workspace-latest',
            selectors: { workspacePath: 'apps/*' },
            mode: 'latest',
          },
          {
            id: 'native-minor',
            selectors: { catalogName: 'native' },
            mode: 'minor',
          },
          {
            id: 'production-exclude',
            selectors: { field: 'dependencies' },
            action: 'exclude',
          },
          {
            id: 'react-include',
            selectors: { dependencyName: '^react$' },
            action: 'include',
          },
        ],
      },
    ])
    const decision = evaluatePolicy(policy, {
      ...baseContext,
      catalogName: 'native',
      catalogRole: 'owner',
    })

    expect(decision).toMatchObject({
      status: 'selected',
      reason: 'POLICY_RULE_INCLUDED',
      action: 'include',
      mode: 'minor',
      winningActionRuleId: 'react-include',
      winningModeRuleId: 'native-minor',
    })
    expect(decision.matchedRuleIds).toEqual(
      expect.arrayContaining([
        'workspace-latest',
        'native-minor',
        'production-exclude',
        'react-include',
      ]),
    )
  })
})

describe('policy matcher ambiguity and catalog boundaries', () => {
  it('retains every authoritative candidate reason when selected work becomes unchanged', () => {
    const reasons: PolicyCandidateReason[] = [
      'CURRENT_VERSION_SELECTED',
      'CURRENT_VERSION_INVALID',
      'NO_VALID_VERSIONS',
      'PRERELEASE_CHANNEL_BLOCKED',
      'DIST_TAG_MISSING',
      'DIST_TAG_NOT_ELIGIBLE',
      'MODE_NO_MATCH',
      'DEPRECATED_CANDIDATE_BLOCKED',
      'MISSING_PUBLISH_TIME',
      'MATURITY_CANDIDATE_BLOCKED',
      'DOWNGRADE_BLOCKED',
    ]
    const selected = evaluatePolicy(
      compilePolicy([
        {
          source: 'library',
          policyRules: [{ id: 'react-minor', selectors: {}, mode: 'minor' }],
        },
      ]),
      baseContext,
    )

    for (const reason of reasons) {
      expect(finalizePolicyDecision(selected, reason)).toMatchObject({
        status: 'unchanged',
        reason: 'POLICY_CANDIDATE_UNCHANGED',
        candidateReason: reason,
        matchedRuleIds: selected.matchedRuleIds,
        winningModeRuleId: 'react-minor',
      })
    }
  })

  it('blocks an otherwise matching manager-specific rule when manager evidence is unknown', () => {
    const policy = compilePolicy([
      { source: 'defaults', mode: 'latest' },
      {
        source: 'library',
        policyRules: [{ id: 'pnpm-minor', selectors: { manager: 'pnpm' }, mode: 'minor' }],
      },
    ])

    expect(
      evaluatePolicy(policy, {
        ...baseContext,
        manager: undefined,
        managerEvidenceStatus: 'ambiguous',
      }),
    ).toMatchObject({
      status: 'blocked',
      reason: 'POLICY_MANAGER_UNKNOWN',
      matchedRuleIds: ['$defaults:mode'],
      indeterminateRuleIds: ['pnpm-minor'],
    })
    expect(
      evaluatePolicy(compilePolicy([{ source: 'defaults', mode: 'latest' }]), {
        ...baseContext,
        manager: undefined,
        managerEvidenceStatus: 'missing',
      }),
    ).toMatchObject({ status: 'selected', mode: 'latest' })
  })

  it('lets a later definite rule clear only the same indeterminate dimension', () => {
    const context = {
      ...baseContext,
      manager: undefined,
      managerEvidenceStatus: 'unavailable' as const,
    }
    const cleared = evaluatePolicy(
      compilePolicy([
        { source: 'defaults', mode: 'default' },
        {
          source: 'library',
          policyRules: [
            { id: 'unknown-mode', selectors: { manager: 'pnpm' }, mode: 'minor' },
            { id: 'known-mode', selectors: {}, mode: 'patch' },
          ],
        },
      ]),
      context,
    )
    const stillBlocked = evaluatePolicy(
      compilePolicy([
        { source: 'defaults', mode: 'default' },
        {
          source: 'library',
          policyRules: [
            { id: 'unknown-mode', selectors: { manager: 'pnpm' }, mode: 'minor' },
            { id: 'known-action', selectors: {}, action: 'include' },
          ],
        },
      ]),
      context,
    )

    expect(cleared).toMatchObject({
      status: 'selected',
      mode: 'patch',
      indeterminateRuleIds: [],
      winningModeRuleId: 'known-mode',
    })
    expect(stillBlocked).toMatchObject({
      status: 'blocked',
      indeterminateRuleIds: ['unknown-mode'],
      winningActionRuleId: 'known-action',
    })
  })

  it('uses the real determinant index for later compatibility inclusion', () => {
    const context = {
      ...baseContext,
      manager: undefined,
      managerEvidenceStatus: 'missing' as const,
    }
    const included = evaluatePolicy(
      compilePolicy([
        {
          source: 'config',
          policyRules: [
            {
              id: 'unknown-action',
              selectors: { manager: 'pnpm' },
              action: 'exclude',
            },
          ],
        },
        { source: 'library', include: ['react'] },
      ]),
      context,
    )
    const ignoreCleared = evaluatePolicy(
      compilePolicy([
        {
          source: 'config',
          mode: 'ignore',
          policyRules: [
            {
              id: 'unknown-action',
              selectors: { manager: 'pnpm' },
              action: 'exclude',
            },
          ],
        },
        { source: 'library', packageMode: { react: 'patch' } },
      ]),
      context,
    )
    const resetDecisions = [
      compilePolicy([
        {
          source: 'config',
          policyRules: [
            { id: 'unknown-action', selectors: { manager: 'pnpm' }, action: 'exclude' },
          ],
        },
        { source: 'library', include: [] },
      ]),
      compilePolicy([
        {
          source: 'config',
          policyRules: [
            { id: 'unknown-action', selectors: { manager: 'pnpm' }, action: 'exclude' },
          ],
        },
        { source: 'library', exclude: [] },
      ]),
    ].map((policy) => evaluatePolicy(policy, context))

    expect(included).toMatchObject({
      status: 'selected',
      winningActionRuleId: '$library:include:0',
      indeterminateRuleIds: [],
    })
    expect(ignoreCleared).toMatchObject({
      status: 'selected',
      mode: 'patch',
      indeterminateRuleIds: [],
    })
    expect(resetDecisions).toEqual([
      expect.objectContaining({ status: 'selected', indeterminateRuleIds: [] }),
      expect.objectContaining({ status: 'selected', indeterminateRuleIds: [] }),
    ])
  })

  it('retains the unresolved half of a combined manager-specific rule', () => {
    const decision = evaluatePolicy(
      compilePolicy([
        {
          source: 'library',
          policyRules: [
            { id: 'base-exclude', selectors: {}, action: 'exclude' },
            {
              id: 'unknown-both',
              selectors: { manager: 'pnpm' },
              action: 'include',
              mode: 'minor',
            },
            { id: 'known-mode', selectors: {}, mode: 'patch' },
          ],
        },
      ]),
      {
        ...baseContext,
        manager: undefined,
        managerEvidenceStatus: 'ambiguous',
      },
    )

    expect(decision).toMatchObject({
      status: 'blocked',
      action: 'exclude',
      mode: 'patch',
      indeterminateRuleIds: ['unknown-both'],
      winningModeRuleId: 'known-mode',
    })
  })

  it('applies catalog rules to owners and consumers without leaking to direct declarations', () => {
    const policy = compilePolicy([
      { source: 'defaults', mode: 'latest' },
      {
        source: 'config',
        policyRules: [
          {
            id: 'native-minor',
            selectors: { catalogName: 'native' },
            mode: 'minor',
          },
        ],
      },
    ])

    expect(
      evaluatePolicy(policy, {
        ...baseContext,
        catalogName: 'native',
        catalogRole: 'owner',
      }),
    ).toMatchObject({ mode: 'minor', winningModeRuleId: 'native-minor' })
    expect(
      evaluatePolicy(policy, {
        ...baseContext,
        catalogName: 'native',
        catalogRole: 'consumer',
      }),
    ).toMatchObject({ mode: 'minor', winningModeRuleId: 'native-minor' })
    expect(evaluatePolicy(policy, baseContext)).toMatchObject({
      mode: 'latest',
      winningModeRuleId: '$defaults:mode',
    })
  })
})
