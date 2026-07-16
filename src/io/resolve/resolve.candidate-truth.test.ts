import * as semver from 'semver'
import { describe, expect, it, vi } from 'vitest'
import type { Cache } from '../../cache/index'
import type { depfreshOptions, NpmrcConfig, PackageData, PackageMeta, RawDep } from '../../types'
import { createLogger } from '../../utils/logger'
import { resolveDependency } from './resolve-dependency'
import { resolvePackage } from './resolve-package'
import {
  selectVersionCandidate,
  type VersionCandidateInput,
  type VersionSelectionReason,
} from './version-filter'

vi.mock('../registry', () => ({
  fetchPackageData: vi.fn(),
}))

const fixedNow = Date.parse('2026-07-15T12:00:00.000Z')
const oldPublishTime = '2026-06-01T12:00:00.000Z'
const recentPublishTime = '2026-07-14T12:00:00.000Z'

function makeCache(pkgData: PackageData): Cache {
  return {
    get: vi.fn(() => pkgData),
    set: vi.fn(),
    has: vi.fn(() => true),
    clear: vi.fn(),
    close: vi.fn(),
    stats: vi.fn(() => ({ hits: 1, misses: 0, size: 1 })),
  }
}

function makeOptions(overrides: Partial<depfreshOptions> = {}): depfreshOptions {
  return {
    cwd: '/tmp/project',
    recursive: true,
    mode: 'default',
    write: false,
    interactive: false,
    force: false,
    includeLocked: false,
    includeWorkspace: true,
    concurrency: 8,
    timeout: 5000,
    retries: 2,
    cacheTTL: 60_000,
    refreshCache: false,
    output: 'table',
    loglevel: 'silent',
    peer: false,
    global: false,
    globalAll: false,
    ignorePaths: [],
    ignoreOtherWorkspaces: true,
    all: false,
    group: true,
    sort: 'diff-asc',
    timediff: true,
    cooldown: 0,
    nodecompat: true,
    long: false,
    explain: false,
    failOnOutdated: false,
    failOnResolutionErrors: false,
    failOnNoPackages: false,
    install: false,
    update: false,
    ...overrides,
  }
}

function makeDep(overrides: Partial<RawDep> = {}): RawDep {
  return {
    name: 'test-dep',
    currentVersion: '^1.0.0',
    source: 'dependencies',
    update: true,
    parents: [],
    ...overrides,
  }
}

const npmrc: NpmrcConfig = {
  registries: new Map(),
  defaultRegistry: 'https://registry.npmjs.org/',
  strictSsl: true,
}

const logger = createLogger('silent')

async function resolveFromCache(
  pkgData: PackageData,
  dep: RawDep,
  options: Partial<depfreshOptions> = {},
) {
  return resolveDependency(dep, makeOptions(options), makeCache(pkgData), npmrc, logger)
}

