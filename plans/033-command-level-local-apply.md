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

- [ ] **Step 1: Write preparation RED tests**

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

- [ ] **Step 2: Run preparation RED tests**

Run: `pnpm exec vitest run src/commands/check/package-preparation.test.ts`

Expected: FAIL because preparation is still coupled to `applyPackageWrite()`.

- [ ] **Step 3: Extract preparation with current semantics**

Move resolution result classification, `onHasUpdates`, interactive selection, and
`beforePackageWrite` into `preparePackage()`. Do not call `afterPackageWrite` or `afterPackageEnd`
until completion. Keep `beforePackageStart` and `finally` behavior explicit so thrown preparation
still calls `afterPackageEnd` exactly once.

- [ ] **Step 4: Add completion helpers**

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
behavior and omit `afterPackageWrite`.

- [ ] **Step 5: Run GREEN callback tests**

Run the preparation, core-flow, interactive-selection, addon, and callback suites. Expected: all
pass and no mutation occurs before command orchestration requests it.

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

- [ ] **Step 1: Write multi-package plan RED tests**

Build three packages with operations in two manifests and one shared Bun catalog owner. Assert one
plan has all unique physical operations, deterministic ordering, the effective-root repository
identity, and package projections back to every selected change.

```ts
export interface LegacyCommandSelection {
  packageIndex: number
  pkg: PackageMeta
  changes: ResolvedDepChange[]
}

export interface LegacyCommandApplyResult {
  applyResult: ApplyResult
  packages: Array<{ packageIndex: number; outcomes: WriteOutcome[] }>
  diagnostics: LegacyWriteDiagnostic[]
  attempts: Array<{
    targetPath: string
    operationIds: string[]
    replacementAttempted: boolean
  }>
}
```

- [ ] **Step 2: Run the plan RED tests**

Run: `pnpm exec vitest run src/commands/apply/legacy-plan.test.ts`

Expected: FAIL because `createLegacyPlan()` is private and accepts one package at a time.

- [ ] **Step 3: Extract plan construction**

Move input collection and plan construction into `legacy-plan.ts`. Require an explicit canonical
effective root; reject any source outside it. Preserve exact source bytes, byte hashes, occurrence
paths, formatting metadata, plan fingerprinting, VCS diagnostics, and invocation authority.

- [ ] **Step 4: Deduplicate physical occurrences safely**

Key operations by source file plus JSON/YAML path. Identical expected/requested pairs become one
physical operation with multiple package projections. Conflicting expected or requested values
produce deterministic `AMBIGUOUS_OCCURRENCE` outcomes for all projections and prevent apply; never
select one by package order.

- [ ] **Step 5: Apply exactly once and project outcomes**

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

- [ ] **Step 6: Run GREEN apply adapter tests**

Run legacy-plan, apply, observed write-flow, catalog, JSON/YAML formatting, and line-ending tests.
Expected: all pass; one apply call covers every local target; shared catalog writes occur once.

### Task 3: Make the command-level apply authoritative

**Files:**

- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`
- Modify: `src/commands/check/run-check.model.test.ts`
- Modify: `src/commands/check/check.write-outcomes.test.ts`
- Modify: `src/commands/check/check.flags.install.test.ts`
- Modify: `src/commands/check/check.flags.update.test.ts`
- Modify: `src/commands/check/check.flags.execute.test.ts`
- Modify: `src/commands/check/check.global-write.test.ts`

**Interfaces:**

- Consumes: prepared packages and `applyLegacyCommandWrite()`.
- Produces: one local apply lifecycle followed by projected package completion and post-write
  phases.

- [ ] **Step 1: Write the late-preflight RED regression**

Create 14 target manifests, make the last target's VCS evidence unavailable, and select 76
operations. Assert before implementation that the old path changes earlier files; retain this as
RED evidence, then change the final expectation to byte-identical targets under the new path.

- [ ] **Step 2: Write orchestration call-count RED tests**

For 15 prepared owner groups, assert one local adapter call, one plan, 14 unique targets, projected
callbacks in package order, one final run result, and no post-write action after block/unknown.

- [ ] **Step 3: Run RED orchestration tests**

Run the orchestration/model/write-outcome/flag suites listed above. Expected: FAIL because current
`run-check.ts` applies inside the package loop.

- [ ] **Step 4: Replace the package write loop**

Prepare every package first. Separate global selections from local selections. Execute the one
local command adapter, project results, then execute existing global state-machine requests under
their separate authority. Complete package hooks in deterministic order and call
`afterPackagesEnd` only after every package completion.

- [ ] **Step 5: Drive the run model from the real apply result**

Map apply phases `preflight`, `stage`, `commit`, `inspect`, and `recovery` to the renderer-neutral
phase states. Retain `journalId`, restored/unrecovered paths, external effects, and exact operation
totals. Derive not-attempted totals only from the structural attempt evidence retained by Task 2;
do not infer replacement attempts from outcome wording.

- [ ] **Step 6: Gate post-write actions on the complete result**

Install/update/execute/verify paths may run only when their existing authority is present, at least
one local/global write was observed, and no local/global outcome is conflicted, failed, or unknown.
Keep `strictPostWrite` and exit behavior unchanged.

- [ ] **Step 7: Run GREEN orchestration tests**

Expected: all focused suites pass; the 14-target failure changes zero target bytes, reports 76 not
attempted operations, returns `2`, and starts no manager/post-write command.

### Task 4: Recovery and interruption matrix

**Files:**

- Modify: `src/commands/apply/index.test.ts`
- Create: `src/commands/check/check.command-apply.integration.test.ts`
- Modify: `test/practical-cli-smoke.mjs`
- Modify: `docs/output-formats/table.md`
- Modify: `docs/troubleshooting.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: authoritative command apply from Task 3.
- Produces: end-to-end filesystem proof and accurate safety language.

- [ ] **Step 1: Add integration fault checkpoints**

Cover stale before first replacement, stale before a later rename, observation failure, completed
recovery, partial recovery, unknown recovery, orphan journal, and signal interruption. Assert exact
target bytes, lock/journal presence, recovery paths, operation statuses, receipt verdict, and exit.

- [ ] **Step 2: Run the integration RED/GREEN loop**

Run `pnpm exec vitest run src/commands/check/check.command-apply.integration.test.ts` after each
fault case. Expected final state: all cases pass with no success claim for partial/unknown recovery.

- [ ] **Step 3: Add built-CLI command transaction proof**

Extend the disposable practical smoke fixture with at least three target manifests and a late
preflight block. Compare recursive target hashes before/after. Expected: zero changes on preflight
block and all requested values observed on success.

- [ ] **Step 4: Document exact atomicity**

State that all targets are preflighted before replacement, each file replacement is atomic, the
repository is not an atomic transaction, recovery is best effort, and incomplete observation is
unknown. Add only `Unreleased` notes.

### Task 5: Command apply verification gate

**Files:**

- Modify: `plans/033-command-level-local-apply.md` with exact completion evidence only after proof
- Modify: `plans/README.md` and `.superpowers/sdd/progress.md` only when marking done

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
