# Plan 028: First-class workspace and catalog exclusions

> Executor instructions: implement this plan with red-green-refactor, one main editor, and a
> different read-only reviewer after the full diff is ready. Re-read `AGENTS.md`, this plan, every
> dependency plan, and every owned file before editing. Preserve unrelated and concurrent work.
>
> Drift check: `git diff --stat 730cc7c..HEAD -- src test docs skills README.md AGENTS.md CHANGELOG.md plans`

## Contract

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 017, 018, 019, 024, 026, 027
- **Opened at**: `730cc7c`, 2026-07-17
- **Status**: TODO

## Objective

Let a user exclude any discovered application/workspace or physical workspace catalog for one
check, write, or immutable plan invocation with clear, exact CLI syntax. Build the shortcuts on the
existing occurrence-policy engine, prove every requested target against the repository model before
registry access or mutation, preserve shared-catalog ownership, and show a compact receipt of what
was actually excluded.

This is a generic monorepo feature. Expo and React Native have no special behavior; an application
is addressed by its canonical workspace path, and a catalog is addressed by its physical default or
named catalog identity.

## Audit evidence

The audit was performed read-only at `730cc7c` against the source, tests, current documentation,
the completed policy/plan/apply contracts, and the sanitized structure of the WUN monorepo. Three
independent audits covered CLI/capabilities, policy/catalog semantics, and UX/docs/test drift.

- `src/cli/args-schema.ts:40-49` exposes only dependency-name `--include` and `--exclude`.
  `src/cli/migration-flags.ts:4-7` exposes `--ignore-paths`, but that removes files during discovery
  rather than selecting modeled dependency occurrences.
- `src/types/policy.ts:38-49` and `src/policy/matcher.ts:195-224` already support generic
  `workspacePath`, `catalogName`, and `catalogRole` selectors. The missing capability is an ergonomic
  invocation surface, not a new policy evaluator.
- `src/config.ts:213-239` orders defaults, config, and invocation policy. Explicit policy rules
  follow compatibility filters inside each layer, so final CLI action rules can win without erasing
  a configured mode decision.
- `src/policy/context.ts:38-55` gives a root-file catalog owner the source directory as its
  `workspacePath`. A naive rule for workspace `.` would therefore also exclude co-located catalogs.
  Workspace shortcuts must select only `catalogRole: direct` and `catalogRole: consumer`; they must
  never select `catalogRole: owner`.
- `src/policy/repository.ts` and `plans/017-target-selectors-policy-rules.md:140-144` establish that a
  catalog consumer is explanatory and never grants authority over the shared physical owner. Only a
  separate catalog exclusion may freeze that owner.
- `src/utils/patterns.ts:13-27` treats a plain advanced selector as a regular expression. Passing an
  invocation value such as `apps/admin.v2` through unchanged would overmatch. Convenience values
  therefore need exact-literal matching and must escape regex metacharacters internally.
- `src/policy/matcher.ts:219-224` treats a selector with zero occurrence matches as an ordinary
  no-match. That is valid for portable advanced configuration, but unsafe for an explicit one-off
  exclusion: a typo could leave writes eligible while appearing accepted.
- `src/commands/plan/index.ts` already retains policy decisions and exact operations, while normal
  table and compatibility JSON output do not provide an exclusion receipt. A shortcut without an
  observable receipt would repeat the current trust problem.
- `src/contracts/schemas.ts:753-781` and `src/contracts/capabilities-schema.ts:12-23` are strict
  closed v1 schemas. A fingerprinted receipt and structured repeatability/command-scope metadata
  cannot be added to those published contracts in place; the new documents require explicit v2
  schemas while v1 artifacts and apply compatibility remain intact.
- `README.md:80-110` and `docs/configuration/workspaces.md:182-225` present a generic mechanism as a
  native/Expo recipe. The WUN-shaped proof and shipped policy example repeat that framing even though
  the model supports arbitrary workspaces and catalogs.

## Product contract

### Public syntax

