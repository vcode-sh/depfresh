# VCS Write Trust Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the large-repository Git buffer failure, preserve its exact preflight cause, and
replace repeated misleading write warnings with one truthful physical-target receipt.

**Architecture:** Restrict tracked-file Git probes to contained exact targets in bounded no-shell
batches, then carry repository diagnostics beside legacy write outcomes without changing the
legacy JSON envelope. A pure receipt builder groups non-success outcomes by physical target and
phase before the current table logger renders them.

**Tech Stack:** TypeScript, Node `24.15.0`, Git CLI, Vitest, Biome, pnpm `10.33.0`.

## Global Constraints

- All code, documentation, plans, and commit messages are English.
- Keep package version `2.0.1`; Plan 031 owns the `2.0.2` release candidate.
- Keep Node `>=24.15.0`, ESM-only output, pnpm `10.33.0`, and all current runtime dependencies.
- Preserve the fixed Git executable, argument arrays, disabled optional locks, sanitized Git
  environment, repository containment, read-only VCS behavior, and unknown-never-success rule.
- Do not enumerate the complete tracked index to classify a small exact target set.
- Do not claim command-level preflight or zero partial-write risk; Plan 033 owns that migration.
- Keep the legacy check JSON envelope and schema version unchanged. `VCS_UNAVAILABLE` is an
  additive stable `WriteOutcomeReason`; narrower repository diagnostics remain internal to human
  rendering and debug evidence.
- Never expose raw Git stdout/stderr, absolute paths, secrets, control bytes, or stacks.
- Do not stage, commit, push, publish, tag, or create a branch/worktree unless the active executor
  receives separate authority.

## Drift Check and Stop Conditions

Before editing, run `git status --short`, re-read this plan and the approved design, and inspect
`git diff --stat 75910f2..HEAD -- src/repository src/commands/apply src/commands/check src/types`.
Stop for maintainer direction if owned files contain unrelated concurrent edits, exact-target Git
queries cannot preserve a current target state, the hotfix requires a breaking JSON/schema change,
or a grouped receipt cannot distinguish preflight from attempted mutation.

---

### Task 1: Exact-target tracked-file evidence

**Files:**

- Modify: `src/types/repository.ts`
- Modify: `src/repository/vcs.ts`
- Modify: `src/repository/vcs.test.ts`
- Modify: `src/contracts/schemas.test.ts` only if the derived diagnostic enum is asserted there

**Interfaces:**

- Consumes: `collectVcsEvidence(root, targetPaths, options)` and repository-relative exact targets.
- Produces: additive `RepositoryDiagnosticCode = 'VCS_OUTPUT_LIMIT_EXCEEDED'` and bounded exact
  tracked-target classification.

- [x] **Step 1: Write failing oversized-index and hostile-target tests**

Add tests that create more than 1 MiB of tracked path output, request only `package.json`, and
assert confirmed clean evidence. Add literal targets named `-dash.json`, `:(glob)*.json`, a Unicode
name, and a name containing a newline; assert only the requested files are classified.

```ts
const evidence = collectVcsEvidence(root, ['package.json'])
expect(evidence).toMatchObject({
  status: 'confirmed',
  targetFiles: [{ path: 'package.json', state: 'clean' }],
})
expect(readFileSync(join(root, '.git', 'index'))).toEqual(indexBefore)
```

- [x] **Step 2: Run the focused RED tests**

Run: `pnpm exec vitest run src/repository/vcs.test.ts`

Expected: FAIL because the current unscoped `git ls-files` reaches `ENOBUFS` and hostile pathspecs
are not yet passed literally.

- [x] **Step 3: Add the diagnostic and bounded batch result types**

In `src/types/repository.ts`, add `VCS_OUTPUT_LIMIT_EXCEEDED`. In `src/repository/vcs.ts`, keep the
types private and explicit:

```ts
type TrackedTargetResult =
  | { ok: true; paths: Set<string> }
  | { ok: false; code: 'VCS_EXECUTABLE_MISSING' | 'VCS_OUTPUT_LIMIT_EXCEEDED' | 'VCS_PROBE_FAILED' }

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024
const MAX_GIT_ARGUMENT_BYTES = 64 * 1024
```

