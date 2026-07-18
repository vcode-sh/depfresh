# Visual+ Insights and PTY Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved functional visualizations and prove complete Visual+ success/safety
journeys with a deterministic Spreadu-shaped fixture in capable and fallback terminals.

**Architecture:** Pure insight builders derive topology, severity distribution, owner impact,
shared declarations, and major blast radius from the authoritative run snapshot. Section renderers
project those relationships at each width. A cross-platform test harness allocates a real PTY for
the built CLI and separately validates non-TTY/CI/pipe behavior and final filesystem bytes.

**Tech Stack:** TypeScript, Node `24.15.0`, Git CLI, platform `script` PTY utility through a bounded
test-only adapter, Vitest, Biome, pnpm `10.33.0`. No new runtime/native dependency.

## Global Constraints

- All code, documentation, plans, and commit messages are English.
- Begin only after Plan 034 is complete and reviewed; keep package version `2.0.2`.
- The fixture contract is exact: 66 discovered package inventories (64 `package.json` manifests
  plus two named catalog pseudo-packages), 616 declared, 612 eligible, 76 selected updates,
  15 owner groups, 14 physical targets, 18 repeated names, 39 repeated occurrences, and 2 major
  blast-radius cards.
- The selected severity distribution is exactly 3 major, 37 minor, and 36 patch operations. The
  three major operations form two cards; operation counts and card counts are never conflated.
- The two approved major cards are `react-dropzone` `^15.0.0 -> ^17.0.0` across `lab-editor` and
  `web`,
  and root-catalog `nanoid` `^5.1.16 -> ^6.0.0`; both use a fixed about-five-day age and explicit
  unknown Node compatibility in the deterministic fixture.
- Both success and safety-block previews show all 76 rows and all 14 targets correctly.
- Visualizations express real relationships with text/numeric equivalents; no decorative ASCII,
  gradient, graphics protocol, hidden result, or unexplained token.
- PTY tests use disposable repositories, HOME/cache/store paths, local registry data, and bounded
  output/time. They never touch user repositories or caches.
- Non-TTY, CI, pipe, `TERM=dumb`, `NO_COLOR`, reduced motion, narrow widths, and hostile text retain
  complete truth without repeated frames.
- Do not stage, commit, push, publish, tag, or create a branch/worktree without separate authority.

## Drift Check and Stop Conditions

Before editing, run `git status --short`, verify Plan 034 completion, and replay its core snapshots.
Stop if fixture counts/relationships cannot be derived deterministically, major compatibility would
need to be invented, any map hides a row/target, no required hosted job can provide a real PTY,
terminal normalization removes semantic output, packed behavior differs from source, or owned files
overlap unrelated concurrent edits.

---

### Task 1: Pure relationship insights

**Files:**

- Create: `src/commands/check/visual-plus/insights.ts`
- Create: `src/commands/check/visual-plus/insights.test.ts`
- Modify: `src/commands/apply/legacy-plan.ts`
- Modify: `src/commands/apply/legacy-plan.test.ts`
- Modify: `src/commands/check/run-model.ts`
- Modify: `src/commands/check/run-model.test.ts`
- Modify: `src/commands/check/visual-plus/integration.ts`
- Modify: `src/commands/check/visual-plus/integration.test.ts`
- Modify: `src/commands/check/visual-plus/input.ts`
- Create: `src/commands/check/visual-plus/input.test.ts`
- Modify: `src/commands/check/json-output.compatibility.test.ts`

**Interfaces:**

- Consumes: selected changes with exact owner/source identities and existing diff/age/compatibility
  metadata.
- Produces: `buildVisualPlusInsights(snapshot): VisualPlusInsights`.

**Authoritative evidence contract:**

- The one-way chain is `LegacySelectionEvidence -> VisualPlusSelectionProjection ->
  CheckRunSnapshot`. The integration must retain selected evidence; the insight builder must not
  reconstruct identities from labels, array positions, display text, or repository state.