The flags are repeatable exact identities, not comma lists and not implicit patterns:

```bash
depfresh -r --exclude-workspace apps/admin
depfresh -r -w \
  --exclude-workspace apps/admin \
  --exclude-workspace packages/legacy \
  --exclude-catalog payments
depfresh plan --json \
  --exclude-workspace apps/worker \
  --exclude-catalog default
```

The same arguments work after the runner prefix, for example:

```bash
bunx depfresh -r --exclude-workspace apps/admin --exclude-catalog payments
```

- `--exclude-workspace <path>` identifies one discovered package by canonical repository-relative
  workspace path. `.` identifies the root package. Safe `./` and trailing-slash spellings may be
  normalized, but absolute paths, parent traversal, backslashes, empty values, control characters,
  and values that cannot canonicalize inside the effective root are rejected.
- `--exclude-catalog <name>` identifies the exact physical catalog name across pnpm, Bun, or Yarn.
  `default` addresses the default catalog. Punctuation is literal; `mobile.v2` cannot match
  `mobileXv2`. Empty and unsafe text is rejected.
- Different values use repeated flags. Repeated identical values are deduplicated in first-seen
  order. Exact names containing commas remain representable because the new flags do not split on
  commas. A value beginning with `-` uses `--exclude-catalog=<value>`.
- Glob and regular-expression selection remains available through advanced `policyRules`; the
  convenience flags do not expose the pattern dialect. Top-level config aliases, include-workspace,
  include-catalog, package-name shortcuts, and raw JSON policy flags are deferred until evidence
  justifies a larger public surface.

### Command matrix

| Surface | Workspace/catalog flags | Required behavior |
| --- | --- | --- |
| normal check | accepted | read-only selection with a human or JSON receipt |
| normal `--write` | accepted | same selection; explicit `--write` remains the only file authority |
| `plan --json` | accepted | fingerprint exact decisions and operations; perform no writes/processes |
| `inspect --json` | rejected | inspect remains policy-free repository evidence |
| `apply --json` | rejected | apply consumes the reviewed immutable plan and cannot change selection |
| global/global-all | rejected | global occurrences have no workspace or catalog identity |
| library `check()` / `plan()` | unchanged | use existing `policyRules`; no CLI-only shortcut leaks into config |

`capabilities --json` and `--help-json` must describe both flags as repeatable, exact-literal,
check/plan-only selection inputs. Human help must distinguish dependency-name `--exclude`,
discovery `--ignore-paths`, workspace exclusion, and physical catalog exclusion.

### Exact occurrence semantics

1. A workspace exclusion binds to a real `RepositoryPackageManifest`, not to a discovery glob or
   package-name guess.
2. It emits final CLI-source action rules for that exact `workspacePath` with
   `catalogRole: direct` and `catalogRole: consumer`. Direct dependencies, overrides, resolutions,
   and package-manager declarations owned by the workspace are excluded. Its catalog consumers are
   excluded as explanatory occurrences.
3. It never matches a catalog owner, even for the root workspace `.` or when every known consumer is
   excluded. A shared physical catalog remains eligible until explicitly excluded.
4. A catalog exclusion binds to at least one physical `RepositoryCatalog`. After binding, reserved
   internal rules target each exact physical catalog ID, its owner occurrences, and only consumers
   linked to that ID. An unresolved or ambiguous same-name consumer is not silently converted into a
   successful exclusion, and a direct dependency with the same dependency name remains eligible.
5. If the same catalog name has several observable physical owners, all are excluded and the receipt
   reports every matched physical identity/count. Filename or enumeration order never chooses one.
6. Workspace and catalog exclusions compose. All matched reserved rule IDs remain in traces, the
   final action is excluded, and the independent configured/CLI mode winner remains unchanged.
7. The generated rules are the final action-only rules in the CLI source layer and use deterministic
   reserved `$cli:exclude-workspace:*` and `$cli:exclude-catalog:*` IDs. User-provided public IDs
   cannot collide with them. They do not replace configured `policyRules` or dependency filters.
