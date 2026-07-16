import * as semver from 'semver'
import { canonicalJson } from '../contracts/canonical-json'
import { hashExactBytes } from '../contracts/fingerprint'
import { isContractSafeText } from '../contracts/sanitize'
import { ConfigError } from '../errors'
import type { ResolutionTrace } from '../io/resolve/context'
import type {
  CohortInput,
  PackageData,
  PassivePresence,
  PlanSignal,
  RepositoryRuntimeDeclaration,
  SignalEvidence,
  SignalPolicySource,
  SignalReason,
  SignalRuleInput,
  SignalState,
  SignalSummary,
} from '../types'
import { exactDeclaredVersion } from '../utils/exact-version'
import { isValidPackageName } from '../utils/package-name'
import { validateSignalConfiguration } from './config'
import { applySignalPolicy } from './policy'

interface SignalOccurrence {
  id: string
  ownerId: string
  name: string
  field: string
  role: string
  protocol: string
  declaredValue: string
  catalogId?: string
}

interface SignalOperation {
  occurrenceId: string
  requestedValue: string
}

interface SignalPackage {
  id: string
  workspacePath: string
}

interface SignalRepository {
  packages: SignalPackage[]
  runtimeDeclarations: RepositoryRuntimeDeclaration[]
  relationships: { boundaryPackages: Array<{ boundaryId: string; packageId: string }> }
}

interface RuntimeEvidenceConclusion {
  id: string
  kind: 'runtime'
  boundaryId?: string
  status: 'confirmed' | 'ambiguous' | 'missing' | 'unsupported' | 'unavailable'
}

interface ResolutionMetadata {
  packageName: string
  currentVersion: string
  data: PackageData
}

export interface EvaluatePlanSignalsInput {
  repository: SignalRepository
  occurrences: SignalOccurrence[]
  operations: SignalOperation[]
  candidateOccurrenceIds?: readonly string[]
  traces: ReadonlyMap<string, ResolutionTrace>
  metadata: ReadonlyMap<string, ResolutionMetadata>
  cohorts: readonly CohortInput[]
  rules: readonly SignalRuleInput[]
  policySource: SignalPolicySource
  cohortSource?: SignalPolicySource
  runtimeEvidence?: readonly RuntimeEvidenceConclusion[]
  asOf: string
  cooldownDays: number
}

export interface EvaluatePlanSignalsResult {
  signals: PlanSignal[]
  evidence: SignalEvidence[]
  summary: SignalSummary
  blockedOccurrenceIds: string[]
}

interface Collector {
  evidence: Map<string, SignalEvidence>
  signals: PlanSignal[]
}

interface SignalBase {
  family: PlanSignal['family']
  state: SignalState
  reason: SignalReason
  subject: PlanSignal['subject']
  evidenceRefs: string[]
}

export function evaluatePlanSignals(input: EvaluatePlanSignalsInput): EvaluatePlanSignalsResult {
  validateEvaluationInput(input)
  const collector: Collector = { evidence: new Map(), signals: [] }
  const operations = new Map(
    input.operations.map((operation) => [operation.occurrenceId, operation]),
  )
  const packages = new Map(input.repository.packages.map((pkg) => [pkg.id, pkg]))
  const boundaryByPackage = new Map(
    input.repository.relationships.boundaryPackages.map((item) => [
      item.packageId,
      item.boundaryId,
    ]),
  )

  for (const occurrence of input.occurrences) {
    if (!isRegistryOccurrence(occurrence)) continue
    const metadata = input.metadata.get(occurrence.id)
    const trace = input.traces.get(occurrence.id)
    const targetVersion = finalRegistryVersion(occurrence, trace)
    const workspacePath = packages.get(occurrence.ownerId)?.workspacePath
    const subject = {
      occurrenceIds: [occurrence.id],
      dependencyName: occurrence.name,
      ...(workspacePath ? { workspacePath } : {}),
    }
    addCompletenessSignals(collector, input, occurrence, metadata, subject)
    addReleaseSignals(collector, input, occurrence, metadata, targetVersion, subject)
    addPassiveSignals(collector, input, occurrence, metadata, targetVersion, subject)
    addRuntimeSignal(
      collector,
      input,
      occurrence,
      metadata,
      targetVersion,
      subject,
      boundaryByPackage.get(occurrence.ownerId),
    )
    addPeerSignals(collector, input, occurrence, metadata, targetVersion, subject, operations)
  }

  addExplicitCohortSignals(collector, input)
  addInferredCohortSignals(collector, input)
  const signals = collector.signals.sort(compareSignals)
  const evidence = [...collector.evidence.values()].sort((left, right) =>
    compareText(left.id, right.id),
  )
  const summary = summarizeSignals(signals)
  const blockedOccurrenceIds = [
    ...new Set(
      signals
        .filter((signal) => signal.effect === 'block')
        .flatMap((signal) => signal.subject.occurrenceIds),
    ),
  ].sort(compareText)
  return { signals, evidence, summary, blockedOccurrenceIds }
}

