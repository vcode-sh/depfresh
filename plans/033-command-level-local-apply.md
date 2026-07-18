# Command-level Local Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal local `-w` collect every selected occurrence and invoke one stale-safe apply
lifecycle that preflights all physical targets before the first replacement.

**Architecture:** Split package processing into preparation and completion. Preparation resolves,
renders current package data, performs interactive/addon selection, and records approved local
changes without mutation. A command adapter builds one immutable legacy-compatible plan, calls the
existing apply engine once, then projects exact outcomes back to package hooks and the run model.

**Tech Stack:** TypeScript, Node `24.15.0`, existing immutable plan/apply engine, Vitest, Biome,
pnpm `10.33.0`.

## Global Constraints

- All code, documentation, plans, and commit messages are English.
- Begin only after Plan 032 is complete and reviewed; keep package version `2.0.2`.
- Preserve per-file atomic replacement, root-local lock, relative journal, same-directory backup,
  stale checks before first replacement and each rename, final observation, and best-effort
  recovery. Never claim repository-wide atomicity.
- One local command run gets one plan, one apply call, one lock/journal lifecycle, and one recovery
  result across all selected local physical targets.
- Preflight every selected target before the first replacement. Unknown never becomes success.
- Preserve global-write separation and all existing authority checks for write, process, manager,
  lockfile, install, execute, verification, artifact, network, and global effects.
- Preserve addon callback arguments and deterministic order. A package rejected by
  `beforePackageWrite` never receives `afterPackageWrite`.
- Keep JSON envelope/schema version stable; reconcile existing operation totals from the single
  result.
- Plan 032 intentionally leaves the run controller inactive for `write: true` and for global
  invocations. Task 3 in this plan is the first local write-mode event producer and must drive it
  only from the collected selections and exact command-level apply result; never reconstruct legacy
  package-level transaction phases. Do not project global owners into repository-relative targets.
- Do not stage, commit, push, publish, tag, or create a branch/worktree without separate authority.

## Drift Check and Stop Conditions

Before editing, run `git status --short`, verify Plan 032 completion, and inspect current apply,
package hook, selection, and post-write code rather than trusting this plan's line positions. Stop
if one-plan migration cannot preserve addon/callback arguments and order, shared physical operations
cannot be deduplicated without guessing, any authority/recovery check would be bypassed, a machine
schema must break in place, or owned files contain unrelated concurrent edits.

---

### Task 1: Prepare package decisions without mutation

**Files:**

- Create: `src/commands/check/package-preparation.ts`
- Create: `src/commands/check/package-preparation.test.ts`
- Modify: `src/commands/check/process-package.ts`
- Modify: `src/commands/check/check.core-flow.test.ts`
- Modify: `src/commands/check/check.interactive-selection.test.ts`
- Modify: `src/commands/check/check.addons.test.ts`

**Interfaces:**

- Consumes: `PackageMeta`, resolved changes, options, authority, and `ProcessPackageHooks`.
- Produces: `preparePackage()` and `PreparedPackage` without calling a writer.

- [x] **Step 1: Write preparation RED tests**

Cover updates/errors, interactive selection, no-write mode, rejected addon, accepted local write,
accepted global write, empty selection, thrown hook, and deterministic callbacks.

```ts
export interface PreparedPackage {
  pkg: PackageMeta
  updates: ResolvedDepChange[]
  selected: ResolvedDepChange[]
  writeApproved: boolean
  kind: 'local' | 'global' | 'none'
}
```

Assert no filesystem writer or global manager runs during preparation.

- [x] **Step 2: Run preparation RED tests**

Run: `pnpm exec vitest run src/commands/check/package-preparation.test.ts`

Expected: FAIL because preparation is still coupled to `applyPackageWrite()`.

- [x] **Step 3: Extract preparation with current semantics**

