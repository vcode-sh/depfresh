# Plan 021: Global apply state machine

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: CRITICAL
- **Depends on**: 013, 018, 019
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Model global dependency occurrences and execute requested global updates as an explicit
non-transactional state machine with preflight inventory, per-manager authority, downgrade guards,
post-command observation, and honest partial/unknown outcomes.

## Invariants

- Global operations never share the repository file transaction or claim rollback.
- Every manager/package/version occurrence has a stable plan identity and expected current value.
- No occurrence may downgrade unless a future dedicated capability and policy explicitly authorize
  it; this plan adds no such authority.
- Global write requires explicit global-write plus process authority for the selected manager.
- One manager/occurrence failure does not rewrite another result; the run-level result becomes
  partial or failed as evidence requires.

## Owned files

- `src/io/global-targets.ts`, global package loaders/writers, and current global command flow
- repository/plan model extensions for global occurrences outside repository file entities
- new global apply state/result types and focused fake-manager fixtures
- global CLI/library docs and `CHANGELOG.md`

Repository source writes, lockfile sync, and promises of global rollback are out of scope.

## Implementation tasks

1. Add fake-manager cases for duplicate package names across managers, mixed installed versions,
   missing manager, malformed inventory, downgrade proposals, mid-run failure, timeout, and
   post-command inventory failure.
2. Model global occurrences with manager, executable evidence, package, expected version, target,
   and required capabilities.
3. Preflight all requested operations and block stale/missing/downgrade cases before their command.
4. Execute fixed argument arrays through manager adapters with timeouts and sanitized environment.
5. Re-inventory after each command or manager batch and derive applied/skipped/conflicted/failed/
   unknown per occurrence.
6. Reconcile run summaries only from item results and document that successful prior commands are not
   rolled back after a later failure.
7. Route current global/global-all writes through the state machine and preserve read-only inventory.

## Acceptance evidence

- mixed-manager and mixed-version updates cannot downgrade any occurrence;
- item results equal observed post-command inventory;
- partial and unknown states are visible and totals reconcile;
- no shell interpolation or config-derived global authority exists;
- fake-manager tests and all repository gates pass.

## STOP conditions

Stop if a manager cannot provide reliable pre/post inventory or a target command cannot be expressed
as fixed argv. Report unsupported/unknown rather than assuming success.

## Completion record

Completed locally on 2026-07-16 at package version `1.2.0`; the version remains unchanged until
final v2.0 release preparation.

### Delivered contract

- Public strict `depfresh.global-plan` and `depfresh.global-apply` schema-v1 contracts ship at
  stable package subpaths with runtime shape, semantic, canonical-fingerprint, reference, fixed-argv,
  plain-data, summary, and item-state validation.
- Occurrence identity binds manager, package, expected version, executable fingerprint, and global
  realm fingerprint. Operation identity additionally binds the target version and exact update
  argv. Repeated package names across managers remain separate even when legacy presentation groups
  names.
- The supported matrix is npm 10/11, pnpm 10/11, and Bun `>=1.2.0 <2.0.0`. Exact inventory argv is
  lifecycle-disabled where supported; npm/pnpm global roots and Bun's absolute inventory header
  bind the realm. Update argv is fixed, no-shell, lifecycle-disabled, supervised, output-bounded,
  timed, and run with the Plan 020 sanitized environment.
- Planning preserves confirmed, unavailable, malformed, timeout, unknown, and unsupported manager
  evidence. Apply requires explicit global-write, process-execute, and exact selected-manager
  grants that configuration cannot provide. Every requested manager is preflighted before the
  first command, then rechecked immediately before its own command.
- Missing or stale expected values conflict, installed targets skip, and downgrades always skip.
  Fresh post-command inventory—not exit status—determines applied truth. An observed target remains
  applied after a nonzero exit; unchanged known state after definite command failure is failed; a
  third known version conflicts; lost inventory or changed executable/realm evidence is unknown.
  Unconfirmed process termination stops later commands as unknown.