The argument-byte limit is a deterministic internal bound below common process argument limits;
tests must prove splitting, not rely on platform failure.

- [x] **Step 4: Implement literal exact-target batches**

Change `collectTrackedTargets` to accept `targetPaths`, convert each contained path to a Git-root
relative literal pathspec, split batches by UTF-8 byte length, and run:

```ts
spawnSync(binary, [...common, 'ls-files', '-z', '--cached', '--full-name', '--', ...batch], {
  cwd: root,
  env,
  encoding: 'buffer',
  maxBuffer: MAX_GIT_OUTPUT_BYTES,
})
```

Use Git literal pathspec magic for metacharacter-bearing names rather than escaping by guesswork.
Classify `error.code === 'ENOBUFS'` as `VCS_OUTPUT_LIMIT_EXCEEDED`; merge successful batch sets and
return the exact failure code otherwise. An empty target set returns an empty confirmed set without
starting Git.

- [x] **Step 5: Preserve every current target state**

Retain the existing porcelain status and ignore probes so clean, staged, unstaged,
staged-plus-unstaged, added, deleted, renamed, conflicted, untracked, and ignored targets keep their
current semantics. Propagate `TrackedTargetResult.code` through `unavailableVcs()`.

- [x] **Step 6: Run GREEN and immutability tests**

Run:

```bash
pnpm exec vitest run src/repository/vcs.test.ts src/repository/inspect.test.ts
pnpm typecheck
pnpm exec biome check src/types/repository.ts src/repository/vcs.ts src/repository/vcs.test.ts
```

Expected: all tests pass, typecheck exits `0`, Biome reports no errors or warnings, and the tests
prove identical Git index/worktree bytes before and after collection.

### Task 2: Preserve VCS preflight causes through legacy apply

**Files:**

- Modify: `src/types/write.ts`
- Modify: `src/commands/apply/legacy.ts`
- Modify: `src/commands/check/write-flow.ts`
- Modify: `src/commands/check/test-helpers.ts`
- Modify: `src/commands/apply/index.test.ts`
- Modify: `src/commands/check/write-flow.observed.test.ts`
- Modify: `src/commands/check/check.write-outcomes.test.ts`

**Interfaces:**

- Consumes: `ApplyResult.operations`, `PlanResult.repository.vcs.diagnostics`, and current
  `PackageWriteResult`.
- Produces: `LegacyPackageApplyResult`, additive `VCS_UNAVAILABLE`, and sanitized internal
  diagnostics for the human receipt.

- [x] **Step 1: Write failing reason-preservation tests**

Force plan VCS evidence to unavailable with `VCS_OUTPUT_LIMIT_EXCEEDED`. Assert the compatibility
outcome remains unknown with `VCS_UNAVAILABLE`, not `WRITE_FAILED`, and the internal result retains
the narrower diagnostic.

```ts
expect(result.outcomes[0]).toMatchObject({ status: 'unknown', reason: 'VCS_UNAVAILABLE' })
expect(result.diagnostics).toEqual([
  { code: 'VCS_OUTPUT_LIMIT_EXCEEDED', path: 'package.json' },
])
```

- [x] **Step 2: Run the focused RED tests**

Run:

```bash
pnpm exec vitest run src/commands/apply/index.test.ts \
  src/commands/check/write-flow.observed.test.ts \
  src/commands/check/check.write-outcomes.test.ts
```

Expected: FAIL because `toLegacyReason()` currently maps `VCS_UNAVAILABLE` to `WRITE_FAILED` and
the legacy return value has no diagnostics.

- [x] **Step 3: Add exact internal result interfaces**

Add `VCS_UNAVAILABLE` to `WriteOutcomeReason`. Define the internal result beside the legacy adapter:

```ts
export interface LegacyWriteDiagnostic {
  code: RepositoryDiagnosticCode
  path: string
}

export interface LegacyPackageApplyResult {
  outcomes: WriteOutcome[]
  diagnostics: LegacyWriteDiagnostic[]
}
```

Change `applyLegacyPackageWrite()` to return `Promise<LegacyPackageApplyResult>`. Add the diagnostic
array to `PackageWriteResult`, but do not copy it into `LegacyCheckJsonResult`.

- [x] **Step 4: Map the apply reason without collapsing it**