Move resolution result classification, `onHasUpdates`, interactive selection, and
`beforePackageWrite` into `preparePackage()`. Do not call `afterPackageWrite` or `afterPackageEnd`
until completion. Preserve the existing start boundary: `beforePackageStart` remains outside the
preparation `try`, so its failure does not call `afterPackageEnd`. After a package has entered
preparation, every return or throw must transfer to one explicit completion/error-cleanup owner that
calls `afterPackageEnd` exactly once. A preparation failure must not start a writer or any result or
after-write hook.

- [x] **Step 4: Add completion helpers**

Define:

```ts
export async function completePreparedPackage(
  prepared: PreparedPackage,
  result: PackageWriteResult | undefined,
  hooks: ProcessPackageHooks,
): Promise<void>
```

For accepted writes, call internal result hooks, then `afterPackageWrite(pkg, selected)`, then
`afterPackageEnd(pkg)`. For no-write/rejected/empty packages, preserve current `afterPackageEnd`
behavior and omit `afterPackageWrite`. A returned result with `didWrite: false` still calls
`afterPackageWrite`; only `onDidWrite` is omitted. Accepted plus `undefined` represents a writer or
adapter that returned no result and calls only `afterPackageEnd`. Rejected/no-write plus a supplied
result is an internal invariant failure. Completion is idempotent per prepared package, and a thrown
`afterPackageEnd` retains the current error-precedence behavior.

- [x] **Step 5: Run GREEN callback tests**

Run the preparation, core-flow, interactive-selection, addon, and callback suites. Expected: all
pass and no mutation occurs before command orchestration requests it.

**Completion evidence (2026-07-18):** Package preparation/completion was implemented in `a21fea1`.
The compatibility wrapper preserves the legacy start/error boundary and callback order while
preparation performs no local or global mutation. Completion owns exactly-once cleanup, retains
`didWrite: false` after-write behavior, and enforces incoherent-result invariants. The full
`src/commands/check` suite passes 440/440 tests; focused lifecycle and write/global/post-write
matrices pass 48/48 and 26/26, with typecheck, focused Biome, and diff checks green. Independent
review reported no Critical, Important, or Minor findings.

### Task 2: Build one command-level legacy plan

**Files:**

- Create: `src/commands/apply/legacy-plan.ts`
- Create: `src/commands/apply/legacy-plan.test.ts`
- Modify: `src/commands/apply/engine.ts`
- Modify: `src/commands/apply/index.ts`
- Modify: `src/commands/apply/legacy.ts`
- Modify: `src/commands/apply/index.test.ts`
- Modify: `src/commands/check/write-flow.ts`
- Modify: `src/commands/check/write-flow.observed.test.ts`

**Interfaces:**

- Consumes: the effective repository root and ordered local `PreparedPackage[]`.
- Produces: `applyLegacyCommandWrite()` returning one `ApplyResult` plus exact package projections.

- [x] **Step 1: Write multi-package plan RED tests**

Build three packages with operations in two manifests and one shared Bun catalog owner. Assert one
plan has all unique physical operations, deterministic ordering, the effective-root repository
identity, and package projections back to every selected change.

```ts
export interface LegacyCommandSelection {
  packageIndex: number
  pkg: PackageMeta
  changes: ResolvedDepChange[]
}

interface LegacyCommandResultBase {
  packages: Array<{ packageIndex: number; outcomes: WriteOutcome[] }>
  diagnostics: LegacyWriteDiagnostic[]
  attempts: Array<{
    targetPath: string
    operationIds: string[]
    replacementAttempted: boolean
  }>
}

export type LegacyCommandApplyResult =
  | (LegacyCommandResultBase & {
      status: 'executed'
      applyResult: ApplyResult
    })
  | (LegacyCommandResultBase & {
      status: 'blocked'
    })
```

- [x] **Step 2: Run the plan RED tests**

Run: `pnpm exec vitest run src/commands/apply/legacy-plan.test.ts`

Expected: FAIL because `createLegacyPlan()` is private and accepts one package at a time.

- [x] **Step 3: Extract plan construction**

Move input collection and plan construction into `legacy-plan.ts`. Require an explicit canonical
effective root; reject any source outside it. Preserve exact source bytes, byte hashes, occurrence
paths, formatting metadata, plan fingerprinting, VCS diagnostics, and invocation authority.

