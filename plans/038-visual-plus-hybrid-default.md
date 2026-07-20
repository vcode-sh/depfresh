# Visual+ Hybrid Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat compact Visual+ transcript with a v1.x-inspired hybrid default that
shows rich context, severity, major-risk focus, and every canonical update exactly once while
preserving the complete audit under `--long` and every existing safety/recovery guarantee.

**Architecture:** Extend immutable renderer input with explicit display intent and canonical row
order, then project pure responsive hybrid sections from the existing authoritative snapshot.
Compact lifecycle ownership becomes transient in capable terminals and silent in constrained
success paths; full audit, excluded routes, command truth, and canonical receipts remain separate
unchanged surfaces. Artifact-bound PTY goldens and a live Spreadoo replay gate the local candidate.

**Tech Stack:** TypeScript, Vitest, Biome, Node `24.15.0`, npm `11.12.1`, pnpm `10.33.0`, ansis,
existing PTY/terminal-emulation helpers, existing Bun `1.3.14` local global-package workflow. No
OpenTUI or new runtime/native dependency.

**Status:** READY. Commit `48eec95` introduced the design; this planning change records its approval.
Implementation has not started.

**Design:** `docs/superpowers/specs/2026-07-20-visual-plus-hybrid-default-design.md`

## Global Constraints

- All code, documentation, tests, plans, reports, and commit messages are English.
- Work on `main`, preserve unrelated files, and commit each independently reviewed task.
- Use test-driven development: every production behavior starts with a focused failing test and
  recorded RED output before implementation.
- Keep package version `2.1.1`; it remains an unpublished local candidate.
- The default eligible route renders context, overview, every major-risk dependency group, every
  canonical `snapshot.changes` operation exactly once, and a truthful receipt.
- Repeated catalog consumers or logical occurrences never duplicate ledger rows; the exhaustive
  occurrence/owner/target audit remains under `--long`.
- Successful compact output contains no durable lifecycle rail, bounded audit previews, or internal
  operation, owner, dependency, or source-file IDs.
- Capable compact lifecycle uses one replaceable active-phase line. Constrained compact output emits
  no append-only phase history or cursor control.
- `--long` retains current exhaustive lifecycle, operations, owners, shared dependencies,
  occurrences, targets, and receipts.
- Every blocked, failed, unknown, not-attempted, recovery-restored, unrecovered, and retained-journal
  fact required by the current contract remains visible without compact limits.
- JSON, silent, direct library, global/global-all, explicit interactive, and veto-capable routes
  retain their current behavior and bytes unless a shared bug fix is independently required.
- `--group`, `--sort`, `--timediff`, and `--nodecompat` remain meaningful on the hybrid route.
  Current `sortDeps()` behavior is authoritative: `diff-asc` is Major/Minor/Patch and `diff-desc` is
  Patch/Minor/Major.
- Geometry is width-derived at 40, 60, 80, and 118 columns even in plain mode. Color, Unicode, and
  motion capabilities never change semantic membership.
- Pure sections consume validated immutable input and perform no I/O, clock, registry, repository,
  Git, manager, or lifecycle work.
- Node remains `>=24.15.0`; package manager remains `pnpm@10.33.0`; add no runtime dependency.
- Do not publish, push, tag, create a GitHub release, run a hosted workflow, or claim public proof.

## Execution Waves

- **Wave 1:** Task 1 only; it defines the evidence consumed by every visual task.
- **Wave 2:** Task 2, then Task 3; Task 3 records the product-facing built-CLI RED before migrating
  lifecycle/receipt integration onto the reviewed pure hybrid projection.
- **Wave 3:** Task 4 and Task 5 Steps 1–3 may run in parallel after Task 3 because their owned
  test/script and documentation files do not overlap. Task 5 Steps 4–5 wait for Task 4's reviewed
  exact replay totals.
- **Wave 4:** Run the broad source/docs review gate and resolve every Critical/Important finding.
- **Wave 5:** Task 6 packs and installs only the clean, reviewed source commit.
- **Wave 6:** Review Task 6 evidence and close Plan 038. Any fix that changes package bytes returns
  to Wave 5 and requires a complete artifact, Bun, and live-proof replay.

---

### Task 1: Immutable display evidence and canonical row order

**Files:**

- Modify: `src/utils/sort.ts`
- Modify: `src/utils/sort.test.ts`
- Modify: `src/commands/apply/legacy-plan.ts`
- Modify: `src/commands/apply/legacy-plan.test.ts`
- Modify: `src/commands/check/visual-plus/input.ts`
- Modify: `src/commands/check/visual-plus/input.test.ts`
- Modify: `src/commands/check/visual-plus/integration.ts`
- Modify: `src/commands/check/visual-plus/integration.test.ts`
- Modify: `src/commands/check/visual-plus/run-metadata.ts`
- Modify: `src/commands/check/visual-plus/run-metadata.test.ts`
- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`

**Interfaces:**

- Consumes: `ResolvedDepChange.source`, current `SortOption`, immutable
  `LegacySelectionEvidence`, and startup CLI display options.
- Produces: `VisualPlusRunMetadata.display`, `VisualPlusChangeMetadata.source`, and unique
  `displayOrder` values used by the hybrid ledger.

- [ ] **Step 1: Write sort-fact and selection-evidence RED tests**

Add this shared display comparator contract to the sort tests:

```ts
export interface DependencySortFacts {
  readonly name: string
  readonly diff: DiffType
  readonly publishedAt?: string
}

export function compareDependencySortFacts(
  left: DependencySortFacts,
  right: DependencySortFacts,
  sort: SortOption,
): number
```

Assert `sortDeps()` delegates to the same comparator for all six sort modes. Preserve exact current
behavior, including Major/Minor/Patch for `diff-asc`, Patch/Minor/Major for `diff-desc`, missing
publish time as epoch `0`, and `localeCompare()` name ordering.

In `legacy-plan.test.ts`, assert a ready operation copies exact typed `source` from the selected
`ResolvedDepChange`, and candidates that otherwise collapse to one physical operation but disagree
on `source` return `INCONSISTENT_SELECTION_EVIDENCE`.

- [ ] **Step 2: Run the focused RED tests**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  src/utils/sort.test.ts \
  src/commands/apply/legacy-plan.test.ts --retry=0
```

