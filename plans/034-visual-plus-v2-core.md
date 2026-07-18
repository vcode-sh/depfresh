# Visual+ v2 Core Terminal Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented default table/progress output with one inline Visual+ v2 renderer that
shows the complete change list, real command lifecycle, physical-target transaction, and exact
final receipt in every terminal capability mode.

**Architecture:** A capability detector selects layout, color, Unicode, and motion without changing
content. One renderer subscribes to the approved run model, owns the small live lifecycle region,
and writes all review rows and final receipts durably once. Pure section renderers return strings;
one output owner performs terminal I/O and cleanup.

**Tech Stack:** TypeScript, Node `24.15.0`, ansis, existing terminal sanitization/visual-width
utilities, Vitest, Biome, pnpm `10.33.0`. No new runtime or native dependency.

## Global Constraints

- All code, documentation, plans, and commit messages are English.
- Begin only after Plan 033 is complete and reviewed; keep package version `2.0.2`.
- Visual+ v2 is the default human terminal interface only for local, non-global, noninteractive CLI
  `table` output. Direct library calls, JSON, silent, explicit interactive selection, `--global`,
  and `--global-all` retain their current paths. Global output cannot enter Visual+ until a separate
  truthful global run model exists.
- Full-screen Focus TUI/OpenTUI is not part of this implementation plan.
- Output is inline, complete, copyable, and stable in scrollback. Every selected row and physical
  target appears exactly once; summaries never replace details.
- Only the active asynchronous phase may animate. No row entrance, keyboard, selection, help, or
  decorative animation.
- Non-TTY, CI, pipes, `TERM=dumb`, and reduced motion emit no repeated frames or cursor control.
- `NO_COLOR` removes color semantics but not content. Every status has text/symbol redundancy.
- Preserve JSON, silent, library callback, interactive selection, authority, and exit semantics.
- Normal CLI completion sets `process.exitCode` and returns so slow/large pipes drain; immediate
  process exit remains reserved for signal termination.
- Sanitize hostile terminal text and calculate visible width for every emitted line.
- Metadata not present in `CheckRunSnapshot` must arrive as explicit immutable renderer input. When
  repository, workspace, or manager facts are absent, omit them or render unknown; never infer them
  from filenames, enumeration order, or the executor environment.
- On the Visual+ route, Visual+ is the only ordinary cursor/timer owner and the legacy progress loop
  is disabled. Explicit interactive TUI retains ownership on its excluded route. The signal handler
  remains a last-resort cursor-restoration authority on termination, not a renderer or timer owner.
  Legacy progress remains available only on excluded compatibility routes until their migration is
  separately planned.
- Do not stage, commit, push, publish, tag, or create a branch/worktree without separate authority.

## Drift Check and Stop Conditions

Before editing, run `git status --short`, verify Plan 033's command-level proof, and inventory all
current stdout/stderr/cursor owners. Stop if complete rows or targets would be hidden, any success
copy must infer rather than consume observed state, constrained modes lose information, cursor
ownership remains ambiguous, a new runtime/native dependency becomes necessary, JSON/library output
drifts, or owned files overlap unrelated work.

---

### Task 1: Terminal capability contract

**Files:**

- Create: `src/commands/check/visual-plus/capabilities.ts`
- Create: `src/commands/check/visual-plus/capabilities.test.ts`
- Modify: `src/commands/check/render-layout.ts`

**Interfaces:**

- Consumes: stdout/stderr TTY state, columns, `CI`, `TERM`, `NO_COLOR`, and an internal
  reduced-motion override used by tests.
- Produces: `detectVisualPlusCapabilities(input): VisualPlusCapabilities`.

The detector is pure and receives one immutable startup snapshot:

```ts
export interface VisualPlusCapabilityInput {
  stdoutIsTTY: boolean
  stderrIsTTY: boolean
  columns?: number
  ci?: string
  term?: string
  noColor?: string
  reducedMotion?: boolean
}
```

Normalize a finite positive width by flooring it with a minimum of `1`; zero, negative,
non-finite, or missing columns become `80`. `CI` is inactive only when missing, empty after trim, or
case-insensitive `false`; every other value, including `0`, is active. `TERM=dumb` is
case-insensitive after trim. Any present `NO_COLOR` value, including the empty string, disables
color.

A run is constrained when either stdout or stderr is not a TTY, CI is active, or `TERM=dumb`.
Constrained runs are noninteractive, plain, colorless, motionless, and emit no cursor control.
Unicode remains available in CI and pipes; only `TERM=dumb` forces ASCII. A capable TTY uses
`narrow` below 60 columns, `medium` from 60 through 99, and `wide` from 100 columns. Reduced motion
changes only `motion` and `cursorControl`; `NO_COLOR` changes only `color`.

- [x] **Step 1: Write capability RED tests**

Cover capable color TTY, `NO_COLOR`, reduced motion, widths 8/10/40/60/80/118, zero/undefined
columns, `TERM=dumb`, CI, and non-TTY pipe.

```ts
export interface VisualPlusCapabilities {
  interactive: boolean
  color: boolean
  unicode: boolean
  motion: boolean
  cursorControl: boolean
  width: number
  layout: 'wide' | 'medium' | 'narrow' | 'plain'
}
```

- [x] **Step 2: Run capability RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/capabilities.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement one startup decision**

