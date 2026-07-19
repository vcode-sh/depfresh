# Visual+ Compact Output and 2.1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the exhaustive default Visual+ transcript with a bounded compact view, retain the
complete audit under `--long`, show truthful discovered repository context, and prepare a verified
local `depfresh@2.1.1` candidate.

**Architecture:** One immutable detail-level contract selects pure compact or existing exhaustive
section renderers from the same authoritative snapshot. A one-time post-discovery renderer context
transition replaces false startup placeholders. Release preparation remains local and follows the
pinned 2.1.1 package-verification path without publishing or tagging.

**Tech Stack:** TypeScript, Vitest, Biome, Node `24.15.0`, npm `11.12.1`, pnpm `10.33.0`, existing
PTY harness, Bun global local-package installation.

## Global Constraints

- All code, documentation, tests, plans, and commit messages are English.
- Work on `main`, preserve unrelated files, and commit each reviewed task independently.
- Use test-driven development: every production behavior starts with a focused failing test whose
  expected failure is observed before implementation.
- Default compact Visual+ output must not exceed 80 durable lines for the successful
  Spreadoo-shaped read-only fixture at 40, 60, 80, 118, and typical wide widths.
- Compact output never shows internal operation, owner, dependency, or source-file IDs.
- Compact limits never hide non-success target, recovery, or final-exit evidence.
- `--long` retains complete 2.1.0 audit semantics and every selected change, physical occurrence,
  and target membership.
- JSON, interactive, global, silent, veto-capable, and public library behavior remains unchanged.
- Repository context uses already observed contained filesystem/package evidence and executes no
  manager, Git, registry, or lifecycle process.
- Node remains `>=24.15.0`; package manager remains `pnpm@10.33.0`; add no runtime dependency.
- Prepare and locally install `2.1.1` only after all required verification passes.
- Do not publish, push, tag, create a GitHub release, or claim hosted/public proof.

---

### Task 1: Compact and full rendering contract

**Files:**

- Modify: `src/commands/check/visual-plus/input.ts`
- Modify: `src/commands/check/visual-plus/test-fixture.ts`
- Create: `src/commands/check/visual-plus/sections/compact.ts`
- Modify: `src/commands/check/visual-plus/sections/transaction.ts`
- Modify: `src/commands/check/visual-plus/renderer.ts`
- Modify: `src/commands/check/visual-plus/sections/sections.test.ts`
- Modify: `src/commands/check/visual-plus/sections/insights.test.ts`
- Modify: `src/commands/check/visual-plus/renderer.test.ts`

**Interfaces:**

- Consumes: `VisualPlusSectionInput`, `VisualPlusInsights`, and the existing exhaustive renderers.
- Produces: `VisualPlusRunMetadata.detailLevel: 'compact' | 'full'` and pure compact review/receipt
  renderers with deterministic limits.

- [ ] **Step 1: Write compact renderer RED tests**

Add focused assertions that the 76-change fixture in compact mode contains topology,
distribution, every major card, bounded owner/shared/update/target previews, explicit omitted
counts, and no strings matching `Operation ID`, `Owner ID`, `Dependency ID`, `operation-`,
`dependency:`, `package:`, or `source:`. Assert every successful compact journey is at most 80
durable lines and every rendered line fits widths 40, 60, 80, 118, and 175.

- [ ] **Step 2: Run RED tests**

Run:

```bash
pnpm exec vitest run src/commands/check/visual-plus/sections/sections.test.ts src/commands/check/visual-plus/sections/insights.test.ts src/commands/check/visual-plus/renderer.test.ts
```

Expected: FAIL because detail-level validation and compact renderers do not exist.

- [ ] **Step 3: Implement the compact contract**

Add `detailLevel` validation/copy/freeze to run metadata. Implement pure helpers with these exact
limits: owners `5`, shared dependencies `5`, update preview `8`, successful/read-only targets `8`.
Sort owners by updates descending then owner order, shared dependencies by occurrence count
descending then canonical current order, and updates by major/minor/patch then owner order/name/ID.
All major cards remain visible. Each truncated section ends with `… N more <items>` using ASCII
`...` in plain/non-Unicode mode.

- [ ] **Step 4: Route review and transaction output**

In `writeReview()`, build insights exactly once and select compact sections only when
`detailLevel === 'compact'`; otherwise call the unchanged exhaustive renderers. In finalization,
compact successful/read-only targets use the bounded target summary, while every non-success or
recovery-affected target remains visible. Finish a nonempty compact review with:

```text
Details: rerun with --long for the complete audit.
```

- [ ] **Step 5: Run GREEN and regression tests**

Run the Step 2 command plus:

```bash
pnpm exec vitest run src/commands/check/visual-plus/input.test.ts
pnpm typecheck
pnpm exec biome check src/commands/check/visual-plus
```

