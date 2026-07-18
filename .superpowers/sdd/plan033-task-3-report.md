# Plan 033 Task 3 Report

## Scope

Task 3 makes the command-level local apply adapter authoritative for legacy `check --write`.
The implementation prepares all packages before mutation, performs at most one local command apply,
projects the command result back to package callbacks in deterministic package order, and gates
post-write actions on the complete local and global result.

## RED Evidence

The retained 14-target fixture selected 76 operations and made the final target's read-only Git
evidence unavailable. Before the orchestration change, the package-level writer changed the first
13 target files, returned 71 applied operations and 5 unknown operations, and never invoked the
command adapter. This demonstrated that late preflight failure could occur after earlier targets
had already changed.

The final regression asserts that the command adapter is invoked once, the result contains 76
unknown and 76 structurally not-attempted operations, the command exits with code 2, no post-write
manager starts, and every target remains byte-identical.

## Implementation

- All package resolution and write preparation completes before the first local mutation.
- One `applyLegacyCommandWrite()` invocation owns every approved local selection; the old physical
  package writer is retained only as a separately mocked compatibility surface.
- Fifteen logical owner groups reconcile into one plan and 14 unique physical targets. Package
  results and lifecycle callbacks are projected in original package order.
- Returned blocked, failed, or unknown local results do not suppress separately authorized global
  requests. A thrown local adapter does suppress them because no coherent local result exists.
- Model events are derived from the exact apply result, including authentic protocol/catalog
  values, exact attempt evidence, mixed physical-target outcomes, recovery journal and path facts,
  and external effects.
- Zero-mutation lock, stage, and precommit exits do not invent recovery or observation. Selected
  all-no-change results require their real final inspection before completion.
- Unreconciled or uncontained blocked projections fail closed with
  `CHECK_RUN_SELECTION_UNBOUND` before selection/results.
- Model projection errors remain primary while all prepared package completions are still attempted.
  When projection succeeds, the first package-order completion error remains primary.
- Install, update, execute, and verification phases require existing authority, an observed local
  or global write, and no conflicted, failed, or unknown outcome.

## Verification

- `pnpm test:run`: 148 files, 1,744 tests passed.
- `pnpm exec vitest run src/commands/check --retry=0`: 45 files, 496 tests passed.
- Compatibility matrix for package preparation, observed write flow, run controller/model, and
  apply: 5 files, 200 tests passed.
- Focused callback/model/orchestration regressions: 3 files, 58 tests passed.
- `pnpm lint`: 318 files checked with no fixes.
- `pnpm typecheck`: passed.
- `pnpm build`: schema check and build passed.
- `git diff --check`: passed.

## Review

The first independent review found two Important gaps and one Minor test-fixture gap:

- incomplete zero-mutation phase coverage;
- model instrumentation failure could bypass mandatory package completion;
- protocol and shared-catalog projections were not represented by authentic physical values.

The implementation now covers the full zero-mutation matrix, retains the required error precedence
while completing every prepared package, and builds test projections with the real package/catalog
request and physical-value helpers. The stricter run model also rejects selected no-mutation
completion without fact-bearing final observation.

The final independent re-review reported no Critical, Important, or Minor findings. It confirmed
that the selected all-no-change bypasses are closed while zero-operation compatibility remains
intact, and that the phase matrix, cleanup precedence, package completion, and authentic
protocol/catalog projections are consistent.
