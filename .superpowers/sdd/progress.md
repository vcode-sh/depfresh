# Development progress

Plans 011-019: complete and committed
Plan 020: complete in b91883a
Plan 021: complete in 2694899
Plan 022: complete in 643b0a8
Plan 023: complete in 1ba8f6e
Plan 024: complete in 3742573
Release preparation: committed in d905747; Action examples pinned in 5a8e5a9
Plan 025: complete; exact-Node local/Linux/package gates and independent review passed.
Plan 026: complete; repository inspection performance and premium progress UX gates passed.
Plan 027: complete; v2.0.0 is published from immutable tag commit e485ebc and hosted release run
29561313135. No movable v2 tag or manual publish was created.
Plan 028: complete; exact workspace/catalog CLI selection, plan/capabilities v2, v1 compatibility,
generic documentation, exact-Node source/built/packed gates, and final no-findings independent review
passed.
Plan 029: complete; depfresh 2.0.1 is published from immutable release commit 6552b1b and annotated
tag v2.0.1. Hosted main run 29579908968 and release run 29580175679 passed; npm, GitHub, signatures,
and SLSA provenance expose the exact verified artifact. No floating v2 tag or manual publish exists.
Plans 030-036: opened from the approved Safe Write and Visual+ v2 design at commit 75910f2.
Plan 030 is complete: exact-target VCS evidence, truthful preflight reasons, grouped physical-target
receipts, and separate global blocker truth passed final verification and independent review.
Plan 031 owns the separate 2.0.2 release proof. Plans 032-035 then deliver the renderer-neutral run
model, one command-level local apply, complete inline Visual+ v2, functional relationship maps, and
real PTY/fallback proof. Plan 036 owns the final 2.1.0 public release proof.
Plan 030 Task 1: complete (commits 9bb9e00..3b1549e, review clean).
Plan 030 Task 2: complete (commits ef7247b..30445ca, review clean).
Plan 030 Task 3: complete (commits 2e68562..2041c44, review clean after fix wave).
Plan 030 Task 4: complete through 0c8594a. Focused proof passed 15 files/197 tests three times and
the built pipe selector passed one check/one request three times. Full gates passed 143 files/1,553
tests with coverage, 34-check smoke, 14-check demo, build, schemas, typecheck, Biome, and exact
56-file package verification. The 1,368,035-byte tracked-index replay applied the exact target
without ENOBUFS or Git index mutation. Final code and docs/terminal re-reviews reported no findings.
Plan 031 is complete; Plan 032 is the next executable plan and has not started.
Plan 031 Task 1: complete in bc6548c. The version-coupled 2.0.2 candidate changed exactly the 13
owned release surfaces; focused 28/28 and release 102/102 tests, schemas, typecheck, and Biome
passed. Independent spec and quality reviews approved Task 2 with no release-blocking findings.
Plan 031 Task 2: complete in d6915cd. Exact isolated local gates passed 102 release tests, 1,559
coverage tests across 143 files, 34 smoke checks/63 requests, 14 demo checks, exact 56-file package
verification, installed CLI 2.0.2, and built plus installed 1,368,035-byte oversized-index replays.
Two independent reviews reproduced the artifact identity with no findings.
Plan 031 Task 3: complete from release commit 45ac1d4. Hosted main run 29631547257 passed before
annotated tag object 7bfa63b was created; Release run 29631713748 completed exact artifact
verification, trusted OIDC publication, public-package verification, and curated GitHub release.
Plan 031 Task 4: complete. npm latest is 2.0.2; Actions artifact 8425727523, npm downloads, and
GitHub asset 481177182 are byte-identical at SHA-256
51ce49b65fef3801aa9dd6efeba469f17760a9e71f4d0294d52339450ff4c5af. Exact npm 11.12.0
verified the public install, CLI, schemas, exports, skills, package signature, publish attestation,
and SLSA provenance with empty invalid/missing sets. The public installed CLI passed the
1,368,031-byte oversized-index replay without Git index mutation or write ambiguity. The SLSA
subject binds the package SHA-512 digest to tag v2.0.2, the release workflow, commit 45ac1d4, run
29631713748, and the GitHub-hosted builder. Plan 031 is DONE; Plan 032 is next and has not started.
Plan 032 Task 1: complete through c439ce0. The pure renderer-neutral reducer now retains immutable
phase, inventory, occurrence, physical-target, result, recovery, diagnostic, elapsed, and exit
truth. Focused tests pass 52/52 and model/schema/apply compatibility passes 132/132; schema,
typecheck, Biome, and diff gates pass. Independent review exhaustively checked all 63 non-empty
outcome combinations against the apply-validator recovery contract with zero mismatches and no
Critical, Important, or Minor findings. Task 2 is next; no controller or orchestration wiring has
started.
Plan 032 Task 2: complete through 8b6262b. The internal controller owns immutable state projection,
monotonic injected-clock timing, ordered observer delivery, independent idempotent subscriptions,
and sanitized observer-failure diagnostics without I/O or reducer mutation. Controller/model tests
pass 66/66 with typecheck, Biome, and diff checks green. Re-review found no Critical, Important, or
Minor issues. Task 3 orchestration instrumentation is next; existing renderers and write paths remain
authoritative.
Plan 032 Task 3 drift decision: a read-only seam audit proved the current package-level legacy write
path cannot emit one truthful command transaction because interactive/catalog facts are hidden,
earlier targets may apply before a later preflight block, and exact recovery evidence is projected
away. The approved correction is to instrument complete read-only/error streams in Plan 032 while
keeping write-mode model emission inactive. Plan 033 owns the first write stream after it collects
all selections and invokes one command-level apply. Global invocations also remain inactive because
their logical owner identities cannot truthfully satisfy the repository-relative target contract.
Plan 032 Task 3: complete through 438647b. Explicitly injected local read-only/error runs emit exact
discovery, inspection, resolution, selection, result, and completion facts from verified seams.
Public and uninjected calls create no controller; legacy write and global invocations emit no model
events. The focused proof passes 171/171 tests across 11 files with typecheck, Biome, and diff checks
green. Exact output/cursor/callback/addon/write/exit behavior is unchanged, and final re-review found
no Critical, Important, or Minor issues. Task 4 full verification is next.
Plan 032 Task 4 review correction: full verification passed, but final reviews found two blockers
before closeout. The package observer briefly widened the public `loadPackages` type, and the model
could not preserve passed commit truth across real recovery/cleanup-unknown branches. Both are under
focused correction. The review also proved that exact replacement-attempt evidence is private to the
apply engine; Plan 033 Task 2 now explicitly owns a package-private structural evidence seam and may
not infer attempts from outcome reasons.
Plan 032 Task 4 and final closeout: complete through 4556a06. The current-head focused matrix passed
three times at 185/185 tests without timer/open-handle warnings. Full coverage passed 146 files and
1,656 tests; schemas, typecheck, lint over 314 files, build, 34-check/63-request smoke, 14-check demo,
102 release tests, exact 56-file package verification, declaration byte comparison with public
2.0.2, and diff/status gates passed. Final lifecycle and authority/output/API reviews reported no
Critical, Important, or Minor findings. Plan 032 is DONE; Plan 033 is next and may activate the first
truthful local write stream from one command-level apply plus structural replacement-attempt facts.
Plan 033 Task 1: complete in a21fea1. `preparePackage()` now records deterministic package decisions
without invoking a local writer or global manager, while `completePreparedPackage()` preserves
legacy result-hook, after-write, after-end, idempotence, and error-precedence semantics. The full
check suite passes 440/440 tests, focused lifecycle and write/global/post-write matrices pass 48/48
and 26/26, and typecheck/Biome/diff gates pass. Independent review found no Critical, Important, or
Minor issues. Task 2 command-level plan construction is next.
Plan 033 Task 2: complete in 5f8bcd0. Ordered local selections now build one deterministic immutable
plan, deduplicate shared physical occurrences, block ambiguous values before engine entry, execute
the ready plan once with least file authority, and project outcomes plus structural attempts by real
operation ID. Public apply/schema/declaration/version surfaces are unchanged. Adapter 17/17,
structural 6/6, broader 185/185, full apply 71/71, typecheck, build, schemas, Biome, and diff gates
pass. Independent concurrency/protocol/format/containment/authority review found no Critical,
Important, or Minor issues. Task 3 authoritative orchestration is next.
Plan 033 Task 3: complete in 590e3d5. All local package decisions are collected before one
authoritative command apply, complete run-model facts project from exact command evidence, and
post-write actions require an observed non-blocking result. Full project, check, compatibility,
static, build, schema, and independent review gates passed.
Plan 033 Task 4: complete in 28d530f. Exact stale, recovery, final-observation, interruption,
fresh-authoritative-follow-up, receipt, and practical built-smoke journeys passed. Human output uses
private exact attempt evidence while public JSON, callbacks, schemas, declarations, and version stay
unchanged. Independent recovery and contract review reported no findings.
Plan 033 Task 5 and final closeout: complete through b54cf95. Final review corrections retain every
contained blocked operation with deterministic false attempt evidence, support multiple operations
per target, keep reversed projection order stable, preserve outside-root fail-closed behavior,
serialize declaration-only Rollup traversal, and isolate the real command integration from shared
unit-test mocks. The final focused matrix passed three times at 397/397; full coverage passed 149
files and 1,775 tests. Schemas, typecheck, lint over 319 files, build, 35-check/69-request smoke,
14-check demo, 102 release tests, exact 56-file package verification, package dry-run, repeated
public declaration byte checks, and final C0/I0/M0 reviews all passed. Plan 033 is DONE; Plan 034 is
next.
Plan 034 Task 1: complete in 8a5d011. The pure startup capability detector now defines exact width,
layout, CI, dumb-terminal, NO_COLOR, dual-stream TTY, Unicode, reduced-motion, and cursor truth.
Focused capability/progress/overflow proof passes 49/49 tests with typecheck, Biome, and diff gates
green. Existing render-layout behavior and callers remain unchanged, and independent spec plus code
quality reviews reported no Critical, Important, or Minor findings. Task 2 pure sections are next.
Plan 034 Task 2: complete in 47a64c7. Deeply immutable, fail-closed renderer input now reconciles
exact run, owner-group, physical-target, canonical receipt, result, and recovery evidence. Pure
sections retain all 76 changes, 15 logical owners, and 14 targets with lossless capable/constrained
wrapping and hostile-terminal containment. The final render union passed 226/226 tests; typecheck,
Biome, whitespace, and two independent C0/I0/M0 reviews passed. Legacy renderer files and callers
remain unchanged.
Plan 034 Task 3: complete through 3db6f80 after the exact dormant-renderer contract in 3b9c3b9.
One injected stdout writer and one 50ms scheduler own atomic live clear/draw frames, durable
lifecycle resolution, nested suspension, fail-closed review/final identity, canonical receipt
validation, and idempotent teardown. Review-driven RED waves covered synchronous subscription
drift, receipt/complete gaps, contract error taxonomy, swallowed reentrancy, retained ownership,
and atomic clear/draw boundaries. The final focused matrix passed 241/241 tests with typecheck,
Biome, whitespace, and legacy-progress byte checks green; two independent final reviews reported
no Critical, Important, or Minor issues. Progress and callers remain unchanged. Task 4 exclusive
route integration is next.
Plan 034 Task 4: complete through 8b0fe05 after the exact route contract in f10cc6b. Frozen
selection evidence and authoritative operation/target projection route only eligible local,
noninteractive table output through one Visual+ owner. Shared physical operations deduplicate only
inside the Visual+ receipt, resolver/callback/debug output remains continuously suspended, and
JSON, silent, library, interactive, global/global-all, and veto-capable routes retain legacy
semantics. The final aggregate passed 59 files and 832 tests with two C0/I0/M0 reviews.
Plan 034 Task 5 and final closeout: complete through 723cecf. Review-driven RED waves made every
operation outcome, independent flag, reason, and read-only diagnostic visible; restored aligned
lossless medium/wide columns; bounded the exact 76-operation transaction; and sanitized, wrapped,
and color-bound all Visual+-only durable output at the immutable startup width. Clean pre-mutation
VCS uncertainty no longer invents recovery while retained ambiguity still fails closed. The final
focused matrix passed three times at 16 files and 281 tests. Isolated full coverage passed 155 files
and 1,976 tests; schema, typecheck, Biome over 337 files, build, 35-check smoke, 14-check demo, 102
release tests, 56-file packed verification, three stable declaration builds, and final independent
C0/I0/M0 reviews all passed. Plan 034 is DONE; Plan 035 is next.
Plan 035 Task 1: complete through d56d282 after the reviewed relationship contract in 5706631 and
lossless evidence chain in cc09845. One shared package-private validator now preserves exact
dependency, source, manifest/catalog owner, occurrence, age, compatibility, and canonical owner
order evidence from legacy selection through the immutable run snapshot and Visual+ boundary,
without public JSON/schema drift. The pure builder derives the exact 66/616/612/76/14 topology,
3/37/36 distribution, 15 owner impacts, 18 shared identities/39 occurrences, and two major cards
from copied authoritative evidence. RED/GREEN waves closed missing insight, metadata divergence,
validator drift, catalog ownership, fixture topology, ordering, collision, mixed-evidence, and
alias-freeze gaps. Final focused gates passed 208/208 tests with typecheck, Biome, diff checks, and
independent spec plus quality reviews at C0/I0/M0. Task 2 functional map rendering is next.
Plan 035 Task 2: complete in 672a3f0 after the reviewed integration contract in fb0c978. The
renderer now derives insights exactly once from the validated snapshot and emits topology,
distribution, majors-only risk, owner impact, and all shared physical occurrences before the
unchanged 76-row operation review. Pure capability-only map sections retain 15 owners, 18 shared
dependency IDs/39 occurrences, and two cards/three major operations with numeric text equivalents,
explicit age/compatibility, no operation-ID duplication, and zero-state safety. The extracted exact
fixture drives 40/60/80/118 layouts plus both real plain 8/10 profiles; map-only plain output is
strictly ASCII while color strips to identical semantic bytes. Review-driven REDs closed incomplete
combined hierarchy and weak ASCII-bar assertions. The final broad gate passed 11 files and 275
tests with typecheck, Biome, diff checks, and independent spec plus quality reviews at C0/I0/M0.
Task 3 deterministic repository/registry fixture is next.
Plan 035 Task 3: complete in 6a1afd6 after the reviewed fixture-contract amendments in 516db17 and
0da37a0 and canonical resolver alignment in 63ed526. The disposable fixture now derives 64 manifests
plus two named pnpm catalog inventories, 616 declared/612 eligible/76 selected operations, 15 owner
groups over 14 targets, 18 repeated identities/39 occurrences, and exact 3/37/36 severity through
the real loader, resolver, legacy plan, run model, and Visual+ insights. A fixed 6,000-file tracked
boundary exceeds the former Git buffer by more than 10%. Built-CLI success applies all 76 operations
to independent byte oracles; the child-local occurrence-2 Git seam safety-blocks all 14 targets with
14 structural `replacementAttempted=false` facts, unchanged bytes, counter 2, clean Git, and no
residue. HOME/cache/store/Git state, registry bytes, processes, sockets, and cleanup remain bounded
and isolated under hostile inherited environment tests. Exact Node 24.15.0 fixture/insight gates
passed 53/53 tests; build, typecheck, focused Biome, selected smoke, and the full 36-check practical
smoke passed. Final independent spec and quality reviews reported C0/I0/M0. Task 4 real PTY and
durable fallback proof is next.
Plan 035 Task 4 implementation: complete locally in fdd749d after the reviewed PTY contract in
7ec9e11. The bounded test-only adapter recognizes BSD and util-linux `script` solely from a
read-only probe, proves exact TTY/width evidence, projects only known terminal controls, and fails
closed on malformed evidence, overflow, timeout, cleanup ambiguity, signaling failure, survivors,
and unknown implementations. Built CLI success and safety journeys retain all 76 operations and
14 targets at 40/60/80/118 columns with exact topology, membership, copy, bytes, Git scope, cursor
state, and exit codes; direct-pipe, slow-pipe, CI, dumb-terminal, NO_COLOR, hostile-text, and pure
reduced-motion fallbacks preserve complete semantics. Fresh Node 24.15.0 gates passed build, PTY
31/31, capability/renderer 62/62, readiness 17/17, typecheck, Biome, and diff checks, with final
independent spec and quality reviews at C0/I0/M0. The exact `ubuntu-24.04`/`macos-15` hosted matrix
is configured but remains unproved until an authorized push runs CI; Plan 035 Steps 2 and 6 stay
open. Task 5 documentation may proceed locally, while Plan 036 remains blocked on that hosted
evidence and the final Plan 035 gate.
Plan 035 Task 5 documentation and repeated focused proof: complete through 6992878 and 442beb2.
The docs distinguish current eligible Visual+ outcomes, the reachable compatibility-table
`Partial result`, and the synthetic forward-compatible `Partial` renderer projection without
weakening recovery precedence. Exact complete, safety, recovery-incomplete, terminal fallback,
mode, exit, preflight, and atomicity boundaries passed independent spec and UX review at C0/I0/M0.
The focused 16-file Node 24.15.0 matrix then passed three fresh no-retry runs at 381/381 tests each
(69.97s, 70.45s, and 70.04s). That proof exposed and corrected four stale orchestration assertions
so operation uniqueness is now scoped to exact `Complete change list` dependency fields while
insight sections may truthfully repeat dependency names. Complete project gates are next.
Plan 035 Task 5 complete local gates: passed after f5096a7. The exact Node 24.15.0 full coverage
run passed all 160 files and 2,129 tests at 88.33% statements, 81.81% branches, 94.82% functions,
and 90.57% lines. Schemas, typecheck, zero-warning Biome over 351 files, build, the 35-check and
673-request practical smoke, 14-check demo, 103 release tests, and exact 56-file package verifier
all passed. The command-apply integration now ignores and restores ambient lower/uppercase npm
registry overrides and no longer needs diagnostic passthrough mocks. The final local conformance
review first found one missing safe-next-action requirement, then approved the test-first fix at
C0/I0/M0 on both correctness/terminal-safety and UX/docs tracks. Every incomplete Visual+ branch
now emits exactly one conservative `Next:` action before final `Exit 2`; pure, multi-cause
orchestration, width, and built PTY tests prevent blind-rerun or sole-cause claims. Task 5 is locally
complete. Task 4's hosted Ubuntu/macOS PTY replay remains pending an authorized push, so Plan 035
is not DONE and Plan 036 remains blocked.
Plan 035 hosted PTY and candidate gate: Step 6 is complete from successful CI run `29677729687` at
exact SHA `8f3f13ea5111f2c41dd8b3fe357a2d76473c9b9f`. Ubuntu job `88168165004` and macOS job
`88168165016` both passed build, focused PTY/fallback, and pure reduced-motion proof. The same run
passed Lint `88168164996`, the full Test job `88168165017`, Build `88168514344`, and Distribution
Smoke `88168547080`. The preceding run exposed one environment-dependent redirected-table color
assertion; commit `8f3f13e` now compares semantic table content across legal color modes while
retaining byte-exact empty renderer stdout, and independent review closed at C0/I0/M0. Task 4 Step
2 remains unchecked: `fdd749d` added the tests, adapter, and hosted matrix together, so no earlier
cross-OS RED run exists and GREEN cannot recreate it. Plan 035 remains not DONE and Plan 036 stays
blocked until the owner explicitly accepts or rejects that recorded process deviation.
Plan 035 final closeout: the owner accepted the recorded historical cross-OS RED deviation on
2026-07-19 without reclassifying it as passed. All implementation, local proof, hosted PTY proof,
complete CI, documentation, and independent C0/I0/M0 review gates are closed through `c77ed27` and
successful run `29677729687`. Plan 035 is DONE; Plan 036 is the next executable plan.
Plan 036 Task 1: complete (commits `47fc418..e99f16e`, review clean). The exact `2.1.0` release
surfaces, dated changelog, release note, workflow body, maintained runner pins, and readiness guards
passed a 5-failure RED then 29/29 GREEN release matrix plus schemas, typecheck, lint, and diff checks
under Node `24.15.0`, npm `11.12.1`, and pnpm `10.33.0`. Independent review closed at C0/I0/M0.
The candidate remains local; Task 2 exact source and packed PTY proof is next.
Plan 036 Task 2: blocked before artifact creation. The retained Visual+ product journeys always run
repository `dist/cli.mjs`; the packed verifier installs exact tarball bytes but does not replay the
76-row/14-target PTY and fallback matrix against them. Linux Docker is available, so platform
availability is not the blocker. An independently reviewed artifact-bound test seam is required
first, including canonical installed-path containment, packed-byte binding, and a distinct-byte
negative control that detects an ignored override or source-tree fallback. No Task 2 checkbox,
artifact identity, release-note evidence, hosted publication, tag, or registry claim is complete.
Plan 036 Task 2A: complete through `6957ebf` and review-fix `c30eec3`. The retained test-only seam
now resolves a paired canonical installed CLI/root, rejects symlinks and escape, binds installed
SHA-256 to `package/dist/cli.mjs` extracted from the exact verified tarball, and proves override use
with a distinct-byte outside-root negative control before running all 32 Visual+ tests. The verifier
uses bounded private output, minimal disposable HOME/tmp/cache, a 120-second identity-control limit,
and a fixed 15-minute full-replay limit. Ubuntu/macOS CI legs bootstrap isolated npm `11.12.0` and
clean it unconditionally. Fresh source and packed replays passed 32/32 with CLI SHA-256
`3a7980e4be50ff11e732ac1c9e47c1e4b6583abf573d036b6326fc5ab6dcbdfd`; build, schemas,
typecheck, release, zero-warning Biome, diff checks, and independent re-review passed at C0/I0/M0.
Task 2 exact source and packed proof may now restart from `c30eec3`.
Plan 036 Task 2: complete on exact candidate `1b2fca3` after parallel macOS arm64 and corrected
non-root/reaping-init Linux arm64 proof. Both lanes used Node `24.15.0`, npm `11.12.1`, pnpm
`10.33.0`, disposable paths, unchanged source/lock hashes, and passed 161 files/2,140 coverage tests,
smoke, demo, 103 release tests, the 10-test transaction matrix, 32 source Visual+ tests, 62 pure
Visual+ tests, and 32 installed-artifact Visual+ tests. Linux one-variable controls proved the
discarded root/non-reaping harness invalid without changing candidate code. Both platforms produced
the same 56-file, 332890-byte `depfresh-2.1.0.tgz` with SHA-256
`5d17e2a43a1c76160f0b95214b956a0d100a2e7e0bcfc2eb0b0c4c6f8143c833`; installed CLI SHA-256 was
`3a7980e4be50ff11e732ac1c9e47c1e4b6583abf573d036b6326fc5ab6dcbdfd`. Independent proof review
closed at C0/I0/M0. The release note records local candidate evidence only; hosted publication is
next.
Plan 036 hosted candidate stop and proof hardening: exact `main` run `29683662980` at
`eed33777ac374b8f7e46a4ac585971e955c5457d` passed every job except the first macOS installed
Visual+ replay. Attempts 2 and 3 passed unchanged bytes, but attempt 2 exposed hidden Vitest retries
in source PTY/process-observation tests, so neither retry-masked result was accepted for release.
Commits `deeaaf4` and `7d0fc14` disable retries for hosted source and packed replay, add fixed
allowlisted failure categories, and bound the private JSON report to an identity-checked regular
non-symlink file of at most 256 KiB. Unsafe, malformed, oversized, or unknown evidence remains
`unclassified` without exposing private output. Exact-Node focused tests passed 34/34, source
Visual+ passed 32/32 without retries, two hosted-like packed replays each passed 32/32 without
retries, and static gates plus independent C0/I0/M0 re-review passed. Exact hardened SHA
`f9f1bc04eb3c539120dc7e3fbe8f1050973f4f17` then ran in hosted CI `29685151490`: both source
lanes, Ubuntu installed Visual+, full tests, lint, build, and distribution smoke passed, while the
no-retry macOS installed replay stopped with the safe `fallback` category. Commit `f4c6611`
preserves every prior assertion but splits the combined fallback contract into direct/slow-pipe,
capable/no-color PTY, and CI/dumb constrained PTY categories. Exact-Node focused tests passed 37/37
and isolated source plus installed replays passed 34/34 without retries; independent review closed
at C0/I0/M0. The diagnostic candidate is local only; a new exact hosted `main` success is required
before tagging.
Exact `main` run `29685720822` at `158ed25f944197053b53fd57d038622c0f2498c0` then passed every
Ubuntu source/installed, full-test, lint, build, and distribution-smoke job, while the no-retry
macOS source lane isolated one forbidden lone carriage return in the CI fallback contract. Idle and
bounded-load controls did not reproduce it locally. A deterministic BSD nested-PTY characterization
instead demonstrated a local mechanism consistent with that symptom: `CRCRLF` normalizes to one
lone carriage return. Commits `054dea9`, `66f6d81`, and `29cc9c6` now make the outer Expect PTY
raw/no-echo, give the inner CLI PTY sole `opost onlcr` ownership, split CI from TERM=dumb fallback
evidence, and enforce a platform-scoped live termios regression. The test is RED on the pre-fix
macOS adapter and GREEN on fixed BSD plus real Linux util-linux Node `24.15.0`. Fresh source and
packed Visual+ passed 36/36 without retries; focused
tests passed 39/39; build, schemas, typecheck, zero-warning Biome, diff checks, artifact integrity,
and CLI SHA remained stable. Independent final re-review closed at C0/I0/M0. The fix is local only;
Task 3 still requires a new exact hosted `main` success before tagging.
Exact `main` run `29687703913` at `b8a4f50532e58407a110e979231760e7fc7f66a7` passed macOS source
Visual+ 36/36, Ubuntu source and installed Visual+, full Test, Lint, Build, and Distribution Smoke.
The macOS installed replay alone failed with `fallback-ci-pty`; reduced-motion was not reached. The
fixed category identifies only the CI journey, and its private report was cleaned as designed, so
the exact historical assertion is unavailable. A workflow-style local installed replay passed
36/36 under exact Node/npm and hosted-like long paths, followed by 20/20 focused installed CI
controls. Commit `0280309` adds one-run, title-only phase evidence for execution/evidence,
semantics, terminal controls, transition uniqueness, and read-only repository state. Sequential
readiness reports only the first violated phase without inspecting or reflecting messages, raw
output, paths, or stacks. Fresh source and packed replays passed 40/40 without retries; focused
contracts passed 43/43, release gates passed 103/103, and all static/artifact checks plus independent
C0/I0/M0 review passed. This remains local diagnostic evidence. Task 3 and tagging stay blocked
pending a new exact hosted all-job success.
Exact `main` run `29688672949` at `601c932012053b31da42a3611352bf39bb50c2aa` passed Ubuntu source
and installed Visual+, full Test, Lint, Build, and Distribution Smoke. The macOS source lane passed
39/40, including every CI fallback diagnostic phase, then failed the first 40-column journey at
wrapper identity registration with `PTY process identity evidence changed`; installed replay and
reduced-motion proof were skipped. The cleanup ambiguity was consequential. Independent audits
identified a deterministic model contradiction consistent with the hosted symptom: a same
PID/start/group snapshot after legitimate reparenting can overwrite the first parent, which the
historical sidecar then correctly disagrees with. The private hosted evidence does not retain those
tuples, so the exact transition is not claimed as recovered. TDD now
preserves the first topology and exact sidecar-parent check, scopes fixed `/bin/ps` inventory to the
current numeric UID, and rejects start/group mutation or absent-then-reappeared PID evidence without
adopting/signaling the changed tuple. RED failed three exact contracts; focused GREEN passed 6/6.
Exact Node 24.15.0 source/verifier/readiness passed 66/66, source Visual+ passed 46/46, and isolated
npm 11.12.0 installed replay passed 46/46 with unchanged 56-file/332890-byte artifact identity and
CLI SHA-256. The complete no-retry suite passed 162 files/2,177 tests, release gates passed 103/103,
and schemas, typecheck, build, full zero-warning Biome, and diff checks passed. Two independent final
reviews reported C0/I0/M0 after direct Darwin and Linux procps probes. A new exact hosted all-job
success remains mandatory before tagging.
Exact `main` run `29690064055` at `c091c8d7fe87d35b9beeb1149ad0ccc56195cc20` passed Ubuntu source
and installed Visual+, full Test, Lint, Build, and Distribution Smoke. macOS source passed 45/46 and
again failed the first 40-column success journey before installed/reduced-motion proof. The stack now
identifies CLI evidence registration, but the generic error conflates parent/group/start axes, so no
identity rule is relaxed. A diagnostic-only TDD slice adds fixed role/axis combination labels while
preserving all comparisons and ambiguity effects. RED failed 6/6 on the old signature; exact Node
24.15.0 GREEN passed 9/9 fixed-label/privacy cases and unchanged Visual+ passed 46/46 without retry.
The labels contain no process values, paths, environment, timestamps, or raw child output. The
complete no-retry suite passed 163 files/2,186 tests; schemas, typecheck, full zero-warning Biome,
and diff checks passed. Two independent reviews closed at C0/I0/M0 after one privacy-wording
correction. A new exact hosted run remains required; Task 3 and tagging stay blocked.
Plan 036 final hosted and public closeout: the BSD inner-transcript correction completed through
`709dc76`; exact source and packed Visual+ replays passed 50/50 on macOS and Ubuntu in hosted run
`29699049511`. The final recorded-proof commit `8c4b9dd479e672f0c937946406603c0988f36e37`
then passed every job in exact hosted run `29699269620`. Annotated tag object
`3f8c74b3502ee6fe55abddddcb5d03d3df26800f` peels to that commit and triggered Release run
`29699466746`; verification job `88225931219`, OIDC publish/public-install job `88226561867`, and
curated GitHub release job `88226641405` all passed on attempt 1.
Public npm exposes `latest=2.1.0`. The tarball inside Actions artifact `8446072086`, GitHub asset
`482646293`, exact npm pack, and direct registry downloads are byte-identical at SHA-256
`5d17e2a43a1c76160f0b95214b956a0d100a2e7e0bcfc2eb0b0c4c6f8143c833`. Exact Node `24.15.0`
and npm `11.12.1` passed the public installed Visual+ replay 50/50 plus version, capabilities,
exports, schemas, skill assets, runtime dependency, signature, and attestation gates. SLSA binds the
exact SHA-512 to `refs/tags/v2.1.0`, `.github/workflows/release.yml`, commit `8c4b9dd`, run
`29699466746` attempt 1, and the GitHub-hosted builder. No floating `v2` tag, tag movement, or
manual publication occurred. Plans 032-036 and the Safe Write/Visual+ v2 program are DONE.