8. No exclusion grants file, process, manager, install, verification, network, or global authority.
   `src/invocation-authority.ts` remains the complete side-effect boundary.

The physical catalog-ID predicate is internal to reserved invocation rules. It must not be added to
the public advanced selector vocabulary without a separate design for identity stability and
portable configuration. Catalog binding occurs after the repository model exists; do not attempt to
represent this guarantee with a name-only public rule.

### Fail-closed binding and receipts

Each requested workspace must bind to a modeled package; each requested catalog must bind to a
physical modeled catalog, not only an unresolved consumer string. Bind after deterministic repository
inspection but before registry requests, plan operations, interactive selection, or writes.

Invalid input or a target that cannot be authoritatively proven returns exit `2` with a sanitized
stable `SELECTION_TARGET_UNPROVEN` error. An ignored, unreadable, outside-boundary, ambiguous-only,
or missing target never becomes a successful no-op. A proven workspace or catalog with zero
dependency entries is valid and reports zero excluded occurrences. Existing unresolved/ambiguous
catalog diagnostics and risks remain visible; exclusions never suppress them.

After binding, table output emits one durable line before resolution, for example:

```text
Exclusions: 2 workspaces · 1 catalog · 34 occurrences
```

When excluded workspace consumers still reference an eligible shared owner, add one concise
sanitized note explaining that the catalog remains eligible and requires `--exclude-catalog`; do
not list every dependency by default. Progress must suspend around durable output and never redraw
over the receipt.

Compatibility JSON gains an additive selection receipt with exact requested identities, matched
workspace/catalog counts, excluded occurrence count, and the count of shared catalog owners left
eligible. It must not trust caller-supplied counts or expose absolute paths, raw errors, secrets, or
stacks.

The fingerprinted machine-plan receipt ships in a new `depfresh.plan` schema version 2 and
`depfresh/schemas/plan-v2.json`; the strict published v1 schema and bytes remain unchanged. Current
planning emits v2. Apply dispatches by contract/schema version, continues to validate and apply
reviewed v1 plans without reinterpretation, and validates v2 receipt/entity/decision bindings before
using the existing stale-safe engine. Plan fingerprints are computed with the matching versioned
semantic shape.

Machine discovery similarly moves to `depfresh.capabilities` schema version 2 and
`depfresh/schemas/capabilities-v2.json`, with structured flag metadata for `repeatable: true`, exact
literal matching, and `check`/`plan` command scope. Keep the v1 schema artifact/export unchanged for
old consumers. Capabilities v2 advertises plan v2 as current, plan v1/apply compatibility, every
current schema path, and the unchanged error/apply/inspect versions. The official Action and
packaged workflow must dispatch through the exact installed validators rather than assuming v1.

## Rejected approaches

1. **Map the feature to `--ignore-paths`.** Rejected because discovery omission removes evidence and
   cannot safely express shared physical catalog ownership.
2. **Automatically cascade a workspace exclusion into catalogs used by that workspace.** Rejected
   because ownership may be shared and the result would change when consumers change. Explicit
   catalog intent is deterministic.
3. **Expose one `--exclude-target workspace:...` flag.** Rejected for weaker help, completion,
   quoting, validation, and error messages.
4. **Expose raw `--policy-rule '<JSON>'`.** Rejected as the primary human UX because shell quoting and
   expert policy vocabulary obscure the common action.
5. **Add top-level config arrays mirroring the flags.** Deferred because persistent and patterned
   selection already has `policyRules`; duplicating it creates another precedence contract.
6. **Use native/Expo heuristics or defaults.** Rejected because the repository model already has the
   correct generic identities and application frameworks do not grant selection authority.

## Global constraints

- Keep version `2.0.0`, Node `>=24.15.0`, ESM-only output, the pinned pnpm version, and existing
  dependency ranges. Do not release, publish, tag, push, or create a branch/worktree in this plan.
- Preserve formatting, containment, cache fallback, exit codes outside the new invalid-input case,
  Git state, catalog owner/consumer separation, immutable apply, and unknown-never-success behavior.