- [x] **Step 4: Deduplicate physical occurrences safely**

`executed` means the engine ran exactly once; it does not claim that its `ApplyResult` succeeded.
Key operations by source file plus JSON/YAML path. Identical expected/requested pairs become one
physical operation with multiple package projections. Conflicting expected or requested values
produce the deterministic blocked result with `AMBIGUOUS_OCCURRENCE` outcomes for all projections,
all structural attempts false, no `applyResult`, and zero engine calls; never select one by package
order or fabricate a dummy/no-op plan result.

- [x] **Step 5: Apply exactly once and project outcomes**

Implement:

```ts
applyLegacyCommandWrite(
  root: string,
  selections: readonly LegacyCommandSelection[],
  authority: InvocationAuthority,
): Promise<LegacyCommandApplyResult>
```

Call `apply(plan, { cwd: root }, authority)` exactly once. Map operation IDs back to all package
projections without matching by dependency name alone.

Retain exact structural replacement-attempt evidence from the engine before result projection. Add
an internal, package-private execution-evidence seam rather than changing the public `ApplyResult`
schema or inferring attempts from reason strings. Every selected operation and physical target must
map to one explicit `replacementAttempted` fact, including staging failure, zero-replacement commit
failure, later commit abort, and recovery branches.

- [x] **Step 6: Run GREEN apply adapter tests**

Run legacy-plan, apply, observed write-flow, catalog, JSON/YAML formatting, and line-ending tests.
Expected: all pass; one apply call covers every local target; shared catalog writes occur once.

**Completion evidence (2026-07-18):** Command-level plan construction was implemented in `5f8bcd0`.
Ready input executes the stateless engine exactly once with least file authority; physical
occurrences deduplicate by canonical source/path and project by real operation ID. Ambiguity returns
the explicit blocked variant with zero engine calls and false attempts. Package-private execution
evidence retains exact replacement attempts and apply-time VCS diagnostics without changing public
`apply()`, schemas, declarations, dependencies, or version. Focused adapter, structural, and broader
matrices pass 17/17, 6/6, and 185/185; full apply passes 71/71 with typecheck, build, schemas, Biome,
and diff checks green. Independent adversarial review reported no Critical, Important, or Minor
findings.

### Task 3: Make the command-level apply authoritative

**Files:**

- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/run-check.model.test.ts`
- Modify: `src/commands/check/run-model.ts`
- Modify: `src/commands/check/run-model.test.ts`
- Modify: `src/commands/check/test-helpers.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`
- Modify: `src/commands/check/run-check.model.test.ts`
- Modify: `src/commands/check/check.core-flow.test.ts`
- Modify: `src/commands/check/check.callbacks.test.ts`
- Modify: `src/commands/check/check.addons.test.ts`
- Modify: `src/commands/check/check.interactive-selection.test.ts`
- Modify: `src/commands/check/check.write-outcomes.test.ts`
- Modify: `src/commands/check/check.flags.install.test.ts`
- Modify: `src/commands/check/check.flags.update.test.ts`
- Modify: `src/commands/check/check.flags.execute.test.ts`
- Modify: `src/commands/check/check.global-write.test.ts`

**Interfaces:**

- Consumes: prepared packages and `applyLegacyCommandWrite()`.
- Produces: one local apply lifecycle followed by projected package completion and post-write
  phases.

- [x] **Step 1: Write the late-preflight RED regression**

Create 14 target manifests, make the last target's VCS evidence unavailable, and select 76
operations. Assert before implementation that the old path changes earlier files; retain this as
RED evidence, then change the final expectation to byte-identical targets under the new path.

- [x] **Step 2: Write orchestration call-count RED tests**

For 15 prepared owner groups, assert one local adapter call, one plan, 14 unique targets, projected
callbacks in package order, one final run result, and no post-write action after block/unknown.
Extend the shared test helper with a distinct command-adapter mock. Keep the legacy package-writer
mock for compatibility tests; never route production command apply through the old writer to satisfy
test interception.

- [x] **Step 3: Run RED orchestration tests**

Run the orchestration/model/write-outcome/flag suites listed above. Expected: FAIL because current
`run-check.ts` applies inside the package loop.

- [x] **Step 4: Replace the package write loop**

Prepare every package first. Separate global selections from local selections. Execute the one
local command adapter, project results, then execute existing global state-machine requests under
their separate authority. Complete package hooks in deterministic order and call
`afterPackagesEnd` only after every package completion.

If preparation fails, it already owns the failing package's end hook; complete every earlier
prepared package with `undefined`, start no writer or global action, omit `afterPackagesEnd`, and
preserve the first package-order cleanup error. After a batch apply returns, attempt completion for
every prepared package in package order with its real projected result even if an earlier completion
throws, retain the first package-order rejection, omit `afterPackagesEnd`, then throw. A returned
local blocked/failed/unknown result does not suppress separately authorized global requests; an
adapter throw does. These cleanup rules prevent already-applied outcomes from disappearing behind a
later callback failure.

Run-model projection is not a cleanup owner. If projection or controller dispatch fails after the
adapter returns, retain that error as the primary failure, still attempt every prepared package
completion in package order, omit `afterPackagesEnd`, and then rethrow the retained model error. If
model emission succeeds, the first package-order completion rejection remains primary. Tests must
cover both precedence branches so instrumentation cannot bypass or replace mandatory cleanup.

- [x] **Step 5: Drive the run model from the real apply result**

Map apply phases `preflight`, `stage`, `commit`, `inspect`, and `recovery` to the renderer-neutral
phase states. Retain `journalId`, restored/unrecovered paths, external effects, and exact operation
totals. Derive not-attempted totals only from the structural attempt evidence retained by Task 2;
do not infer replacement attempts from outcome wording.

Apply completion records independently whether recovery and final observation actually exist in the
engine result. A precommit or zero-replacement commit failure after stage may have neither inspect
nor recovery: retain the failed/unknown apply fact, skip both model phases, and complete with exact
blocked/failed/unknown plus structural not-attempted receipts. Never invent inspect or recovery to
advance the reducer.

The same zero-mutation rule applies before commit. A lock or stage block/failure/unknown result may
skip apply, recovery, and observation while retaining exact blocked/failed/unknown operations plus
structural not-attempted evidence. The non-success lifecycle phase supplies the terminal reason;
this is not permission to attach failed results to an arbitrary skipped lifecycle. If cleanup is
unknown after one of these early exits, record its real non-executed recovery/cleanup evidence and
external effects while keeping the recovery phase skipped. No zero-mutation branch may report an
applied or reverted operation.

An all-no-change result is different: lock/stage and apply are skipped, but the engine still records
a passed inspect phase. Use a fact-bearing no-mutation stage transition that skips apply/recovery and
activates observe, then retain exact neutral skipped operations and structural not-attempted truth.

Retain engine `skipped` as an exact neutral operation outcome, distinct from structural
not-attempted truth. A physical target whose member operations have different exact outcomes uses a
mixed target result rather than selecting a worst status. Target attempt evidence applies to every
member operation because replacement is physical-file scoped; it does not rewrite a skipped base
outcome. Cover applied+skipped and recovery-time reverted+failed/unknown target matrices before
wiring the command stream.

For a pre-engine blocked union, build model inventory only when every exact projected occurrence is
contained, repository-relative, deterministic, and fully reconciled. Then mark preflight blocked and
every operation blocked plus structurally not attempted. If any projection is outside/unbound or the
inventory cannot reconcile, emit `CHECK_RUN_SELECTION_UNBOUND` and close review as unknown before
selection/results; never omit a projection or fabricate an owner, operation ID, or target path.

- [x] **Step 6: Gate post-write actions on the complete result**

Install/update/execute/verify paths may run only when their existing authority is present, at least
one local/global write was observed, and no local/global outcome is conflicted, failed, or unknown.
Keep `strictPostWrite` and exit behavior unchanged.

- [x] **Step 7: Run GREEN orchestration tests**

Expected: all focused suites pass; the 14-target failure changes zero target bytes, reports 76 not
attempted operations, returns `2`, and starts no manager/post-write command.

**Completion evidence (2026-07-18):** Authoritative command apply was implemented in `590e3d5`,
with the supporting run-model corrections in `5c22caa`, `276c7d7`, and `b5a180e`. All package
decisions are prepared before one local adapter call; exact command results project back in package
order, separately authorized globals retain their lifecycle, and post-write actions require an
observed non-blocking result. The 14-target late-preflight regression retains byte-identical files,
76 structurally not-attempted operations, exit code 2, and zero manager starts. The full project
passes 1,744/1,744 tests, the check suite passes 496/496, and the compatibility matrix passes
200/200, with lint, typecheck, build, schemas, and diff checks green. Independent final review
reported no Critical, Important, or Minor findings. The detailed evidence is retained in
`.superpowers/sdd/plan033-task-3-report.md`.

### Task 4: Recovery and interruption matrix

**Files:**

- Modify: `src/commands/apply/engine.ts`
- Modify: `src/commands/apply/index.test.ts`
- Modify: `src/contracts/validate.ts`
- Modify: `src/contracts/schemas.test.ts`
- Create: `src/commands/check/check.command-apply.integration.test.ts`
- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/run-model.ts`
- Modify: `src/commands/check/run-model.test.ts`
- Modify: `src/commands/check/write-receipt.ts`
- Modify: `src/commands/check/write-receipt.test.ts`
- Modify: `src/commands/check/check.write-outcomes.test.ts`
- Modify: `test/practical-cli-smoke.mjs`
- Modify: `docs/output-formats/table.md`
- Modify: `docs/troubleshooting.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: authoritative command apply from Task 3.
- Produces: end-to-end filesystem proof and accurate safety language.

Task 4 may add private local-command evidence wiring for the human receipt and project exact local
recovery paths into the fields already present in `ApplyResult`. Public `WriteOutcome`, callback,
JSON, schema, declaration, dependency, and version contracts remain unchanged. Reconcile exact
apply operations and structural attempts by contained repository-relative file plus occurrence
path before rendering. When command evidence exists, receipt status, reason, and attempted state
come only from that evidence; never fall back to legacy reason heuristics after reconciliation
fails. Such a failure must remain an exit-2 unknown/error and can never print complete or safety
block.

Completed recovery may retain a later exact precondition conflict only when at least one earlier
selected operation is reverted, every conflicted operation is structurally not attempted, and its
reason is `SOURCE_CHANGED`, `STAGED_SOURCE_CHANGED`, or `BACKUP_SOURCE_CHANGED`. This represents a
fully restored earlier replacement plus a later target that was never mutated. Amend the semantic
validator and run model narrowly for that matrix. The semantic result must also contain the exact
lifecycle evidence: failed commit, passed recovery, passed final inspection, and passed cleanup;
missing or different phase evidence is invalid. Continue to reject completed recovery containing
applied, skipped, unknown, attempted-conflict, arbitrary-conflict, or conflict-only results; never
mislabel the truthful matrix as partial recovery merely to satisfy an older validator.

`Safety block · no files were changed` requires zero applied/reverted results, exact not-attempted
evidence for every blocking group, and no retained or prior recovery uncertainty. In particular,
clean `SOURCE_CHANGED` and `VCS_UNAVAILABLE` preflight blocks may qualify, while
`RECOVERY_REQUIRED`, incomplete/unknown cleanup, a recovery journal, restored/unrecovered paths, or
external effects never qualify. Preserve projected legacy outcomes for callbacks and public JSON;
the exact command evidence is private to the human receipt.

- [x] **Step 1: Add integration fault checkpoints**

Cover stale before first replacement, stale before a later rename, observation failure, completed
recovery, partial recovery, unknown recovery, orphan journal, and signal interruption. Assert exact
target bytes, lock/journal presence, recovery paths, operation statuses, receipt verdict, and exit.

Signal interruption is a two-invocation proof, not graceful same-run recovery. Start a child with
the real CLI signal handler, interrupt after an observed replacement, and assert exit 143 plus the
exact changed/original target bytes and retained owned lock, relative journal, and backups. Then run
a fresh authoritative check and require exact `RECOVERY_REQUIRED`, an unknown receipt, exit 2, and
no further mutation or cleanup. Same-run cancellation/recovery is outside this plan.

- [x] **Step 2: Run the integration RED/GREEN loop**

Run `pnpm exec vitest run src/commands/check/check.command-apply.integration.test.ts` after each
fault case. Expected final state: all cases pass with no success claim for partial/unknown recovery.

- [x] **Step 3: Add built-CLI command transaction proof**

Extend the disposable practical smoke fixture with at least three target manifests and a late
preflight block. Compare recursive target hashes before/after. Expected: zero changes on preflight
block and all requested values observed on success.

- [x] **Step 4: Document exact atomicity**

State that all targets are preflighted before replacement, each file replacement is atomic, the
repository is not an atomic transaction, recovery is best effort, and incomplete observation is
unknown. Add only `Unreleased` notes.

**Completion evidence (2026-07-18):** Recovery and interruption proof was implemented in
`28d530f`. The focused 13-suite matrix passes 227/227 tests, the command check suite passes 517/517,
and the full practical smoke passes 35 checks with 69 registry requests. The matrix covers exact
stale-first/stale-later, completed/partial/unknown recovery, final-observation identity loss, orphan
journal, deterministic after-replacement interruption, real operating-system SIGTERM exit 143, and
fresh authoritative recovery blocking. Human receipts consume private exact operation/attempt
evidence while public JSON, callbacks, schemas, version, and declarations remain unchanged. Lint,
typecheck, build, schema, and diff checks pass; all four built declarations byte-match public
`depfresh@2.0.2`. Independent review reported no Critical, Important, or Minor findings. Detailed
evidence and the intentionally deferred mixed no-change plus completed-recovery contract are in
`.superpowers/sdd/plan033-task-4-report.md`.

### Task 5: Command apply verification gate

**Files:**

- Modify: `plans/033-command-level-local-apply.md` with exact completion evidence only after proof
- Modify: `plans/README.md` and `.superpowers/sdd/progress.md` only when marking done
- Modify: `build.config.ts`, `package.json`, and
  `scripts/verify-declaration-stability.mjs` for deterministic declaration generation and proof
- Modify: `src/commands/apply/legacy-plan.ts` and
  `src/commands/apply/legacy-plan.test.ts` for complete blocked attempt evidence
- Modify: `src/commands/check/run-check.ts` and
  `src/commands/check/run-check.orchestration.test.ts` for multi-operation blocked targets

**Interfaces:**

- Consumes: Tasks 1-4.
- Produces: the safe command lifecycle required by Visual+ v2.

- [ ] **Step 1: Run the focused matrix three times**

Repeat preparation, legacy-plan, command-apply integration, apply fault, orchestration, addon,
callback, interactive, global, JSON, and post-write suites three times. Expected: stable counts,
zero flakes, zero leaked locks/timers/processes.

- [ ] **Step 2: Run complete gates**

Run schemas check, typecheck, lint, full coverage, build, smoke, demo, and packed verification.
Expected: all exit `0` and target/Git state assertions remain green.

- [ ] **Step 3: Require adversarial review**

One reviewer audits authority, stale/recovery, deduplication, and callback semantics; another audits
JSON/result reconciliation and documentation. Plan 034 cannot start while either has findings.

- [ ] **Step 4: Resolve final-review findings before replay**

Serialize only the declaration Rollup traversal so repeated clean builds preserve the exact public
`2.0.2` declaration bytes. Add a durable repeated-build verifier covering all four declarations.
Retain deterministic private operation IDs and target-scoped `replacementAttempted: false` evidence
for every contained ambiguous physical occurrence, including multiple operations sharing one
target. Keep outside or unreconciled projections on the existing fail-closed unbound path. Run the
new RED tests before implementation, then replay Steps 1-3 and require both reviewers to report no
findings.