Detect capabilities once per run. Use deterministic layout thresholds proved by snapshots, not
terminal brand detection. `TERM=dumb` forces ASCII/plain/no motion; non-TTY and CI force
plain/no-motion/no cursor; `NO_COLOR` changes only color; zero columns use width 80.

Task 1 additions to `render-layout.ts` must be pure and additive. Do not change existing
`getTerminalWidth()`, `fitCell()`, column sizing, truncation, table bytes, or callers before Task 4.

- [x] **Step 4: Run capability GREEN tests**

Run the new test plus current `progress.test.ts`, `render-overflow.test.ts`, and typecheck.
Expected: all pass and existing width utilities remain compatible.

**Completion evidence (2026-07-18):** The pure capability contract was implemented in `8a5d011`.
The RED run failed because `./capabilities` did not exist. The final focused matrix passed 49/49
tests across capabilities, progress, and overflow; typecheck, focused Biome, and diff checks also
passed. Width normalization, layout boundaries, CI, `TERM=dumb`, `NO_COLOR`, both TTY streams,
Unicode, reduced motion, and cursor behavior have exact boundary coverage. Existing layout helpers
and callers remain unchanged; the new layout helpers are pure and additive. Independent spec and
quality reviews reported no Critical, Important, or Minor findings.

### Task 2: Pure lifecycle, topology, row, target, and receipt sections

**Files:**

- Create: `src/commands/check/visual-plus/sections/header.ts`
- Create: `src/commands/check/visual-plus/sections/lifecycle.ts`
- Create: `src/commands/check/visual-plus/sections/topology.ts`
- Create: `src/commands/check/visual-plus/sections/changes.ts`
- Create: `src/commands/check/visual-plus/sections/transaction.ts`
- Create: `src/commands/check/visual-plus/sections/receipt.ts`
- Create: `src/commands/check/visual-plus/sections/sections.test.ts`
- Create: `src/commands/check/visual-plus/theme.ts`
- Create: `src/commands/check/visual-plus/input.ts`
- Modify: `src/commands/check/render/table-rows.ts`

**Interfaces:**

- Consumes: `CheckRunSnapshot`, `VisualPlusCapabilities`, and exact immutable renderer metadata.
- Produces: pure `readonly string[]` section functions with no I/O or timers.

Task 2 uses this renderer-only input contract; it does not widen the public run-model schema:

```ts
export interface VisualPlusRunMetadata {
  readonly repository?: {
    readonly name?: string
    readonly relativePath?: string
  }
  readonly workspaceScope: 'single-package' | 'workspace' | 'unknown'
  readonly packageManager: VisualPlusPackageManagerMetadata
}

export type VisualPlusPackageManagerMetadata =
  | {
      readonly status: 'observed'
      readonly name: string
      readonly version?: string
      readonly sources: readonly [string, ...string[]]
    }
  | {
      readonly status: 'ambiguous'
      readonly candidates: readonly {
        readonly name: string
        readonly version?: string
        readonly source: string
      }[]
    }
  | {
      readonly status: 'unavailable'
      readonly sources: readonly string[]
    }
  | {
      readonly status: 'unknown'
      readonly sources: readonly []
    }

export interface VisualPlusChangeMetadata {
  readonly operationId: string
  readonly ownerGroup: {
    readonly id: string
    readonly label: string
    readonly order: number
    readonly physicalTarget: string
  }
  readonly ageMs: number | null
  readonly compatibility: {
    readonly status: 'compatible' | 'incompatible' | 'unknown'
    readonly detail?: string
  }
  readonly catalog?: {
    readonly name: string
    readonly sourcePath: string
  }
}

export interface VisualPlusSectionInput {
  readonly snapshot: CheckRunSnapshot
  readonly capabilities: VisualPlusCapabilities
  readonly run: VisualPlusRunMetadata
  readonly changes: readonly VisualPlusChangeMetadata[]
  readonly writeReceipt?: VisualPlusWriteReceiptEvidence
}

export interface VisualPlusWriteReceiptEvidence {
  readonly canonical: DeepReadonly<WriteReceipt>
  readonly operationIds: readonly string[]
  readonly targets: readonly {
    readonly path: string
    readonly operationIds: readonly string[]
  }[]
  readonly recovery: DeepReadonly<CheckRunRecovery>
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T
```

`changes` must contain exactly one entry for every `snapshot.changes[].id`; duplicate, missing, or
extra IDs fail closed. Every `ownerGroup.physicalTarget` must equal the selected physical target
containing that operation ID. Logical owner-group identity is separate from the physical target:
the acceptance fixture has 15 stable owner groups and 14 target paths, with exactly one target
shared by two groups. Group order is numeric `order`, then `id`; ties, unsafe paths, or incomplete
target membership fail closed. Missing age is `null` and renders `age unknown`; missing
compatibility is the explicit `unknown` state and renders `compat unknown`. Repository, workspace,
manager, catalog, age, and compatibility facts come only from these inputs. Absent facts are
omitted or rendered unknown and are never inferred from paths, filenames, process runtime, or
enumeration order. Task 4 must build this input from the already resolved selection using one fixed
startup clock and exact plan projections before enabling Visual+.