function addCompletenessSignals(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  occurrence: SignalOccurrence,
  metadata: ResolutionMetadata | undefined,
  subject: PlanSignal['subject'],
): void {
  const complete = Boolean(metadata && metadata.data.versions.length > 0)
  const evidenceRef = addEvidence(collector, {
    kind: 'registry-version',
    status: complete ? 'observed' : 'unknown',
    subject: occurrence.id,
    sourceRefs: [occurrence.id],
    facts: { metadata: complete ? 'available' : 'unavailable' },
  })
  addSignal(collector, input, {
    family: 'evidence-completeness',
    state: complete ? 'pass' : 'unknown',
    reason: complete ? 'REGISTRY_EVIDENCE_COMPLETE' : 'REGISTRY_EVIDENCE_UNKNOWN',
    subject,
    evidenceRefs: [evidenceRef],
  })
  const clockRef = addEvidence(collector, {
    kind: 'clock',
    status: 'absent',
    subject: occurrence.id,
    sourceRefs: [],
    facts: { observation: 'not-recorded' },
  })
  addSignal(collector, input, {
    family: 'evidence-staleness',
    state: 'not-applicable',
    reason: 'STALENESS_NOT_OBSERVED',
    subject,
    evidenceRefs: [clockRef],
  })
}

function addReleaseSignals(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  occurrence: SignalOccurrence,
  metadata: ResolutionMetadata | undefined,
  targetVersion: string | undefined,
  subject: PlanSignal['subject'],
): void {
  const versionEvidence = addRegistryVersionEvidence(collector, occurrence, targetVersion)
  const parsedTarget = targetVersion ? semver.parse(targetVersion) : null
  addSignal(collector, input, {
    family: 'release-channel',
    state: parsedTarget ? (parsedTarget.prerelease.length > 0 ? 'warn' : 'pass') : 'unknown',
    reason: parsedTarget
      ? parsedTarget.prerelease.length > 0
        ? 'TARGET_PRERELEASE'
        : 'TARGET_STABLE'
      : 'TARGET_VERSION_UNKNOWN',
    subject,
    evidenceRefs: [versionEvidence],
  })

  if (input.cooldownDays === 0) {
    const disabledMaturityEvidence = addRegistryVersionEvidence(
      collector,
      occurrence,
      targetVersion,
      { asOf: input.asOf, cooldownDays: '0' },
    )
    addSignal(collector, input, {
      family: 'maturity',
      state: 'not-applicable',
      reason: 'MATURITY_POLICY_DISABLED',
      subject,
      evidenceRefs: [disabledMaturityEvidence],
    })
  } else {
    const observedPublishedAt = targetVersion ? metadata?.data.time?.[targetVersion] : undefined
    const publishedAt =
      observedPublishedAt &&
      Number.isFinite(Date.parse(observedPublishedAt)) &&
      new Date(Date.parse(observedPublishedAt)).toISOString() === observedPublishedAt
        ? observedPublishedAt
        : undefined
    const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN
    const asOfMs = Date.parse(input.asOf)
    const mature =
      Number.isFinite(publishedMs) &&
      publishedMs <= asOfMs - input.cooldownDays * 24 * 60 * 60 * 1000
    const maturityEvidence = addRegistryVersionEvidence(collector, occurrence, targetVersion, {
      publishedAt: publishedAt ?? 'unknown',
      asOf: input.asOf,
      cooldownDays: String(input.cooldownDays),
    })
    addSignal(collector, input, {
      family: 'maturity',
      state: !Number.isFinite(publishedMs) ? 'unknown' : mature ? 'pass' : 'fail',
      reason: !Number.isFinite(publishedMs)
        ? 'TARGET_TIME_UNKNOWN'
        : mature
          ? 'TARGET_MATURE'
          : 'TARGET_TOO_NEW',
      subject,
      evidenceRefs: [maturityEvidence],
    })
  }

  const current =
    exactDeclaredVersion(metadata?.currentVersion) ??
    exactDeclaredVersion(occurrence.declaredValue, occurrence.role)
  const currentPresence = current ? metadata?.data.deprecationPresence?.[current] : undefined
  const currentDeprecationEvidence = addRegistryVersionEvidence(collector, occurrence, current, {
    deprecation: currentPresence ?? 'unknown',
    versionRole: 'current',
  })
  addDeprecationSignal(
    collector,
    input,
    'current-deprecation',
    currentPresence,
    current ? 'CURRENT_NOT_DEPRECATED' : 'CURRENT_VERSION_UNKNOWN',
    'CURRENT_DEPRECATED',
    current ? 'CURRENT_DEPRECATION_UNKNOWN' : 'CURRENT_VERSION_UNKNOWN',
    subject,
    currentDeprecationEvidence,
  )
  const targetPresence = targetVersion
    ? metadata?.data.deprecationPresence?.[targetVersion]
    : undefined
  const targetDeprecationEvidence = addRegistryVersionEvidence(
    collector,
    occurrence,
    targetVersion,
    { deprecation: targetPresence ?? 'unknown', versionRole: 'target' },
  )
  addDeprecationSignal(
    collector,
    input,
    'target-deprecation',
    targetPresence,
    'TARGET_NOT_DEPRECATED',
    'TARGET_DEPRECATED',
    'TARGET_DEPRECATION_UNKNOWN',
    subject,
    targetDeprecationEvidence,
  )
}