- A physical occurrence key is the tuple `(sourceFileId, occurrencePath)`. `sourceFileId` must map
  bijectively to one safe, contained repository-relative `sourcePath`; contradictory mappings fail.
- A source file ID is `createRepositoryId('source', sourcePath)`. A dependency ID is
  `createRepositoryId('dependency', rawDependencyName)`, so hostile names that sanitize to equal
  display text cannot merge. A manifest owner ID is `createRepositoryId('package', ownerPath)` and
  its label is the sanitized manifest name with owner path fallback. A catalog owner ID uses the
  repository-model formula `createRepositoryId('catalog',
  `${sourcePath}\0${manager}\0${name}`)` and its label is the sanitized catalog name with source
  path fallback. Catalog consumers are explanatory and never become owners.
- Physical owner order is the zero-based index assigned after evidence reconciliation by code-unit
  comparison of owner path, role, catalog manager, catalog name, and owner ID. It is unique within
  the snapshot and never depends on consumer order, map enumeration, locale, or display labels.
- `CheckRunChange.owner` remains the physical transaction target. Add optional internal
  `CheckRunChange.insight`; Visual+ local projections require it for every selected operation,
  while legacy/global callers may omit it. This is internal data only: no public JSON or schema
  changes are allowed.
- `dependencyId` is the exact dependency identity used for grouping. Equal rendered names with
  different dependency IDs must remain separate; equal owner labels with different owner IDs must
  remain separate.
- Every retained path must be normalized, repository-relative, contained, and free of absolute or
  parent traversal segments. Missing or contradictory selected evidence throws a dedicated
  `VisualPlusInsightError`; unknown evidence is represented explicitly and never inferred.
- For every selected change, `change.owner`, `insight.sourcePath`,
  `insight.owner.physicalTarget`, and its one selected target path are equal, and
  `insight.sourceFileId === createRepositoryId('source', insight.sourcePath)`. Its dependency ID is
  `createRepositoryId('dependency', insight.rawName)` and
  `sanitizeTerminalText(insight.rawName) === change.name`.
- Direct manifest evidence requires `catalog.role === 'direct'`, `owner.role === 'manifest'`,
  `owner.path === sourcePath`, and `owner.id === createRepositoryId('package', owner.path)`.
  Catalog-owned evidence requires `catalog.role === 'owner'`, `owner.role === 'catalog'`,
  `owner.id === catalog.id`, `owner.path === catalog.sourcePath`,
  `catalog.sourcePath === sourcePath`, `catalog.sourceFileId === sourceFileId`, and the exact catalog
  ID formula above. Every mismatch is a fail-closed contract error with an explicit RED test.
- `VisualPlusChangeMetadata` is a transitional renderer projection, not a second truth source.
  `visual-plus/input.ts` must either derive it from `snapshot.changes[].insight` or require exact
  equality for operation ID, owner ID/order/label/physical target, age, compatibility, and catalog
  name/source before rendering. Contradictory maps and change-list evidence must fail closed.
- One owner ID maps to exactly one complete owner reference. One dependency ID maps to exactly one
  raw dependency name and sanitized display name. Owner orders are derived from the complete owner
  inventory, contiguous `0..ownerCount - 1`, and equal the contract-defined sort; supplied order
  values are validated rather than trusted.

