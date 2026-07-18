# depfresh 2.0.1 terminal write UX audit

## Audit contract

- **Date**: 2026-07-18
- **Audited commit**: `9f0af97`
- **Incident command**: `bunx depfresh major -w`
- **Incident repository**: `/Users/tomrobak/_projects_/spreadoo`
- **Primary evidence**:
  `/Users/tomrobak/.codex/attachments/0400af19-403e-4340-9339-c0ee71ef1daa/pasted-text.txt`
- **Scope**: write correctness, human terminal output, progress/motion, interactive architecture,
  documentation, and regression coverage
- **Out of scope**: source changes, dependency installation, publishing, Git mutation, and recovery
  of the user's Spreadu changes

## Executive verdict

The reported experience is a product-level failure, but the visual layer is not the first defect to
fix. The incident combines four failures:

1. A real scalability bug makes the repository-root Git evidence probe exceed Node's default
   synchronous child-process buffer.
2. The compatibility adapter discards the exact preflight reason and exposes the misleading pair
   `unknown (WRITE_FAILED)`.
3. Normal `-w` writes each package independently, so 35 occurrence updates were retained before 41
   root-file operations were blocked.
4. The terminal presents full tables and every low-level occurrence at equal visual weight, then
   ends without a plain-language safety verdict or recovery instruction.

This was not observed corruption of `spreadoo/package.json`. The root file was not changed because
its write plan failed closed before replacement. Thirteen child manifests were changed, containing
35 applied updates. The root manifest and its Bun catalog remained unchanged, accounting for all 41
unknown operations. The resulting repository is therefore partially updated.

The command returns exit code `2` for this outcome in the current implementation, but the supplied
terminal transcript does not make that contract visible to the user.

## Proven causal chain

```text
root git ls-files output: 1,250,160 bytes
  -> Node spawnSync default output buffer exceeded at 1,114,112 bytes (ENOBUFS)
  -> repository evidence becomes VCS_PROBE_FAILED
  -> apply preflight becomes VCS_UNAVAILABLE
  -> all operations in that physical root file become unknown
  -> legacy adapter rewrites VCS_UNAVAILABLE to WRITE_FAILED
  -> terminal prints 41 occurrence-level "Write unknown" warnings
```

The equivalent probe from `apps/docs` emits only 5,329 bytes and succeeds. This explains the exact
split between root-file failures and child-manifest successes without assuming a filesystem write
error.

## Current post-run state in Spreadu

- `package.json`: unchanged relative to Git
- Bun catalog in root `package.json`: unchanged
- Modified child manifests: 13
- Applied occurrence updates in those files: 35
- `bun.lock`: unchanged by this command; normal `-w` does not run an install or lockfile phase
- Unknown occurrence updates targeting root `package.json`: 41

No recovery action was performed during this audit.

## Prioritized findings

| # | Finding | Category | Impact | Effort | Fix risk | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Target-scope the Git tracked-file probe and retain bounded process diagnostics | Correctness | Critical | M | Medium | High |
| 2 | Preserve the real apply/preflight reason through compatibility output | Correctness / UX | High | M | Low | High |
| 3 | Replace package-by-package mutation with one command-level write transaction envelope | Correctness / architecture | Critical | L | High | High |
| 4 | Render one grouped, actionable partial-failure result instead of 41 warnings | UX / DX | High | M | Medium | High |
| 5 | Add write, observation, and recovery to the visible run lifecycle | UX / motion | High | M | Medium | High |
| 6 | Make default TTY output overview-first with progressive disclosure | UX | High | M | Low | High |
| 7 | Add real PTY and large-Git regression contracts | Test coverage | High | M | Low | High |
| 8 | Align human documentation and error terminology with actual exit/write semantics | Docs | Medium | S | Low | High |

### 1. The root Git inventory exceeds the synchronous process buffer

**Evidence**

- `src/repository/vcs.ts:277-299` runs an unscoped `git ls-files -z --cached --full-name` through
  `spawnSync` without a larger or streaming buffer.
- `src/repository/vcs.ts:137-144` converts the process failure to generic `VCS_PROBE_FAILED`.
- A production-equivalent read-only probe in Spreadu reproduced `spawnSync git ENOBUFS`, with
  1,114,112 stdout bytes captured before termination.
- `src/commands/apply/engine.ts:747-758` correctly fails closed when either planned or current VCS
  evidence is unavailable.

**Impact**

Any sufficiently large repository can make root-target writes impossible while nested targets still
work. This is deterministic repository-size behavior, not an intermittent write failure.

**Required direction**

Query tracked state only for the exact target path set instead of enumerating the entire repository.
Keep a bounded explicit output limit and distinguish an output-limit failure from a missing/corrupt
Git probe. Add a fixture whose tracked-file output exceeds the old limit.

### 2. The compatibility layer destroys the actual cause

**Evidence**

- `src/commands/apply/engine.ts:1207-1240` retains the preflight reason in phase and operation data.
- `src/commands/apply/legacy.ts:47-56` projects only operation outcomes and drops phases, recovery,
  and diagnostics.