function addDeprecationSignal(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  family: 'current-deprecation' | 'target-deprecation',
  presence: PassivePresence | undefined,
  absentReason: SignalReason,
  presentReason: SignalReason,
  unknownReason: SignalReason,
  subject: PlanSignal['subject'],
  evidenceRef: string,
): void {
  const state: SignalState =
    presence === 'absent'
      ? 'pass'
      : presence === 'present'
        ? family === 'target-deprecation'
          ? 'fail'
          : 'warn'
        : 'unknown'
  addSignal(collector, input, {
    family,
    state,
    reason:
      presence === 'absent' ? absentReason : presence === 'present' ? presentReason : unknownReason,
    subject,
    evidenceRefs: [evidenceRef],
  })
}

function addPassiveSignals(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  occurrence: SignalOccurrence,
  metadata: ResolutionMetadata | undefined,
  targetVersion: string | undefined,
  subject: PlanSignal['subject'],
): void {
  const signature = targetVersion ? metadata?.data.signaturePresence?.[targetVersion] : undefined
  const signatureEvidence = addRegistryVersionEvidence(collector, occurrence, targetVersion, {
    signaturePresence: signature ?? 'unknown',
  })
  addPresenceSignal(collector, input, 'signature-presence', signature, subject, signatureEvidence)
  const provenance = targetVersion ? metadata?.data.provenancePresence?.[targetVersion] : undefined
  const provenanceEvidence = addRegistryVersionEvidence(collector, occurrence, targetVersion, {
    provenancePresence: provenance ?? 'unknown',
  })
  addPresenceSignal(
    collector,
    input,
    'provenance-presence',
    provenance,
    subject,
    provenanceEvidence,
  )
}

function addPresenceSignal(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  family: 'signature-presence' | 'provenance-presence',
  presence: PassivePresence | undefined,
  subject: PlanSignal['subject'],
  evidenceRef: string,
): void {
  const signature = family === 'signature-presence'
  const reason: SignalReason =
    presence === 'present'
      ? signature
        ? 'SIGNATURE_PRESENT_UNVERIFIED'
        : 'PROVENANCE_PRESENT_UNVERIFIED'
      : presence === 'absent'
        ? signature
          ? 'SIGNATURE_METADATA_ABSENT'
          : 'PROVENANCE_METADATA_ABSENT'
        : signature
          ? 'SIGNATURE_METADATA_UNKNOWN'
          : 'PROVENANCE_METADATA_UNKNOWN'
  addSignal(collector, input, {
    family,
    state: presence === 'unknown' || presence === undefined ? 'unknown' : 'warn',
    reason,
    subject,
    evidenceRefs: [evidenceRef],
  })
}