Every path-bearing metadata value (`repository.relativePath`, manager source, owner physical
target, catalog source, receipt group/target path, and recovery path) uses the same safe `.` or
repository-relative containment rule. All IDs, labels, names, versions, details, and sources must
be nonempty after terminal sanitization when their state requires them. `observed` manager evidence
requires a name and at least one source; `ambiguous` requires at least two distinct candidates;
`unknown` carries no candidate, name, version, or source. Contradictory shapes fail closed.

Task 4 maps `ResolvedDepChange.nodeCompatible === true` to `compatible`, `false` to
`incompatible`, and `undefined` to `unknown`; sanitized `nodeCompat` may be retained only as detail.
It captures one finite startup wall-clock value. A valid `publishedAt` not later than that clock
becomes the floored non-negative millisecond difference; malformed/future/missing timestamps become
`ageMs: null`. Supplied ages must be finite non-negative integers or fail closed.

`writeReceipt.canonical` is a deeply copied and recursively frozen projection produced from the
existing canonical `buildWriteReceipt()` path. Its operation IDs, target membership, and recovery
copy must exactly equal the snapshot selection/results/recovery. Canonical applied, skipped,
conflicted, reverted, failed, and unknown operation totals must respectively equal snapshot
applied, skipped, blocked, reverted, failed, and unknown totals. Canonical planned-file count must
equal selected target count, and every non-applied canonical group path must be one selected target.
Restored/unrecovered paths must be safe selected targets. A duplicate, missing, extra, or
contradictory fact fails closed before receipt prose. The renderer must not recompute replacement
attempts, cleanup certainty, or the zero-file predicate from snapshot statuses or diagnostic prose.

- [x] **Step 1: Write complete section RED snapshots**

Use a fixture with counts `66/616/612/0/76/76/14`, 76 unique changes and metadata entries, 15
logical owner groups, and 14 physical targets. Exactly one physical target is shared by two logical
groups; every change ID belongs to one group and one target. Assert all 76 dependency names occur
exactly once in change rows and all 14 target paths have exactly one structured transaction entry.
Owner-group cross-references may repeat a physical path and are not transaction entries. Assert
owner ordering is stable, success/block receipts are exact, and no visible line exceeds the
requested width.

