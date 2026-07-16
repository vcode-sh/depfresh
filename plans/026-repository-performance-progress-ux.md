# Plan 026: Repository performance and progress UX

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: 025
- **Opened at**: `8946fb0`, 2026-07-16
- **Status**: DONE

## Objective

Make normal recursive checks feel immediate and trustworthy in large repositories. Inventory only
files that can contribute repository evidence while retaining unreadable-directory and containment
truth, show the discovery/evidence/resolution/render phases before expensive work starts, coordinate
ephemeral progress with durable tables, explain declared versus eligible counts, and finish with a
compact run summary without changing JSON, non-TTY, library, policy, cache, or exit contracts.

## Root-cause evidence

- In WUN, exact Node `24.15.0` and a disposable HOME/cache measured about 23.53 seconds cold and
  18.61 seconds warm. Warm discovery/model time was 17.83 seconds with zero network fetches.
- Direct instrumentation split package discovery at 86.74 ms from repository model construction at
  18,451.71 ms with VCS disabled. Git was not the bottleneck.
- `walkRepository()` retained every unignored file and evaluated each path plus every ancestor
  against every ignore glob. WUN exposed about 147,585 files outside `node_modules` and `.git`, most
  of them irrelevant temporary, build, mobile, and cache artifacts.
- The CLI printed `Found 29 packages with 232 dependencies` before model construction, but created
  progress only afterwards. The progress total counted 201 eligible declarations, so the first
  visible state could be `Packages 0/29` and `total 201/201`.
- All resolution promises start before ordered package rendering. The existing two-line renderer
  owns cursor movement while durable tables write independently, allowing a later progress redraw
  to move into table output.

## Product design

Keep the primary CLI inline and pure Node. A Bun/native-Zig TUI runtime would violate the shipped
Node `>=24.15.0` and packed-product contract. The TTY experience uses one small activity renderer:

1. `Discovering packages`
2. `Inspecting repository evidence`
3. `Resolving dependencies 123/201`
4. `Rendering results 27/29`

The second line reports coherent scope such as `29 packages · 232 declared · 201 eligible · 31
pinned`. Phase changes render immediately; high-frequency dependency ticks are coalesced.
Before any durable table/error/up-to-date output, progress clears and relinquishes cursor ownership;
it redraws only below that output. The final progress is cleared and a durable compact summary
reports updates and affected/scanned packages. JSON, silent, non-TTY, CI, redirected output, and
library calls never emit cursor control.

## Global constraints

- Keep package version `2.0.0`, Node `>=24.15.0`, ESM-only output, and no new runtime dependency.
- Preserve repository containment, nested boundaries, unreadable-directory diagnostics, physical
  identity, ignore patterns, Git immutability, and unknown-never-success semantics.
- Preserve exact JSON/schema bytes and meanings except timestamps; preserve non-TTY output and exit
  codes.
- Do not hard-code WUN paths or add repository-specific default ignores.
- Sanitize/truncate untrusted package names and support narrow, Unicode, NO_COLOR, and dumb terminals.
- Use TDD and retain RED evidence. Do not use the real user cache.
- Do not push, tag, publish, release, create a branch/worktree, or open a pull request.

## Owned files

- `src/repository/evidence.ts`, repository evidence/performance tests
- `src/repository/inspect.ts`, `src/io/packages/discovery.ts`
- `src/commands/check/progress.ts`, `src/commands/check/run-check.ts`
- focused progress/orchestration/render tests and practical CLI smoke
- current CLI/workspace/troubleshooting docs, `README.md`, `AGENTS.md`, `CHANGELOG.md`
- `docs/releases/v2.0.0.md`, `.superpowers/sdd/release-2-preparation.md`
- `plans/README.md`, this completion record, `.superpowers/sdd/progress.md`

Interactive selection semantics, machine schemas, apply/global state machines, manager commands,
registry candidate selection, and cache storage are out of scope.

## Requirement-to-code/test map

| Requirement | Implementation owner | RED/proof owner |
| --- | --- | --- |
| candidate-only evidence inventory | `repository/evidence.ts` | evidence candidate and large irrelevant-tree tests |
| preserved unavailable/identity/boundary truth | existing evidence collectors | full evidence, containment, VCS regressions |
| pre-load discovery/evidence phases | `inspect.ts`, `discovery.ts`, `run-check.ts` | orchestration call-order tests |
| coherent declared/eligible/skipped counts | `progress.ts` | progress unit tests with pins and other skipped inputs |
| one cursor owner around durable output | `progress.ts`, `run-check.ts` | suspend/resume output-order and PTY smoke tests |
| coalesced responsive rendering | `progress.ts` | fake-clock render-count/final-flush tests |
| compact durable final summary | `run-check.ts` and summary helper | table-only summary tests |
| unchanged automation contracts | unchanged JSON paths | JSON snapshots, non-TTY, full release/package gates |

## Implementation tasks