```ts
export interface CheckRunOwnerReference {
  id: string
  role: 'manifest' | 'catalog'
  label: string
  path: string
  order: number
  physicalTarget: string
}

export type CheckRunCatalogEvidence =
  | { role: 'direct' }
  | {
      role: 'owner'
      id: string
      manager: 'pnpm' | 'bun' | 'yarn'
      name: string
      sourceFileId: string
      sourcePath: string
    }

export interface CheckRunInsightEvidence {
  dependencyId: string
  rawName: string
  sourceFileId: string
  sourcePath: string
  occurrencePath: readonly string[]
  owner: CheckRunOwnerReference
  catalog: CheckRunCatalogEvidence
  ageMs: number | null
  compatibility: {
    status: 'compatible' | 'incompatible' | 'unknown'
    detail?: string
  }
}

export interface PhysicalDependencyOccurrence {
  operationId: string
  dependencyId: string
  name: string
  sourceFileId: string
  sourcePath: string
  occurrencePath: readonly string[]
  owner: CheckRunOwnerReference
  catalog: CheckRunCatalogEvidence
  current: string
  target: string
  diff: 'major' | 'minor' | 'patch'
  ageMs: number | null
  compatibility: CheckRunInsightEvidence['compatibility']
}

export interface OwnerImpact {
  owner: CheckRunOwnerReference
  operationIds: readonly string[]
  updates: number
  distribution: { major: number; minor: number; patch: number }
}

export interface SharedDependencySurface {
  dependencyId: string
  name: string
  occurrences: readonly PhysicalDependencyOccurrence[]
}

export interface MajorBlastRadius {
  dependencyId: string
  name: string
  current: string
  target: string
  operationIds: readonly string[]
  owners: readonly CheckRunOwnerReference[]
  occurrences: readonly PhysicalDependencyOccurrence[]
  age: { state: 'known'; ageMs: number } | { state: 'unknown' } | { state: 'mixed' }
  compatibility: { compatible: number; incompatible: number; unknown: number }
}
```

**Builder invariants:**

- `topology.packages/declared/eligible` come from snapshot counts;
  `topology.updates = counts.operations` and `topology.files = counts.targets`.
- Distribution is counted from selected changes, must sum to `counts.operations`, and rejects
  `none`, `unknown`, unsupported, or inconsistent diffs.
- Owners group only by owner ID. Shared surfaces group only by `dependencyId` and include entries
  with at least two distinct physical occurrence keys. Major cards group by
  `(dependencyId, current, target)`.
- `OwnerImpact.operationIds` exactly match that owner's occurrences in canonical occurrence order,
  and every selected operation appears in exactly one owner impact. `MajorBlastRadius.operationIds`
  exactly match its occurrences; its owners are deduplicated by owner ID and sorted by reconciled
  owner order. Singleton and non-major operations remain present in owner impact even though they
  are intentionally absent from `shared` or `majors`; insight construction never drops a selected
  operation.
- Major age is `known` only when every occurrence has the same known value, `unknown` only when all
  values are null, and `mixed` otherwise. Exact per-occurrence values remain retained.
- Major compatibility has independent compatible/incompatible/unknown occurrence counts; it never
  converts unknown to success or uses the executor runtime.
- All comparisons use deterministic JavaScript code-unit ordering, never `localeCompare`.
  Occurrences order by source path, `canonicalJson(occurrencePath)`, then operation ID; shared
  surfaces by dependency ID then name; major cards by dependency ID, current, then target; owners
  by the reconciled owner order then ID.
- The reducer and insight builder deep-copy nested insight evidence before freezing. They never
  freeze caller-owned input objects. The complete result, all nested arrays, and retained nested
  evidence are deeply frozen.

**Deterministic synthetic insight fixture:**

- Severity is exactly `3 major / 37 minor / 36 patch`.
- Owner 0 has 6 operations; owners 1-14 have 5 each, for 76 operations total. Owner 0 is
  `lab-editor`, owner 1 is `web`, and owner 14 is `root-catalog`.
- Owners 0-12 each own one physical target. Owners 13 and 14 are distinct physical owners sharing
  one workspace configuration target, yielding 15 owner groups and 14 physical targets.
- `react-dropzone` has two occurrences; three other dependency IDs have three occurrences each;
  fourteen have two occurrences each. This yields 18 repeated dependency identities and 39
  repeated occurrences. The other 37 occurrences are singletons, including `nanoid`.
- The three major operations form exactly two cards: the two `react-dropzone` occurrences
  `^15.0.0 -> ^17.0.0`, and root-catalog `nanoid` `^5.1.16 -> ^6.0.0`. All three retain age
  `432_000_000` ms and compatibility `unknown`.