- `src/commands/apply/legacy.ts:307-321` maps every unrecognized reason, including
  `VCS_UNAVAILABLE`, to `WRITE_FAILED`.
- `src/types/write.ts:9-24` cannot represent VCS preflight failure in the compatibility reason set.

**Impact**

The displayed message implies a file write may have failed, although no root replacement was
attempted. The user cannot distinguish "preflight blocked safely" from "mutation happened but final
state could not be observed."

**Required direction**

Carry the exact safe public reason category and run/recovery status to the human renderer. Internal
codes may remain available in details, but the primary copy must say which phase stopped and whether
any replacement was attempted.

### 3. Normal `-w` applies a series of package transactions, not one repository run

**Evidence**

- `src/commands/check/run-check.ts:283-299` processes resolved packages sequentially.
- `src/commands/check/process-package.ts:70-86` selects and writes inside each package iteration.
- `src/commands/check/write-flow.ts:82-84` delegates one package at a time.
- `src/commands/apply/legacy.ts:42-47` creates an independent plan from only that package's inputs.
- Live Spreadu state contains 35 applied changes in 13 child manifests while the root file stayed
  unchanged.

**Impact**

The stale-safe apply engine's preflight cannot prevent earlier package runs from committing when a
later package fails. Per-file safety remains, but the user's mental model of one command producing
one coherent result is false.

**Required direction**

Resolve and select globally, then construct one command-level plan containing all selected physical
occurrences. Preflight all targets before the first replacement, retain one lock/journal lifecycle,
and produce one run result. This does not create impossible repository-wide atomicity, but it does
prevent known preflight failures from being discovered only after earlier files were changed.

### 4. Human output amplifies one incident into 41 equal-weight alarms

**Evidence**

- Incident transcript lines 260-269 and 470-500 contain 41 nearly identical warnings targeting the
  same physical file.
- `src/commands/check/run-check.ts:226-245` suppresses applied items but prints every non-applied
  occurrence as an absolute path, dotted object path, status, and internal code.
- `src/commands/check/run-check.ts:374-377` ends with only numeric write totals.

**Impact**

The one decision-relevant fact is buried: the run partially updated 13 files, did not update the
root file, and stopped because root Git evidence could not be collected. Repetition reads like 41
independent write failures and destroys trust.

**Required direction**

Group human diagnostics by physical file, phase, and reason. Render one prominent partial-failure
receipt with applied/unchanged/unconfirmed file counts, whether replacement was attempted, and the
next safe action. Put the occurrence list behind a details or debug view.

### 5. The progress model stops before the consequential work

**Evidence**

- `src/commands/check/progress.ts:9-19` models discovery, evidence, resolution, and rendering only.
- `src/commands/check/progress.ts:165-175` labels the final live phase `Rendering results`.
- Actual writes occur inside the rendering loop at `src/commands/check/run-check.ts:282-299` and
  `src/commands/check/process-package.ts:74-86`.
- `src/commands/check/progress.ts:208-230` clears the cursor-controlled progress, so its flow is not
  durable in a pasted transcript.

**Impact**

The user sees motion while low-risk work happens, then no truthful live state during mutation,
observation, or recovery. The transition from tables to warnings feels abrupt and uncontrolled.

**Motion verdict**

| Before | After | Why |
| --- | --- | --- |
| A discrete 50 ms bar for scan/render phases, then no write-state motion | Keep frequent progress linear and restrained; add clear apply/observe state changes and snap system results into a durable receipt | Motion should explain state and feedback. It must not delay a high-frequency CLI or decorate failure. |

Do not animate keyboard navigation or add long/staggered table entrances. A dependency CLI is a
high-frequency professional tool: state changes should be crisp, interruptible, and generally under
300 ms. The premium quality gap is primarily semantic continuity and hierarchy, not missing bounce
or easing.

### 6. Large monorepo output lacks progressive disclosure

**Evidence**

- `src/commands/check/render/table-layout.ts:21-48` always emits a package title, groups, rows,
  spacing, and package summary.
- `src/commands/check/render/table-layout.ts:50-73` repeats group headers and separators.
- Run-level totals appear only after all package output at `src/commands/check/run-check.ts:322-341`.
- The complete supplied transcript contains 129 blank lines, 38 dependency-section headers, and 41
  write warnings across the read-only and write invocations.

**Impact**

Important information has no visual priority. A user must scan hundreds of lines before learning
whether the write succeeded.

**Required direction**

Default TTY output should be overview-first: repository scope, update mix, high-risk majors,
physical files affected, then the final write verdict. Preserve full tables in `--verbose`, a
details view, and machine output. Avoid hiding major updates or unknown evidence.

### 7. Existing tests prove components, not this journey

**Evidence**

- `src/repository/vcs.test.ts:137-171` covers failing/corrupt Git probes but no inventory larger
  than the process buffer.
- `src/commands/check/test-helpers.ts:37-39` mocks the legacy apply path for check tests.
- `src/commands/check/check.write-outcomes.test.ts:12-59` verifies aggregate JSON reconciliation
  with mocked outcomes.
