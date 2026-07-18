# Renderer-neutral Check Run Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one deterministic, renderer-neutral model of the complete check lifecycle and
wire every lifecycle fact that current orchestration exposes truthfully, without changing write
orchestration or default terminal bytes yet.

**Architecture:** A pure reducer turns typed check events into immutable snapshots. `run-check.ts`
emits complete local read-only and error event streams at existing orchestration seams while the
current progress, table, JSON, addon, and write paths remain authoritative. Current package-level
writes do not expose a truthful command transaction, so Plan 033 activates local write-mode events
from its one real command-level apply result. Global owners use logical identities rather than
repository-relative target paths and remain outside this model until an explicit identity contract
is approved. Later renderers consume the same snapshot instead of reconstructing state from logger
strings.

**Tech Stack:** TypeScript, Node `24.15.0`, Vitest, Biome, pnpm `10.33.0`.

## Global Constraints

- All code, documentation, plans, and commit messages are English.
- Begin only after the public `2.0.2` proof in Plan 031.
- Keep version `2.0.2`; Plans 033-035 build `2.1.0`, and Plan 036 owns its version bump/release.
- Add no runtime dependency and no public option, export, JSON field, callback, or schema change.
- Preserve current stdout/stderr bytes, cursor behavior, package/addon callback order, selection,
  writes, post-write actions, exit codes, and profile metrics in this plan.
- The model may describe phases and outcomes but must not grant authority or trigger side effects.
- Unknown remains distinct from failed, blocked, skipped, and success.
- Do not stage, commit, push, publish, tag, or create a branch/worktree without separate authority.

## Drift Check and Stop Conditions

Before editing, run `git status --short`, verify public `2.0.2`, and compare every owned check file
with the Plan 031 completion commit. Stop if the model requires a public API/JSON/schema change,
cannot represent an approved lifecycle/result state, changes terminal bytes or callback/write order,
duplicates authority decisions, or overlaps unrelated concurrent edits.

**Resolved stop condition (2026-07-18):** A read-only seam audit proved that current package-level
writes can apply an earlier target before a later preflight block, hide interactive selection and
catalog ownership inside package processing, and discard exact recovery evidence in the legacy
compatibility projection. Emitting one aggregate write rail here would invent transaction facts.
The approved correction is to wire complete local read-only/error streams in this plan and defer
local write-mode event emission to Plan 033, which first collects every selection and calls one
command-level apply lifecycle. Global invocations remain inactive because values such as
`global:npm` are logical identities, not repository-relative paths.

---

### Task 1: Pure event and snapshot contract

**Files:**

- Create: `src/commands/check/run-model.ts`
- Create: `src/commands/check/run-model.test.ts`

**Interfaces:**

- Consumes: sanitized repository-relative run facts already known by `run-check.ts`.
- Produces: `createCheckRunState()`, `reduceCheckRun()`, `CheckRunEvent`, and `CheckRunSnapshot`.

- [x] **Step 1: Write the reducer RED tests**

Cover legal phase progression, rejected backward transitions, immutable snapshots, count
reconciliation, duplicate event idempotency, unknown state, and recovery branching.

```ts
let state = createCheckRunState({ mode: 'major', write: true })
state = reduceCheckRun(state, { type: 'packages-discovered', packages: 66, declared: 616 })
state = reduceCheckRun(state, { type: 'resolution-completed', eligible: 612, updates: 76 })
state = reduceCheckRun(state, { type: 'selection-completed', operations: 76, targets: 14 })
expect(state.counts).toEqual({
  packages: 66,
  declared: 616,
  eligible: 612,
  updates: 76,
  operations: 76,
  targets: 14,
})
```

- [x] **Step 2: Run the RED test**

Run: `pnpm exec vitest run src/commands/check/run-model.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Define exact phase and outcome types**

Use these internal names consistently:

```ts
export type CheckRunPhaseName =
  | 'discover'
  | 'inspect'
  | 'resolve'
  | 'review'
  | 'preflight'
  | 'stage'
  | 'apply'
  | 'observe'
  | 'recover'
  | 'complete'

export type CheckRunPhaseStatus =
  | 'pending'
  | 'active'
  | 'passed'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'unknown'