- Include permutation, equal-label/different-ID, equal-display-name/different-dependency-ID,
  duplicate-occurrence, conflicting-source, unsafe-path, mixed-age, mixed-compatibility, and
  deep-freeze assertions.

- [x] **Step 1: Write insight RED tests**

Build the deterministic synthetic fixture above. Assert exact topology, `3/37/36` distribution,
`6 + 14*5` owner impact, 14 physical targets, `18/39` shared identities/occurrences, catalog-owner
identity, deterministic permutation invariance, strict failure cases, deep freezing, and the two
major cards. Ensure equal display names with different dependency IDs and equal owner labels with
different owner IDs are never merged. Prove caller-owned nested evidence remains mutable after the
snapshot/result copy is frozen.

```ts
export interface VisualPlusInsights {
  topology: { packages: number; declared: number; eligible: number; updates: number; files: number }
  distribution: { major: number; minor: number; patch: number }
  owners: readonly OwnerImpact[]
  shared: readonly SharedDependencySurface[]
  majors: readonly MajorBlastRadius[]
}
```

- [x] **Step 2: Run insight RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/insights.test.ts`

Expected: FAIL because the insight builder does not exist.

- [x] **Step 3: Retain exact relationship inputs in the run model**

First extend `LegacySelectionEvidenceOperation`, then project it through
`VisualPlusSelectionProjection`, and finally retain it in optional `CheckRunChange.insight`. Add the
exact dependency ID, source file ID/path, physical manifest or catalog owner, occurrence path,
catalog identity/role, explicit age, and compatibility evidence required by pure insights. Assert
the full cross-field coherence matrix, source-ID/path bijection, catalog ID formula, stable owner
assignment, transitional metadata equality, and a byte-for-byte regression for every existing
public JSON result. Do not expose absolute paths or add JSON/schema fields.

- [x] **Step 4: Implement deterministic insight builders**

Validate and deep-freeze the authoritative evidence before grouping. Group shared surfaces by exact
dependency ID and distinct physical occurrence key, owners by owner ID, and majors by exact
dependency ID/current/target. Use the ordering and aggregation rules above. Compute distribution
from selected operations while retaining numeric labels. Never infer identity, age, catalog
ownership, or runtime compatibility from display metadata.

- [x] **Step 5: Run insight GREEN tests**

Run insight and run-model tests, typecheck, and focused Biome. Expected: exact fixture counts and
stable order pass.

### Task 2: Render functional Visual+ maps

**Files:**

- Create: `src/commands/check/visual-plus/sections/distribution.ts`
- Create: `src/commands/check/visual-plus/sections/impact.ts`
- Create: `src/commands/check/visual-plus/sections/shared.ts`
- Create: `src/commands/check/visual-plus/sections/risk.ts`
- Create: `src/commands/check/visual-plus/sections/insights.test.ts`
- Create: `src/commands/check/visual-plus/test-fixture.ts`
- Modify: `src/commands/check/visual-plus/renderer.ts`
- Modify: `src/commands/check/visual-plus/renderer.test.ts`
- Modify: `src/commands/check/visual-plus/insights.test.ts`
- Modify: `src/commands/check/visual-plus/sections/sections.test.ts`
- Modify: `src/commands/check/visual-plus/sections/topology.ts`
- Modify: `src/commands/check/visual-plus/theme.ts`

**Interfaces:**

- Consumes: `VisualPlusInsights` and `VisualPlusCapabilities`.
- Produces: complete topology/distribution/impact/shared/risk lines in wide, medium, narrow, plain,
  and colorless modes.

**Integration and rendering contract:**

- Keep `VisualPlusSectionInput` and `run-check.ts` unchanged. Caller-supplied derived insights are
  forbidden. After `createVisualPlusSectionInput(source)` validates and deep-copies the
  authoritative snapshot, `writeReview()` calls `buildVisualPlusInsights(input.snapshot)` exactly
  once and before emitting any review-section bytes.
- Add `VisualPlusInsightError` to the renderer's contract-error classification. Invalid insight
  evidence fails closed without being reported through the internal `onError` callback and without
  partial topology/map/change-list output.
- Pure map sections receive only `VisualPlusInsights` plus the immutable startup
  `VisualPlusCapabilities`. A capability-only safe wrapping helper in `theme.ts` is the single text
  sanitation/width boundary; sections never derive evidence independently.
- Review order is exactly topology -> distribution -> risk -> impact -> shared -> unchanged
  complete change list. `renderVisualPlusChanges(input)` remains the only operation-review surface
  and appears exactly once. Maps never print operation IDs.
- `Risk focus` means the exact major-card inventory only. It renders both approved cards, their
  current/target transitions, occurrence count, exact age state, independent
  compatible/incompatible/unknown counts, and every major owner. Non-major compatibility
  uncertainty remains complete in the unchanged change list; it is not silently claimed as part of
  the risk map.
- `Shared dependencies` renders all 18 dependency IDs and every one of the 39 physical occurrences.
  Each visible occurrence includes semantic `Owner`, `Source`, and `Path` labels derived from its
  canonical owner/source/occurrence evidence; equal display names remain separate surfaces.
- `Owner impact` renders all 15 owner IDs with owner label, physical target, update count, and exact
  major/minor/patch counts. `Distribution` always retains explicit `Major 3`, `Minor 37`, and
  `Patch 36` text next to any proportional bar. `Topology` uses insight topology, so selected
  operations—not registry candidates—supply its update count.
- For these new map sections only, `layout === 'plain'` forces ASCII separators, connectors, and
  bars even when `capabilities.unicode === true` (the real CI/pipe profile). This does not alter
  existing Plan 034 header/lifecycle/change/receipt rendering. Test both plain+Unicode and
  plain+ASCII capability profiles.
- Zero-selection insights render stable headings, zero numeric distribution, and explicit empty
  owner/shared/risk states without division by zero. Decorations disappear before any semantic
  label, count, owner, source, path, age, compatibility state, or transition.
- Extract the exact Task 1 66/616/612/76/15/14/18/39/2 synthetic model into the test-only
  `test-fixture.ts` and reuse it from insight and section tests. Do not import another `.test.ts` or
  duplicate the arithmetic.

- [x] **Step 1: Write RED snapshots at required widths**

Snapshot 40, 60, 80, and 118 columns plus plain 8/10-column containment. Assert every shared
occurrence and major owner remains present, bars have numeric labels, and color stripping preserves
the same words/numbers. Use small stripped snapshots for layout and full-fixture semantic
inventories for completeness rather than raw snapshots of all 76 operations. Include:

- every rendered line has `visualLength <= width` at 40/60/80/118 and both real plain profiles at
  8/10;
- all 15 owners and exact `[6, ...14x5]` updates, all 18 shared dependency IDs and 39 distinct
  owner/source/path occurrence tuples, and both major cards/all three major occurrences;
- exact transitions, `~5d`, explicit compatibility counters, and numeric Major/Minor/Patch labels
  that remain after bar glyphs and ANSI are removed;
- colored output contains ANSI and strips to exactly the same semantic bytes as the equivalent
  same-Unicode colorless output; colorless/plain output contains no escape bytes;
- hostile OSC/CSI/newline/bidi/zero-width/wide-grapheme fields remain sanitized and contained;
- topology uses `insights.topology.updates` when registry `counts.updates` differs from selected
  `counts.operations`;
- hierarchy headings are strictly ordered and emitted once, builder failure emits no review
  section bytes, maps contain no operation IDs, and the unchanged change list retains all 76 exact
  operation rows once.

- [x] **Step 2: Run section RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/sections/insights.test.ts`