- Item totals alone derive applied, noop, partial, conflicted, failed, or unknown run status. Every
  result states `rollback: "not-supported"`; earlier applied items are not rewritten after a later
  failure. Legacy `--global[-all] --write` routes through this engine and emits versioned
  `globalResults`; ordinary repository plan remains process-free and rejects global flags.
- Observed asynchronous global inventory is the public loader contract. The unsafe direct
  `writeGlobalPackage()` root export was removed. Ordered policy evaluates each physical global
  occurrence using its own manager and installed version.

### Adversarial and review evidence

- Unit and fake-manager integration tests cover duplicate names with mixed installed versions,
  deterministic identities/order, missing/unsupported managers, malformed and duplicate-key JSON,
  strict Bun inventory, empty confirmed inventory, stale/missing/downgrade states, authority
  mismatch, command failure/timeout, executable and realm drift, post-command inventory loss,
  partial/failed/unknown reconciliation, inert hostile names, exact argv, sanitized environment,
  and no rollback.
- The practical built-CLI smoke fixture implements the exact npm/pnpm/Bun protocol, verifies both
  manager-specific shared-package updates, and proves a one-request cold / zero-additional-request
  warm SQLite cache cycle under an isolated temporary HOME.
- Independent requirements, adversarial-test, documentation, and final code reviewers inspected
  the separate global contract and repository boundary. Final review initially found loose result
  semantics, authority supersets, realm-timeout collapse, API-document drift, and process-census
  test interference. RED/GREEN corrections fixed each issue; bounded test retries retain the
  supervisor's conservative unknown behavior instead of weakening it. The corrected re-review
  returned `APPROVED`; no validated finding remains.

### Verification

- Temporary-HOME/store frozen installation passed with pnpm `10.33.0`; the exact Node `24.15.0`
  rerun installed 210 packages without using the user cache.
- `pnpm typecheck`, `pnpm schemas:check`, `pnpm lint`, strict
  `biome check --error-on-warnings .`, and `git diff --check` passed; Biome checked 282 files with
  zero warnings.
- The 10-file, 58-test focused global suite passed three consecutive exact-Node runs. The
  exact-Node repository/plan/policy/resolution regression set passed 26 files
  and 282 tests. The corrected exact-Node full suite passed 131 files and 1,334 tests with
  process-sensitive files serialized and bounded retry for documented conservative census races.
- Exact Node `24.15.0` built 41 package files with a 1.28 MB `dist`, including six generated schemas;
  `node:sqlite` remained external and `better-sqlite3` was absent. Practical smoke passed 26 checks
  and 49 mock-registry requests.
- Package dry-run reported `depfresh@1.2.0`, 41 files, 209,033 packed bytes, and 1,293,885 unpacked
  bytes. An actual tarball installed in an isolated exact-Node consumer; root APIs, both global
  schema subpaths, and built CLI version passed.
- Exact-Node built inspection preserved Git index, status, tracked diff, and empty staged diff
  hashes: `07f524125db972ac2f724b2e0b1086d6ed2fd5184c16cfac02a5d42dd707ae6c`,
  `3059dc51135ece1ccf8e818a6a77986fdb163023bb4094dbc2d1fefe1d87bf1b`,
  `7763e5b830f5cd66494ee8fea8521a66bd3ca0c760d5d5b2ddedec51e1c06b82`, and
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

### Remaining limitations

- Global manager state and caches are non-transactional. No item is rolled back; callers must
  re-inventory and create a fresh plan before retrying conflicted, failed, or unknown items.
- Yarn globals, npm/pnpm versions outside 10/11, Bun below 1.2 or at/above 2, Windows manager
  execution, and any manager without reliable fixed-argv inventory/update behavior are unsupported.
- No live npm 10, pnpm 11, or Bun host replay was available. Their exact protocols are covered by
  strict adapters, parser tests, and executable fake-manager integration on macOS.
- The sanitized environment excludes ambient credential and proxy variables. Private registries
  require manager-readable configuration. This contract proves observed installed versions, not
  artifact provenance or package trust; Plan 023 owns native trust verification.