Expected: all commands exit 0 with no warnings.

- [ ] **Step 6: Commit**

```bash
git add src/commands/check/visual-plus
git commit -m "fix: make Visual Plus output compact by default"
```

### Task 2: Truthful discovered repository context

**Files:**

- Create: `src/commands/check/visual-plus/run-metadata.ts`
- Create: `src/commands/check/visual-plus/run-metadata.test.ts`
- Modify: `src/commands/check/visual-plus/sections/header.ts`
- Modify: `src/commands/check/visual-plus/renderer.ts`
- Modify: `src/commands/check/visual-plus/renderer.test.ts`
- Modify: `src/commands/check/run-check.ts`
- Modify: `src/commands/check/run-check.orchestration.test.ts`

**Interfaces:**

- Consumes: the effective root, loaded `PackageMeta[]`, contained root markers, and startup
  `VisualPlusRunMetadata`.
- Produces: `deriveVisualPlusRunMetadata(root, packages, detailLevel)` and
  `VisualPlusRenderer.setRunMetadata(metadata)`.

- [ ] **Step 1: Write metadata RED tests**

Cover one root package, a multi-package workspace, root `packageManager`, coherent duplicate
declarations, conflicting declarations, one lockfile marker, conflicting markers, absent evidence,
unreadable/unsafe marker evidence, hostile names, and deterministic source ordering. Assert no
process-spawn API is called.

- [ ] **Step 2: Write renderer/orchestration RED tests**

Assert startup emits no `Repository unknown` or `Package manager unknown`; one metadata transition
writes the correct context before review; missing, repeated, late, or conflicting transitions fail
closed. At command level, assert a Spreadoo-shaped root reports its package name, workspace scope,
and declared `pnpm` version/source.

- [ ] **Step 3: Run RED tests**

Run:

```bash
pnpm exec vitest run src/commands/check/visual-plus/run-metadata.test.ts src/commands/check/visual-plus/renderer.test.ts src/commands/check/run-check.orchestration.test.ts
```

Expected: FAIL because the derivation and renderer transition do not exist.

- [ ] **Step 4: Implement the one-time context transition**

Start Visual+ with the check heading and lifecycle only. After `loadPackagesWithLogger()` returns,
derive metadata from the effective root and package inventory, call `setRunMetadata()` exactly
once, and use that frozen metadata for every later section input. Reject review before context and
reject a second transition. Render `unknown` only as post-discovery absence of evidence.

- [ ] **Step 5: Run GREEN and neighboring tests**

Run the Step 3 command plus:

```bash
pnpm exec vitest run src/commands/check/check.flags.all.test.ts src/io/packages/packages.load.test.ts
pnpm typecheck
pnpm exec biome check src/commands/check/run-check.ts src/commands/check/visual-plus
```

Expected: all commands exit 0 with no warnings.

- [ ] **Step 6: Commit**

```bash
git add src/commands/check/run-check.ts src/commands/check/run-check.orchestration.test.ts src/commands/check/visual-plus
git commit -m "fix: show discovered Visual Plus repository context"
```

### Task 3: CLI, PTY, fallback, and documentation journeys

**Files:**

- Modify: `src/cli/args-schema.ts`
- Modify: `test/visual-plus-cli.test.ts`
- Modify: `README.md`
- Modify: `docs/output-formats/table.md`
- Modify: `docs/troubleshooting.md`
- Modify: `CHANGELOG.md`
- Modify: `plans/README.md`

**Interfaces:**

- Consumes: `options.long`, compact/full renderers, and the retained PTY adapter.
- Produces: product-level proof of default compact output and explicit complete `--long` output.

- [ ] **Step 1: Write built-CLI RED journeys**

Add true-PTY and direct-pipe journeys proving default compact line budgets, absence of internal
IDs, correct repository/manager lines, `--long` complete operation/owner/shared/target membership,
terminal-control containment, exit codes, and byte-identical fixture repositories. Preserve exact
non-success target/recovery evidence in compact mode.

- [ ] **Step 2: Run PTY RED tests**

Run under the pinned Mise toolchain:

```bash
mise exec -- pnpm exec vitest run test/visual-plus-cli.test.ts --retry=0
```

Expected: new compact and metadata assertions fail against the current built CLI behavior.

- [ ] **Step 3: Wire `--long` and update help text**

Map eligible Visual+ `options.long` to `detailLevel: 'full'`; default to `compact`. Change the
`--long` description to state that it includes the complete Visual+ audit while retaining legacy
homepage behavior outside Visual+.

- [ ] **Step 4: Document both journeys**

Document default compact output, `--long` completeness, `--write --interactive`, line-budget
semantics, failure-detail override, and the removal of false startup placeholders. Add an
Unreleased changelog entry and mark Plan 037 active in `plans/README.md`.