Expected: FAIL because `compareDependencySortFacts()` and
`LegacySelectionEvidenceOperation.source` do not exist.

- [ ] **Step 3: Implement the shared comparator and exact source evidence**

Refactor `sortDeps()` around the pure comparator without changing its public signature:

```ts
export function compareDependencySortFacts(
  left: DependencySortFacts,
  right: DependencySortFacts,
  sort: SortOption,
): number {
  const diff = () => (DIFF_ORDER[left.diff] ?? 4) - (DIFF_ORDER[right.diff] ?? 4)
  const time = () =>
    (left.publishedAt ? new Date(left.publishedAt).getTime() : 0) -
    (right.publishedAt ? new Date(right.publishedAt).getTime() : 0)
  if (sort === 'diff-asc') return diff()
  if (sort === 'diff-desc') return -diff()
  if (sort === 'time-asc') return time()
  if (sort === 'time-desc') return -time()
  const name = left.name.localeCompare(right.name)
  return sort === 'name-desc' ? -name : name
}
```

Add `readonly source: DepFieldType` to `LegacySelectionEvidenceOperation`, copy
`projection.change.source` in `evidenceFacts()`, and include it in the canonical fact comparison.

- [ ] **Step 4: Write renderer-input RED tests**

Add these exact types to the test contract:

```ts
export interface VisualPlusDisplayOptions {
  readonly group: boolean
  readonly sort: SortOption
  readonly timediff: boolean
  readonly nodecompat: boolean
}

export interface VisualPlusRunMetadata {
  readonly detailLevel?: 'compact' | 'full'
  readonly display: VisualPlusDisplayOptions
  // existing repository/workspace/package-manager fields remain
}

export interface VisualPlusChangeMetadata {
  readonly operationId: string
  readonly source: DepFieldType
  readonly displayOrder: number
  // existing owner/age/compatibility/catalog fields remain
}
```

Assert validation rejects an unknown sort, non-boolean display flags, an invalid source, duplicate
or non-contiguous display orders, and metadata whose operation IDs do not match the snapshot.
Assert copy/freeze retains the exact display contract.

- [ ] **Step 5: Run renderer-input RED tests**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  src/commands/check/visual-plus/input.test.ts \
  src/commands/check/visual-plus/run-metadata.test.ts --retry=0
```

Expected: FAIL because display/source/order metadata is absent and post-discovery metadata drops
startup display intent.

- [ ] **Step 6: Implement display validation and metadata preservation**

Initialize startup metadata in `run-check.ts` from the resolved options:

```ts
display: {
  group: options.group,
  sort: options.sort,
  timediff: options.timediff,
  nodecompat: options.nodecompat,
},
```

Change `deriveVisualPlusRunMetadata()` to consume and preserve this presentation object:

```ts
type VisualPlusPresentation = Pick<VisualPlusRunMetadata, 'detailLevel' | 'display'>

export function deriveVisualPlusRunMetadata(
  root: string,
  packages: readonly PackageMeta[],
  presentation: VisualPlusPresentation,
): VisualPlusRunMetadata
```

Validate all six sort literals, the four boolean flags, all `DepFieldType` literals, and unique
contiguous `displayOrder` values `0..changes.length - 1`.

- [ ] **Step 7: Write integration-order RED tests**

Change the projection signature to:

```ts
export function createVisualPlusSelectionProjection(
  evidence: LegacySelectionEvidence,
  wallClockMs: number,
  display: VisualPlusDisplayOptions,
): VisualPlusSelectionProjection
```

For each sort mode, use operations with distinct diff/name/publish time plus equal-key ties. Assert
metadata contains exact source and a unique `displayOrder`; semantic ties resolve by package index,
change index, then operation ID. Assert input evidence order and objects remain unchanged.

- [ ] **Step 8: Run integration-order RED tests**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  src/commands/check/visual-plus/integration.test.ts \
  src/commands/check/run-check.orchestration.test.ts --retry=0
```

Expected: FAIL because projection accepts no display intent and creates no source/order metadata.

- [ ] **Step 9: Implement canonical display order and wire the CLI**

Sort a copy of evidence operations with `compareDependencySortFacts()`, then apply deterministic
identity ties:

```ts
const ordered = [...evidence.operations].sort(
  (left, right) =>
    compareDependencySortFacts(left, right, display.sort) ||
    left.packageIndex - right.packageIndex ||
    left.changeIndex - right.changeIndex ||
    compareText(left.operationId, right.operationId),
)
const displayOrderById = new Map(
  ordered.map((operation, displayOrder) => [operation.operationId, displayOrder]),
)
```

Project `source` and `displayOrder` into metadata. Pass `visualRun.display` from every read-only and
write selection path; update fixtures and orchestration expectations without changing public
run-model or JSON schemas.

- [ ] **Step 10: Run GREEN, static, and regression gates**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  src/utils/sort.test.ts \
  src/commands/apply/legacy-plan.test.ts \
  src/commands/check/visual-plus/input.test.ts \
  src/commands/check/visual-plus/integration.test.ts \
  src/commands/check/visual-plus/run-metadata.test.ts \
  src/commands/check/run-check.orchestration.test.ts --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm typecheck
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec biome check \
  src/utils/sort.ts src/utils/sort.test.ts \
  src/commands/apply/legacy-plan.ts src/commands/apply/legacy-plan.test.ts \
  src/commands/check/visual-plus/input.ts src/commands/check/visual-plus/input.test.ts \
  src/commands/check/visual-plus/integration.ts \
  src/commands/check/visual-plus/integration.test.ts \
  src/commands/check/visual-plus/run-metadata.ts \
  src/commands/check/visual-plus/run-metadata.test.ts \
  src/commands/check/run-check.ts src/commands/check/run-check.orchestration.test.ts