Expected: FAIL because the map sections do not exist.

- [x] **Step 3: Implement adaptive map topology**

Wide layouts may place label/count/bar on one line. Medium/narrow layouts stack labels and values.
Plain mode uses ASCII separators and ordinary lists. Decorative connectors disappear before any
name, count, path, risk, or compatibility label.

- [x] **Step 4: Insert maps into the approved hierarchy**

Render topology, distribution, risk, impact, and shared surfaces before the complete change list.
Do not duplicate dependency detail: maps reference owners/relationships, while the change list
remains the exact operation review surface.

- [x] **Step 5: Run GREEN visual tests**

Run all Visual+ section, renderer, width, ANSI, and overflow suites. Expected: no horizontal
overflow, hidden relationships, or color-only meaning.

### Task 3: Deterministic Spreadu-shaped fixture

**Files:**

- Create: `test/helpers/visual-plus-fixture.mjs`
- Create: `test/visual-plus-fixture.test.ts`
- Modify: `test/practical-cli-smoke.mjs`
- Modify: `src/commands/check/visual-plus/test-fixture.ts`
- Modify: `src/commands/check/visual-plus/insights.test.ts`
- Modify: `src/commands/check/visual-plus/sections/insights.test.ts`

**Interfaces:**

- Consumes: a canonical absolute empty disposable root, a loopback HTTP registry URL with an
  explicit port, and `options.asOfMs`.