function addRuntimeSignal(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  occurrence: SignalOccurrence,
  metadata: ResolutionMetadata | undefined,
  targetVersion: string | undefined,
  subject: PlanSignal['subject'],
  boundaryId: string | undefined,
): void {
  const contexts = evaluationContexts(input, occurrence)
  const boundaryIds = new Set(
    contexts
      .map(
        (context) =>
          input.repository.relationships.boundaryPackages.find(
            (item) => item.packageId === context.ownerId,
          )?.boundaryId,
      )
      .filter((value): value is string => Boolean(value)),
  )
  if (boundaryId) boundaryIds.add(boundaryId)
  const declarations = input.repository.runtimeDeclarations.filter((item) =>
    boundaryIds.has(item.boundaryId),
  )
  const conclusions = (input.runtimeEvidence ?? []).filter(
    (item) => item.boundaryId && boundaryIds.has(item.boundaryId),
  )
  const observedTargetEngine = targetVersion ? metadata?.data.engines?.[targetVersion] : undefined
  const targetEngine =
    observedTargetEngine &&
    isContractSafeText(observedTargetEngine) &&
    semver.validRange(observedTargetEngine)
      ? observedTargetEngine
      : undefined
  const observedEngineState = targetVersion
    ? metadata?.data.engineMetadata?.[targetVersion]
    : undefined
  const engineState = observedTargetEngine && !targetEngine ? 'unknown' : observedEngineState
  const repositoryRanges = declarations.map((item) => semver.validRange(item.declaredText))
  const conclusionsUnknown =
    boundaryIds.size === 0 ||
    [...boundaryIds].some((id) => {
      const matches = conclusions.filter((item) => item.boundaryId === id)
      return matches.length !== 1 || matches[0]?.status !== 'confirmed'
    })
  const rangesMalformed = repositoryRanges.some((range) => !range)
  const validRanges = repositoryRanges.filter((range): range is string => Boolean(range))
  const repositoryConflict = validRanges.some((range, index) =>
    validRanges.slice(index + 1).some((other) => !semver.intersects(range, other)),
  )
  const evidenceStatus =
    conclusionsUnknown || rangesMalformed
      ? 'unknown'
      : repositoryConflict
        ? 'conflicting'
        : declarations.length === 0 || !targetVersion
          ? 'unknown'
          : targetEngine
            ? 'observed'
            : engineState === 'absent'
              ? 'absent'
              : 'unknown'
  const runtimeFacts: Record<string, string> = {
    targetVersion: targetVersion ?? 'unknown',
    targetEngine: targetEngine ?? (engineState === 'absent' ? 'absent' : 'unknown'),
  }
  for (const declaration of declarations) {
    runtimeFacts[`repositoryRange.${declaration.id}`] = declaration.declaredText
  }
  for (const conclusion of conclusions) {
    runtimeFacts[`conclusionStatus.${conclusion.id}`] = conclusion.status
  }
  const evidenceRef = addEvidence(collector, {
    kind: 'repository-runtime',
    status: evidenceStatus,
    subject: occurrence.id,
    sourceRefs: [
      occurrence.id,
      ...contexts.map((context) => context.id),
      ...declarations.map((item) => item.id),
      ...conclusions.map((item) => item.id),
    ].filter((value, index, values) => values.indexOf(value) === index),
    facts: runtimeFacts,
  })
  if (
    !targetVersion ||
    declarations.length === 0 ||
    conclusionsUnknown ||
    rangesMalformed ||
    repositoryConflict
  ) {
    addSignal(collector, input, {
      family: 'runtime',
      state: 'unknown',
      reason: 'RUNTIME_EVIDENCE_UNKNOWN',
      subject,
      evidenceRefs: [evidenceRef],
    })
    return
  }
  if (!targetEngine) {
    addSignal(collector, input, {
      family: 'runtime',
      state: engineState === 'absent' ? 'not-applicable' : 'unknown',
      reason: engineState === 'absent' ? 'RUNTIME_UNCONSTRAINED' : 'TARGET_ENGINE_UNKNOWN',
      subject,
      evidenceRefs: [evidenceRef],
    })
    return
  }
  const targetRange = semver.validRange(targetEngine)!
  const disjoint = validRanges.some((range) => !semver.intersects(range, targetRange))
  const subset = validRanges.every((range) => semver.subset(range, targetRange))
  addSignal(collector, input, {
    family: 'runtime',
    state: disjoint ? 'fail' : subset ? 'pass' : 'warn',
    reason: disjoint
      ? 'RUNTIME_INCOMPATIBLE'
      : subset
        ? 'RUNTIME_COMPATIBLE'
        : 'RUNTIME_PARTIAL_OVERLAP',
    subject,
    evidenceRefs: [evidenceRef],
  })
}