```

`CheckRunSnapshot` contains `sequence`, mode/write intent, ordered phases, reconciled counts,
selected change/target arrays, diagnostics, result totals, recovery, elapsed milliseconds, and
exit code. Every array is readonly and every displayed path is repository-relative.

- [x] **Step 4: Implement a strict pure reducer**

Reject impossible count reductions and phase completion before activation with a private invariant
error. Accept duplicate terminal events only when payloads are byte-for-byte equivalent. Return a
new frozen object for each accepted event; never mutate caller arrays.

- [x] **Step 5: Run reducer GREEN tests**

Run:

```bash
pnpm exec vitest run src/commands/check/run-model.test.ts
pnpm typecheck
pnpm exec biome check src/commands/check/run-model.ts src/commands/check/run-model.test.ts
```

Expected: all exit `0` with no warnings.

**Completion evidence (2026-07-18):** The reducer was implemented through `c439ce0`. Its focused
suite passes 52/52 tests, the combined model/schema/apply compatibility suite passes 132/132, and
schema generation, typecheck, focused Biome, and diff checks pass. Independent review enumerated
all 63 non-empty internal outcome combinations with zero recovery-matrix mismatches and reported
no Critical, Important, or Minor findings. No public, renderer, I/O, schema, or authority surface
changed.

### Task 2: One internal run controller

**Files:**

- Create: `src/commands/check/run-controller.ts`
- Create: `src/commands/check/run-controller.test.ts`
- Modify: `src/commands/check/run-model.ts`

**Interfaces:**

- Consumes: `CheckRunEvent` and a monotonic `now(): number` dependency.
- Produces: `createCheckRunController(options): CheckRunController`.

- [x] **Step 1: Write controller RED tests**

Assert observer ordering, stable snapshot delivery, single finalization, observer failure isolation,
and exact elapsed time from an injected clock.

```ts
export interface CheckRunController {
  emit(event: CheckRunEvent): void
  snapshot(): CheckRunSnapshot
  subscribe(observer: (snapshot: CheckRunSnapshot) => void): () => void
}
```

- [x] **Step 2: Run the controller RED test**

Run: `pnpm exec vitest run src/commands/check/run-controller.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the controller without I/O**

The controller owns only state, sequence, timing, and observers. It never writes to stdout/stderr,
starts timers, reads environment variables, invokes callbacks, or changes `process.exitCode`.
Unsubscribe is idempotent. An observer exception is retained as a sanitized internal diagnostic and
cannot prevent later observers or command cleanup.

- [x] **Step 4: Run controller GREEN tests**

Run both new test files, typecheck, and focused Biome. Expected: all pass with no warnings.

**Completion evidence (2026-07-18):** The internal controller was implemented through `8b6262b`.
Controller and reducer tests pass 66/66, with typecheck, focused Biome, and diff checks green. It
retains exact raw terminal-event identity while deriving visible elapsed time from the injected
monotonic clock, isolates sanitized observer failures without reopening reducer state, and has no
I/O, environment, timer, process-exit, callback, or public-surface dependency. Independent review
reported no Critical, Important, or Minor findings.

### Task 3: Instrument observable read-only orchestration without behavior drift

**Files:**

- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`
- Modify: `src/commands/check/check.callbacks.test.ts`
- Modify: `src/commands/check/check.addons.test.ts`
- Modify: `src/commands/check/check.json-output.test.ts`
- Modify: `src/io/packages/discovery.ts`
- Create: `src/commands/check/run-check.model.test.ts`

**Interfaces:**

- Consumes: `CheckRunController` through a private optional dependency of `runCheck()` used by
  tests and later renderers.
- Produces: one complete event stream for local read-only and error journeys alongside current
  behavior. Write-mode and global injection remain deliberately inactive.

- [x] **Step 1: Characterize current output and callback order**

Capture table stdout/stderr, JSON bytes excluding the existing timestamp, addon callback order,
write mock calls, progress writes, and exit codes for read-only, write-success, partial write,
resolution error, no-package, and thrown-error cases. The two write cases prove unchanged legacy
behavior and that no incomplete or invented model stream is emitted.

- [x] **Step 2: Write failing event-stream tests**

Inject a recording controller and require ordered phase/count/result/final events for read-only,
resolution-error, no-package, and thrown-error journeys. Inject it into write-success, partial
write, and global cases and require no model events; Plan 033 replaces the local-write boundary.

- [x] **Step 3: Run the new RED test**

Run: `pnpm exec vitest run src/commands/check/run-check.model.test.ts`

Expected: FAIL because `runCheck()` does not emit model events.

- [x] **Step 4: Emit events at verified seams**

For local read-only invocations, add events immediately after package discovery, repository
inspection start/end, resolution completion, selection completion, and final exit selection. Use
existing computed counts; do not rescan packages or parse rendered text. Treat ordinary
per-occurrence resolution errors as unresolved facts rather than a failed aggregate resolve phase.
In `catch` and `finally`, resolve every active phase to failed or unknown before finalization. Do
not attach the controller to any write or global invocation in this plan. Extend the internal
package observer only as needed to preserve the default discovery log bytes while emitting the real
discovery callback before repository inspection starts; never emit retrospective active timing.

- [x] **Step 5: Prove zero public behavior drift**

Run:

```bash
pnpm exec vitest run src/commands/check/run-check.model.test.ts \
  src/commands/check/run-check.orchestration.test.ts \
  src/commands/check/check.callbacks.test.ts \
  src/commands/check/check.addons.test.ts \
  src/commands/check/check.json-output.test.ts \
  src/commands/check/check.core-flow.test.ts \
  src/commands/check/check.write-outcomes.test.ts \
  src/commands/check/progress.test.ts
```

Expected: all pass; characterization bytes/callback order/write call count are unchanged.

**Completion evidence (2026-07-18):** Local read-only/error instrumentation was implemented through
`438647b`. The focused model/orchestration/callback/addon/JSON/core/write/progress/controller/
reducer/discovery matrix passes 171/171 tests across 11 files, with typecheck, focused Biome, and
diff checks green. Events use the real discovery observer before repository inspection, reconcile
exact resolution and selection facts without clamping, and close every injected journey exactly
once. Public and uninjected calls create no controller; write and global invocations emit no model
events. Exact output, cursor, callback, addon, write, and exit behavior is unchanged. Independent
review reported no Critical, Important, or Minor findings.

### Task 4: Model verification and handoff

**Files:**

- Modify: `plans/032-check-run-model.md` with completion evidence only after proof
- Modify: `plans/README.md` and `.superpowers/sdd/progress.md` only when marking done

**Interfaces:**

- Consumes: Tasks 1-3.
- Produces: a stable internal model that Plan 033 may make authoritative.

- [x] **Step 1: Run focused tests three times**

Run all run-model/controller/orchestration/callback/addon/JSON/progress tests three times. Expected:
identical pass counts and no timer/open-handle leaks.

- [x] **Step 2: Run complete gates**

Run schemas check, typecheck, lint, full coverage, build, smoke, demo, and packed verification.
Expected: all exit `0`; public CLI bytes remain behaviorally unchanged from the Plan 031 baseline.

- [x] **Step 3: Review the model contract**

Require one reviewer to map every read-only/error lifecycle phase to an event and verify that the
model can represent every apply/recovery fact Plan 033 will receive. Require another reviewer to
verify no authority/output/API drift and that write/global invocations emit no incomplete model
stream. Stop Plan 033 if any required local transaction fact cannot be represented.

**Final completion evidence (2026-07-18):** Plan 032 is DONE through `4556a06`. The exact focused
11-file matrix passed three times at 185/185 tests with no timer or open-handle warnings. Full
coverage passed 1,656/1,656 tests across 146 files; schemas, typecheck, lint over 314 files, build,
34-check/63-request smoke, 14-check demo, 102 release tests, exact 56-file packed verification, and
diff checks all passed on Node `24.15.0`. Four built declaration files are byte-identical to public
`depfresh@2.0.2`. Final corrections kept model injection private, preserved passed commit truth
across executed recovery and non-executed cleanup uncertainty, and retained structural
not-attempted receipts for untouched late-abort targets. Independent lifecycle and drift reviews
reported no Critical, Important, or Minor findings. Plan 033 may now make the local write model
authoritative using its package-private structural replacement-attempt evidence seam; global
invocations remain outside the repository-relative target model.