- Produces: `createVisualPlusFixture(root, options)` with a contained `repository/` Git root and
  sibling `runtime/` isolation root, exact package inventories, registry metadata, Git state,
  selected owner/target/change identities, child-local success/safety Git environments, a VCS
  probe counter, and before/expected-after bytes and SHA-256 hashes for all 14 physical targets.

**Fixture and safety contract:**

- Generate exactly 64 `package.json` manifests. Discovery must add exactly two named pnpm catalog
  pseudo-packages from one shared workspace configuration, yielding 66 runtime package inventories;
  filler must never contain another manifest or workspace/catalog declaration.
- Thirteen selected manifest owners plus two selected catalog owners share 14 physical targets.
  The two catalog owners share only the workspace configuration target. The remaining 51 manifests
  are discovered but have no selected operation.
- Assign 76 selected declarations plus 540 non-updating declarations. Exactly four non-updating
  declarations are explicitly ineligible and 536 are eligible/current, yielding independently
  derived `616 declared / 612 eligible / 76 selected / 0 unresolved` counts and `3/37/36` severity.
- Fixture expectations are not count authority. Invariant tests derive counts, identities,
  relationships, and target membership from the production loader/resolver/run-model projection.
- `options.asOfMs` is required. Fixed publication times use one captured clock, with both approved
  major targets published at `asOfMs - 432_000_000`; fixture construction never calls `Date.now()`.
- The safety variant uses a test-harness-only Git command-boundary wrapper in the child `PATH`. It
  recognizes only `ls-files -z --cached --full-name --` with the exact sorted 14 literal target
  pathspecs. It delegates matching occurrence 1 during plan construction, then injects a
  deterministic bounded oversized response on matching occurrence 2 during initial apply
  validation. The counter must equal 2, every target's `replacementAttempted` evidence must be
  false, and no lock, stage, journal, backup, or replacement may have begun. Every other invocation
  delegates to the fixed real Git executable. This seam may only reduce authority, remains outside
  production source, and never mutates `.git`, index, worktree, or target bytes.
- Success and safety variants have byte-identical selected IDs, owner IDs, target IDs, proposed
  versions, and before hashes. Success must end at every expected-after hash; safety must exit `2`
  with every before hash unchanged and no lock, stage, journal, backup, or replacement residue.
- The builder rejects a non-empty, relative, symlinked, or non-canonical root and keeps all
  generated paths under it. Tests create and clean only their own `mkdtemp` child in `finally`.
- Return isolated `HOME`, XDG cache/config, Corepack, npm cache, pnpm home/store, wrapper/counter,
  and Git config paths below the sibling `runtime/` root, never inside the Git worktree. Child launch
  strips inherited `npm_config_*` case-insensitively, uses `GIT_CONFIG_NOSYSTEM=1`, `LC_ALL=C`,
  `LANG=C`, `TZ=UTC`, and preserves no user cache/store. Porcelain must be empty before and after
  both variants without broad ignore rules.