function addPeerSignals(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  occurrence: SignalOccurrence,
  metadata: ResolutionMetadata | undefined,
  targetVersion: string | undefined,
  subject: PlanSignal['subject'],
  operations: Map<string, SignalOperation>,
): void {
  const peerState = targetVersion ? metadata?.data.peerMetadata?.[targetVersion] : undefined
  const requirements = targetVersion ? metadata?.data.peerDependencies?.[targetVersion] : undefined
  const requirementEntries = requirements ? Object.entries(requirements) : []
  const requirementsValid =
    requirementEntries.length > 0 &&
    requirementEntries.every(
      ([name, range]) =>
        isContractSafeText(name) &&
        isValidPackageName(name) &&
        isContractSafeText(range) &&
        Boolean(semver.validRange(range)),
    )
  const normalizedPeerState: PassivePresence | undefined =
    (peerState === 'present' && !requirementsValid) ||
    (peerState === 'absent' && requirementEntries.length > 0)
      ? 'unknown'
      : peerState
  const evidenceRef = addRegistryVersionEvidence(collector, occurrence, targetVersion, {
    peerMetadata: normalizedPeerState ?? 'unknown',
  })
  if (normalizedPeerState === 'absent') {
    addSignal(collector, input, {
      family: 'peer',
      state: 'not-applicable',
      reason: 'PEER_METADATA_ABSENT',
      subject,
      evidenceRefs: [evidenceRef],
    })
    return
  }
  if (normalizedPeerState !== 'present' || !requirements) {
    addSignal(collector, input, {
      family: 'peer',
      state: 'unknown',
      reason: 'PEER_EVIDENCE_UNKNOWN',
      subject,
      evidenceRefs: [evidenceRef],
    })
    return
  }
  const contexts = evaluationContexts(input, occurrence)
  if (contexts.length === 0) {
    addSignal(collector, input, {
      family: 'peer',
      state: 'unknown',
      reason: 'PEER_EVIDENCE_UNKNOWN',
      subject,
      evidenceRefs: [evidenceRef],
    })
    return
  }
  for (const [peerName, requiredRange] of Object.entries(requirements).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const optional =
      (targetVersion
        ? metadata?.data.optionalPeerDependencies?.[targetVersion]?.includes(peerName)
        : false) ?? false
    for (const context of contexts) {
      const providers = input.occurrences.filter(
        (candidate) =>
          candidate.ownerId === context.ownerId &&
          candidate.name === peerName &&
          isProviderOccurrence(candidate),
      )
      const boundaryId = input.repository.relationships.boundaryPackages.find(
        (item) => item.packageId === context.ownerId,
      )?.boundaryId
      const boundaryProviders = boundaryId
        ? input.occurrences.filter(
            (candidate) =>
              candidate.ownerId !== context.ownerId &&
              candidate.name === peerName &&
              isProviderOccurrence(candidate) &&
              input.repository.relationships.boundaryPackages.some(
                (item) => item.packageId === candidate.ownerId && item.boundaryId === boundaryId,
              ),
          )
        : []
      const overrideConstraints = input.occurrences.filter(
        (candidate) =>
          candidate.name === peerName &&
          candidate.role === 'override' &&
          (candidate.ownerId === context.ownerId ||
            (boundaryId !== undefined &&
              input.repository.relationships.boundaryPackages.some(
                (item) => item.packageId === candidate.ownerId && item.boundaryId === boundaryId,
              ))),
      )
      const providerProjection =
        providers.length === 1
          ? finalProviderProjection(input, providers[0]!, operations)
          : undefined
      const providerRange = providerProjection?.range
      const required = semver.validRange(requiredRange)
      const peerSubject = { ...subject, occurrenceIds: [occurrence.id] }
      const graphRef = addEvidence(collector, {
        kind: 'planned-graph',
        status:
          overrideConstraints.length > 0 || providers.length > 1
            ? 'conflicting'
            : providers.length === 0
              ? boundaryProviders.length > 0
                ? 'unknown'
                : 'absent'
              : providerRange
                ? 'observed'
                : 'unknown',
        subject: `${occurrence.id}:${context.id}:${peerName}`,
        sourceRefs: [
          occurrence.id,
          context.id,
          ...providers.map((provider) => provider.id),
          ...boundaryProviders.map((provider) => provider.id),
          ...overrideConstraints.map((constraint) => constraint.id),
          ...(providerProjection?.sourceRefs ?? []),
        ].filter((value, index, values) => values.indexOf(value) === index),
        facts: {
          peer: peerName,
          requiredRange,
          providerRange: providerRange ?? 'missing',
          providers: String(providers.length),
          boundaryProviders: String(boundaryProviders.length),
          overrideConstraints: String(overrideConstraints.length),
          optional: optional ? 'yes' : 'no',
        },
      })
      if (overrideConstraints.length > 0) {
        addSignal(collector, input, {
          family: 'peer',
          state: 'unknown',
          reason: 'PEER_EVIDENCE_UNKNOWN',
          subject: peerSubject,
          evidenceRefs: [evidenceRef, graphRef],
        })
        continue
      }
      if (providers.length === 0) {
        if (boundaryProviders.length > 0) {
          addSignal(collector, input, {
            family: 'peer',
            state: 'unknown',
            reason: 'PEER_EVIDENCE_UNKNOWN',
            subject: peerSubject,
            evidenceRefs: [evidenceRef, graphRef],
          })
          continue
        }
        addSignal(collector, input, {
          family: 'peer',
          state: optional ? 'not-applicable' : 'fail',
          reason: optional ? 'PEER_OPTIONAL_MISSING' : 'PEER_REQUIRED_MISSING',
          subject: peerSubject,
          evidenceRefs: [evidenceRef, graphRef],
        })
        continue
      }
      if (providers.length > 1 || !(providerRange && required)) {
        addSignal(collector, input, {
          family: 'peer',
          state: 'unknown',
          reason: 'PEER_EVIDENCE_UNKNOWN',
          subject: peerSubject,
          evidenceRefs: [evidenceRef, graphRef],
        })
        continue
      }
      const intersects = semver.intersects(providerRange, required)
      const subset = semver.subset(providerRange, required)
      addSignal(collector, input, {
        family: 'peer',
        state: !intersects ? 'fail' : subset ? 'pass' : 'warn',
        reason: !intersects
          ? 'PEER_INCOMPATIBLE'
          : subset
            ? 'PEER_COMPATIBLE'
            : 'PEER_PARTIAL_OVERLAP',
        subject: peerSubject,
        evidenceRefs: [evidenceRef, graphRef],
      })
    }
  }
}