- `src/commands/check/progress.test.ts:69-183` tests phase text, cursor ownership, throttling, and
  narrow terminals, but not a full partial-write transcript.
- The focused current suites pass: 6 files and 54 tests. Green tests therefore do not cover the
  shipped incident.

**Required direction**

Add a built-CLI PTY contract for complete success, preflight block before any write, mixed/partial
recovery, interruption, and this Bun-catalog monorepo shape. Assert final wording, cursor cleanup,
grouped diagnostics, exact exit status, and physical file state. Add a large tracked-index fixture
that would have exceeded the old buffer.

### 8. Documentation promises safety without teaching mixed outcomes

**Evidence**

- `README.md:41-53` describes `depfresh -w` as safe but does not explain partial/unknown results.
- `docs/output-formats/table.md:98-104` documents tips but not write receipts or recovery guidance.
- `docs/troubleshooting.md:139-142` points catalog failures to debug output, while
  `src/commands/apply/legacy.ts:36-40` ignores the legacy log level and exposes no phase detail.
- Documentation tone repeatedly frames errors and updates as jokes, while the actual safety model is
  strict and evidence-oriented.

**Required direction**

Document `applied`, `blocked/conflicted`, `failed`, `reverted`, and `unknown` in plain language. Show
the safe response to a mixed result and the real exit-code behavior. Use concise professional copy
for safety-critical paths; personality can remain in low-stakes guidance.

## Recommended product sequence

### P0: restore correctness and trust

1. Fix the target Git probe and add the oversized-index regression.
2. Preserve exact preflight/recovery reasons through the human compatibility boundary.
3. Group the current warning output by physical cause and add an explicit partial-failure receipt.
4. Ship this as a patch before marketing the write path as safe for large monorepos.

### P1: unify the command lifecycle

1. Introduce a renderer-neutral run model: scan, review, apply, observe, recover, complete.
2. Collect all selected operations before one command-level apply invocation.
3. Add PTY golden journeys and non-TTY compatibility tests before replacing the renderer.
4. Redesign default output around overview-first progressive disclosure.

### P2: polish the terminal presentation

1. Reuse the current Node renderer for one coherent run-level surface.
2. Add restrained activity feedback for genuinely long phases and instant durable state receipts.
3. Replace single-character status tokens and unexplained `?node` markers with explicit labels or
   an on-demand legend.
4. Refine typography, spacing, color hierarchy, and copy only after the state model is truthful.

## OpenTUI decision

Do not migrate the default CLI to OpenTUI as the first response to this incident.

- The command used plain `-w`; the current custom TUI is entered only with `-I`, so replacing that
  selector would not change this journey.
- depfresh's shipped contract is Node `>=24.15.0` (`package.json:122-124`). OpenTUI uses a
  Bun/native-Zig runtime according to its current platform contract.
- Plan 026 already records the explicit decision to keep the primary CLI inline and pure Node at
  `plans/026-repository-performance-progress-ux.md:36-55`.
- The existing raw-mode TUI already owns resize, frame rendering, input, cleanup, and tests. The
  missing abstraction is a command-level run/result model, not a rendering library.

An optional companion/spike becomes reasonable only if depfresh intentionally becomes a persistent
full-screen review application and is willing to change its runtime/packaging contract. Build the
shared run model and PTY contracts first so any renderer remains replaceable.

## Considered and rejected

- **Increase `maxBuffer` only**: rejected as the primary fix. It moves the repository-size failure
  threshold while continuing to inventory irrelevant tracked paths.
- **Rename `unknown` to `failed`**: rejected. It would destroy the conservative evidence semantics;
  the UI must explain unknown rather than lie about it.
- **Add decorative animations first**: rejected. More motion around an ambiguous partial result
  would reduce trust further.
- **Replace the existing selector with OpenTUI immediately**: rejected. It does not affect plain
  `-w` and expands runtime/packaging risk before fixing correctness.
- **Print all 41 warnings and add a better final line**: rejected. Equal-weight repetition remains
  hostile; details must be progressively disclosed.

## Verification performed

- Read the complete supplied terminal transcript.
- Inspected the current Spreadu Git state and manifest diff without modifying it.
- Reproduced the root and nested Git evidence probes with the production argument shape.
- Confirmed root `git ls-files -z` output size and the exact `ENOBUFS` termination.
- Called current `collectVcsEvidence()` against Spreadu root and `apps/docs`; observed unavailable
  root evidence and confirmed nested evidence.
- Ran focused Vitest suites for VCS, write outcomes, progress, and TUI rendering: 6 files, 54 tests,
  all passed.
- No depfresh source files, Spreadu files, Git index entries, commits, branches, or remote state were
  changed by this audit.

## Audit limits

- No full-screen interactive recording was made because the incident command did not use `-I`.
- No registry resolution or second write run was performed against Spreadu.
- The complete test suite, build, lint, and exact-Node package replay were not needed for this
  read-only diagnosis and were not run.
- No implementation plan files were created; findings should be selected and split into executable
  plans before source work starts.
