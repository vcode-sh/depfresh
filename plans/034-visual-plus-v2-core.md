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
- Visual+ v2 is the default human terminal interface for `table` output. Full-screen Focus
  TUI/OpenTUI and alternate screen mode are out of scope.
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

- [ ] **Step 1: Write capability RED tests**

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

- [ ] **Step 2: Run capability RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/capabilities.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement one startup decision**

Detect capabilities once per run. Use deterministic layout thresholds proved by snapshots, not
terminal brand detection. `TERM=dumb` forces ASCII/plain/no motion; non-TTY and CI force
plain/no-motion/no cursor; `NO_COLOR` changes only color; zero columns use width 80.

- [ ] **Step 4: Run capability GREEN tests**

Run the new test plus current `progress.test.ts`, `render-overflow.test.ts`, and typecheck.
Expected: all pass and existing width utilities remain compatible.

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
- Modify: `src/commands/check/render/table-rows.ts`

**Interfaces:**

- Consumes: `CheckRunSnapshot`, `VisualPlusCapabilities`, and selected change metadata.
- Produces: pure `readonly string[]` section functions with no I/O or timers.

- [ ] **Step 1: Write complete section RED snapshots**

Use a fixture with 15 owner groups, 76 changes, and 14 physical targets. Assert all 76 dependency
names and all 14 target paths occur exactly once, owner ordering is stable, success/block receipts
are exact, and no visible line exceeds the requested width.

- [ ] **Step 2: Run section RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/sections/sections.test.ts`

Expected: FAIL because the section modules do not exist.

- [ ] **Step 3: Implement shared semantic tokens**

Define text labels for pending, active, passed, skipped, blocked, failed, unknown, applied,
reverted, and not attempted. Color and Unicode symbols decorate those labels but never replace
them. Do not introduce gradients, banners, logos, or box art without meaning.

The header renders command mode, sanitized repository path/name, workspace scope, observed package
manager evidence, and explicit read-only/write intent. It never infers a manager from filename
order or exposes an absolute path outside the selected root.

- [ ] **Step 4: Implement complete owner-grouped rows**

Each row exposes dependency, current, target, diff, age, and compatibility. Wide/medium layouts use
columns; narrow/plain layouts use wrapped labeled lines. Do not truncate semantic values into
ambiguity: move them to continuation lines. Replace unexplained `?node` with `compat unknown` or
render a visible same-section legend.

- [ ] **Step 5: Implement transaction and receipts**

Render every physical target with phase/result. Success copy must be equivalent to:

```text
Complete · 76 updates applied across 14 files
Applied 76  Blocked 0  Not attempted 0  Failed 0  Unknown 0
All 14 target files were observed at the requested values. Recovery was not needed. 2.4s.
Exit 0
```

Preflight block before replacement must be equivalent to:

```text
Safety block · no files were changed
Applied 0  Blocked 76  Not attempted 76  Failed 0  Unknown 76
Preflight could not confirm Git state for package.json.
Exit 2
```

Partial/recovery cases must list restored and unrecovered physical files and never use the zero-file
claim without observed original bytes.

- [ ] **Step 6: Run section GREEN snapshots**

Run sections, format/ANSI, width, current render, and overflow tests. Expected: all pass at
8/10/40/60/80/118 columns with hostile Unicode/control inputs contained.

### Task 3: One live renderer and cursor owner

**Files:**

- Create: `src/commands/check/visual-plus/renderer.ts`
- Create: `src/commands/check/visual-plus/renderer.test.ts`
- Create: `src/commands/check/visual-plus/index.ts`
- Modify: `src/commands/check/progress.ts`
- Modify: `src/commands/check/progress.test.ts`

**Interfaces:**

- Consumes: `CheckRunController`, capability decision, output writer, and injected scheduler.
- Produces: `createVisualPlusRenderer(options): VisualPlusRenderer`.

- [ ] **Step 1: Write renderer lifecycle RED tests**

Assert feedback within 100 ms, one active indicator, timer throttling, durable suspension, stable
phase resolution, no frames after finalize/error/signal, idempotent cleanup, and no cursor bytes in
plain modes.

```ts
export interface VisualPlusRenderer {
  start(controller: CheckRunController): void
  writeReview(snapshot: CheckRunSnapshot): void
  finalize(snapshot: CheckRunSnapshot): void
  dispose(): void
}
```

- [ ] **Step 2: Run renderer RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/renderer.test.ts`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement bounded live-region rendering**

Reuse the current 50 ms maximum refresh cadence. Redraw only lifecycle lines, clear only lines the
renderer owns, and suspend/resolve the live region before any durable section. On non-motion modes,
write a phase only when state changes. Never replay accumulated frames.

- [ ] **Step 4: Retire duplicate progress ownership**

Make `progress.ts` a compatibility wrapper or remove its private cursor loop after all callers move.
There must be exactly one timer and cursor owner. Preserve current cleanup behavior during errors.

- [ ] **Step 5: Run renderer GREEN tests**

Run renderer/progress/orchestration tests with fake timers and real output buffers. Expected: all
pass, no open handles, and final scrollback contains no spinner or erased durable content.

### Task 4: Integrate Visual+ as default human output

**Files:**

- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/render/index.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`
- Modify: `src/commands/check/check.edge-cases.test.ts`
- Modify: `src/commands/check/check.json-output.test.ts`
- Modify: `src/commands/check/check.interactive-fallback.test.ts`
- Modify: `src/commands/check/tui/index.ts` only if needed to preserve explicit interactive mode

**Interfaces:**

- Consumes: authoritative run controller and Visual+ renderer.
- Produces: default CLI table output with unchanged machine/library surfaces.

- [ ] **Step 1: Write default-output RED journeys**

Assert normal `checkFromCli(... output: 'table')` instantiates Visual+, while JSON, silent, direct
library `check()`, and explicit interactive selection preserve their documented paths. Assert each
change row is emitted once, not once by old render and once by Visual+.

- [ ] **Step 2: Run integration RED tests**

Run the orchestration/edge/JSON/interactive suites. Expected: FAIL because current tables and
progress are still written directly.

- [ ] **Step 3: Route human output through one renderer**

Subscribe Visual+ at command start, emit durable review after resolution/selection, emit target
transaction state during apply, and finalize after the exit decision is known. Suppress old table,
summary, per-write warning, and progress output only on the Visual+ route.

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