```

Expected: every command exits `0` with no warnings.

- [ ] **Step 11: Commit**

```bash
git add src/utils/sort.ts src/utils/sort.test.ts \
  src/commands/apply/legacy-plan.ts src/commands/apply/legacy-plan.test.ts \
  src/commands/check/visual-plus/input.ts src/commands/check/visual-plus/input.test.ts \
  src/commands/check/visual-plus/integration.ts \
  src/commands/check/visual-plus/integration.test.ts \
  src/commands/check/visual-plus/run-metadata.ts \
  src/commands/check/visual-plus/run-metadata.test.ts \
  src/commands/check/run-check.ts src/commands/check/run-check.orchestration.test.ts
git commit -m "feat: project Visual Plus display evidence"
```

---

### Task 2: Pure hybrid overview, risk focus, and complete ledger

**Files:**

- Create: `src/commands/check/visual-plus/sections/ledger.ts`
- Create: `src/commands/check/visual-plus/sections/ledger.test.ts`
- Create: `src/commands/check/visual-plus/sections/hybrid.ts`
- Create: `src/commands/check/visual-plus/sections/hybrid.test.ts`
- Modify: `src/commands/check/visual-plus/test-fixture.ts`
- Modify: `src/commands/check/visual-plus/theme.ts`
- Create: `src/commands/check/visual-plus/theme.test.ts`

**Interfaces:**

- Consumes: validated `VisualPlusSectionInput`, `VisualPlusInsights`, explicit display options,
  canonical `displayOrder`, and existing sanitization/visual-width/theme utilities.
- Produces: `createVisualPlusLedgerRows()`, `renderVisualPlusLedger()`, and
  `renderVisualPlusHybridReview()` with no I/O or mutation.

- [ ] **Step 1: Add small visual goldens and the large invariant RED matrix**

Create a 7-operation fixture containing Major/Minor/Patch, two owners with the same label but
different physical paths, dependencies/devDependencies/catalog sources, known/unknown age, and
compatible/incompatible/unknown compatibility. Its snapshot and metadata satisfy the Task 1 input
contract and use display orders `0..6`.

Add exact inline snapshots for Unicode/color-capable geometry at `40`, `60`, `80`, and `118` columns
after ANSI stripping while preserving every space and line break. Add representative `80`-column
raw ANSI, `NO_COLOR`, and ASCII snapshots. The expected hierarchy is exactly:

```text
<context>
<topology counts>
<severity labels and proportional bar>
<Breaking changes with every major dependency group>
<owner heading>
<optional source subgroup>
<ledger header/rows>
<next owner and rows>
```

The snapshots must contain no `Lifecycle`, audit preview, omitted-count line, or internal ID.
Add focused option tests: `group=false` produces the flat source column/label, `timediff=false`
removes every age field, `nodecompat=false` removes compatibility detail, and all six sort modes
produce the Task 1 order inside each physical owner without changing row membership.

Using the existing deterministic 76-operation fixture, also add failing invariant tests for exact
one-to-one snapshot/row membership, 15 distinct physical owners, `3 Major / 37 Minor / 36 Patch`,
major risk-group membership, owner/source/display order, width bounds, and absence of internal IDs,
audit previews, and omitted-count tokens at all four canonical widths.

- [ ] **Step 2: Run visual-golden RED tests**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  src/commands/check/visual-plus/sections/hybrid.test.ts \
  src/commands/check/visual-plus/sections/ledger.test.ts --retry=0
```

Expected: FAIL because the hybrid and ledger modules do not exist; both the small goldens and large
membership contract are red before production implementation.

- [ ] **Step 3: Define the pure ledger row model**

Implement these exact internal interfaces:

```ts
export interface VisualPlusLedgerRow {
  readonly operationId: string
  readonly displayOrder: number
  readonly owner: VisualPlusChangeMetadata['ownerGroup']
  readonly source: DepFieldType
  readonly name: string
  readonly current: string
  readonly target: string
  readonly diff: 'major' | 'minor' | 'patch'
  readonly ageMs: number | null
  readonly compatibility: VisualPlusChangeMetadata['compatibility']
  readonly catalog?: VisualPlusChangeMetadata['catalog']
}

export function createVisualPlusLedgerRows(
  input: VisualPlusSectionInput,
): readonly VisualPlusLedgerRow[]

export function renderVisualPlusLedger(
  input: VisualPlusSectionInput,
  rows: readonly VisualPlusLedgerRow[],
): readonly string[]
```

Join snapshot changes to metadata by operation ID, sort by owner order then display order, and fail
closed on any missing/duplicate membership. Owner IDs and operation IDs remain private row keys and
are never copied into rendered strings.

- [ ] **Step 4: Implement deterministic responsive geometry**

Use a focused `buildLedgerLayout(rows, width, display)` helper with three geometries:

```ts
type LedgerGeometry = 'wide' | 'medium' | 'narrow'

const geometry = (width: number): LedgerGeometry =>
  width >= 100 ? 'wide' : width >= 60 ? 'medium' : 'narrow'
```

Wide uses aligned `dependency | current | target | severity | age` columns. Medium uses aligned
`dependency | current -> target | severity | age`. Narrow uses one dependency line and one labeled
transition/severity line. Physical owners always have one heading. With `group=true`, source
subgroups follow stable first appearance inside the owner's display order; with `group=false`,
source is a row column/label. `timediff=false` removes age geometry and content. `nodecompat=false`
removes compatibility badges. Exceptional compatibility/catalog evidence uses a continuation only
when it cannot fit losslessly.

Build cells with existing `visualLength`, `visualPadEnd`, semantic version coloring, and lossless
wrapping. Use `fitCell` only for fixed chrome that is already proven to fit; never pass a semantic
name, version, range, source, owner, compatibility, or catalog value through its truncating path.
No line may exceed `input.capabilities.width`; no semantic token may be replaced by ellipsis.