- The registry URL validator accepts only credential-free loopback HTTP with an explicit port and
  no query/hash. Metadata uses fixed npm abbreviated bytes/timestamps and supports bounded GET/HEAD
  routing, including single-decoded npm scoped names. The test/smoke caller owns the loopback
  server: it may listen with a closure, installs the fixture's immutable response-byte map, caps
  request URL/body sizes, returns GET bodies, equivalent empty HEAD responses, deterministic
  404/405 results, and always awaits socket closure in `finally`. The fixture owns no socket.
- Every spawned Git/CLI process uses argument arrays, a 30-second timeout, and explicit output
  bounds. Full tracked-list measurement uses a sufficiently large buffer and asserts a trailing NUL,
  complete entry count, clean worktree, and bytes greater than 1,250,160 on macOS and Linux.
- Use a fixed 6,000-file ASCII filler formula with a 220-character filename body, components at
  most 240 bytes, absolute paths below 1,024 bytes, and at least 10% margin above the byte boundary.
  Fixture tests declare an explicit extended timeout covering setup and teardown; generation is
  never adaptive or unbounded.
- Expected-after bytes are an independent oracle generated from the same explicit deterministic
  JSON/YAML templates with only the selected version substitutions. The success journey must prove
  production-written bytes equal this oracle before its hashes are reused for variant comparison.

- [ ] **Step 1: Write fixture invariant RED tests**

Require the complete contract above. Independently assert the production-discovered
`64 manifests + 2 catalogs = 66` inventories, all exact counts and relationships, and that the
complete `git ls-files -z --cached --full-name` output exceeds 1,250,160 bytes while only 14
selected physical targets participate in planning/apply VCS evidence.

- [ ] **Step 2: Run fixture RED tests**

Run: `pnpm exec vitest run test/visual-plus-fixture.test.ts`

Expected: FAIL because the fixture builder does not exist.

- [ ] **Step 3: Generate deterministic repository and registry evidence**

Create 64 manifests, two catalog pseudo-packages, and enough physically present, committed, clean,
harmless tracked filler paths to cross the old buffer. Keep every ASCII path component at most 240
bytes and full paths conservatively portable. Stage with `git add -A` rather than an unbounded
argument list. Use fixed registry versions/timestamps and exact dependency assignment to yield 616
declared occurrences, 612 eligible occurrences, 76 selected operations, 15 owner groups, 14
physical targets, 18 repeated dependency identities, 39 occurrences belonging to repeated
identities, and 2 major cards plus 3 major operations. Include the approved `react-dropzone` and
`nanoid` relationships.
Initialize Git with fixed local identity/dates and record target bytes/hashes. Never copy Spreadu
source, private names, secrets, or absolute paths.

The real resolver accepts only faithfully rewritable simple ranges here. Use
`react-dropzone ^15.0.0 -> ^17.0.0`; the shorter `^15` is classified as an unsupported complex
range and registry semver `17.0.0` cannot produce `^17`. Align the synthetic test fixture and its
focused insight assertions with these canonical production bytes. Keep
`nanoid ^5.1.16 -> ^6.0.0` unchanged.

- [ ] **Step 4: Add success and safety variants**

Success keeps all exact target VCS evidence available. Safety uses the child-local, test-harness
Git wrapper defined above to make the exact apply-time target probe unavailable before replacement,
without mutating Git. Both variants use identical selected changes so output comparison is
meaningful. Assert root/cache/registry cleanup and no leaked process/socket on success and setup or
execution failure.

- [ ] **Step 5: Run fixture GREEN invariants**

Expected: all exact counts, ownership/relationship membership, isolation, cleanup, Git state, and
byte boundaries pass on macOS and Linux with stable code-unit ordering. Repeat the invariant suite
three times and require identical normalized target hashes and selected IDs.