describe('authoritative resolution candidate truth', () => {
  it('uses the occurrence policy mode and finalizes no-target decisions with the exact reason', async () => {
    const selectedDecision = {
      occurrenceId: 'occurrence:test-dep',
      status: 'selected' as const,
      reason: 'POLICY_DEFAULT_INCLUDED' as const,
      action: 'include' as const,
      mode: 'latest' as const,
      matchedRuleIds: ['$defaults:mode'],
      indeterminateRuleIds: [],
      winningModeRuleId: '$defaults:mode',
    }
    const dep = makeDep({ policyDecision: selectedDecision })
    const pkg: PackageMeta = {
      name: 'root',
      type: 'package.json',
      filepath: '/tmp/project/package.json',
      deps: [dep],
      resolved: [],
      raw: {},
      indent: '  ',
    }

    const updates = await resolvePackage(
      pkg,
      makeOptions({ mode: 'default' }),
      makeCache({
        name: 'test-dep',
        versions: ['1.0.0'],
        distTags: { latest: '1.0.0' },
      }),
      npmrc,
    )

    expect(updates).toEqual([])
    expect(dep.policyDecision).toEqual({
      ...selectedDecision,
      status: 'unchanged',
      reason: 'POLICY_CANDIDATE_UNCHANGED',
      candidateReason: 'CURRENT_VERSION_SELECTED',
    })
  })

  it('uses a selected occurrence mode instead of stale global mode', async () => {
    const dep = makeDep({
      policyDecision: {
        occurrenceId: 'occurrence:test-dep',
        status: 'selected',
        reason: 'POLICY_RULE_INCLUDED',
        action: 'include',
        mode: 'latest',
        matchedRuleIds: ['latest-rule'],
        indeterminateRuleIds: [],
        winningModeRuleId: 'latest-rule',
      },
    })
    const result = await resolveFromCache(
      {
        name: 'test-dep',
        versions: ['1.0.0', '2.0.0'],
        distTags: { latest: '2.0.0' },
      },
      dep,
      { mode: 'default' },
    )

    expect(result?.targetVersion).toBe('^2.0.0')
  })

  it('exposes a pure selector whose targets are eligible and never downgrades', () => {
    const cases: VersionCandidateInput[] = [
      {
        currentVersion: '^1.0.0',
        pkgData: {
          name: 'stable',
          versions: ['2.0.0-beta.1', '1.2.0', '0.9.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
        },
        mode: 'major',
        includeLocked: false,
        cooldown: 0,
        now: fixedNow,
      },
      {
        currentVersion: '2.0.0-beta.1',
        pkgData: {
          name: 'prerelease',
          versions: ['1.9.0', '2.0.0-alpha.9', '2.0.0-beta.2', '2.0.0'],
          distTags: { latest: '2.0.0' },
        },
        mode: 'newest',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      {
        currentVersion: '3.0.0',
        pkgData: {
          name: 'downgrade',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
        },
        mode: 'latest',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
    ]

    for (const input of cases) {
      const result = selectVersionCandidate(input)
      if (!result.targetVersion) continue

      expect(result.eligibleVersions).toContain(result.targetVersion)
      const current = semver.minVersion(input.currentVersion)
      expect(current).not.toBe(null)
      expect(semver.gte(result.targetVersion, current!)).toBe(true)
      expect(result.targetVersion).toBe(semver.maxSatisfying(result.eligibleVersions, '*'))
    }
  })

  it('preserves the selection invariants across modes and adversarial metadata order', () => {
    const versions = ['2.0.0', 'garbage', '1.0.1', '1.0.0', '2.0.0-beta.2', '1.0.1', '0.9.0']
    const modes = ['default', 'major', 'minor', 'patch', 'latest', 'newest', 'next'] as const

    for (const mode of modes) {
      const result = selectVersionCandidate({
        currentVersion: '^1.0.0',
        pkgData: {
          name: 'adversarial-order',
          versions,
          distTags: { latest: '2.0.0', next: '2.0.0-beta.2' },
        },
        mode,
        includeLocked: false,
        cooldown: 0,
        now: fixedNow,
      })

      expect(result.eligibleVersions).toEqual(
        [...new Set(result.eligibleVersions)].sort(semver.compare),
      )
      expect(result.eligibleVersions.every((version) => semver.valid(version))).toBe(true)
      if (!result.targetVersion) continue
      expect(result.eligibleVersions).toContain(result.targetVersion)
      expect(semver.gte(result.targetVersion, '1.0.0')).toBe(true)
    }
  })

  it.each(['dependencies', 'catalog', 'overrides'] as const)(
    'updates an included locked %s occurrence through the same candidate set',
    async (source) => {
      const result = await resolveFromCache(
        {
          name: 'test-dep',
          versions: ['1.0.0', '1.1.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
        },
        makeDep({ currentVersion: '1.0.0', source }),
        { includeLocked: true },
      )

      expect(result?.targetVersion).toBe('2.0.0')
      expect(result?.diff).toBe('major')
    },
  )

  it.each([
    ['global:npm', { global: true }],
    ['global:npm+pnpm+bun', { globalAll: true }],
  ] as const)(
    'resolves exact observed versions for %s in default mode',
    async (filepath, flags) => {
      const pkg: PackageMeta = {
        name: 'Global packages',
        type: 'global',
        filepath,
        deps: [makeDep({ currentVersion: '1.0.0' })],
        resolved: [],
        raw: {},
        indent: '  ',
      }

      const result = await resolvePackage(
        pkg,
        makeOptions(flags),
        makeCache({
          name: 'test-dep',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
        }),
        npmrc,
      )

      expect(result).toHaveLength(1)
      expect(result[0]?.targetVersion).toBe('2.0.0')
    },
  )

  it('advances an included exact prerelease pin within its channel', async () => {
    const result = await resolveFromCache(
      {
        name: 'test-dep',
        versions: ['1.0.0-next.1', '1.0.0-next.2'],
        distTags: { latest: '1.0.0-next.2', next: '1.0.0-next.2' },
      },
      makeDep({ currentVersion: '1.0.0-next.1' }),
      { includeLocked: true },
    )

    expect(result?.targetVersion).toBe('1.0.0-next.2')
    expect(result?.diff).toBe('patch')
  })

  it('retains an equals-prefixed pin when includeLocked is disabled', () => {
    expect(
      selectVersionCandidate({
        currentVersion: '=1.2.3',
        pkgData: {
          name: 'test-dep',
          versions: ['1.2.3', '2.0.0'],
          distTags: { latest: '2.0.0' },
        },
        mode: 'default',
        includeLocked: false,
        cooldown: 0,
        now: fixedNow,
      }),
    ).toEqual({
      targetVersion: null,
      eligibleVersions: ['1.2.3'],
      reason: 'CURRENT_VERSION_SELECTED',
    })
  })

  it('does not fall back from a present next tag rejected by channel safety', () => {
    const result = selectVersionCandidate({
      currentVersion: '1.0.0',
      pkgData: {
        name: 'test-dep',
        versions: ['1.0.0', '1.1.0', '2.0.0-next.1'],
        distTags: { latest: '1.1.0', next: '2.0.0-next.1' },
      },
      mode: 'next',
      includeLocked: false,
      cooldown: 0,
      now: fixedNow,
    })

    expect(result).toEqual({
      targetVersion: null,
      eligibleVersions: [],
      reason: 'PRERELEASE_CHANNEL_BLOCKED',
    })
  })

  it.each([
    ['1.0.0-0', '2.0.0-beta.1'],
    ['1.0.0-beta.1', '2.0.0-0'],
  ])('does not cross prerelease channels from %s to %s', (currentVersion, candidate) => {
    expect(
      selectVersionCandidate({
        currentVersion,
        pkgData: {
          name: 'test-dep',
          versions: [currentVersion, candidate],
          distTags: { latest: candidate },
        },
        mode: 'major',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      }),
    ).toEqual({
      targetVersion: null,
      eligibleVersions: [currentVersion],
      reason: 'PRERELEASE_CHANNEL_BLOCKED',
    })
  })

  it.each([1, '1'])('treats coercive publish timestamp %j as unknown', (publishedAt) => {
    const time = {
      '1.0.0': oldPublishTime,
      '2.0.0': publishedAt,
    } as unknown as Record<string, string>

    expect(
      selectVersionCandidate({
        currentVersion: '1.0.0',
        pkgData: {
          name: 'test-dep',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
          time,
        },
        mode: 'major',
        includeLocked: true,
        cooldown: 7,
        now: fixedNow,
      }),
    ).toEqual({
      targetVersion: null,
      eligibleVersions: ['1.0.0'],
      reason: 'MISSING_PUBLISH_TIME',
    })
  })

  it('uses the normalized current version to allow escape from deprecation', async () => {
    const result = await resolveFromCache(
      {
        name: 'test-dep',
        versions: ['1.0.0', '1.1.0', '2.0.0'],
        distTags: { latest: '2.0.0' },
        deprecated: {
          '1.0.0': 'Unsupported',
          '2.0.0': 'Unsupported major',
        },
      },
      makeDep({ currentVersion: '^1.0.0' }),
      { mode: 'major' },
    )

    expect(result?.targetVersion).toBe('^2.0.0')
  })

  it('does not reintroduce a deprecated latest tag after safety filtering', async () => {
    const result = await resolveFromCache(
      {
        name: 'test-dep',
        versions: ['1.0.0', '2.0.0'],
        distTags: { latest: '2.0.0' },
        deprecated: { '2.0.0': 'Do not install' },
      },
      makeDep({ currentVersion: '^1.0.0' }),
      { mode: 'latest' },
    )

    expect(result).toBe(null)
  })

  it('does not reintroduce recent or unknown-age versions after cooldown filtering', () => {
    const result = selectVersionCandidate({
      currentVersion: '^1.0.0',
      pkgData: {
        name: 'test-dep',
        versions: ['1.0.0', '1.1.0', '2.0.0'],
        distTags: { latest: '2.0.0' },
        time: {
          '1.0.0': oldPublishTime,
          '1.1.0': recentPublishTime,
        },
      },
      mode: 'major',
      includeLocked: false,
      cooldown: 7,
      now: fixedNow,
    })

    expect(result).toEqual({
      targetVersion: null,
      eligibleVersions: ['1.0.0'],
      reason: 'MISSING_PUBLISH_TIME',
    })
  })

  it.each<{
    name: string
    input: VersionCandidateInput
    reason: VersionSelectionReason
  }>([
    {
      name: 'prerelease channel',
      input: {
        currentVersion: '1.0.0',
        pkgData: {
          name: 'channel-block',
          versions: ['1.0.0', '2.0.0-beta.1'],
          distTags: {},
        },
        mode: 'major',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'PRERELEASE_CHANNEL_BLOCKED',
    },
    {
      name: 'deprecation',
      input: {
        currentVersion: '1.0.0',
        pkgData: {
          name: 'deprecated-block',
          versions: ['1.0.0', '2.0.0'],
          distTags: {},
          deprecated: { '2.0.0': 'Unsupported' },
        },
        mode: 'major',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'DEPRECATED_CANDIDATE_BLOCKED',
    },
    {
      name: 'maturity',
      input: {
        currentVersion: '1.0.0',
        pkgData: {
          name: 'maturity-block',
          versions: ['1.0.0', '2.0.0'],
          distTags: {},
          time: { '1.0.0': oldPublishTime, '2.0.0': recentPublishTime },
        },
        mode: 'major',
        includeLocked: true,
        cooldown: 7,
        now: fixedNow,
      },
      reason: 'MATURITY_CANDIDATE_BLOCKED',
    },
  ])('retains the $name reason when the current version remains eligible', ({ input, reason }) => {
    expect(selectVersionCandidate(input)).toMatchObject({
      targetVersion: null,
      eligibleVersions: ['1.0.0'],
      reason,
    })
  })

  it('returns deterministic reasons for rejected candidate classes', () => {
    const base: Omit<VersionCandidateInput, 'pkgData'> = {
      currentVersion: '1.0.0',
      mode: 'latest',
      includeLocked: true,
      cooldown: 0,
      now: fixedNow,
    }

    expect(
      selectVersionCandidate({
        ...base,
        pkgData: {
          name: 'deprecated',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
          deprecated: { '2.0.0': 'Unsafe' },
        },
      }).reason,
    ).toBe('DEPRECATED_CANDIDATE_BLOCKED')

    expect(
      selectVersionCandidate({
        ...base,
        currentVersion: '2.0.0',
        pkgData: {
          name: 'downgrade',
          versions: ['1.0.0'],
          distTags: { latest: '1.0.0' },
        },
      }).reason,
    ).toBe('DOWNGRADE_BLOCKED')

    expect(
      selectVersionCandidate({
        ...base,
        pkgData: {
          name: 'missing-time',
          versions: ['1.0.0', '2.0.0'],
          distTags: { latest: '2.0.0' },
          time: { '1.0.0': oldPublishTime },
        },
        cooldown: 7,
      }).reason,
    ).toBe('MISSING_PUBLISH_TIME')
  })

  it.each<{
    name: string
    input: VersionCandidateInput
    reason: VersionSelectionReason
  }>([
    {
      name: 'invalid current version',
      input: {
        currentVersion: 'not-semver',
        pkgData: { name: 'invalid-current', versions: ['1.0.0'], distTags: {} },
        mode: 'major',
        includeLocked: false,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'CURRENT_VERSION_INVALID',
    },
    {
      name: 'invalid registry versions',
      input: {
        currentVersion: '1.0.0',
        pkgData: { name: 'invalid-registry', versions: ['latest', 'nope'], distTags: {} },
        mode: 'major',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'NO_VALID_VERSIONS',
    },
    {
      name: 'cross-channel prereleases',
      input: {
        currentVersion: '1.0.0-beta.1',
        pkgData: {
          name: 'cross-channel',
          versions: ['1.0.0-alpha.2', '1.0.0-rc.1'],
          distTags: {},
        },
        mode: 'newest',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'PRERELEASE_CHANNEL_BLOCKED',
    },
    {
      name: 'JSR metadata without latest',
      input: {
        currentVersion: '1.0.0',
        pkgData: { name: 'jsr:@scope/pkg', versions: ['1.0.0', '2.0.0'], distTags: {} },
        mode: 'latest',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'DIST_TAG_MISSING',
    },
    {
      name: 'tag absent from registry versions',
      input: {
        currentVersion: '1.0.0',
        pkgData: {
          name: 'inconsistent-tag',
          versions: ['1.0.0'],
          distTags: { latest: '2.0.0' },
        },
        mode: 'latest',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'DIST_TAG_NOT_ELIGIBLE',
    },
    {
      name: 'mode without matching candidates',
      input: {
        currentVersion: '2.1.0',
        pkgData: { name: 'patch-gap', versions: ['3.0.0'], distTags: {} },
        mode: 'patch',
        includeLocked: true,
        cooldown: 0,
        now: fixedNow,
      },
      reason: 'MODE_NO_MATCH',
    },
    {
      name: 'all candidates too recent',
      input: {
        currentVersion: '1.0.0',
        pkgData: {
          name: 'recent',
          versions: ['2.0.0'],
          distTags: { latest: '2.0.0' },
          time: { '2.0.0': recentPublishTime },
        },
        mode: 'latest',
        includeLocked: true,
        cooldown: 7,
        now: fixedNow,
      },
      reason: 'MATURITY_CANDIDATE_BLOCKED',
    },
  ])('reports $reason for $name', ({ input, reason }) => {
    expect(selectVersionCandidate(input)).toMatchObject({
      targetVersion: null,
      reason,
    })
  })
})