Include `VCS_UNAVAILABLE` in `toLegacyReason()` and copy only allow-listed, sanitized plan VCS
diagnostics into the internal result. Keep operation status `unknown` and do not reinterpret it as
failed, skipped, or success.

- [x] **Step 5: Run GREEN compatibility tests**

Run the three focused files from Step 2 plus:

```bash
pnpm exec vitest run src/commands/check/check.json-output.test.ts \
  src/commands/check/json-output.compatibility.test.ts \
  src/commands/check/check.core-flow.test.ts
pnpm typecheck
```

Expected: all pass; JSON keeps its existing top-level keys and includes the additive
`reason: "VCS_UNAVAILABLE"` only when that outcome occurs.

### Task 3: Grouped physical-target write receipt

**Files:**

- Create: `src/commands/check/write-receipt.ts`
- Create: `src/commands/check/write-receipt.test.ts`
- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/check.write-outcomes.test.ts`
- Modify: `src/commands/check/check.global-write.test.ts`
- Modify: `test/practical-cli-smoke.mjs`
- Modify: `test/release-readiness.test.ts`
- Modify: `docs/output-formats/table.md`
- Modify: `docs/output-formats/json.md`
- Modify: `docs/troubleshooting.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: all accumulated `WriteOutcome[]` and internal `LegacyWriteDiagnostic[]`.
- Produces: `buildWriteReceipt(input): WriteReceipt` grouped by repository-relative physical file,
  status, and reason.

- [x] **Step 1: Write failing pure receipt tests**

Cover 41 unknown operations for one file, 35 applied operations across 13 other files, a clean
preflight block, hostile terminal text, and pluralization.

```ts
const receipt = buildWriteReceipt({ outcomes, diagnostics, cwd: root })
expect(receipt.verdict).toBe('partial')
expect(receipt.files).toMatchObject({ applied: 13, blocked: 1 })
expect(receipt.groups).toHaveLength(1)
expect(receipt.groups[0]).toMatchObject({
  file: 'package.json',
  occurrences: 41,
  reason: 'VCS_UNAVAILABLE',
  replacementAttempted: false,
})
```

- [x] **Step 2: Run the receipt RED test**

Run: `pnpm exec vitest run src/commands/check/write-receipt.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the pure grouped model**

Define `WriteReceiptVerdict = 'complete' | 'partial' | 'safety-block' | 'failed' | 'unknown'` and
derive operation totals with `summarizeWriteOutcomes()`. Convert absolute occurrence files to safe
repository-relative display paths only when contained; sanitize every label. Keep occurrence
details in the model, but render one primary group per physical cause.

- [x] **Step 4: Replace per-occurrence warnings**

Remove the warning loop in `run-check.ts`. At finalization, render one receipt group per non-success
physical target, then exact totals. For the shipped 2.0.x partial path, use copy equivalent to:

```text
Partial result · 35 updates applied across 13 files; 1 file blocked
package.json · 41 updates not attempted
Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_OUTPUT_LIMIT_EXCEEDED)
Exit 2 · inspect the changed files, fix the Git evidence problem, then rerun
```

Use `Safety block · no files were changed` only when zero outcomes are applied/reverted and every
blocked group proves replacement was not attempted.

- [x] **Step 5: Run renderer and exit-code GREEN tests**

Run:

```bash
pnpm exec vitest run src/commands/check/write-receipt.test.ts \
  src/commands/check/check.write-outcomes.test.ts \
  src/commands/check/check.json-output.test.ts \
  src/commands/check/run-check.orchestration.test.ts \
  test/release-readiness.test.ts
