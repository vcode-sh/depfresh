# Plan 025: CI portability and ledger truth

## Contract

- **Priority**: P1
- **Effort**: S
- **Risk**: HIGH
- **Depends on**: 024
- **Opened at**: `6e8a208`, 2026-07-16
- **Status**: DONE

## Objective

Restore trustworthy release status after the first post-preparation Linux push exposed seven test
failures. Make the numbered plan ledger version-controlled, replace the stale tracked progress
snapshot, run permission-sensitive tests on an explicitly unprivileged Linux runner, and keep the
large private-output test below operating-system argv limits without weakening its output-boundary
assertions.

## Evidence and root cause

- GitHub Actions run `29530434379`, job `87729177545`, failed 7 of 1,428 tests on exact Node
  `24.15.0`; lint passed and downstream build/distribution jobs were skipped.
- Six repository-evidence tests use mode `000` as the unavailable-input boundary. The push runner
  is root, so it can still read and traverse those paths; the tests did not create their stated
  precondition.
- The private verifier test embeds a 128 KiB value in one `node -e` argument. The resulting 131,281
  byte argument exceeds Linux `MAX_ARG_STRLEN` (131,072), so the process correctly fails closed as
  `PROCESS_START_FAILED` before output capture is exercised.
- `/plans/` was ignored by Git, while tracked `.superpowers/sdd/progress.md` incorrectly said the
  next task was Plan 020 after Plans 020-024 and release preparation were already committed.

## Global constraints

- Keep Node `24.15.0`, pnpm `10.33.0`, package version `2.0.0`, and all public runtime contracts.
- Do not weaken unavailable-evidence semantics or process-output bounds.
- CI tests that depend on Unix permission denial must state and enforce a non-root runner contract.
- Do not push, tag, publish, release, create a branch/worktree, or mutate hosted workflow state.
- All code, tests, documentation, plans, and commits are English.

## Owned files

- `.gitignore`, `plans/README.md`, `plans/025-ci-portability-ledger-truth.md`
- `.superpowers/sdd/progress.md`
- `.github/workflows/ci.yml`
- `test/release-readiness.test.ts`
- `src/commands/apply/process-runner.test.ts`
- `CHANGELOG.md`, `docs/releases/v2.0.0.md`, `.superpowers/sdd/release-2-preparation.md`

Production repository evidence and process-runner behavior are out of scope unless a new failing
test proves a production defect.

## Requirement-to-code/test map

| Requirement | Implementation owner | RED/proof owner |
| --- | --- | --- |
| tracked authoritative numbered plans | `.gitignore`, `plans/README.md` | `git check-ignore`, `git ls-files` |
| current progress snapshot | `.superpowers/sdd/progress.md` | commit/ledger audit |
| unprivileged permission boundary in CI | `.github/workflows/ci.yml` | `test/release-readiness.test.ts` |
| bounded output without oversized argv | `process-runner.test.ts` fixture | exact Linux focused suite |
| truthful release status | changelog and release draft | release readiness suite and docs review |

## Implementation tasks

1. Add a failing release-readiness assertion that the permission-sensitive test job uses an
   explicit hosted non-root runner for both push and pull-request events.
2. Change only the CI test job runner; retain exact Node, frozen installation, schema, Action,
   typecheck, zero-warning lint, coverage, and downstream job dependencies.
3. Retain the 128 KiB captured-output assertion but generate the value inside the child process so
   the test exercises output capture rather than the operating-system argv boundary.
4. Track the numbered plan ledger, correct the stale tracked progress snapshot, and document that
   release preparation needs a fresh green replay.
5. Run the focused tests three times on exact Node, reproduce them in exact-Node Linux as root and
   non-root where applicable, then run all repository, build, smoke, package, cache, Git
   immutability, and diff gates.
6. Obtain independent code/workflow/documentation approval, record exact evidence and limitations,
   mark DONE, and commit without changing the package version.

## Acceptance evidence

- Release-readiness rejects a root/self-hosted permission-sensitive test job.
- Exact Linux no longer fails before the private-output fixture starts.
- Permission-denial evidence is still exercised on a non-root Linux test job.
- Plans 009-025 and `plans/README.md` are tracked, and no tracked progress surface points to Plan
  020 as future work.
- Full exact-Node gates pass with zero warnings and the packed product remains version `2.0.0`.

## STOP conditions

Stop if hosted CI cannot provide the required exact Node runtime or if making the test portable
would require weakening production unavailable/unknown semantics. Preserve fail-closed behavior
and record the unsupported environment instead.

## Completion record

Completed on 2026-07-16 at package version `2.0.0`; the version was not changed.

### Delivered contract

- `/plans/` is no longer ignored. Plans 009-025 and the active queue are available for normal Git
  tracking, and `.superpowers/sdd/progress.md` records the actual Plan 020-024 and release commits.
- The full permission-sensitive CI test job now uses `ubuntu-latest` for pushes and pull requests.
  Exact Node, frozen install, schema generation, Action harness, typecheck, zero-warning lint,
  coverage, and downstream build/distribution dependencies are unchanged.
- The private verifier fixture still captures and compares exactly 128 KiB, isolates HOME/cache,
  strips the hostile environment secret, and parses private stdout/stderr. It now creates the
  payload inside the child, keeping the `node -e` argument below Linux's per-argument limit.
- The changelog, release draft, and internal preparation record preserve the historical local green
  evidence while stating that the first hosted push failed and a fresh hosted replay is required.

### RED/GREEN and platform evidence

- GitHub Actions run `29530434379` supplied the retained RED evidence: 6 unavailable-evidence
  assertions failed under root and the oversized verifier argv failed closed before spawn.
- The new release-readiness assertion failed with the conditional self-hosted runner expression,
  then passed after the test job was pinned to `ubuntu-latest`.
- The focused exact-Node loop passed three consecutive runs: 38 release/evidence tests plus the
  exact private verifier capture test in each run.
- Exact Node `24.15.0` in a Linux container with an init/reaper and an unprivileged user passed both
  focused files, 44/44 tests. The frozen pnpm `10.33.0` install added 209 packages from the exact
  lockfile. An independent root Linux replay passed all 12 process-runner tests.

### Repository and distribution gates

- Exact Node `24.15.0` passed typecheck, schema drift check, and strict Biome over 299 files with
  zero warnings; `git diff --check` passed.
- Full exact-Node coverage passed 137 files and 1,429 tests in 108.37 seconds: 86.84% statements,
  79.76% branches, 94.01% functions, and 89.25% lines.
- Build passed with seven schemas and 1.57 MB total `dist`. Practical built-CLI smoke passed 26
  checks and 49 mock-registry requests, including cold/warm isolated cache behavior.
- A real tarball and dry-run reported `depfresh@2.0.0`, 54 files, 261,710 packed bytes and
  1,598,785 unpacked bytes. The verification script passed every export, schema, CLI, and installed
  consumer assertion; plans and internal progress files were not packed.
- Independent workflow/code/documentation review returned `APPROVED` with no Critical or Important
  findings after the release-status wording correction.

### Remaining limitations

- No hosted run was started because push and workflow mutation are unauthorized. The next normal
  push must prove the hosted test, build, and distribution jobs before release readiness is current.
- Linux containers without an init/reaper can retain zombie process-group evidence; process
  supervision fails closed as unknown there. The exact-Node `--init` Linux replay passed, matching
  the normal hosted VM reaper model. This plan does not weaken process supervision semantics.