- [ ] **Step 5: Implement context, severity, and concise risk composition**

Export:

```ts
export function renderVisualPlusHybridReview(
  input: VisualPlusSectionInput,
  insights: VisualPlusInsights,
): readonly string[]
```

Render one context line from repository/manager/mode/intent, one topology count line, the existing
proportional distribution semantics, every major dependency group once with transition/age/owners
and optional compatibility, then the complete ledger. Reuse authoritative insights; do not derive
owners or compatibility from rendered labels. Render `No breaking changes` when there are no majors.
Add a pure `VisualPlusMajorRiskGroup` projection keyed by dependency identity with an ordered
`transitions` array. A same-identity/different-current-or-target fixture must render one dependency
heading and every distinct transition with its own age, owners, and compatibility counts; it must
never collapse divergent transitions into one singular range.
Keep the new hybrid module unreferenced by the production renderer in this task. Do not modify the
existing compact review/transaction module; Task 3 owns the renderer switch and deletion.

- [ ] **Step 6: Run the 76-operation invariant GREEN matrix**

Confirm the RED matrix created in Step 1 now passes at widths `40/60/80/118`:

- `createVisualPlusLedgerRows()` returns exactly `76` unique operation IDs;
- every snapshot change maps to exactly one row and every row to one change;
- all `15` owner identities remain distinct, including duplicate labels;
- distribution is exactly `3 Major / 37 Minor / 36 Patch`;
- every major operation is in the ledger and each major dependency identity is one risk group;
- section order and owner/source/display order are exact;
- every stripped line fits its width and no heading/divider/continuation dangles;
- output contains no internal ID, audit preview, or omitted-count token.

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  src/commands/check/visual-plus/sections/ledger.test.ts \
  src/commands/check/visual-plus/sections/hybrid.test.ts \
  src/commands/check/visual-plus/sections/insights.test.ts \
  src/commands/check/visual-plus/theme.test.ts --retry=0
```

Expected: PASS with reviewable exact snapshots and no snapshot update flag.

- [ ] **Step 7: Run static and full-section regression gates**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  src/commands/check/visual-plus/sections/sections.test.ts \
  src/commands/check/visual-plus/renderer.test.ts --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm typecheck
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec biome check \
  src/commands/check/visual-plus/sections \
  src/commands/check/visual-plus/test-fixture.ts \
  src/commands/check/visual-plus/theme.ts \
  src/commands/check/visual-plus/theme.test.ts
```

Expected: all commands exit `0`; the unchanged compact path keeps current renderer regressions
green while the new hybrid composition is reachable only from pure tests.

- [ ] **Step 8: Commit**

```bash
git add src/commands/check/visual-plus/sections/ledger.ts \
  src/commands/check/visual-plus/sections/ledger.test.ts \
  src/commands/check/visual-plus/sections/hybrid.ts \
  src/commands/check/visual-plus/sections/hybrid.test.ts \
  src/commands/check/visual-plus/test-fixture.ts \
  src/commands/check/visual-plus/theme.ts \
  src/commands/check/visual-plus/theme.test.ts
git commit -m "feat: render the hybrid Visual Plus ledger"
```

---

### Task 3: Compact lifecycle ownership and truthful final receipts

**Files:**

- Modify: `src/commands/check/visual-plus/renderer.ts`
- Modify: `src/commands/check/visual-plus/renderer.test.ts`
- Modify: `src/commands/check/visual-plus/sections/lifecycle.ts`
- Modify: `src/commands/check/visual-plus/sections/insights.test.ts`
- Modify: `src/commands/check/visual-plus/sections/sections.test.ts`
- Modify: `src/commands/check/visual-plus/sections/receipt.ts`
- Modify: `src/commands/check/visual-plus/sections/transaction.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`
- Modify: `test/visual-plus-cli.test.ts`
- Delete after renderer migration: `src/commands/check/visual-plus/sections/compact.ts`

**Interfaces:**

- Consumes: reviewed `renderVisualPlusHybridReview()`, immutable final snapshot, and canonical write
  receipt/recovery evidence.
- Produces: one transient compact active-phase line, no durable success lifecycle, concise strict
  success receipts, and complete unchanged non-success evidence.

- [ ] **Step 1: Write product-facing built-CLI and compact lifecycle RED tests**

Before changing the renderer, convert the existing five exact width journeys in
`test/visual-plus-cli.test.ts` from `renders compact success...` to `renders hybrid success...`.
For `40/60/80/118`, add the approved non-whitespace-normalized final-screen signatures containing
context, topology, proportional severity, every major-risk line, representative owner/source
headings, table headings, first/last ledger row, receipt, and exit. Require exact 76-row membership,
15 distinct owners, width compliance, a visible cursor, no durable lifecycle rail, and no audit
preview, omitted-count, or internal-ID string. Keep the 175-column overflow and safety journeys.
Add the corresponding pre-implementation expectations for direct pipe, slow pipe, capable
`NO_COLOR`, CI, and `TERM=dumb`: width-derived hybrid geometry, no lifecycle history, and identical
semantic membership. Store exact plain 40/60/80/118 signatures for direct pipe and `TERM=dumb`;
use representative no-color evidence to prove zero SGR without multiplying the full matrix.

For capable compact runs, assert startup draws exactly one replaceable active-phase line, phase
changes replace it, suspension clears/redraws it once, and finalization clears it with a visible
cursor. The final successful transcript must contain no `Lifecycle` heading and none of the ten
`<phase> · <status>` durable rows.

For compact constrained runs, assert startup, observation, metadata transition, suspension, and
finalization emit no active or terminal phase history. For `detailLevel='full'`, preserve current
startup/context/lifecycle/finalization bytes exactly.

- [ ] **Step 2: Run lifecycle RED tests**

Build first, then run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm build
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  test/visual-plus-cli.test.ts \
  src/commands/check/visual-plus/renderer.test.ts \
  src/commands/check/visual-plus/sections/sections.test.ts --retry=0
