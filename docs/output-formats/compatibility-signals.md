# Compatibility and Passive-Evidence Signals

New `depfresh.plan` documents carry a fingerprinted `signals` array, a normalized
`signalEvidence` collection, and exact counts in `summary.signals`. Older schema-v1 plans without
the optional extension remain valid; the current producer always emits it.

## Signal contract

Each signal contains a stable content-derived ID, one family, immutable evidence `state`, stable
`reason`, exact occurrence/cohort subjects, evidence references, and a policy `effect`. States are
`pass`, `warn`, `fail`, `unknown`, and `not-applicable`. Effects are `none`, `warn`, and `block`.
Unknown never becomes pass. Ordered explicit rules record every matched ID, the winning ID, and an
override `{ ruleId, source, from, to }` when they change the default effect.

Families cover repository runtime constraints, final planned peer compatibility, explicit and
inferred cohorts, release channel, maturity, current/target deprecation, signature presence,
provenance presence, evidence completeness, and evidence staleness.

| State | Meaning |
|---|---|
| `pass` | The retained evidence proves the family-specific condition. |
| `warn` | The condition is observed but needs review; it is not a safety assertion. |
| `fail` | The retained evidence proves a conflict or policy failure. |
| `unknown` | Required evidence is missing, malformed, ambiguous, unavailable, or unprovable. |
| `not-applicable` | The check does not apply, such as an absent optional peer or disabled maturity policy. |

`effect` is independent of `state`: `none` permits the candidate, `warn` retains it with review
evidence, and `block` removes the affected operation. A rule can change only the effect.

## Evidence semantics

- Runtime signals consume every Node declaration attached to the occurrence's repository boundary.
  A confirmed Plan 016 runtime conclusion is required for each owning boundary. They never inspect
  the process running depfresh.
- Peer signals use each selected package version's registry peer requirements and the complete
  proposed declaration graph for the exact manifest owner. Catalog consumers project through their
  physical catalog owner. A possible provider elsewhere in the same workspace boundary remains
  unknown unless exact topology proves the relationship; it is never guessed from hoisting.
  Required missing peers fail; optional missing peers are not applicable; malformed or conflicting
  providers remain unknown.
- Explicit cohorts use `update-together`, `same-major`, or `same-version`. A divergent explicit
  cohort blocks by default. `update-together` means every physical configured member had a candidate
  operation or none did; it does not require equal target versions. Catalog consumers are projected
  to and deduplicated by physical owners. Inferred families require the same hashed repository
  identity, remain warnings, and cannot change operations or be promoted to blocking policy.
- Maturity uses only the canonical plan `asOf` instant and configured cooldown. With cooldown
  disabled it is not applicable. Missing or malformed publish times remain unknown.
- Signature and provenance observations are independent presence fields. `present`, `absent`, and
  `unknown` describe registry metadata only. They do not verify a tarball, signature, attestation,
  signer, integrity, or mutable tag.
- The planner's memory-only registry data has no trustworthy observation timestamp. Evidence
  staleness is therefore explicitly not applicable rather than inferred from package modification
  time or the wall clock.

## Stable reason codes

| Family | Reasons |
|---|---|
| Runtime | `RUNTIME_COMPATIBLE`, `RUNTIME_PARTIAL_OVERLAP`, `RUNTIME_INCOMPATIBLE`, `RUNTIME_UNCONSTRAINED`, `RUNTIME_EVIDENCE_UNKNOWN`, `TARGET_ENGINE_UNKNOWN` |
| Peer | `PEER_COMPATIBLE`, `PEER_PARTIAL_OVERLAP`, `PEER_INCOMPATIBLE`, `PEER_REQUIRED_MISSING`, `PEER_OPTIONAL_MISSING`, `PEER_METADATA_ABSENT`, `PEER_EVIDENCE_UNKNOWN` |
| Cohort | `COHORT_ALIGNED`, `COHORT_DIVERGED`, `COHORT_MEMBER_UNKNOWN`, `COHORT_INFERRED_SUGGESTION` |
| Release channel | `TARGET_STABLE`, `TARGET_PRERELEASE`, `TARGET_VERSION_UNKNOWN` |
| Maturity | `MATURITY_POLICY_DISABLED`, `TARGET_MATURE`, `TARGET_TOO_NEW`, `TARGET_TIME_UNKNOWN` |
| Current deprecation | `CURRENT_NOT_DEPRECATED`, `CURRENT_DEPRECATED`, `CURRENT_VERSION_UNKNOWN`, `CURRENT_DEPRECATION_UNKNOWN` |
| Target deprecation | `TARGET_NOT_DEPRECATED`, `TARGET_DEPRECATED`, `TARGET_DEPRECATION_UNKNOWN` |
| Signature presence | `SIGNATURE_PRESENT_UNVERIFIED`, `SIGNATURE_METADATA_ABSENT`, `SIGNATURE_METADATA_UNKNOWN` |
| Provenance presence | `PROVENANCE_PRESENT_UNVERIFIED`, `PROVENANCE_METADATA_ABSENT`, `PROVENANCE_METADATA_UNKNOWN` |
| Completeness | `REGISTRY_EVIDENCE_COMPLETE`, `REGISTRY_EVIDENCE_UNKNOWN` |
| Staleness | `STALENESS_NOT_OBSERVED` |

## Evidence records

Each `SignalEvidence` record has a content-derived `id`, one `kind`, an observation `status`, a
public subject, exact `sourceRefs`, and bounded public `facts`. Evidence kinds are
`repository-runtime`, `registry-version`, `planned-graph`, `explicit-cohort`, `inferred-cohort`, and
`clock`; statuses are `observed`, `absent`, `unknown`, and `conflicting`. Runtime facts retain each
declaration and Plan 016 conclusion separately. Cohort facts retain each configured physical member,
proposed version, and candidate-operation bit separately. Passive evidence retains only presence
state, never signature bytes, attestation URLs, credentials, or raw registry error text.

Signal subjects contain exact `occurrenceIds` and may include a public `dependencyName`,
repository-relative `workspacePath`, or explicit/inferred `cohortId`. The semantic validator binds
reason, state, family, evidence kind, relevant facts, policy trace, references, IDs, ordering, and
summary counts before accepting a plan.

Only an explicit cohort or matching `signalRules` entry can create a blocking signal effect.
Blocking removes affected candidate operations and rebuilds graph-dependent signals without
selecting another version. Configuration shapes policy but grants no apply or process authority.
Artifact and manager-native verification belong to the separate verification contract.
