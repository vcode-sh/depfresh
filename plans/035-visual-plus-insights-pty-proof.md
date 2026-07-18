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
- The fixture contract is exact: 66 packages, 616 declared, 612 eligible, 76 selected updates,
  15 owner groups, 14 physical targets, 18 repeated names, 39 repeated occurrences, and 2 major
  blast-radius cards.
- The two approved major cards are `react-dropzone` `^15 -> ^17` across `lab-editor` and `web`,
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
- Modify: `src/commands/check/run-model.ts`
- Modify: `src/commands/check/run-model.test.ts`

**Interfaces:**

- Consumes: selected changes with exact owner/source identities and existing diff/age/compatibility
  metadata.
- Produces: `buildVisualPlusInsights(snapshot): VisualPlusInsights`.

- [ ] **Step 1: Write insight RED tests**

Assert exact topology, major/minor/patch distribution, owner impact, physical shared occurrences,
catalog-owner identity, deterministic ordering, and two major cards. Ensure equal dependency names
with different physical identities are not merged incorrectly.

```ts
export interface VisualPlusInsights {
  topology: { packages: number; declared: number; eligible: number; updates: number; files: number }
  distribution: { major: number; minor: number; patch: number }
  owners: readonly OwnerImpact[]
  shared: readonly SharedDependencySurface[]
  majors: readonly MajorBlastRadius[]
}
```

- [ ] **Step 2: Run insight RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/insights.test.ts`

Expected: FAIL because the insight builder does not exist.

- [ ] **Step 3: Retain exact relationship inputs in the run model**

Add internal source file ID, repository-relative owner path, occurrence path, catalog identity/role,
and compatibility evidence required by pure insights. Do not expose absolute paths or add JSON.

- [ ] **Step 4: Implement deterministic insight builders**

Group shared surfaces by dependency name and physical occurrence identity, not display owner name.
Include only names with at least two physical occurrences. Compute proportional distribution from
counts while retaining numeric labels. Major cards include current/target, all owners, age, and
known/unknown compatibility; never synthesize runtime compatibility.

- [ ] **Step 5: Run insight GREEN tests**

Run insight and run-model tests, typecheck, and focused Biome. Expected: exact fixture counts and
stable order pass.

### Task 2: Render functional Visual+ maps

**Files:**

- Create: `src/commands/check/visual-plus/sections/distribution.ts`
- Create: `src/commands/check/visual-plus/sections/impact.ts`
- Create: `src/commands/check/visual-plus/sections/shared.ts`
- Create: `src/commands/check/visual-plus/sections/risk.ts`
- Create: `src/commands/check/visual-plus/sections/insights.test.ts`
- Modify: `src/commands/check/visual-plus/renderer.ts`
- Modify: `src/commands/check/visual-plus/sections/topology.ts`

**Interfaces:**

- Consumes: `VisualPlusInsights` and `VisualPlusCapabilities`.
- Produces: complete topology/distribution/impact/shared/risk lines in wide, medium, narrow, plain,
  and colorless modes.

- [ ] **Step 1: Write RED snapshots at required widths**

Snapshot 40, 60, 80, and 118 columns plus plain 8/10-column containment. Assert every shared
occurrence and major owner remains present, bars have numeric labels, and color stripping preserves
the same words/numbers.

- [ ] **Step 2: Run section RED tests**

Run: `pnpm exec vitest run src/commands/check/visual-plus/sections/insights.test.ts`

Expected: FAIL because the map sections do not exist.

- [ ] **Step 3: Implement adaptive map topology**

Wide layouts may place label/count/bar on one line. Medium/narrow layouts stack labels and values.
Plain mode uses ASCII separators and ordinary lists. Decorative connectors disappear before any
name, count, path, risk, or compatibility label.

- [ ] **Step 4: Insert maps into the approved hierarchy**

Render topology, distribution, risk, impact, and shared surfaces before the complete change list.
Do not duplicate dependency detail: maps reference owners/relationships, while the change list
remains the exact operation review surface.

- [ ] **Step 5: Run GREEN visual tests**

Run all Visual+ section, renderer, width, ANSI, and overflow suites. Expected: no horizontal
overflow, hidden relationships, or color-only meaning.

### Task 3: Deterministic Spreadu-shaped fixture

**Files:**

- Create: `test/helpers/visual-plus-fixture.mjs`
- Create: `test/visual-plus-fixture.test.ts`
- Modify: `test/practical-cli-smoke.mjs`

**Interfaces:**

- Consumes: a disposable root and local registry URL.
- Produces: `createVisualPlusFixture(root, options)` with exact manifests, Git state, registry data,
  expected changes, and before/after hashes.

- [ ] **Step 1: Write fixture invariant RED tests**

Require exact counts from the design and assert the complete `git ls-files -z` output exceeds
1,250,160 bytes while only 14 selected targets participate in apply.

- [ ] **Step 2: Run fixture RED tests**

Run: `pnpm exec vitest run test/visual-plus-fixture.test.ts`

Expected: FAIL because the fixture builder does not exist.

- [ ] **Step 3: Generate deterministic repository and registry evidence**

Create 66 manifests and enough harmless tracked filler paths to cross the old buffer. Use fixed
registry versions/timestamps and exact dependency assignment to yield 616/612/76/15/14/18/39/2,
including the approved `react-dropzone` and `nanoid` major relationships. Initialize Git and record
target hashes. Never copy Spreadu source, private names, secrets, or absolute paths.

- [ ] **Step 4: Add success and safety variants**

Success keeps all exact target VCS evidence available. Safety injects an internal test seam that
makes root VCS evidence unavailable before apply without mutating Git. Both variants use identical
selected changes so output comparison is meaningful.

- [ ] **Step 5: Run fixture GREEN invariants**

Expected: all exact counts and byte boundaries pass on macOS and Linux with stable ordering.

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
