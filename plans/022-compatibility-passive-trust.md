# Plan 022: Compatibility and passive trust signals

## Contract

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 013, 016, 017, 018
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Add deterministic compatibility, coordination, maturity, deprecation, and passive trust-presence
signals to plans. Signals explain risk and may block through explicit policy, but inferred evidence
must not silently change targets.

## Signal model

Every signal has `pass`, `warn`, `fail`, `unknown`, or `not-applicable`; stable reason codes; source
evidence; policy effect; and optional override provenance. Unknown is never serialized or rendered as
safe. Presence fields never claim cryptographic verification.

## Signal families

- planned target compatibility with repository Node/runtime constraints;
- peer dependency compatibility evaluated across the final planned graph;
- explicit package cohorts/families and non-mutating inferred cohort suggestions;
- release channel, age/maturity, and current/target deprecation evidence;
- registry metadata indicating signature/provenance presence only;
- evidence completeness and staleness.

## Owned files

- signal types/evaluators and policy/plan schema extensions
- repository constraint and planned peer-graph adapters
- registry metadata enrichment for maturity/deprecation/passive presence
- explicit cohort config/schema and inference reporting
- compatibility/trust docs and `CHANGELOG.md`

Cryptographic verification, package-manager command execution, writes, and automatic inferred cohort
mutation are out of scope.

## Implementation tasks

1. Add fixtures for conflicting/missing engine constraints, planned peer conflicts, explicit and
   inferred cohorts, prerelease/stale/new releases, deprecated current/target versions, and missing
   presence metadata.
2. Define the shared signal vocabulary, evidence references, policy effects, and override trace.
3. Evaluate repository runtime constraints from plan 016 evidence, never from `process.version`.
4. Build the final planned peer graph before evaluating conflicts.
5. Enforce only explicit cohorts; report inferred cohorts as warnings/suggestions.
6. Complete maturity/channel/deprecation evidence consistently with plan 013 candidate filters.
7. Rename/serialize signature and provenance metadata strictly as presence/unknown until plan 023
   verifies an artifact.
8. Extend plan summaries compatibly and document evidence limits.

## Acceptance evidence

- engine and peer results use the complete planned state;
- explicit cohort policy is traceable; inference never mutates targets;
- maturity/deprecation/channel cases are deterministic under a fixed clock;
- passive metadata makes no verified/safe claim;
- unknown remains unknown in JSON and human output;
- focused fixtures and all repository gates pass.

## STOP conditions

Stop if a signal lacks source evidence, relies on the executor runtime instead of repository state,
or would require network/process verification owned by plan 023.

## Completion record

### Delivered contract

- Plan schema v1 now carries deterministic `pass`, `warn`, `fail`, `unknown`, and
  `not-applicable` signals with stable reason codes, evidence references, policy effects, matched
  rule provenance, and optional override provenance. Summary counts remain additive and compatible.
- Runtime signals project Plan 016 repository declarations and conclusions, never the executor
  runtime. Peer signals use the exact planned owner graph; catalog consumers project to physical
  owners, while ambiguous cross-workspace, hoisted, or override-constrained topology remains
  unknown.
- Explicit cohorts support `update-together`, `same-version`, and `same-major` enforcement. Inferred
  cohorts are bounded suggestions only and never select or retarget a candidate.
- Registry enrichment records fixed-clock release channel, publish time, deprecation, engine, peer,
  signature-presence, provenance-presence, completeness, and staleness evidence. Presence never
  claims cryptographic verification.
- Signal policy is declarative, traceable, and unable to grant authority. Blocking removes the
  affected operation without choosing a replacement and retains the causal signal and evidence.

### Adversarial and review evidence

- RED/GREEN fixtures cover conflicting and missing runtime ranges; complete, optional, missing,
  cross-workspace, catalog, hoisted, and override-constrained peers; aligned and divergent explicit
  cohorts; bounded inference; stable and prerelease targets; maturity and malformed publish times;
  current/target deprecation; passive presence and unknown metadata; unavailable evidence; and
  explicitly unobserved staleness.
- Contract-forgery tests bind signal subject, occurrence, workspace, target/current version,
  repository runtime source, provider range, operation, catalog owner, cohort candidate, evidence
  state, reason, and policy effect. Exact locked semver, npm alias, JSR alias, and package-manager
  declarations share one normalization path; unknown never validates as success.
- Hostile package names, paths, control text, oversized public values, malformed dist-tags, engines,
  peer ranges, signature objects, attestations, and provenance objects are rejected, redacted, or
  preserved as unknown without secret or stack leakage.
- Independent requirements, documentation, code, and adversarial reviewers inspected the full
  diff. Validated findings were corrected with retained tests; final code and edge re-reviews both
  returned `APPROVED` with no remaining validated blocker.

### Verification

- A temporary-HOME/store frozen install passed under exact Node `24.15.0` with pnpm `10.33.0` and
  installed 210 packages without using the user cache.
- Exact Node `24.15.0` passed `pnpm typecheck`, `pnpm schemas:check`, `pnpm lint`, strict
  `biome check --error-on-warnings .`, and `git diff --check`; Biome checked 289 files with zero
  warnings.
- The 5-file, 90-test focused suite passed three consecutive exact-Node runs. The 8-file changed and
  dependency-regression suite passed 130 tests. The full suite passed 132 files and 1,366 tests.
- Exact Node built 40 `dist` files totaling about 1.4 MB, including the generated Plan 022 schema;
  `node:sqlite` remained external and `better-sqlite3` was absent. Practical built-CLI smoke passed
  26 checks and 49 mock-registry requests, including a one-request cold and zero-additional-request
  warm cache cycle under an isolated temporary HOME.
- Package dry-run reported `depfresh@1.2.0`, 43 files, 232,343 packed bytes, and 1,414,910 unpacked
  bytes. An actual tarball installed in an isolated exact-Node consumer; root signal APIs, the plan
  schema subpath, and the built CLI version passed.
- Built-product inspection preserved Git index, status, tracked diff, and empty staged-diff hashes:
  `f5f0c519647a2935fbccd5514f948b14f042b09f1443b70b2bde3efbdbd013a5`,
  `af3f3c6cec1579476f62dd292fc1219f1bb341c01c9c5ecb9e1ce3144ef817bc`,
  `2e35c154a5c3be2565e4fed76a0907f2ced1d8f966c60b2b22ce49f432882df3`, and
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

### Remaining limitations

- Signature and provenance fields report metadata presence only. Exact artifact retrieval and
  cryptographic/native verification belong to Plan 023.
- Peer topology is complete only where an exact physical owner is provable. Cross-workspace
  installation layout, hoisting, and ambiguous override topology remain unknown rather than safe.
- Inferred cohorts never mutate plans. Users must declare a cohort before it can block or warn under
  explicit cohort policy.
- Maturity decisions require the immutable plan clock and valid registry publish time; missing or
  malformed time remains unknown.