```

Expected: FAIL because the built CLI still renders bounded compact previews and compact mode still
durably writes heading, context, terminal phases, complete phase, target preview, and receipt
through the full lifecycle path.

- [ ] **Step 3: Make renderer lifecycle detail-level aware**

Preserve the full branch and add compact behavior at every output boundary:

```ts
const compact = (): boolean => startupRun?.detailLevel === 'compact'
```

- `start()`: full writes current heading/lifecycle; compact writes no durable bytes and draws only
  the current active phase when cursor mode is available.
- `appendTerminalFacts()`: return without durable phase output for compact.
- `renderLatest()`: compact constrained mode emits nothing; compact cursor mode owns one active
  phase frame; full keeps current behavior.
- `setRunMetadata()`: compact keeps context immutable but defers it to hybrid review; full writes
  current durable context.
- `writeReview()`: compact clears the active frame, writes hybrid review once, then redraws the
  newest active phase if the run continues.
- suspension: compact clears/redraws only the active frame and never materializes terminal history.
- `finalize()`: compact clears the frame, omits successful complete/transaction history, and selects
  the compact receipt rules below; full remains byte-stable.

After the renderer and insight tests use `renderVisualPlusHybridReview()`, replace the bounded
compact transaction path with an unbounded human non-success projection in `transaction.ts`.
Migrate its section tests, delete `sections/compact.ts`, and prove no source or test import remains.

- [ ] **Step 4: Write concise receipt and non-success RED tests**

Add pure tests for exact compact success semantics:

```text
Review complete · 76 updates across 14 files · write not attempted
Exit 0
```

```text
Complete · 76 updates applied across 14 files
All 14 files observed at the requested values · recovery not needed · 2.4s
Exit 0
```

For read-only exit `1`, exit `2`, skipped write, safety block, partial, failed, unknown, completed
recovery, partial recovery, unknown recovery, unrecovered paths, and retained journal, assert the
complete existing receipt/transaction evidence remains present and unbounded. Unexpected renderer
or orchestration failure continues to emit only the sanitized generic error and never a fabricated
ledger, phase, target result, or receipt.

- [ ] **Step 5: Implement compact receipt/transaction predicates**

Add pure predicates:

```ts
export function isStrictVisualPlusWriteSuccess(input: VisualPlusSectionInput): boolean

export function requiresVisualPlusDetailedTransaction(
  input: VisualPlusSectionInput,
): boolean
```

Strict success requires every operation and target applied, observe passed, recovery `not-needed`,
canonical complete evidence, and exit `0`. Only read-only exit `0` and strict write success use
concise compact receipts. Every other compact result renders every target, operation outcome,
reason, recovery path, and retained-journal fact without an eight-target limit. Join operation
results to immutable human ledger facts instead of exposing internal operation IDs; keep the full
`--long` transaction bytes and IDs unchanged. Render one compact failed/blocked/unknown phase line
only when a modeled non-complete phase has that terminal status.

- [ ] **Step 6: Run GREEN, compatibility, and static gates**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  test/visual-plus-cli.test.ts \
  src/commands/check/visual-plus/renderer.test.ts \
  src/commands/check/visual-plus/sections/sections.test.ts \
  src/commands/check/run-check.orchestration.test.ts \
  src/commands/check/check.interactive-fallback.test.ts \
  src/commands/check/check.json-output.test.ts --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm typecheck
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec biome check \
  src/commands/check/visual-plus/renderer.ts \
  src/commands/check/visual-plus/renderer.test.ts \
  src/commands/check/visual-plus/sections/lifecycle.ts \
  src/commands/check/visual-plus/sections/receipt.ts \
  src/commands/check/visual-plus/sections/transaction.ts \
  src/commands/check/visual-plus/sections/sections.test.ts \
  src/commands/check/run-check.orchestration.test.ts \
  test/visual-plus-cli.test.ts
```

Expected: every command exits `0`; full audit and excluded-route assertions remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/commands/check/visual-plus/renderer.ts \
  src/commands/check/visual-plus/renderer.test.ts \
  src/commands/check/visual-plus/sections/compact.ts \
  src/commands/check/visual-plus/sections/insights.test.ts \
  src/commands/check/visual-plus/sections/lifecycle.ts \
  src/commands/check/visual-plus/sections/receipt.ts \
  src/commands/check/visual-plus/sections/transaction.ts \
  src/commands/check/visual-plus/sections/sections.test.ts \
  src/commands/check/run-check.orchestration.test.ts \
  test/visual-plus-cli.test.ts