```

Expected: all pass; one physical warning replaces 41 duplicates; exit remains `2`; JSON remains
parseable and complete.

- [x] **Step 6: Document exact patch semantics**

Document `applied`, `failed`, `unknown`, `VCS_UNAVAILABLE`, partial 2.0.x behavior, exit `2`, and
the safe instruction to inspect changed files before rerunning. Add the fix under `Unreleased`
without editing published `2.0.0` or `2.0.1` release records.

### Task 4: Hotfix verification gate

**Files:**

- Verify: all Plan 030 source, tests, docs, generated contracts, and package contents
- Create: `scripts/verify-local-package.mjs`
- Modify: `scripts/verify-packed-package.mjs`
- Modify: `package.json`
- Modify: `test/release-readiness.test.ts`
- Create: `test/verify-local-package.test.ts`
- Modify: `plans/030-vcs-write-trust-hotfix.md` with exact completion evidence only after proof
- Modify: `plans/README.md` and `.superpowers/sdd/progress.md` only when marking the plan done

**Interfaces:**

- Consumes: Tasks 1-3.
- Produces: a reviewed `2.0.1`-version implementation eligible for Plan 031 release preparation.

- [x] **Step 1: Run focused proof three times**

Run the VCS, apply legacy, write-flow, receipt, JSON, orchestration, render-overflow, and progress
test files plus global-write, local package-verifier timeout/cleanup, and release-readiness three
consecutive times. Build once, then run only the named built-CLI pipe-receipt journey three times
through the practical-smoke focused selector. The complete practical smoke, including its
intentionally fail-closed global process supervision, runs once in Step 2. Expected: every focused
run exits `0` with identical test or journey counts.

- [x] **Step 2: Run complete local gates**

```bash
pnpm schemas:check
pnpm typecheck
pnpm lint
pnpm test:run --coverage
pnpm build
pnpm test:smoke
pnpm test:demo
pnpm verify:package
```

Expected: every command exits `0`; Biome has zero warnings; coverage meets repository thresholds;
the packed verifier reports no missing or unexpected contract files. `pnpm verify:package` must
self-pack into a disposable directory, call the existing exact-manifest verifier, and remove only
its own temporary files; hosted CI and release workflows retain their explicit `artifacts/pack.json`
path.

- [x] **Step 3: Reproduce the original boundary with the built CLI**

Use a disposable Git repository whose full tracked index exceeds 1,250,160 bytes, run the built CLI
against one exact root target, and assert no `ENOBUFS`, no `Write unknown (WRITE_FAILED)`, no Git
mutation, and the expected write/result state.

- [x] **Step 4: Review and close only with evidence**

Require one read-only reviewer for code/correctness and one for docs/terminal copy. Record exact
commands, counts, and remaining 2.0.x package-by-package limitation. Do not bump the version or
publish in this plan.

- [x] **Step 5: Close final human-truth review regressions**

Write RED tests proving that global non-success items retain sanitized manager, package, status,
and exact global reason in a separate stdout section without physical-file or atomicity language.
Also combine a VCS-only local safety block with strict resolution failure and prove that the final
guidance does not claim Git is the only blocker. Implement structured final-exit causes for receipt
formatting, render global non-success details separately from the local physical-target receipt,
then rerun the focused receipt/global/JSON/orchestration tests and both independent reviews.

The local package verifier continues to target the repository's required Node/Linux/macOS release
environment. Direct `npm.cmd` execution with `shell: false` remains an explicitly non-blocking
Windows portability follow-up; do not weaken no-shell process execution in this hotfix.

## Completion Evidence

Plan 030 completed on 2026-07-18 at `0c8594a`. Focused source proof ran the same 15 files and 197
tests three times, and the built pipe-receipt selector ran its single check and request three times.
The complete gates passed: schemas, typecheck, Biome over 309 files, 143 coverage files with 1,553
tests, build, the full 34-check/63-request smoke, 14-check demo, and the exact 56-file local package
verification. The disposable oversized-index replay produced 1,368,035 tracked bytes across 18,003
files while the exact root target applied successfully, the Git index stayed byte-identical, and
neither `ENOBUFS` nor `WRITE_FAILED` appeared.

Two independent final re-reviews approved the code and docs/terminal contract with no findings.
Their fresh code proof passed six files and 50 tests, typecheck, all-file Biome, and diff checks.
The final review fixes preserve every pre-execution and executor global blocker in one sanitized
stdout detail block and keep multi-cause guidance position-neutral without changing JSON or schema
bytes.

The package remains `2.0.1`; Plan 031 owns the `2.0.2` candidate and publication. Normal 2.0.x
writes still apply package-by-package, so an earlier package can change before a later preflight
blocks. The fail-closed macOS global process-observation nondeterminism and the non-blocking Windows
`npm.cmd` local-verifier portability follow-up also remain explicit limitations.
