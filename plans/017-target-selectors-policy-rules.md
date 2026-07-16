# Plan 017: Target selectors and ordered policy rules

## Contract

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 013, 015, 016
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Compile CLI, config, and library policy into one validated ordered rule list evaluated against
dependency occurrences. Use deterministic last-match-wins semantics and expose complete decision
traces without granting side-effect authority.

## Required selectors

- dependency name pattern;
- workspace canonical path and package name;
- catalog name and catalog-backed/direct role;
- dependency field/role;
- package manager;
- protocol/source kind;
- current channel/status where already supported.

Rules contain a stable ID, selectors, optional action/mode, and source provenance. A decision
contains all matched rule IDs, independent winning action and mode rule IDs, effective mode/action,
and stable reason codes.

## Owned files

- new pure policy schema/compiler/matcher modules and public types
- `src/config.ts`, CLI argument/schema modules, and `src/io/resolve-mode.ts` integration
- check processing boundary and catalog adapters only to supply occurrence context
- compatibility migration for current include/exclude flags
- policy docs, realistic fixtures, and `CHANGELOG.md`

Repository discovery, candidate fetching, physical writes, and apply authority are out of scope.

## Implementation tasks

1. Freeze current include/exclude/mode behavior with compatibility tests and resolve terminology
   collisions between package, workspace, and catalog selectors.
2. Define a JSON-compatible rule schema and reject unknown fields, invalid combinations, duplicate
   IDs, and rules attempting to grant runtime authority.
3. Compile defaults, config/library policy, and CLI compatibility inputs to one ordered list with
   explicit provenance. Named reusable policy profiles remain deferred; `--profile` remains
   runtime telemetry.
4. Match only against the versioned occurrence/model context; keep the matcher pure.
5. Produce deterministic last-match-wins decisions and traces for selected, skipped, blocked, and
   unchanged occurrences.
6. Prove the acceptance case: broad latest updates while occurrences consuming Bun's `native`
   catalog are capped at `minor`; direct occurrences of the same names remain broad.
7. Document precedence, selector vocabulary, migration warnings, and library configuration.

## Acceptance evidence

- order changes only the cases expected by last-match-wins;
- every occurrence has one deterministic decision and complete trace;
- catalog owners/consumers inherit policy correctly without affecting direct declarations;
- the WUN-style fixture passes end to end through decision generation;
- configuration cannot grant side-effect capabilities;
- focused/property tests and all repository gates pass.

## STOP conditions

Stop if a selector depends on data absent from the repository model or if compatibility requires
two competing precedence systems. Amend the owning model or migration contract first.

## Contract amendment record

Implementation had not started when a read-only requirement map and an independent adversarial
review on 2026-07-16 confirmed that the plan triggered its own STOP conditions. The user approved
the minimal contract below on 2026-07-16. Those STOP conditions are resolved for Plan 017, and the
approved contract is now implementation authority.

### Validated blockers

1. **Policy profiles are undefined.** Task 3 requires compiling profiles, but the only current
   `profile` is runtime telemetry. There is no named policy-profile type, activation mechanism,
   source provenance, merge order, or CLI syntax. Adding one would invent a public contract and
   collide with the existing `--profile` flag.
2. **Legacy behavior has two precedence systems.** Include/exclude filtering is an allow-list plus
   exclude-wins gate applied before resolution. `packageMode` gives exact names unconditional
   priority and otherwise uses the first matching insertion-order pattern. The plan requires one
   ordered last-match-wins list and one winning rule, but does not say whether action and mode are
   independent partial overlays or one winner owns both. No migration can preserve current behavior
   until this mapping is explicit.
3. **Catalog consumer-to-owner propagation is undefined.** The model has separate non-writeable
   consumers and writeable catalog owners linked by catalog ID. Workspace/package rules can match
   one consumer while several consumers share one physical owner. The plan does not define whether
   consumer policy affects the owner or how conflicting consumer modes/actions are combined.
4. **Required public vocabulary is incomplete.** The action enum, valid action/mode/include/exclude
   combinations, meaning of selected/skipped/blocked/unchanged, and stable policy reason codes are
   not defined.
5. **Some selector context is absent or has no unknown-state rule.** Occurrences contain declared
   text, field, role, protocol, owner, and catalog IDs, but not normalized current channel/status or
   a manager conclusion reference. Manager evidence may be confirmed, ambiguous, missing,
   unsupported, or unavailable. The contract does not say which states are no-match, blocked, or
   unknown.