- [ ] **Step 5: Run GREEN and route regressions**

Run:

```bash
mise exec -- pnpm build
mise exec -- pnpm exec vitest run test/visual-plus-cli.test.ts --retry=0
mise exec -- pnpm exec vitest run src/cli/index.test.ts src/commands/check/check.interactive-selection.test.ts src/commands/check/interactive.test.ts
mise exec -- pnpm typecheck
mise exec -- pnpm lint
```

Expected: all commands exit 0, the PTY suite reports zero retries, and lint has zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/cli/args-schema.ts test/visual-plus-cli.test.ts README.md docs/output-formats/table.md docs/troubleshooting.md CHANGELOG.md plans/README.md
git commit -m "test: prove compact Visual Plus terminal journeys"
```

### Task 4: Prepare and verify the local 2.1.1 candidate

**Files:**

- Modify: `package.json`
- Modify: maintained current-version references identified by `test/release-readiness.test.ts`
- Modify: `test/package-assets.test.ts`
- Modify: `test/release-readiness.test.ts`
- Modify: `test/visual-plus-cli.test.ts`
- Create: `docs/releases/v2.1.1.md`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/README.md`
- Modify: `plans/037-visual-plus-compact-2.1.1.md`
- Modify: `plans/README.md`

**Interfaces:**

- Consumes: reviewed Tasks 1-3 and the pinned release toolchain.
- Produces: one committed, locally packed, locally installed, fully verified 2.1.1 candidate.

- [ ] **Step 1: Write release-coupling RED tests**

Update release readiness and package asset tests to require `2.1.1`, a dated changelog section,
dedicated release notes, workflow body path, current docs/runner pins, and preserved historical
2.1.0 evidence. Explicitly assert the release note makes no npm publication, tag, hosted, or public
artifact claim.

- [ ] **Step 2: Run release RED tests**

Run:

```bash
mise exec -- pnpm exec vitest run test/release-readiness.test.ts test/package-assets.test.ts
```

Expected: FAIL because package and maintained release surfaces still identify 2.1.0.

- [ ] **Step 3: Bump maintained candidate surfaces**

Set the package version to `2.1.1` while leaving the versionless root `pnpm-lock.yaml` unchanged,
move the Visual+ compact changelog entry to
`## [2.1.1] - 2026-07-20`, add comparison links, create the candidate release note, update current
README/docs/workflow/test pins, and leave historical 2.1.0 evidence unchanged.

- [ ] **Step 4: Run the complete pinned source gate**

Run with `--retry=0` where supported:

```bash
mise exec node@24.15.0 npm@11.12.1 -- pnpm install --frozen-lockfile
mise exec node@24.15.0 npm@11.12.1 -- pnpm schemas:check
mise exec node@24.15.0 npm@11.12.1 -- pnpm typecheck
mise exec node@24.15.0 npm@11.12.1 -- pnpm lint
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec biome check --error-on-warnings .
mise exec node@24.15.0 npm@11.12.1 -- pnpm exec vitest run --coverage --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm build
mise exec node@24.15.0 npm@11.12.1 -- pnpm test:smoke
mise exec node@24.15.0 npm@11.12.1 -- pnpm test:demo
mise exec node@24.15.0 npm@11.12.1 -- pnpm test:release -- --retry=0
mise exec node@24.15.0 npm@11.12.1 -- pnpm verify:package
```

Expected: every command exits 0 with zero failed tests and zero retries.

- [ ] **Step 5: Pack and verify one isolated artifact**

Run the repository package verifier, record exact filename, file count, packed/unpacked bytes,
SHA-1, SHA-256, SHA-512 integrity, and installed CLI SHA-256 in `docs/releases/v2.1.1.md`, then rerun
release readiness. The verifier must use disposable HOME/cache/store/temp/install paths and the
exact candidate bytes.

- [ ] **Step 6: Install the exact candidate for Bun and smoke Spreadoo**

Install the verified local tarball with Bun global package management. Verify:

```bash
bunx --no-install depfresh --version
bunx depfresh --version
```

Both must print `2.1.1`. Run `bunx depfresh major` in `/Users/tomrobak/_projects_/spreadoo` under a
true PTY and require compact output, correct `spreadu`/`pnpm` context, exit 0, at most 80 durable
lines, no internal IDs, and unchanged `git status --short` before/after.

- [ ] **Step 7: Final independent review and commit**

Obtain a whole-range code/spec/safety review. Fix every Critical or Important finding and rerun its
covering tests. Mark Plan 037 complete only after the review is clean and every fresh verification
result is recorded.

```bash
git add package.json CHANGELOG.md README.md docs .github test plans
git commit -m "chore: prepare depfresh 2.1.1"
```