1. Add candidate-inventory and large irrelevant-tree RED tests. Characterize byte-identical models
   for nested workspaces, Git markers, lockfile aliases/symlinks, ignored paths, unreadable
   directories, concurrent deletion, and hostile names before changing the walker.
2. Replace all-file retention and per-file ancestor glob loops with a deterministic walker that
   prunes ignored directories once, retains only boundary/lockfile/runtime candidate names, checks
   candidate-file ignore rules, never follows directory symlinks, and records every unavailable
   directory it attempts to inspect.
3. Add phase/count/suspend/throttle RED tests and redesign progress so it can start before packages
   are loaded, receive discovery and inspection events, distinguish declared from eligible pinned
   declarations, coalesce dependency ticks, and flush/clear on every success or failure path.
4. Route durable table, resolution-error, and up-to-date rendering through progress suspension.
   Replace package/current-dependency mixed counters with global resolution and ordered rendering
   counters whose labels describe their actual phase.
5. Add a concise durable final table summary and built PTY regression proving package summaries
   survive progress redraws. Keep JSON, non-TTY, silent, redirected, narrow, and Unicode behavior
   unchanged.
6. Benchmark the built CLI on WUN with disposable HOME/cache, cold and warm, and record before/after
   phase timings plus Git immutability hashes. Do not mutate WUN.
7. Update current docs and release records, run all exact-Node/repository/package/cache/security
   gates, obtain independent code/performance/UX/docs approval, mark DONE, and commit without a
   version bump.

## Acceptance evidence

- WUN no longer has a multi-second silent interval after a premature discovery message.
- Warm repository inspection is at least 10x faster than the measured 18.45-second model baseline
  without WUN-specific ignores.
- Progress never reports all dependencies complete beside zero processed packages as one phase and
  never overwrites durable output.
- `232 declared`, `201 eligible`, and `31 pinned` are represented consistently when those
  are the observed counts.
- Focused suites pass three times; exact Node, full coverage, build, smoke, package, temporary-cache,
  Git immutability, and zero-warning gates pass.
- Independent reviewers return `APPROVED` with no Critical or Important findings.

## STOP conditions

Stop if optimization loses evidence completeness, ignores an unavailable subtree, follows a
directory symlink, changes repository fingerprints, or requires a repository-specific exclusion.
Prefer a smaller proven speedup over weakening truth. Stop UX expansion if it changes JSON/non-TTY
contracts or requires a Bun/native runtime.

## Completion record

Completed on 2026-07-16 without a version bump.

- Replaced the all-file evidence inventory with deterministic candidate-only retention. Candidate
  files, broken and directory-target symlinks, Git boundaries, unavailable directories, physical
  identities, hard `node_modules` pruning, and ignore semantics retain conservative truth; real
  directories with candidate filenames are not promoted to files.
- Added four-phase CLI progress, coherent declared/eligible/pinned/other-skipped counts, throttled
  registry ticks, bounded narrow-terminal rows, coordinated durable output, and a compact final
  summary. JSON, non-TTY, CI, dumb-terminal, debug, callback/addon, global, and library paths emit
  no inappropriate cursor control. Manifest and registry text is terminal-sanitized without
  changing selected dependency identity.
- Retained RED evidence for missing candidate inventory, symlink and `node_modules` regressions,
  hostile Clack labels, narrow rows, title overflow, suppressed-debug flicker, ALM bidi spoofing,
  and a built distribution that initially lost the evidence-phase callback.
- Exact Node 24.15.0 focused suites passed three times at 15 files and 157 tests per run. Full
  coverage passed 139 files and 1,456 tests at 87.13% statements, 80.04% branches, 94.13% functions,
  and 89.51% lines. Typecheck, schema check, zero-warning Biome, `git diff --check`, build, 26-check
  practical smoke, and the five-file/84-test release suite three times passed.
- WUN repository inspection measured 2,249.47 ms, 1,283.70 ms, and 1,353.45 ms (1.35-second median)
  versus the 18.45-second baseline, with 484 occurrences and three truthful diagnostics each time.
  A built Bun cold run used a disposable home/cache, completed in 7.28 seconds with 92 fetches, and
  its warm replay completed in 2.45 seconds with zero fetches. The final PTY replay showed every
  phase, preserved both durable tables, and reported 29 packages, 232 declared, 201 eligible, 31
  pinned, and 10 updates in two packages.
- The final WUN read-only replay preserved status, unstaged diff, staged diff, and index SHA-256
  hashes byte-for-byte. The final tarball contains 53 files, is 263,354 bytes packed and 1,605,924
  bytes unpacked, and has integrity
  `sha512-+KIBEUCCvIn7H0ksnLkGPMHOWiCKZEWGriOv4Nwu15P9legaK4Ioy6sQ/VIgyLKuwI+gpr1XVJFJkOHP48RnLg==`;
  isolated install, CLI, capabilities, library, exports, schemas, and packaged assets passed.
- Two independent adversarial reviewers returned `APPROVED` with no Critical or Important
  findings. A hosted workflow replay remains pending because pushing is outside this plan's
  authority.