6. **Globals are outside the versioned model.** Plan 015 defers global occurrences to Plan 021.
   Plan 017 must explicitly preserve their legacy policy path or move the required model work ahead
   of this plan.

### Superseded unblock requirements

Amend the Plan 017 contract, and Plan 015/model contract where necessary, with:

- a named policy-profile schema, activation mechanism, and precedence;
- explicit action and reason enums plus valid rule combinations;
- an exact compatibility migration table for include, exclude, mode, and `packageMode`;
- catalog owner/consumer propagation and conflict behavior;
- versioned current-channel/status and manager-context semantics for unknown evidence;
- an explicit global-occurrence boundary for this plan versus Plan 021.

### Approved implementation contract

This contract preserves current behavior and avoids catalog fan-out guesses:

1. **Profiles**: remove named policy profiles from Plan 017. The existing `--profile` remains
   telemetry. Named reusable policy profiles are deferred until a separate plan defines activation
   and precedence.
2. **Rule shape**: a JSON-compatible rule has `id`, `selectors`, optional `action` (`include` or
   `exclude`), and optional `mode`. A rule must set at least one of `action` or `mode`;
   `action: exclude` plus `mode` is invalid. Unknown fields, non-JSON values, duplicate IDs, invalid
   patterns, and all authority-shaped fields are rejected.
3. **Precedence**: one ordered list is evaluated last-match-wins independently for the action and
   mode dimensions. Decisions expose `matchedRuleIds`, `winningActionRuleId`, and
   `winningModeRuleId`; there is no misleading single winner when two compatibility dimensions
   contribute.
4. **Legacy migration**: global mode supplies the default mode. `packageMode` patterns are compiled
   in reverse insertion order so the current first-pattern-wins behavior survives, followed by exact
   name rules so exact matches still win. `ignore` becomes `action: exclude`. Include compiles to a
   default exclude plus matching include rules; exclude rules follow and therefore win. Explicit
   policy rules follow compatibility rules within their source layer. Source layers are defaults,
   config/library, then explicit CLI compatibility inputs; CLI arrays continue replacing config
   arrays rather than concatenating.
5. **Catalogs**: catalog-name and catalog-role rules match owners and consumers independently. Only
   the catalog-owner decision controls the physical catalog entry. Consumer decisions are
   explanatory and workspace/package-specific consumer rules never propagate into a shared owner.
   The `native` acceptance rule therefore selects `catalogName: native` and applies to the owner and
   every linked consumer, while same-name direct declarations remain unaffected.
6. **Unknown manager evidence**: catalog manager comes from the catalog entity. Package occurrence
   manager comes only from a confirmed single-manager boundary conclusion. If a manager-specific
   rule matches every other selector but manager evidence is ambiguous, missing, unsupported, or
   unavailable, the occurrence is `blocked` with `POLICY_MANAGER_UNKNOWN`; broad rules that do not
   depend on manager evidence remain evaluable.
7. **Current context**: add model-derived normalized current version, channel, and specifier status
   (`locked`, `range`, `dynamic`, or `invalid`) to versioned occurrence policy context. No
   registry-derived status is invented during inspection.
8. **Decision states**: `selected`, `skipped`, and `blocked` are produced by policy evaluation.
   Check integration finalizes a selected decision as `unchanged` when the authoritative candidate
   pipeline returns no target, retaining the Plan 013 candidate reason in the trace.
9. **Globals**: Plan 017 preserves the current global policy path. Versioned global occurrence
   policy remains owned by Plan 021 and must not be fabricated in the repository model here.

### Implementation map

Every behavior task starts with a failing focused test and retains the RED evidence in the final
completion record.

1. **Public schema and validation**
   - Add JSON-compatible policy input, selector, compiled-rule, decision, status, reason, and
     provenance types in new pure policy modules and public type exports.
   - Validate unknown fields, JSON values, IDs, selector patterns, action/mode combinations, and
     authority-shaped keys before compilation.
   - Characterize direct library input and configuration loading separately so invalid policy is
     never silently ignored.
2. **Compatibility compiler**
   - Characterize existing `mode`, `packageMode`, `ignore`, `include`, and `exclude` behavior.
   - Compile compatibility inputs in the approved order, preserving exact-name and first-pattern
     `packageMode` behavior while exposing ordered last-match-wins rules.
   - Preserve CLI replacement semantics and attach deterministic source-layer provenance.
3. **Occurrence policy context**
   - Add only model-derived current version, channel, specifier status, catalog context, and manager
     evidence required by the approved selectors.
   - Keep globals on their legacy path and retain every ambiguous or unavailable manager state.