- Never use the real user cache. Use disposable HOME/cache/store directories for every integration
  and package proof.
- Keep existing advanced `policyRules` semantics and public library calls compatible. Do not add a
  second policy evaluator or change discovery semantics.
- Sanitize and bound every user/repository value shown in a terminal or error. Do not expose stacks,
  absolute repository paths, secrets, or raw hostile text.
- Use arbitrary fixtures such as `apps/admin`, `apps/worker`, `packages/shared`, `payments`, and
  `legacy`. Native/Expo may appear only as a secondary example, never as product semantics.
- Preserve historical changelog and `docs/releases/v2.0.0.md` evidence. Record implementation only
  under `Unreleased`; do not rewrite the published release.

## Owned files

- CLI parsing and routing: `src/cli/args-schema.ts`, `src/cli/raw-args.ts`,
  `src/cli/normalize-args.ts`, `src/cli/machine-commands.ts`, `src/cli/index.ts`, and a focused new
  internal scope-exclusion parser/binder if needed
- policy integration: `src/config.ts`, `src/policy/compiler.ts`, `src/policy/repository.ts`, and
  internal/public policy types only where required for reserved invocation rules
- repository/check/plan receipts: `src/repository/inspect.ts`, `src/io/packages/discovery.ts`,
  `src/commands/check/run-check.ts`, `src/commands/check/json-output.ts`,
  `src/commands/plan/index.ts`, `src/errors.ts`, and focused render/progress helpers
- capabilities/contracts: `src/cli/capabilities.ts`, versioned capabilities schema modules, plan v2
  plus preserved plan v1 schema/types/semantic validators, legacy JSON types, generated schema
  artifacts, package exports, and exact-version Action/workflow validator dispatch
- focused colocated tests plus `test/wun-demo-proof.mjs`, practical CLI/package/official-workflow
  regressions, and shipped examples under `skills/depfresh/`
- current `README.md`, CLI/config/workspace/API/agent docs, `AGENTS.md`, `CHANGELOG.md`, this plan,
  `plans/README.md`, and the tracked progress record

Manager execution, artifact verification, cache storage, resolution candidates, interactive TUI
selection design, repository discovery ignores, new config aliases, new dependency protocols, and
published v2.0.0 release records are out of scope.

## Requirement-to-code/test map

| Requirement | Implementation owner | RED/proof owner |
| --- | --- | --- |
| repeatable exact flags | CLI schema/raw parser/scope parser | raw argv, normalization, help tests |
| CLI-final reserved action rules | config/policy compiler | layer precedence and trace tests |
| workspace never selects owners | policy shortcut compiler | root/co-located and shared-owner tests |
| catalog binds physical IDs only | repository binder/internal policy | unresolved/ambiguous/multi-owner tests |
| zero-match/unavailable is exit 2 | repository binder/errors | no-registry/no-write subprocess tests |
| observable truthful receipt | check JSON/render and plan v2 | progress, JSON, schema-forgery tests |
| versioned contract compatibility | plan/capabilities v2 and apply dispatch | unchanged v1 artifact/apply tests |
| immutable plan/apply boundary | plan and CLI command safety | plan/apply operation and rejection tests |
| generic public documentation | README/docs/skill examples | built help/capabilities/docs command replay |
| packed-product behavior | WUN-shaped demo and smoke | built/tarball cold/warm Git-immutable proof |

## Implementation tasks

1. **Characterize the current boundary and retain RED evidence.** Start with status/diff inspection.
   Add failing raw-argv, help/capabilities, normalization, command-matrix, config-precedence,
   repository-policy, check, plan, write, JSON, and packaged-demo tests before production changes.
2. **Implement a strict invocation parser.** Make only the two new options repeatable; preserve
   singleton conflict behavior for every existing flag. Canonicalize workspace paths, validate safe
   catalog text, deduplicate first-seen exact values, retain comma-containing identities, and reject
   malformed/hostile values without echoing secrets.