- [x] **Step 2: Run section RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/sections/sections.test.ts`

Expected: FAIL because the section modules do not exist.

- [x] **Step 3: Implement shared semantic tokens**

Define text labels for pending, active, passed, skipped, blocked, failed, unknown, applied,
reverted, and not attempted. Color and Unicode symbols decorate those labels but never replace
them. Do not introduce gradients, banners, logos, or box art without meaning.

The header renders command mode, sanitized repository path/name, workspace scope, observed package
manager evidence, and explicit read-only/write intent. `relativePath` accepts only `.` or a safe
repository-relative path; absolute, parent-traversing, empty-segment, control-bearing, or otherwise
unsafe values fail closed. It never infers a manager from filename order or exposes an absolute
path outside the selected root.

- [x] **Step 4: Implement complete owner-grouped rows**

Each row exposes dependency, current, target, diff, age, and compatibility. Wide/medium layouts use
columns; narrow/plain layouts use wrapped labeled lines. Do not truncate semantic values into
ambiguity: move them to continuation lines. Replace unexplained `?node` with `compat unknown` or
render a visible same-section legend. `topology.ts` renders only the count flow and stable owner
grouping; relationship, impact, shared-surface, and risk maps remain owned by Plan 035.

Sanitize every raw value before styling. Lossless wrapping may split a long semantic token only at
grapheme boundaries and must retain every sanitized grapheme across continuation lines; ellipsis
must never replace names, versions, paths, statuses, or receipt facts. Each emitted line satisfies
`visualLength(line) <= max(1, width)`. Apply and reset ANSI styling independently per wrapped
fragment. When `unicode=false`, use ASCII tokens and separators only. At normalized width `1`,
encode every width-two grapheme as a reversible ASCII `U+{HEX...}` token before one-column wrapping;
at width `2` and above retain the sanitized grapheme itself.

- [x] **Step 5: Implement transaction and receipts**

Render the command transaction phase rail once, then every physical target with its exact selected
membership and final result. Before target results exist, render `pending`; never project the global
active phase onto an individual target. Success copy must be equivalent to:

```text
Complete · 76 updates applied across 14 files
Applied 76  Blocked 0  Not attempted 0  Failed 0  Unknown 0
All 14 target files were observed at the requested values. Recovery was not needed. 2.4s.
Exit 0
```

Preflight block before replacement must be equivalent to:

```text
Safety block · no files were changed
Applied 0  Blocked 76  Not attempted 76  Failed 0  Unknown 0
Preflight could not confirm Git state for package.json.
Exit 2
```

Render the snapshot's operation totals exactly. `blocked`, `notAttempted`, and `unknown` are
independent, overlapping dimensions; never synthesize `unknown` from a diagnostic. Also render
nonzero `skipped` and `reverted` operation totals so no result is hidden; `mixed` is rendered only
from `snapshot.results.targetTotals.mixed`. The five example counts come from operation totals.

Use this ordered receipt decision table; the first matching row wins:

| Condition | Headline/claim |
| --- | --- |
| Invalid or mismatched immutable input | Fail closed; integration returns exit `2` and emits no success or zero-file claim |
| `exitCode === null` | `Pending`; no final claim |
| `write === false`, exit `0` | `Review complete`; use `no updates` or exact reviewed update/target counts |
| `write === false`, exit `1` | `Review complete · updates available`; use exact counts |
| `write === false`, exit `2` | `Review incomplete`; use exact counts/diagnostics |
| Write with zero selected operations/targets, exit `0` | `Complete · no selected updates`; never say applied or no files changed |
| Write with zero selected operations/targets, exit `1` or `2` | `Write incomplete · no selected updates`; render exact exit |
| Missing receipt on a final nonempty write | `Result unknown · receipt evidence unavailable` |
| Recovery executed and `completed` | `Recovered`; list every restored path; never use the strict complete/zero-file claims |
| Recovery `partial` | `Recovery incomplete`; list restored and unrecovered paths |
| Recovery `unknown` | `Recovery unknown`; list retained safe evidence |
| Canonical `safety-block` with `noFilesChanged === true` | `Safety block · no files were changed` |
| Canonical `partial` | `Partial` |
| Canonical `failed` | `Failed` |
| Canonical `unknown` | `Unknown` |
| Canonical `complete`, every operation/target applied, observe passed, recovery `not-needed`, exit `0` | Exact strict `Complete` and observed-requested-values claims |
| Canonical `complete` with skipped operations and exit `0` | `Complete · A applied, S skipped across F files`; no all-requested-values claim |
| Canonical `complete` with nonzero exit or any other non-strict shape | `Write complete · command incomplete`; render exact totals and exit |

Canonical `safety-block` with `noFilesChanged !== true`, contradictory recovery/verdict shapes, or
any case not covered by the table is invalid input and fails closed. Partial/recovery cases list
restored and unrecovered physical files and never use the zero-file claim; every final branch
renders the exact exit code.

- [x] **Step 6: Run section GREEN snapshots**

Run sections, format/ANSI, width, current render, and overflow tests. Expected: all pass for both
capable and constrained modes at 8/10/40/60/80/118 columns with hostile ANSI, OSC, bidi, control,
combining, emoji, and wide-grapheme inputs contained. Color/no-color and Unicode/ASCII variants
retain identical words and numbers.

Task 2 changes to `table-rows.ts` are pure and additive. Existing `renderRows()`, `buildHeader()`,
`renderTimediff()`, callers, truncation, and legacy output bytes remain unchanged until Task 4.

**Completion evidence (2026-07-18):** Pure Visual+ input, theme, wrapping, header, lifecycle,
topology, change, transaction, and receipt sections were implemented in `47a64c7`. The initial RED
failed before collection because `../input` did not exist. The final acceptance matrix passed
128/128 section, canonical receipt, ANSI, width, overflow, and legacy-render tests; the combined
section plus authoritative run-model proof passed 172/172, and the final union passed 226/226.
Typecheck, focused Biome, and untracked-aware whitespace checks passed. The acceptance fixture
retains all 76 rows, 15 logical owners, 14 exact physical targets, immutable fail-closed evidence,
canonical receipt authority, complete recovery truth, constrained/capable width coverage, and
hostile terminal containment. No `table-rows.ts` change was required, so legacy renderer bytes and
callers remain untouched. Final spec and terminal/security reviews reported no Critical, Important,
or Minor findings.

### Task 3: One live renderer and cursor owner

**Files:**

- Create: `src/commands/check/visual-plus/renderer.ts`
- Create: `src/commands/check/visual-plus/renderer.test.ts`
- Create: `src/commands/check/visual-plus/index.ts`
- Modify: `src/commands/check/visual-plus/sections/lifecycle.ts`
- Modify: `src/commands/check/visual-plus/sections/transaction.ts`
- Modify: `src/commands/check/visual-plus/sections/sections.test.ts`
- Verify unchanged: `src/commands/check/progress.ts`
- Verify unchanged: `src/commands/check/progress.test.ts`

**Interfaces:**

- Consumes: `CheckRunController`, capability decision, immutable run/change metadata, canonical
  receipt evidence, output writer, and injected scheduler.
- Produces: `createVisualPlusRenderer(options): VisualPlusRenderer`.

Task 3 uses these exact package-private contracts:

```ts
export interface VisualPlusOutputWriter {
  write(chunk: string): void
}

export interface VisualPlusScheduler {
  schedule(callback: () => void, delayMs: number): () => void
}

