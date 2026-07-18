# Plan 033 Task 4 Report

## Scope

Task 4 proves command-level local apply across filesystem faults, recovery, and interruption. It
projects exact private command evidence into the human receipt without changing public JSON,
callback, schema, declaration, dependency, or version contracts.

## RED Evidence

The first focused run passed 217 of 222 tests. The failing cases exposed signal-fixture blocking,
incorrect mixed-result precedence after stale-later recovery, accidental private-evidence leakage
into JSON, incoherent late-preflight fixtures, and incomplete local recovery-path projection during
manager cleanup failure.

Adversarial review then found two additional fail-open edges. A stale-later conflict remap could
hide an unknown final observation and clean retained evidence, and a non-passed cleanup phase other
than `unknown` could still qualify for a no-files-changed safety receipt. Both now have direct
regressions.

## Implementation

- Local recovery reports exact restored and unrecovered repository-relative paths for attempted
  physical targets, including manager-phase failure paths.
- Completed recovery accepts only the narrow truthful stale-later matrix: at least one reverted
  operation plus structurally not-attempted `SOURCE_CHANGED`, `STAGED_SOURCE_CHANGED`, or
  `BACKUP_SOURCE_CHANGED` conflicts, backed by a matching failed commit and passed recovery,
  inspection, and cleanup phases. Applied, skipped, unknown, attempted-conflict,
  arbitrary-conflict, missing-phase, and conflict-only results remain invalid.
- Unknown final observations are never remapped to precondition conflicts. Their lock, relative
  journal, backup, and recovery evidence remains retained.
- Human receipts reconcile private apply operations and structural attempts by contained physical
  file plus occurrence path. Missing, duplicate, empty, outside-repository, or mismatched evidence
  fails closed.
- `Safety block · no files were changed` requires zero applied and reverted outcomes, every
  blocking operation proven not attempted, and no recovery, retained artifact, external effect, or
  non-passed cleanup uncertainty.
- Private evidence is created only for table output. Public JSON and callback outcomes retain their
  existing projection and redaction contracts.
- The practical CLI smoke fixture uses three recursively discovered manifests. A late Git
  preflight failure leaves all target SHA-256 hashes unchanged; a fresh run observes every requested
  value.
- Signal proof combines an operating-system SIGTERM exit-143 test with an exact after-replacement
  checkpoint. A second authoritative invocation returns `RECOVERY_REQUIRED`, exit 2, and leaves
  the retained evidence and target bytes unchanged.
- Documentation now states that preflight covers every selected target before replacement, each
  file rename is atomic, the repository is not an atomic transaction, recovery is best effort, and
  incomplete observation is unknown.

## Verification

- Task 4 focused matrix: 13 suites, 227 tests passed, `success=true`.
- Command check suite: 46 files, 517 tests passed.
- Command apply integration: 10 tests passed, including the two-invocation signal proof.
- Final-observation race regression: passed with an unknown result and retained lock/journal.
- Full practical CLI smoke: 35 checks passed with 69 registry requests.
- `pnpm typecheck`: passed.
- Focused Biome check: passed with no fixes.
- `pnpm build`: schema check and build passed.
- `git diff --check`: passed.
- Built `index.d.mts`, `index.d.ts`, `cli.d.mts`, and `cli.d.ts` match the freshly packed public npm
  2.0.2 artifact byte for byte.

## Review

Independent adversarial review identified and verified fixes for local recovery path loss, final
observation conflict masking, non-passed cleanup uncertainty, declaration-bundler traversal drift,
and an impossible receipt example. The final review snapshot contains all corrections.

Completed recovery with a selected no-change or skipped operation remains rejected by design. Any
future relaxation requires a separate public apply-contract decision and is outside Task 4.