3. **Bind intent to repository truth before work.** Resolve workspace requests against canonical
   modeled packages and catalog requests against physical catalog entities. Reject every target
   unproven during inspection/binding before cache/registry/process/write work. Retain all physical
   catalog matches, all unavailable/ambiguous diagnostics, and stable source identities.
4. **Compile reserved rules through the existing policy engine.** Feed a non-config invocation
   selection object into the CLI policy layer after binding. Generate anchored exact workspace role
   rules and internal catalog-ID owner/linked-consumer rules in deterministic order after all other
   CLI action inputs. Keep public `policyRules`, selector vocabulary, library calls, source
   provenance, mode winners, and authority unchanged.
5. **Add truthful receipts.** Compute counts from the final model and decisions, not input. Render
   one progress-safe human summary and the shared-owner note. Add bounded additive compatibility JSON
   and fingerprinted plan v2 receipts. Add capabilities v2 structured flag metadata, preserve v1
   schema artifacts, dispatch old/new plans safely in apply, and add forgery tests so counts, IDs,
   decisions, and operations cannot disagree.
6. **Prove writes and immutable apply.** In a sanitized pnpm/Bun/Yarn fixture, show that workspace-only
   exclusions leave shared/default/named catalog owners eligible, catalog exclusions remove every
   matching physical owner operation, direct same-name declarations remain eligible, excluded files
   stay byte-identical, and apply accepts only selection already fingerprinted in the plan.
7. **Replace the native-centric product framing.** Lead current docs and shipped examples with
   arbitrary workspace/catalog commands. Add a decision guide for dependency filter vs discovery
   ignore vs workspace exclusion vs catalog exclusion, explain root/default/shared ownership, and
   retain native/Expo only as an optional example.
8. **Run all gates and independent review.** Replay focused suites three times, dependency
   regressions, full tests, build, smoke, demo, exact Node/package/cache/Git gates, and strict
   formatting. Fix every validated review finding with RED/GREEN evidence, re-review until
   `APPROVED`, record exact results/limitations, mark DONE, and commit without a version bump.

## Adversarial acceptance matrix

- Exclude one of two workspaces consuming a shared catalog: its direct/consumer occurrences skip;
  the owner and the other workspace remain eligible.
- Exclude every consumer but not the catalog: the physical owner still remains eligible.
- Exclude catalog `payments`: every physical `payments` owner and linked consumer skips; direct
  dependencies with the same package names remain eligible.
- Exclude root workspace `.`: co-located default and named catalog owners remain eligible.
- Exclude workspace and catalog together: overlapping rule traces are deterministic and counts do
  not double-count occurrences.
- Cover default and arbitrary named catalogs for pnpm, Bun, and Yarn, including dotted, spaced,
  comma-containing, Unicode, and hostile terminal text.
- Cover several physical catalogs with the same name without selecting by enumeration order;
  exclude each proven owner and linked consumer while unresolved same-name consumers retain their
  incomplete diagnostic/status.
- A configured include or mode followed by CLI exclusion leaves the CLI action as winner and the
  independent mode trace intact.
- Missing, ignored, unreadable, nested-boundary, outside-root, unresolved-consumer-only, malformed,
  and targets removed before or during binding fail before registry access and writes. A target that
  disappears after successful binding is caught by existing stale-safe plan/write preconditions and
  never becomes a successful mutation; the plan does not claim to eliminate every TOCTOU interval.
- Empty proven workspaces/catalogs succeed with a zero-occurrence receipt; unknown targets do not.
- Duplicate/repeated flags retain order, existing singleton conflicts remain errors, and exact
  punctuation never becomes regex.
- Normal table/JSON check and machine plan agree; inspect/apply/global reject the flags; globals and
  library-only policy behavior remain unchanged.
- Non-TTY, redirected, narrow, dumb, NO_COLOR, interrupted, and error paths leave no cursor damage or
  raw stack/secret leakage.

## Verification gates