function addExplicitCohortSignals(collector: Collector, input: EvaluatePlanSignalsInput): void {
  const candidateIds = new Set(
    input.candidateOccurrenceIds ?? input.operations.map((operation) => operation.occurrenceId),
  )
  for (const cohort of input.cohorts) {
    const members = input.occurrences.filter(
      (occurrence) => isRegistryOccurrence(occurrence) && cohort.members.includes(occurrence.name),
    )
    const versions = members.map((member) => input.traces.get(member.id)?.targetVersion)
    const complete =
      cohort.members.every((name) => members.some((member) => member.name === name)) &&
      versions.every(Boolean)
    const aligned =
      complete &&
      cohortAligned(
        cohort.strategy,
        versions as string[],
        members.map((member) => candidateIds.has(member.id)),
      )
    const cohortFacts: Record<string, string> = {
      strategy: cohort.strategy,
      source: input.cohortSource ?? input.policySource,
    }
    for (const [index, name] of [...cohort.members].sort(compareText).entries()) {
      cohortFacts[`configuredMember.${String(index).padStart(6, '0')}`] = name
    }
    for (const [index, member] of members.entries()) {
      cohortFacts[`proposedVersion.${member.id}`] = versions[index] ?? 'unknown'
      cohortFacts[`candidateOperation.${member.id}`] = candidateIds.has(member.id) ? 'yes' : 'no'
    }
    const evidenceRef = addEvidence(collector, {
      kind: 'explicit-cohort',
      status: complete ? 'observed' : 'unknown',
      subject: cohort.id,
      sourceRefs: members.map((member) => member.id).sort(),
      facts: cohortFacts,
    })
    addSignal(
      collector,
      input,
      {
        family: 'cohort',
        state: !complete ? 'unknown' : aligned ? 'pass' : 'fail',
        reason: !complete
          ? 'COHORT_MEMBER_UNKNOWN'
          : aligned
            ? 'COHORT_ALIGNED'
            : 'COHORT_DIVERGED',
        subject: {
          occurrenceIds: members.map((member) => member.id).sort(),
          cohortId: cohort.id,
        },
        evidenceRefs: [evidenceRef],
      },
      true,
    )
  }
}