git commit -m "feat: complete the hybrid Visual Plus journey"
```

---

### Task 4: Replay classification, evidence report, and live-proof harness

**Files:**

- Verify: `test/visual-plus-cli.test.ts`
- Modify: `scripts/visual-plus-replay-failure.mjs`
- Modify: `test/visual-plus-replay-failure.test.ts`
- Modify: `scripts/verify-packed-package.mjs`
- Modify: `test/verify-local-package.test.ts`
- Create: `scripts/live-visual-plus-proof.mjs`
- Create: `test/live-visual-plus-proof.test.ts`
- Modify: `test/package-assets.test.ts`

**Interfaces:**

- Consumes: the Task 3 built-CLI goldens, true-PTY terminal emulator, exact installed-artifact path
  binding, one packed-artifact evidence report, and a real Bun global installation.
- Produces: exact hybrid failure classification, machine-readable installed replay identity, and a
  deterministic 80/118-column live Spreadoo proof that runs the resolved `bunx` executable.

- [ ] **Step 1: Write replay-classification and evidence-report RED tests**

Require the five Task 3 `renders hybrid success...` full-name keys and category
`visual-hierarchy`; every retired `renders compact success...` title must be unclassified. Preserve
the exact source-coupling rule that all trusted titles exist in `test/visual-plus-cli.test.ts`.

Add verifier tests for a new contained `--evidence <path>` option. A successful installed replay
atomically writes schema-versioned JSON containing tarball realpath/SHA-256, extracted package
realpath, installed `dist/cli.mjs` realpath/SHA-256, package version, and exact file/suite/test
totals. It must reject an existing output, symlink, non-contained path, incomplete run, or identity
mismatch and must leave no partial report.

- [ ] **Step 2: Write live-proof harness RED tests**

Specify `scripts/live-visual-plus-proof.mjs` with required `--cwd`, `--pack-json`, `--replay-evidence`,
repeatable `--columns`, and `--output` arguments. Its tests must prove the harness:

- resolves exactly one executable `bunx` from `PATH` without a shell and records its realpath;
- uses fixed argv `--no-install depfresh major --cwd <cwd>` through `runInPty()` at each requested
  width and records raw-control classification plus the projected final screen;
- rejects a local Spreadoo `node_modules/.bin/depfresh` shadow;
- resolves Bun's global bin with fixed no-shell argv, binds its depfresh link target and CLI
  SHA-256 to the installed replay evidence, and records both identities;
- validates the pack JSON/tarball SHA-256 binding before launch;
- records exit, cursor, columns, operation-row membership, hierarchy tokens, and before/after Git,
  index, diff, status, and `bun.lock` identities;
- refuses an existing/symlink/non-contained output and atomically writes one JSON report only after
  both widths pass.

- [ ] **Step 3: Run focused RED tests**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  test/visual-plus-replay-failure.test.ts \
  test/verify-local-package.test.ts \
  test/live-visual-plus-proof.test.ts --retry=0
```

Expected: FAIL because trusted titles are still compact, the verifier emits no evidence report, and
the live-proof harness does not exist.

- [ ] **Step 4: Implement exact replay and live-proof evidence**

Replace the five trusted `renders compact success...` full-name keys with the exact new `renders
hybrid success...` keys and category `visual-hierarchy`. Update the source-coupling tests so all five
titles must exist in `test/visual-plus-cli.test.ts` and any retired compact title is unclassified.

Implement the contained atomic verifier report and the fixed-argv live harness exactly as tested.
Reuse `runInPty()` and terminal projection; do not duplicate or weaken its transport, process
identity, bounds, cursor, or cleanup contracts. Keep raw output private and bounded.

If implementation adds or removes a test, take the exact Vitest JSON total and update
`VISUAL_PLUS_PASSED_TESTS`, synthetic verifier reports, and package assertions in the same commit,
then hand the reviewed total to Task 5 for documentation. Otherwise retain exact `1` file, `5`
suites, and `58` tests.

- [ ] **Step 5: Run GREEN source and installed-style proof**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm build
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  test/visual-plus-cli.test.ts \
  test/visual-plus-replay-failure.test.ts \
  test/verify-local-package.test.ts \
  test/live-visual-plus-proof.test.ts \
  test/package-assets.test.ts --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm typecheck
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec biome check \
  test/visual-plus-cli.test.ts \
  test/visual-plus-replay-failure.test.ts \
  test/verify-local-package.test.ts \
  scripts/live-visual-plus-proof.mjs \
  test/live-visual-plus-proof.test.ts \
  test/package-assets.test.ts
```

Expected: every command exits `0`; the Visual+ file remains exactly `58/58` unless Step 4 records a
reviewed explicit total change.

- [ ] **Step 6: Commit**

```bash
git add scripts/visual-plus-replay-failure.mjs \
  test/visual-plus-replay-failure.test.ts \
  scripts/verify-packed-package.mjs \
  test/verify-local-package.test.ts \
  scripts/live-visual-plus-proof.mjs \
  test/live-visual-plus-proof.test.ts \
  test/package-assets.test.ts
git commit -m "test: prove the hybrid Visual Plus CLI"
```

---

### Task 5: Documentation and planning truth

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-07-18-safe-write-visual-plus-design.md`
- Modify: `docs/superpowers/specs/2026-07-20-visual-plus-compact-2.1.1-design.md`
- Modify: `docs/superpowers/specs/2026-07-20-visual-plus-hybrid-default-design.md`
- Modify: `docs/output-formats/table.md`
- Modify: `docs/releases/v2.1.1.md`
- Modify: `docs/README.md`
- Modify: `docs/agents/README.md`
- Modify: `docs/integrations/README.md`
- Modify: `docs/troubleshooting.md`
- Modify: `plans/037-visual-plus-compact-2.1.1.md`
- Modify: `plans/038-visual-plus-hybrid-default.md`
- Modify: `plans/README.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `test/release-readiness.test.ts`

**Interfaces:**

- Consumes: reviewed behavior from Tasks 1–3 for Steps 1–3, then Task 4's exact replay totals for
  Steps 4–5.
- Produces: one coherent truth surface: Plan 037 completed its superseded compact semantic contract;
  Plan 038 owns and proves the hybrid human default.

- [ ] **Step 1: Write documentation RED assertions**

Update release-readiness tests to require:

- the 2026-07-18 design links to the approved hybrid amendment;
- table docs describe the five-region hybrid default and complete ledger;
- docs say `diff-asc` is Major/Minor/Patch and `diff-desc` is Patch/Minor/Major;
- `--long` remains the exhaustive audit;
- successful compact output has no durable lifecycle rail;
- no doc claims an 80-line cap or bounded successful update preview;
- root README, changelog, troubleshooting, and the compact 2.1.1 design identify that projection as
  historical and link Plan 038 as its visual-composition successor;
- Plan 037 is complete only for its historical compact semantic contract;
- Plan 038 stays `IN PROGRESS` through Task 6 and the final evidence review.

- [ ] **Step 2: Run documentation RED tests**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  test/release-readiness.test.ts --retry=0
```

Expected: FAIL because current documentation still describes the superseded compact preview and
the table sort directions incorrectly.

- [ ] **Step 3: Update documentation and status boundaries**