### Task 4: Real PTY and durable fallback harness

**Files:**

- Create: `test/helpers/pty-runner.mjs`
- Create: `test/visual-plus-cli.test.ts`
- Modify: `.github/workflows/ci.yml` only if the existing matrix lacks a PTY-capable macOS/Linux job

**Interfaces:**

- Consumes: built `dist/cli.mjs`, fixture paths, exact environment, columns, and input sequence.
- Produces: bounded captured terminal bytes, normalized durable transcript, exit code, and timeout
  diagnostics.

- [ ] **Step 1: Write PTY adapter RED tests**

Detect BSD and util-linux `script` argument forms with a read-only capability probe. Launch only a
generated fixed test wrapper; never interpolate repository/user values into shell code. Require an
actual child TTY assertion before accepting a capture as PTY proof.

- [ ] **Step 2: Run PTY adapter RED tests**

Run the focused helper test on both supported CI operating systems. Expected: FAIL until the
adapter returns `isTTY === true` and bounded output.

- [ ] **Step 3: Implement bounded cross-platform capture**

Use argument-array `spawn`, a disposable wrapper/config file, a 30-second timeout, 4 MiB combined
output limit, signal cleanup, and transcript normalization that removes only live-frame control
sequences. Retain final visible text exactly.

- [ ] **Step 4: Write built-CLI success and block journeys**

For 40/60/80/118 columns, assert all 76 rows and 14 targets exactly once, lifecycle resolution,
insight counts, final copy, exit `0`/`2`, no orphan spinner/cursor state, and exact filesystem
hashes.

- [ ] **Step 5: Write no-motion fallback journeys**

Run non-TTY, CI, slow pipe, `TERM=dumb`, `NO_COLOR`, reduced motion, and hostile Unicode/control
cases. Assert no cursor escapes/repeated frames, complete semantic content, and output drain before
exit.

- [ ] **Step 6: Run PTY/fallback GREEN tests**

Build first, then run `pnpm exec vitest run test/visual-plus-cli.test.ts`. Expected: all journeys
pass on supported macOS/Linux jobs; unsupported PTY environments fail explicitly rather than skip
the release gate silently.

### Task 5: Documentation and final 2.1.0 candidate gate

**Files:**

- Modify: `README.md`
- Modify: `docs/output-formats/table.md`
- Modify: `docs/output-formats/README.md`
- Modify: `docs/cli/modes.md`
- Modify: `docs/troubleshooting.md`
- Modify: `CHANGELOG.md`
- Modify: `plans/035-visual-plus-insights-pty-proof.md` with completion evidence after proof
- Modify: `plans/README.md` and `.superpowers/sdd/progress.md` only when marking done

**Interfaces:**

- Consumes: complete Visual+ implementation and PTY proof.
- Produces: reviewed `2.0.2`-version implementation eligible for Plan 036 release preparation.

- [ ] **Step 1: Document all four result journeys**

Include capable and plain examples for complete, safety block, partial result, and recovery
incomplete. Define all counts, exit codes, command-level preflight, per-file atomicity, non-atomic
repository boundary, fallbacks, and explicit interactive/JSON/global differences.

- [ ] **Step 2: Run focused terminal proof three times**

Repeat insight, section, renderer, fixture, PTY, fallback, command apply, orchestration, JSON, and
interactive tests three times. Expected: stable counts/transcripts and no leaks.

- [ ] **Step 3: Run complete gates**

```bash
pnpm schemas:check
pnpm typecheck
pnpm lint
pnpm test:run --coverage
pnpm build
pnpm test:smoke
pnpm test:demo
pnpm test:release
pnpm verify:package
```

Expected: every command exits `0`, full PTY journeys pass, no new runtime/native dependency exists,
and the packed CLI reproduces source behavior.

- [ ] **Step 4: Require final design-conformance review**

Map every acceptance criterion in the approved spec to a passing test or inspected output. Require
independent correctness/terminal-safety and UX/docs approvals. Plan 036 cannot start with gaps.