4. **Pure matcher and decisions**
   - Match selectors against versioned occurrence context without I/O.
   - Resolve action and mode independently, produce deterministic traces, and block only a
     manager-specific otherwise-match on unknown manager evidence.
   - Prove catalog owners and consumers are evaluated independently and direct declarations do not
     inherit catalog policy.
5. **Check integration**
   - Apply occurrence policy at the check processing boundary without granting write authority or
     changing candidate selection.
   - Preserve existing callers and global behavior, avoid registry work for skipped/blocked
     occurrences, and finalize selected decisions to `unchanged` with the authoritative Plan 013
     candidate reason when no target exists.
6. **Acceptance fixture, documentation, and gates**
   - Prove the WUN-style `native` catalog fixture end to end through decision generation.
   - Update current README/docs, `AGENTS.md`, Unreleased changelog, this plan, `plans/README.md`, and
     only the matching DRAFT v2 section.
   - Run all per-plan verification gates, obtain independent APPROVED review, record exact results,
     mark DONE, and commit Plan 017 without changing the package version.

No Plan 017 production implementation had been made before this contract approval. The package
version remains `1.2.0`.

## Completion record

Completed locally on 2026-07-16 and committed as `7678b2a`. The package version remains `1.2.0`;
release preparation and the single `2.0.0` bump remain deferred until Plans 018–024 are complete.

- Added strict public occurrence-policy types and pure schema, compatibility compiler, context,
  matcher, repository evaluator, and candidate finalizer APIs. Public layer inputs are canonicalized
  as defaults, config, library, then CLI regardless of caller enumeration order.
- Preserved legacy global mode, `packageMode` exact-first/first-pattern behavior, npm-alias
  resolution names, allow-list and exclude semantics, and `ignore` behavior. Internal compatibility
  causes ensure matching include rules cannot bypass global/package ignore or explicit/filter
  exclusions, while explicit policy actions retain normal ordered last-match-wins behavior.
- Added registry-free occurrence context for normalized current version/channel/status, canonical
  package/workspace/catalog identity, and confirmed/unknown manager evidence. Manager-specific
  otherwise-matches block deterministically and later definite rules clear only the affected
  action or mode dimension.
- Integrated local checks through the repository model and selected projection. Skipped and blocked
  occurrences never reach resolution; selected occurrences use policy mode; no-target candidates
  finalize as unchanged with the exact Plan 013 reason. Globals retain their legacy path.
- Proved owner/consumer/direct separation with Bun and pnpm named-catalog fixtures, dotted catalog
  names, unresolved/ambiguous catalog evidence, consumer non-propagation, and npm aliases.
- Hardened rules, layer containers, filters, and `packageMode` against unknown fields, symbols,
  non-enumerable properties, sparse/extra arrays, accessors, cycles, proxies, invalid modes/enums,
  and authority-shaped input without invoking hostile getters or leaking their values.

### Final verification

- Isolated `pnpm install --frozen-lockfile`: pass with pnpm `10.33.0`; lockfile unchanged.
- Typecheck: pass. `pnpm lint` and strict zero-warning Biome: pass, 236 files checked.
- Focused policy/config/catalog/candidate suite: pass, 7 files and 119 tests; three consecutive
  reviewer runs passed.
- Full suite: pass, 112 files and 1,128 tests.
- Build: pass, 382 kB total dist. Practical smoke: pass, 26 checks and 52 mock-registry requests.
- Exact Node `24.15.0`: pass, 7 focused files and 119 tests; built CLI reports `1.2.0`; built
  library exports and canonical source-order policy probe pass.
- Dist inspection: pass; public policy declarations/exports are present, `node:sqlite` remains a
  builtin import, and `better-sqlite3` is absent.
- `npm pack --dry-run --json`: pass, `depfresh@1.2.0`, 23 files, 86,608 bytes packed.
- Exact-Node temporary-HOME cache probe: pass, one cold registry request and zero additional warm
  requests; the real user cache was never used.
- Live repository inspection preserved complete Git status, `.git/index` bytes, `package.json`, and
  `pnpm-lock.yaml`; `git diff --check` passed.
- Independent implementation review: `APPROVED`; independent documentation drift re-audit:
  `APPROVED`; no validated findings remain.

### Remaining limitations

Named reusable policy profiles remain intentionally deferred. Versioned global occurrence policy
remains owned by Plan 021. Immutable inspect/plan envelopes, stale-safe apply, lockfile sync,
compatibility/trust, native verification, and the official workflow remain owned by Plans 018–024.