function addInferredCohortSignals(collector: Collector, input: EvaluatePlanSignalsInput): void {
  const groups = new Map<string, SignalOccurrence[]>()
  for (const occurrence of input.occurrences) {
    const repository = input.metadata.get(occurrence.id)?.data.repository
    if (!repository) continue
    const group = groups.get(repository) ?? []
    group.push(occurrence)
    groups.set(repository, group)
  }
  for (const [repository, members] of groups) {
    const names = new Set(members.map((member) => member.name))
    if (names.size < 2) continue
    const ids = members.map((member) => member.id).sort()
    const subjectId = hashExactBytes(canonicalJson(ids)).slice(0, 16)
    const evidenceRef = addEvidence(collector, {
      kind: 'inferred-cohort',
      status: 'observed',
      subject: subjectId,
      sourceRefs: ids,
      facts: {
        sharedRepository: 'present',
        repositoryIdentity: hashExactBytes(repository),
        members: String(names.size),
      },
    })
    addSignal(
      collector,
      input,
      {
        family: 'cohort',
        state: 'warn',
        reason: 'COHORT_INFERRED_SUGGESTION',
        subject: { occurrenceIds: ids, cohortId: `inferred-${subjectId}` },
        evidenceRefs: [evidenceRef],
      },
      false,
      true,
    )
  }
}

function addSignal(
  collector: Collector,
  input: EvaluatePlanSignalsInput,
  base: SignalBase,
  explicitCohort = false,
  inferred = false,
): void {
  const projected = applySignalPolicy(
    base,
    input.rules,
    input.policySource,
    explicitCohort,
    inferred,
  )
  const id = `signal-${hashExactBytes(canonicalJson(projected)).slice(0, 24)}`
  collector.signals.push({ id, ...projected })
}

function addEvidence(collector: Collector, evidence: Omit<SignalEvidence, 'id'>): string {
  const id = `signal-evidence-${hashExactBytes(canonicalJson(evidence)).slice(0, 24)}`
  collector.evidence.set(id, { id, ...evidence })
  return id
}

function addRegistryVersionEvidence(
  collector: Collector,
  occurrence: SignalOccurrence,
  version: string | undefined,
  facts: Record<string, string> = {},
): string {
  return addEvidence(collector, {
    kind: 'registry-version',
    status: version ? 'observed' : 'unknown',
    subject: occurrence.id,
    sourceRefs: [occurrence.id],
    facts: { targetVersion: version ?? 'unknown', ...facts },
  })
}

function finalRegistryVersion(
  occurrence: SignalOccurrence,
  trace: ResolutionTrace | undefined,
): string | undefined {
  if (trace?.targetVersion && semver.valid(trace.targetVersion)) return trace.targetVersion
  return exactDeclaredVersion(occurrence.declaredValue, occurrence.role)
}

function normalizeDeclaredRange(value: string): string | null {
  const withoutWorkspace = value.startsWith('workspace:') ? value.slice('workspace:'.length) : value
  const withoutNpmAlias = withoutWorkspace.startsWith('npm:')
    ? withoutWorkspace.slice(withoutWorkspace.lastIndexOf('@') + 1)
    : withoutWorkspace
  return semver.validRange(withoutNpmAlias)
}

function evaluationContexts(
  input: EvaluatePlanSignalsInput,
  occurrence: SignalOccurrence,
): SignalOccurrence[] {
  if (occurrence.role !== 'catalog-owner') return [occurrence]
  return input.occurrences.filter(
    (candidate) =>
      candidate.role === 'catalog-consumer' &&
      candidate.catalogId === occurrence.catalogId &&
      candidate.name === occurrence.name,
  )
}