Use only disposable HOME/cache/store directories. Record commands, exact counts, timings, artifact
size/integrity, and limitations in the completion record.

1. `git status --short`, staged/unstaged diff inspection, dependency-plan DONE checks, and owned-file
   overlap audit before editing and before completion.
2. `pnpm install --frozen-lockfile` under the pinned pnpm version with an isolated store.
3. Schema generation/check, `pnpm typecheck`, `pnpm lint`, and strict zero-warning Biome.
4. Raw CLI, config/policy, repository, check/render/JSON, machine plan/apply, capabilities/schema,
   package-assets, official-workflow, and demo focused suites three consecutive times.
5. Dependency regressions for Plans 017-019, 024, 026, and 027; then all tests with coverage.
6. `pnpm build`, practical smoke, sanitized demo, dist inspection, and `npm pack --dry-run --json`.
7. Exact Node `24.15.0` focused tests plus built CLI/library/capabilities/schema probes.
8. Exact npm `11.12.x` isolated tarball install and package verifier; built and packed commands for
   workspace-only, catalog-only, combined, malformed, and missing-target cases.
9. Temporary-HOME cold/warm cache probe proving excluded occurrences cause no registry requests and
   the real user cache is untouched.
10. Relevant Git status/index/file hash immutability before and after read-only checks/plans and
    failed inputs; `git diff --check`.
11. Independent full-diff code/security/UX/docs review by an agent that did not implement the plan;
    reproduce edge cases and require final `APPROVED` with no validated findings.

## STOP conditions

Stop and amend this plan before implementation broadens scope if:

- a workspace shortcut cannot exclude direct/consumer occurrences without also matching a physical
  catalog owner;
- binding a target would require filename/enumeration-order choice or guessing across unavailable
  evidence;
- an unmatched target, or a removal/unavailability observed during inspection or binding, can reach
  registry, interactive, plan-operation, or write work;
- the shortcut would need configuration or selection to grant side-effect authority;
- a receipt cannot be semantically bound to exact repository entities and decisions;
- compatibility requires changing existing advanced policy, discovery, apply, JSON exit, or library
  semantics rather than adding the bounded invocation feature;
- implementation would rewrite historical v2.0.0 release truth or require a version bump/release.

## Done criteria

- Both exact repeatable flags work through source, built, and packed normal check/write and plan CLI.
- Current plan/capabilities documents use new strict v2 schemas; published v1 schema artifacts remain
  byte-stable and apply continues to accept valid reviewed plan v1 documents.
- Every requested target is proven before network or mutation, and every receipt is derived and
  validator-bound; unknown never appears as success.
- Workspace exclusion never freezes a physical catalog owner. Catalog exclusion covers all matching
  physical owners and their linked consumers without affecting direct or unresolved declarations.
- Help, capabilities, README, current docs, shipped skills/examples, and arbitrary fixtures describe
  the same generic syntax and ownership behavior.
- Exact Node, full repository, package, cache, security, Git immutability, and documentation gates
  pass; independent review returns `APPROVED`.
- `AGENTS.md`, `CHANGELOG.md` Unreleased, this completion record, the plan ledger, and tracked progress
  truth are current. Version remains `2.0.0`, and the implementation is committed without any push,
  tag, publish, release, branch/worktree, or PR action.

## Completion record

Pending implementation.

The planning audit completed on 2026-07-17. Three independent read-only audits agreed on the two
exact invocation shortcuts, fail-closed target binding, explicit shared-catalog ownership, generic
documentation, and end-to-end proof. Final adversarial review identified two Important contract
gaps before execution: mutating strict v1 schemas in place and matching unresolved consumers by
catalog name alone. The plan now requires versioned plan/capabilities v2 contracts with unchanged v1
artifacts/apply compatibility and internal physical catalog-ID binding. A separate semantic review
narrowed concurrent-removal claims to observable binding plus existing stale-safe mutation checks.
Both reviewers re-reviewed the amended full plan and returned `APPROVED` with no remaining Critical
or Important findings.