export interface CreateVisualPlusRendererOptions {
  capabilities: VisualPlusCapabilities
  writer: VisualPlusOutputWriter
  scheduler: VisualPlusScheduler
  onError(error: unknown): void
}
```

The production scheduler used in Task 4 must create an unreferenced timeout and return an
idempotent cancel function. The renderer never reads `process`, `console`, logger state, terminal
width, or environment state, never writes stderr, and never owns process signal listeners. All
durable and live bytes use the same synchronous stdout writer so ordering is observable. Each
durable line is written with exactly one trailing `\n`. Stream buffering and backpressure remain
the injected writer's responsibility.

`schedule()` receives exactly `50` ms and may be called only when no callback is pending. Startup
feedback is synchronous; later snapshots coalesce to the newest snapshot in the one pending
callback, so updates render at most 20 times per second. Cancellation invalidates the callback even
if an adversarial scheduler invokes it later. Plain/non-motion modes never call `schedule()`.

The renderer is `idle -> live -> review-written -> finalized`, with `failed` and `disposed` terminal
states. `start()` subscribes exactly once and safely handles the controller's synchronous initial
notification. It requires the initial snapshot to have zero selected operations, targets, and
results; a late start fails before output. A repeated start fails before output. `writeReview()` and
`finalize()` each accept one validated deep-frozen input. Identical retries are no-ops; divergent
retries fail closed. Nonempty finalization requires a prior review. Zero-selection early
finalization may omit review. `dispose()` is idempotent.

The renderer observer catches all writer, scheduler, and render failures because controller
observers do not propagate errors. It cancels, clears only its live region, unsubscribes, calls
`onError()` once, ignores any error thrown by `onError()`, and schedules no more work. A synchronous
initial observer failure is rethrown by `start()` after subscription cleanup. A failure from an
explicit renderer method is rethrown after cleanup. A failure from a user-supplied suspension
callback tears down and rethrows the original callback error without calling `onError()`.
All internal writer, scheduler, or render failures, synchronous or asynchronous, call `onError()`
once; failures reached through an explicit method additionally rethrow the original error. Cleanup
and `onError()` failures never replace that first error. Contract and usage errors, including late
or repeated start, illegal state calls, divergent retries, and stale or foreign input, clean up and
rethrow without calling `onError()`. User suspension callback failures also do not call `onError()`.

- [x] **Step 1: Write renderer lifecycle RED tests**

Assert synchronous feedback (and therefore feedback within 100 ms), one active indicator, one
pending 50 ms callback, burst coalescing, durable nested sync/async suspension, stable phase
resolution, no frames after finalize/error/termination disposal, idempotent cleanup, and no timer
or cursor bytes in plain modes. Include golden raw-byte transcripts for zero/one/multiple wrapped
lines, growth, shrinkage, suspend/resume, narrow width, finalization, adversarial post-cancel
callbacks, and writer/scheduler failure. Add stale/foreign controller snapshot and
finalize-during-async-suspension REDs; both fail before transaction, receipt, or success bytes. Add
a capable reduced-motion case with color and wide layout: SGR is allowed, while timers, carriage
returns, erase, movement, hide, and show bytes remain absent.

```ts
export interface VisualPlusRenderer {
  start(controller: CheckRunController, run: VisualPlusRunMetadata): void
  writeReview(input: VisualPlusSectionInput): void
  finalize(input: VisualPlusSectionInput): void
  suspend<T>(write: () => T): T
  suspendAsync<T>(write: () => Promise<T>): Promise<T>
  dispose(): void
}
```

`start()` may render only lifecycle and already supplied run facts. `writeReview()` is called only
after exact change metadata and pre-apply physical targets reconcile. `finalize()` receives the
same immutable selection plus canonical write-receipt evidence when `snapshot.write` is true.

Section ownership is exact. `start()` validates the zero-selection startup snapshot, writes the
header and one `Lifecycle` heading durably, and then owns only the current lifecycle phase as a live
region. Each newly terminal phase is cleared from the live region and appended durably exactly
once in canonical phase order; pending phases are never written. `writeReview()` first validates
and freezes the full input, requires capability equality and full equality to the latest subscribed
controller snapshot, then flushes the latest lifecycle state, suspends the live region, and writes
topology plus the complete change list once. It does not write transaction or receipt rows.
`finalize()` first cancels pending callbacks and,
before flushing or clearing lifecycle state, requires the review/final `input.snapshot` to be
semantically equal to the latest snapshot delivered by the subscribed controller. It also validates
semantic equality of run metadata, ordered operation metadata, snapshot changes, and target
membership against the review input. Only after every validation succeeds does it flush and clear,
write the final physical-target transaction once for every nonempty read-only or write run, write
the final receipt once, cancel, and unsubscribe. `transaction.ts` uses the existing `Apply
transaction` heading for write runs and the neutral `Reviewed physical targets` heading for
read-only runs without changing its target rows. Snapshot equality covers the full ordered
`CheckRunSnapshot` contract, not only its selection. Every review/final input must also contain
capabilities field-equal to the immutable startup `options.capabilities`; width, layout, color,
Unicode, motion, or cursor-control drift fails before section bytes. Equality is field equality in
the contract's canonical array order, not object identity. A mismatch or invalid final receipt
tears down before any transaction, command-success lifecycle, or receipt bytes.

The observer never commits the terminal `complete` lifecycle row when `snapshot.exitCode` is
non-null. It retains that command verdict until `finalize()` validates the authoritative final
input. Other phase rows are factual lifecycle evidence and may resolve normally. Successful
finalization then appends `complete` exactly once before the transaction and receipt; failed
validation clears only any owned live frame and emits no command-success lifecycle row.

Add a pure lifecycle-phase helper to `sections/lifecycle.ts` so incremental rows retain Task 2
wrapping, sanitization, color, Unicode, and ASCII behavior without fabricating a full section input.
Capable cursor mode uses the current raw frame protocol: write each owned line as
`\r\x1B[2K<line>\n`; before replacement or clearing, move up by the exact owned physical-line
count, erase that many lines, and return to the top. Frames may grow or shrink and may erase only
owned lines. The renderer never hides or shows the cursor. Plain/non-motion mode is append-only: it
writes a lifecycle row only when the phase/status bytes change, creates no timer, and emits no
carriage return or cursor-control erase, movement, hide, or show bytes. ANSI SGR styling remains
allowed whenever the immutable capability has `color: true`, including a capable reduced-motion
terminal; constrained plain capabilities remain colorless under Task 1.

Outermost `suspend()`/`suspendAsync()` cancels the pending callback, flushes terminal lifecycle
facts, clears the owned live frame, runs or awaits the durable callback, and redraws only the newest
active phase when the renderer is still live. Nested suspension is depth-counted and performs no
extra clear/redraw. Finalize, dispose, renderer failure, and callback failure cancel before teardown
and never redraw. Suspension is legal only in `live` or `review-written`; outside those states it
fails before invoking the callback. `writeReview()` and `finalize()` fail closed while a user
suspension is active. `dispose()` ends renderer ownership during an outstanding asynchronous
suspension but cannot suppress later bytes written by that caller-owned callback. Task 4 must await
every `suspendAsync()` before finalization, and route-level tests must prove that ordering.

- [x] **Step 2: Run renderer RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/renderer.test.ts`

Expected: FAIL because the renderer does not exist.

- [x] **Step 3: Implement bounded live-region rendering**

Reuse the current 50 ms maximum refresh cadence. Redraw only lifecycle lines, clear only lines the
renderer owns, and suspend/resolve the live region before any durable section. On non-motion modes,
write a phase only when state changes. Never replay accumulated frames.

- [x] **Step 4: Preserve compatibility ownership until route migration**

Task 3 is standalone and dormant. Keep `progress.ts` behavior and bytes unchanged while its callers
still exist. Task 4 must construct exactly one of legacy progress or Visual+ for a route, disable
legacy progress on the Visual+ route, and then decide whether extracting a shared primitive is
useful. JSON, silent, library, interactive, global, and global-all routes retain their current
owners. Real signal-to-renderer disposal is also a Task 4 integration responsibility; Task 3 proves
the termination contract through `dispose()` and adds no renderer-owned process listener.

Width is the immutable startup capability width from Task 1 for all Task 3 frames. Resize-aware
rendering is deferred unless a later plan explicitly adds an injected width source; the renderer
must not privately reread `process.stdout.columns`.

- [x] **Step 5: Run renderer GREEN tests**

Run renderer/progress/orchestration tests with fake timers and real output buffers. Expected: all
pass, no open handles, and final scrollback contains no spinner or erased durable content.

**Completion evidence (2026-07-18):** The exact writer, scheduler, lifecycle, suspension,
validation, reentrancy, and compatibility contract was defined in `3b9c3b9` after two independent
authority audits stopped the underspecified original task. The live renderer and pure incremental
lifecycle/read-only-target helpers were implemented in `3db6f80`. The initial RED failed before
collection with `Cannot find module './renderer'`. Review-driven RED waves then proved six contract
gaps, one retained-ownership cleanup leak, and two atomic clear/draw boundary failures before their
fixes. The final focused matrix passed 241/241 tests across renderer, sections, legacy progress,
controller, run model, and orchestration. Typecheck, focused Biome, whitespace, and byte checks
passed; `progress.ts`, its tests, callers, and Task 4 integration files remain unchanged. Atomic
accepted clear/draw chunks retain exact physical-line ownership, never erase durable content, and
remain safe when a hostile injected writer swallows reentrant renderer calls. Final independent
spec and terminal-quality reviews reported no Critical, Important, or Minor findings. Task 4 is
next and owns exclusive route construction plus real signal integration.

### Task 4: Integrate Visual+ as default human output

**Files:**

- Create: `src/commands/check/visual-plus/integration.ts`
- Create: `src/commands/check/visual-plus/integration.test.ts`
- Create: `src/cli/signals.test.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/signals.ts`
- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/render/index.ts`
- Modify: `src/commands/check/write-flow.ts`
- Modify: `src/commands/apply/legacy-plan.ts`
- Modify: `src/commands/apply/legacy-plan.test.ts`
- Modify: `src/commands/check/test-helpers.ts`
- Modify: `src/commands/check/check.command-apply.integration.test.ts`
- Modify: `src/commands/check/run-check.model.test.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`
- Modify: `src/commands/check/check.edge-cases.test.ts`
- Modify: `src/commands/check/check.json-output.test.ts`
- Modify: `src/commands/check/check.interactive-fallback.test.ts`
- Modify: `src/commands/check/tui/index.ts` only if needed to preserve explicit interactive mode

**Interfaces:**

- Consumes: authoritative run controller and Visual+ renderer.
- Produces: default CLI table output with unchanged machine/library surfaces.

Task 4 uses this exact route predicate:

```ts
const visualPlusEligible =
  renderProgress &&
  options.output === 'table' &&
  options.loglevel !== 'silent' &&
  !options.interactive &&
  !options.global &&
  !options.globalAll &&
  !options.beforePackageWrite &&
  !options.addons?.some((addon) => addon.beforePackageWrite !== undefined)
```

`renderProgress` is the existing CLI/library boundary: `checkFromCli()` passes `true`; direct
library `check()` passes `false`. Both `info` and `debug` table CLI runs are eligible. JSON, silent,
library, explicit interactive, global, global-all, and invocations with a direct or addon
`beforePackageWrite` hook are excluded and retain their current bytes, callbacks, cursor owners,
and result semantics. The current lifecycle exposes no authoritative outcome for a vetoed selected
change, so Task 4 must not invent a Visual+ skipped result or hide a vetoed row. Focused route tests
cover full, partial, and shared-target veto cases and prove they remain on the unchanged legacy
path with no additional mutation.

Immediately after option validation, an eligible route detects capabilities once, captures one
finite nonnegative integer `Date.now()` for release-age projection, creates the run controller with
the monotonic `performance.now()` clock, and starts Visual+ before package loading. An invalid wall
clock is an instrumentation error before renderer start. Task 4 startup metadata is intentionally
truthful and minimal:

```ts
const startupRun: VisualPlusRunMetadata = {
  workspaceScope: 'unknown',
  packageManager: { status: 'unknown', sources: [] },
}
```

Do not infer or later replace repository, workspace, or manager facts from package counts,
filenames, lockfile order, or executor state. The production writer calls only
`process.stdout.write(chunk)`. The production scheduler uses one `setTimeout(callback, 50)`, calls
`unref()`, and returns an idempotent cancel closure. It never uses an interval. `onError` retains
the first renderer failure without logging reentrantly; orchestration checks and throws that error
before selection, apply, and finalization. The catch path disposes Visual+, emits the existing
sanitized error once, and never fabricates a final receipt.

The real CLI passes a package-private terminal lifecycle into `checkFromCli()` from
`src/cli/index.ts`; direct `checkFromCli()` tests may omit it:

```ts
export interface CliTerminalLifecycle {
  registerSignalCleanup(cleanup: () => void): () => void
}
```

`src/cli/signals.ts` implements registration with idempotent unregister. `SIGINT` and `SIGTERM`
snapshot and remove registered cleanups, invoke each at most once while swallowing cleanup errors,
then preserve the existing cursor restore and immediate exit `130`/`143`. The normal `exit` handler
continues to restore the cursor. Only an eligible real CLI run registers `renderer.dispose`; it
unregisters in `finally`. Library code never imports or installs CLI signal handlers, and the
renderer owns no process listener.

#### Authoritative selection evidence

`createLegacyPlan()` produces a deeply copied and frozen package-private evidence result after
operation IDs are assigned:

```ts
export type LegacySelectionEvidenceResult =
  | { status: 'ready'; evidence: LegacySelectionEvidence }
  | {
      status: 'unavailable'
      reason: 'UNSUPPORTED_WRITE_SOURCE' | 'UNBOUND_OPERATION' | 'INCONSISTENT_SELECTION_EVIDENCE'
    }

export interface LegacySelectionEvidence {
  readonly operations: readonly {
    readonly operationId: string
    readonly packageIndex: number
    readonly changeIndex: number
    readonly ownerLabel: string
    readonly physicalTarget: string
    readonly occurrencePath: readonly string[]
    readonly name: string
    readonly current: string
    readonly target: string
    readonly diff: 'major' | 'minor' | 'patch'
    readonly publishedAt?: string
    readonly nodeCompatible?: boolean
    readonly nodeCompat?: string
    readonly catalog?: { readonly name: string; readonly sourcePath: string }
  }[]
  readonly targets: readonly {
    readonly path: string
    readonly operationIds: readonly string[]
  }[]
}
```

Evidence contains no `PackageMeta`, `ResolvedDepChange`, plan, projection, or mutable aliases.
Operations retain plan physical order, followed by blocked physical operations in stable key order;
targets sort by exact contained repository-relative path and retain operation membership order.
Manifest operations omit `catalog`. Catalog operations retain the exact matched catalog name and
repository-relative source path, and `catalog.sourcePath` must equal `physicalTarget`.

One physical operation may have multiple consumer projections. Its canonical renderer owner is the
lowest `packageIndex`, then lowest `changeIndex`; owner group ID is `package:<packageIndex>`, order
is the package index, and label is the package name only when
`sanitizeTerminalText(name).trim()` is nonempty, otherwise the exact contained
repository-relative package source path. Store the sanitized nonempty label. Both
`CheckRunChange.owner` and `VisualPlusChangeMetadata.ownerGroup.physicalTarget` map to the evidence
`physicalTarget`; the metadata owner group is exactly
`{ id: package:<packageIndex>, order: packageIndex, label: ownerLabel }`. Every duplicate projection
must agree on name, physical current/target values, diff,
`publishedAt`, `nodeCompatible`, `nodeCompat`, and catalog identity. Disagreement yields
`INCONSISTENT_SELECTION_EVIDENCE`; unsafe, unsupported, or unbound physical truth yields the other
unavailable reasons. Legacy non-Visual callers retain their existing blocked-result behavior, but
the Visual+ route treats unavailable evidence as an instrumentation error, disposes, reports the
sanitized error, and exits `2` before claiming a target or applying a file.

`applyLegacyCommandWrite(root, selections, authority, observer?)` invokes its optional observer
synchronously with the frozen evidence result immediately after `createLegacyPlan()` and before
the blocked-result branch, the apply engine's VCS preflight, or any replacement. Plan construction
may already collect its existing read-only Git evidence. An observer throw aborts with no
apply side effect. For read-only runs, construct the same `LegacyCommandSelection[]` after package
preparation from every non-global `prepared.selected`, regardless of `writeApproved`, and call
`createLegacyPlan()` once without invoking apply. Remove the approximate `emitReadOnlySelection()`
IDs and manifest targets.

`visual-plus/integration.ts` is pure. It consumes ready evidence plus the fixed startup wall clock
and produces one reconciled set of ordered `CheckRunChange`, `CheckRunTarget`, and
`VisualPlusChangeMetadata`. Missing, malformed, or future `publishedAt` becomes `ageMs: null`;
otherwise age is the finite nonnegative clock difference. `nodeCompatible: true/false` maps to
compatible/incompatible; missing maps to unknown; optional `nodeCompat` is sanitized detail.
Run-model selection and Visual+ review must consume this same object. After write apply,
phase/result projection must reconcile against the already emitted operation IDs and targets and
must not emit or reconstruct selection again.

#### Output and finalization order

On the Visual+ route, construct exactly one of Visual+ or legacy progress, never both. Use the
chosen owner as the sync/async durable-output arbiter. Explicit selection/discovery reports,
resolution-error details, addon output, requested profile output, and post-write command output
remain visible exactly once through suspension. Suppress only the legacy change table, up-to-date
rows, checked summary, old local write receipt, status warning, and tips on the Visual+ route.
Global renderers remain excluded. The non-TTY structured-output hint remains on stderr after the
complete Visual+ receipt so it cannot split or obscure stdout evidence.

For write runs, the plan observer emits controller selection and `writeReview()` before preflight.
For read-only runs, emit the same selection and review immediately after preparation. Errors that
cannot be represented by the current pure sections, including individual resolution failures,
remain durable sanitized detail lines rather than being hidden. The command controller emits all
phases/results and `run-completed` with the final exit decision before renderer finalization.

Build the canonical local `WriteReceipt` once. Excluded routes render it exactly as before. A
nonempty Visual+ write finalizes with that same canonical object, evidence operation IDs/targets,
and authoritative snapshot recovery. Read-only and zero-selection finalization follow the Task 3
contract without invented receipt evidence. If an exception occurs after selection but before a
canonical receipt exists, dispose and use the existing sanitized error path; never emit terminal
success, transaction, or fallback receipt bytes. Await every `suspendAsync()` before finalization,
then finalize once, unregister signal cleanup in `finally`, and allow no later frame.

Implement Task 4 in two reviewed slices: first the frozen legacy selection-evidence seam and pure
integration projection, then the CLI route/output/signal migration. Do not start the route slice
until the evidence slice has focused tests and independent review.

- [ ] **Step 1: Write default-output RED journeys**

Assert normal `checkFromCli(... output: 'table')` instantiates Visual+, while JSON, silent, direct
library `check()`, and explicit interactive selection preserve their documented paths. Assert each
change row is emitted once, not once by old render and once by Visual+. Characterize `info` and
`debug` eligibility; global/global-all exclusion; no-package/no-update; fixed-clock ages; catalog and
shared-target membership; read-only exit `0`/`1`; write success/block/revert/unknown; strict and
non-strict resolution/post-write errors; addon/profile output; non-TTY ordering; renderer failure;
and real signal cleanup. Prove direct/addon `beforePackageWrite` hooks, including full, partial, and
shared-target vetoes, select the unchanged legacy route; observer-before-preflight; observer-throw
zero mutation; canonical receipt reuse; no selection reconstruction; one timer/cursor owner; no
ANSI in JSON; no bytes in silent; library callback compatibility; and interactive TUI ownership.

- [ ] **Step 2: Run integration RED tests**

Run the orchestration/edge/JSON/interactive suites. Expected: FAIL because current tables and
progress are still written directly.

- [ ] **Step 3: Route human output through one renderer**

Subscribe Visual+ at command start, emit durable review after resolution/selection, update the
single command transaction rail during apply, and finalize target outcomes after the exit decision
is known. Suppress old table, summary, per-write warning, and progress output only on the Visual+
route. Never invent a per-target live phase; targets have exact pending/final result states while
the command rail owns the active phase.

- [ ] **Step 4: Preserve fallbacks and cleanup**

Plain modes use the same pure sections sequentially. Catch/finally and signals dispose once. JSON
must contain no ANSI/human lines; silent must remain silent; non-TTY writes the existing structured
output hint only if it does not obscure the final receipt.

- [ ] **Step 5: Run GREEN integration tests**

Expected: all focused suites pass; complete rows/targets/receipt appear once; JSON bytes and library
callback behavior remain compatible.

### Task 5: Core renderer verification gate

**Files:**

- Modify: `plans/034-visual-plus-v2-core.md` with exact completion evidence only after proof
- Modify: `plans/README.md` and `.superpowers/sdd/progress.md` only when marking done

**Interfaces:**

- Consumes: Tasks 1-4.
- Produces: stable Visual+ core for Plan 035 insights and PTY proof.

- [ ] **Step 1: Run focused tests three times**

Repeat capabilities, sections, renderer, progress, orchestration, command apply, JSON, interactive,
width, ANSI, and overflow suites. Expected: stable pass counts and no timer/handle leaks.

- [ ] **Step 2: Run complete gates**

Run schemas check, typecheck, lint, full coverage, build, smoke, demo, and packed verification.
Expected: all exit `0` with no new runtime dependency.

- [ ] **Step 3: Review semantic and terminal safety**

Require one UX/content review and one terminal-control/security review. Stop Plan 035 if any result
is hidden, any line overflows required widths, or cursor ownership is ambiguous.