function finalProviderProjection(
  input: EvaluatePlanSignalsInput,
  provider: SignalOccurrence,
  operations: Map<string, SignalOperation>,
): { range: string | null; sourceRefs: string[] } {
  if (provider.role !== 'catalog-consumer') {
    return {
      range: normalizeDeclaredRange(
        operations.get(provider.id)?.requestedValue ?? provider.declaredValue,
      ),
      sourceRefs: [],
    }
  }
  const owner = input.occurrences.find(
    (candidate) =>
      candidate.role === 'catalog-owner' &&
      candidate.catalogId === provider.catalogId &&
      candidate.name === provider.name,
  )
  if (!owner) return { range: null, sourceRefs: [] }
  return {
    range: normalizeDeclaredRange(operations.get(owner.id)?.requestedValue ?? owner.declaredValue),
    sourceRefs: [owner.id],
  }
}

function cohortAligned(
  strategy: CohortInput['strategy'],
  versions: string[],
  selected: boolean[],
): boolean {
  const parsed = versions.map((version) => semver.parse(version))
  if (parsed.some((version) => !version)) return false
  if (strategy === 'update-together') return new Set(selected).size === 1
  if (strategy === 'same-version') return new Set(versions).size === 1
  return new Set(parsed.map((version) => version!.major)).size === 1
}

function isRegistryOccurrence(occurrence: SignalOccurrence): boolean {
  return (
    occurrence.role !== 'catalog-consumer' && ['semver', 'npm', 'jsr'].includes(occurrence.protocol)
  )
}

function isProviderOccurrence(occurrence: SignalOccurrence): boolean {
  if (occurrence.role === 'catalog-consumer') {
    return occurrence.protocol === 'catalog'
  }
  return (
    occurrence.role === 'dependency' &&
    ['semver', 'npm', 'jsr', 'workspace'].includes(occurrence.protocol)
  )
}

function summarizeSignals(signals: PlanSignal[]): SignalSummary {
  return {
    total: signals.length,
    pass: signals.filter((signal) => signal.state === 'pass').length,
    warn: signals.filter((signal) => signal.state === 'warn').length,
    fail: signals.filter((signal) => signal.state === 'fail').length,
    unknown: signals.filter((signal) => signal.state === 'unknown').length,
    notApplicable: signals.filter((signal) => signal.state === 'not-applicable').length,
    blocking: signals.filter((signal) => signal.effect === 'block').length,
  }
}

function compareSignals(left: PlanSignal, right: PlanSignal): number {
  return compareText(left.id, right.id)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export { validateSignalConfiguration } from './config'

function validateEvaluationInput(input: EvaluatePlanSignalsInput): void {
  validateSignalConfiguration([...input.cohorts], [...input.rules])
  const publicText = [
    input.asOf,
    input.policySource,
    ...(input.cohortSource ? [input.cohortSource] : []),
    ...input.repository.packages.flatMap((item) => [item.id, item.workspacePath]),
    ...input.repository.runtimeDeclarations.flatMap((item) => [
      item.id,
      item.boundaryId,
      item.kind,
      item.path,
      ...(item.field ? [item.field] : []),
      item.declaredText,
    ]),
    ...input.repository.relationships.boundaryPackages.flatMap((item) => [
      item.boundaryId,
      item.packageId,
    ]),
    ...input.occurrences.flatMap((item) => [
      item.id,
      item.ownerId,
      item.name,
      item.field,
      item.role,
      item.protocol,
      item.declaredValue,
      ...(item.catalogId ? [item.catalogId] : []),
    ]),
    ...input.operations.flatMap((item) => [item.occurrenceId, item.requestedValue]),
    ...(input.runtimeEvidence ?? []).flatMap((item) => [
      item.id,
      item.kind,
      item.status,
      ...(item.boundaryId ? [item.boundaryId] : []),
    ]),
  ]
  if (publicText.some((value) => !isContractSafeText(value))) {
    throw new ConfigError('Invalid compatibility signal public evidence text.', {
      reason: 'INVALID_CONFIG',
    })
  }
  const asOf = Date.parse(input.asOf)
  if (!Number.isFinite(asOf) || new Date(asOf).toISOString() !== input.asOf) {
    throw new ConfigError('Invalid compatibility signal evaluation clock.', {
      reason: 'INVALID_CONFIG',
    })
  }
  if (!Number.isSafeInteger(input.cooldownDays) || input.cooldownDays < 0) {
    throw new ConfigError('Invalid compatibility signal cooldown.', {
      reason: 'INVALID_CONFIG',
    })
  }
}