Add an amendment note to the original design without rewriting historical decisions. Mark the
approved hybrid spec as implementation in progress. Mark the compact 2.1.1 design as a historical
contract superseded for default visual composition by Plan 038. Rewrite every root/docs/changelog
default table/Visual+ example to match the reviewed goldens, document responsive/plain behavior and
display flags, and preserve all failure/recovery wording. In v2.1.1 notes, say the existing
tarball/Bun/Spreadoo evidence proves Plan 037 only and is not Plan 038 proof; do not claim it is
superseded or insert future hashes before Task 6 creates replacement bytes.

Update Plan 037 and the registry to say its compact contract remains historically complete but the
visual-composition objective moved to Plan 038. Record reviewed Task 1–3 commit ranges in Plan 038
and the durable SDD ledger during the parallel documentation pass.

- [ ] **Step 4: Integrate Task 4 totals, then run GREEN documentation and static checks**

Wait for Task 4's reviewed handoff, record its exact replay totals and commit range in the release
note, Plan 038, registry, and progress ledger, then run:

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  test/release-readiness.test.ts --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec biome check \
  test/release-readiness.test.ts
git diff --check
```

Expected: every command exits `0`; Plan 038 is still `IN PROGRESS` and no publication claim exists.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md \
  docs/superpowers/specs/2026-07-18-safe-write-visual-plus-design.md \
  docs/superpowers/specs/2026-07-20-visual-plus-compact-2.1.1-design.md \
  docs/superpowers/specs/2026-07-20-visual-plus-hybrid-default-design.md \
  docs/output-formats/table.md docs/releases/v2.1.1.md \
  docs/README.md docs/agents/README.md docs/integrations/README.md \
  docs/troubleshooting.md \
  plans/037-visual-plus-compact-2.1.1.md \
  plans/038-visual-plus-hybrid-default.md plans/README.md \
  .superpowers/sdd/progress.md test/release-readiness.test.ts
git commit -m "docs: describe the hybrid Visual Plus default"
```

---

## Pre-artifact Review Gate

After Tasks 1–5, generate a review package from `48eec95` through current HEAD and dispatch one
broad reviewer. The reviewer must inspect spec compliance, visual hierarchy, complete ledger
membership, sort/display-option truth, divergent major transitions, renderer failure/cursor
behavior, unbounded non-success/recovery evidence, `--long` preservation, excluded-route
compatibility, replay classification, proof-harness containment, documentation truth, and the
local-only release boundary. Resolve every Critical or Important finding, rerun all covering tests,
commit the fixes, and obtain a clean re-review before Task 6 may start.

---

### Task 6: Full gate, corrected local artifact, Bun install, and live Spreadoo proof

**Files:**

- Modify after proof: `docs/releases/v2.1.1.md`
- Modify after proof: `plans/038-visual-plus-hybrid-default.md`
- Modify after proof: `plans/README.md`
- Modify after proof: `.superpowers/sdd/progress.md`
- Create or replace scratch report (ignored, never staged):
  `.superpowers/sdd/plan-038-final-report.md`

**Interfaces:**

- Consumes: reviewed source commits from Tasks 1–5 and the exact pinned package verifier.
- Produces: one retained corrected 2.1.1 tarball, an artifact-bound installed replay, a scoped local
  Bun replacement, and unchanged live Spreadoo repository evidence.

- [ ] **Step 1: Prove a clean exact-toolchain source candidate**

Run with no concurrent Vitest process:

```bash
git status --short --branch
git status --porcelain=v1
git rev-parse HEAD
git diff --check
mise exec node@24.15.0 npm@11.12.1 -- node --version
mise exec node@24.15.0 npm@11.12.1 -- npm --version
mise exec node@24.15.0 npm@11.12.1 -- pnpm --version
mise exec node@24.15.0 npm@11.12.1 -- pnpm install --frozen-lockfile
mise exec node@24.15.0 npm@11.12.1 -- pnpm schemas:check
mise exec node@24.15.0 npm@11.12.1 -- pnpm typecheck
mise exec node@24.15.0 npm@11.12.1 -- pnpm lint
mise exec node@24.15.0 npm@11.12.1 -- pnpm build
mise exec node@24.15.0 npm@11.12.1 -- pnpm test:run --coverage --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm test:release -- --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm test:smoke
mise exec node@24.15.0 npm@11.12.1 -- pnpm test:demo
mise exec node@24.15.0 npm@11.12.1 -- pnpm verify:package
```

Expected: exact Node `v24.15.0`, npm `11.12.1`, pnpm `10.33.0`; every gate exits `0`; full tests
have zero retry; Biome reports zero warnings; package identity remains `2.1.1`; porcelain output is
empty. Record the exact HEAD as `PACKAGE_SOURCE_COMMIT` and require the same value immediately
before packing, installed replay, and Bun replacement.

- [ ] **Step 2: Pack one isolated retained artifact**

Create one retained root and two distinct empty npm configs:

```bash
PACK_ROOT=$(mktemp -d /private/tmp/depfresh-2.1.1-hybrid.XXXXXX)
touch "$PACK_ROOT/user.npmrc" "$PACK_ROOT/global.npmrc"
mise exec node@24.15.0 npm@11.12.1 -- env \
  XDG_CACHE_HOME="$PACK_ROOT/xdg-cache" \
  npm_config_cache="$PACK_ROOT/cache" \
  npm_config_userconfig="$PACK_ROOT/user.npmrc" \
  npm_config_globalconfig="$PACK_ROOT/global.npmrc" \
  npm_config_prefix="$PACK_ROOT/prefix" \
  npm_config_ignore_scripts=true \
  pnpm_config_home="$PACK_ROOT/pnpm-home" \
  npm pack --json --ignore-scripts --pack-destination "$PACK_ROOT" > "$PACK_ROOT/pack.json"
```

Validate exactly one `depfresh-2.1.1.tgz`, retain `pack.json`, and record filename, file count,
packed/unpacked bytes, SHA-1, SHA-256, and SHA-512 integrity in the final report.

- [ ] **Step 3: Run the artifact-bound installed replay**

Run:

```bash
mise exec node@24.15.0 npm@11.12.1 -- env \
  XDG_CACHE_HOME="$PACK_ROOT/xdg-cache" \
  npm_config_cache="$PACK_ROOT/cache" \
  npm_config_userconfig="$PACK_ROOT/user.npmrc" \
  npm_config_globalconfig="$PACK_ROOT/global.npmrc" \
  npm_config_prefix="$PACK_ROOT/prefix" \
  npm_config_ignore_scripts=true \
  node scripts/verify-packed-package.mjs "$PACK_ROOT/pack.json" --visual-plus \
    --evidence "$PACK_ROOT/installed-replay.json"
```

Expected: exit `0`, exact installed CLI/tarball identity, exact `1` file/`5` suites/`58` tests unless
Task 4 reviewed a different fixed total, zero failed/pending/todo/retry, and all hybrid goldens run
against the installed CLI.

- [ ] **Step 4: Replace only the local global Bun depfresh candidate**

Before mutation, record `bun pm -g ls`, the current depfresh package source/tarball identity, current
CLI symlink target, and CLI SHA-256. Require a readable retained old tarball whose package version
and installed CLI SHA-256 reproduce the current candidate; if it is unavailable or mismatched, do
not mutate Bun. Retain that exact tarball for rollback. Re-run
`git status --porcelain=v1` and `git rev-parse HEAD`; require empty output and exact
`PACKAGE_SOURCE_COMMIT`. Then run:

```bash
bun remove -g depfresh
bun add -g "$PACK_ROOT/depfresh-2.1.1.tgz" --ignore-scripts
bunx --no-install depfresh --version
bunx depfresh --version
```

Expected: both probes print `2.1.1`; the global bin resolves into Bun's depfresh package; its CLI
SHA-256 matches the installed replay; every unrelated global package remains present. If add or
identity verification fails, restore the retained previous exact tarball and stop without a success
claim.

- [ ] **Step 5: Prove the live Spreadoo hybrid journey without writes**

Use the reviewed fixed-argv harness; do not run an ad hoc terminal command:

```bash
mise exec node@24.15.0 npm@11.12.1 -- node scripts/live-visual-plus-proof.mjs \
  --cwd /Users/tomrobak/_projects_/spreadoo \
  --pack-json "$PACK_ROOT/pack.json" \
  --replay-evidence "$PACK_ROOT/installed-replay.json" \
  --columns 80 --columns 118 --include-long \
  --output "$PACK_ROOT/spreadoo-live.json"
```

The harness runs the exact resolved `bunx --no-install depfresh major --cwd <cwd>` argv at both
widths and the corresponding `--long` journey, binds the Bun global CLI SHA-256 to
`installed-replay.json`, and rejects local command shadowing. For the default journey, require the
displayed update total to equal the number of rendered ledger row shapes, the approved five-region
hierarchy, current repository and discovered project-manager evidence, no lifecycle rail/audit
preview/internal IDs, visible cursor, and exit `0`. Exact canonical-ID one-to-one membership remains
the artifact-bound deterministic-fixture assertion because human live output intentionally hides
IDs. For `--long`, assert current exhaustive owner/shared/occurrence/target membership and exit `0`.
Require exact pre/post equality for HEAD, index, working/cached diff, status, and `bun.lock`.

- [ ] **Step 6: Record current evidence without closing Plan 038**

Write exact tool versions, commit, test totals, coverage, artifact metrics/hashes, installed CLI
hash, Bun inventory/probes, PTY widths/counts, and Spreadoo pre/post identities to the release note,
Plan 038, plan registry, progress ledger, and final report. Mark the previous 2.1.1 artifact/Bun/live
proof as superseded local evidence. Keep Plan 038 `IN PROGRESS` until the final evidence review and
closeout commit.

- [ ] **Step 7: Run final evidence checks and commit**

Run:

```bash
git diff --check
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run \
  test/release-readiness.test.ts \
  test/verify-local-package.test.ts \
  test/live-visual-plus-proof.test.ts \
  test/package-assets.test.ts \
  test/visual-plus-replay-failure.test.ts --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm verify:package
git status --short --branch
```

Expected: every command exits `0`; only exact evidence files are modified before staging; no tag,
remote ref, publication, hosted workflow, or public-release claim exists.

```bash
git add docs/releases/v2.1.1.md \
  plans/038-visual-plus-hybrid-default.md plans/README.md \
  .superpowers/sdd/progress.md
git commit -m "docs: record hybrid Visual Plus evidence"
git status --porcelain=v1
```

Expected after commit: empty porcelain output.

---

## Final Evidence Review and Closeout Gate

After Task 6, dispatch an evidence reviewer over `48eec95` through current HEAD plus the retained
pack, installed replay, Bun inventory, and Spreadoo report. Require C0/I0 for package-source commit
binding, hashes, fixed totals, rollback-readiness evidence, exact Bun CLI identity, 80/118 PTY
hierarchy, `--long`, repository immutability, documentation truth, and local-only release claims.

If any correction changes `package.json`, `pnpm-lock.yaml`, build inputs, `src/`, packaged skills,
or replay/package-verifier semantics, invalidate all Task 6 evidence and rerun Task 6 completely
from a new clean reviewed `PACKAGE_SOURCE_COMMIT`. For evidence-only documentation corrections,
rerun the focused readiness/package/proof tests and obtain a clean re-review.

Only after C0/I0, update Plan 038 and `plans/README.md` to `DONE`, append the review result and exact
final commit range to `.superpowers/sdd/progress.md` and `docs/releases/v2.1.1.md`, run
`git diff --check` plus `test/release-readiness.test.ts`, and commit:

```bash
git add docs/releases/v2.1.1.md plans/038-visual-plus-hybrid-default.md \
  plans/README.md .superpowers/sdd/progress.md
git commit -m "docs: close the hybrid Visual Plus plan"
git status --porcelain=v1
```

Expected: empty porcelain output after commit. No push, tag, publish, hosted workflow, GitHub
release, or public-artifact proof is part of Plan 038.
