# depfresh implementation plans

This directory is the execution queue for the next depfresh product cycle. The queue was audited
and split into bounded implementation contracts on 2026-07-15. Plans are based on commit
`8eea9c5`; plan 009 was subsequently committed as `49b6fa0`.

Completed plans `001` through `008` were removed; Git history remains their implementation record.
`depfresh-agent.md` is design input only. The numbered plans below are the current authority.

## Execution rules

- Execute one numbered plan at a time. Dependencies describe semantic order, not permission for
  parallel edits in a shared checkout.
- Re-read every owned file and run the drift check before editing. Stop on overlapping work.
- Keep changes inside the plan's owned behavior and file set. Update the plan before expanding
  scope.
- Use red-green-refactor for behavior changes and retain characterization evidence for migrations.
- Do not stage, commit, push, publish, create branches, or open pull requests unless explicitly
  requested in the active task.
- Preserve unrelated dirty work. All code, documentation, plans, and commit messages are English.
- A completed plan must record exact verification evidence and the remaining known limitations.

## Product contract

```text
inspect repository -> build occurrence model -> evaluate policy -> emit immutable plan
-> validate preconditions -> apply exact file operations -> synchronize lockfile
-> verify observed state -> report every requested outcome
```

The CLI, library, and automation surfaces must share the same repository model, policy evaluator,
planner, and apply engine. Configuration may select policy, but only explicit invocation authority
may grant side effects. Unknown state is never reported as success.

## Active queue

| Plan | Title | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| [009](./009-node-sqlite-migration.md) | Replace the native SQLite dependency | P2 | M | — | DONE |
| [010](./010-action-runtime-input-hardening.md) | Action runtime and input hardening | P1 | M | — | DONE |
| [011](./011-invocation-authority-cli-validation.md) | Invocation authority, CLI validation, and redaction | P1 | M | — | DONE |
| [012](./012-repository-containment-boundaries.md) | Repository containment and nested workspace boundaries | P1 | M | 011 | DONE |
| [013](./013-resolution-candidate-truth.md) | Resolution candidate truth and downgrade prevention | P1 | M | 011 | DONE |
| [014](./014-observed-write-outcomes.md) | Canonical writes and observed outcomes | P1 | M | 011, 012, 013 | DONE |
| [015](./015-repository-model-core.md) | Repository model core | P1 | L | 012, 014 | DONE |
| [016](./016-repository-evidence.md) | Manager, lockfile, runtime, and VCS evidence | P1 | M | 015 | DONE |
| [017](./017-target-selectors-policy-rules.md) | Target selectors and ordered policy rules | P1 | L | 013, 015, 016 | DONE |
| [018](./018-inspect-plan-contract-v1.md) | Inspect and plan contract v1 | P1 | L | 011, 013–017 | DONE |
| [019](./019-stale-safe-file-apply.md) | Stale-safe file apply | P1 | L | 014, 018 | DONE |
| [020](./020-lockfile-sync-verification.md) | Lockfile synchronization and verification | P1 | M | 016, 019 | DONE |
| [021](./021-global-apply-state-machine.md) | Global apply state machine | P1 | M | 013, 018, 019 | DONE |
| [022](./022-compatibility-passive-trust.md) | Compatibility and passive trust signals | P2 | L | 013, 016–018 | DONE |
| [023](./023-artifact-trust-native-verification.md) | Artifact trust and native verification | P2 | L | 020, 022 | DONE |
| [024](./024-official-agent-workflow.md) | Official workflow and distribution | P2 | M | 010, 018–023 | DONE |
| [025](./025-ci-portability-ledger-truth.md) | CI portability and ledger truth | P1 | S | 024 | DONE |
| [026](./026-repository-performance-progress-ux.md) | Repository performance and progress UX | P1 | M | 025 | DONE |
| [027](./027-wun-demo-release-proof.md) | WUN-shaped demo and release proof | P1 | M | 026 | DONE |
| [028](./028-first-class-workspace-catalog-exclusions.md) | First-class workspace and catalog exclusions | P1 | L | 017, 018, 019, 024, 026, 027 | DONE |
| [029](./029-v2.0.1-release.md) | Publish and prove depfresh 2.0.1 | P1 | M | 028 | DONE |
| [030](./030-vcs-write-trust-hotfix.md) | VCS write trust hotfix | P0 | M | 029 | DONE |
| [031](./031-v2.0.2-release.md) | Publish and prove depfresh 2.0.2 | P0 | M | 030 | DONE |
| [032](./032-check-run-model.md) | Renderer-neutral check run model | P1 | M | 031 | DONE |
| [033](./033-command-level-local-apply.md) | Command-level local apply | P0 | L | 032 | DONE |
| [034](./034-visual-plus-v2-core.md) | Visual+ v2 core terminal renderer | P1 | L | 033 | DONE |
| [035](./035-visual-plus-insights-pty-proof.md) | Visual+ insights and PTY proof | P1 | L | 034 | DONE |
| [036](./036-v2.1.0-release.md) | Publish and prove depfresh 2.1.0 | P1 | M | 035 | DONE |
| [037](./037-visual-plus-compact-2.1.1.md) | Compact Visual+ output and prepare 2.1.1 | P1 | M | 036 | DONE |

The implementation order through 016 is present locally. Plans 011 through 013 passed their final
blocker replays, regression fixes, full gates, and independent re-reviews on 2026-07-16. Plans 014
and 015 passed their final verification replay on 2026-07-15; Plan 016 passed its final adversarial
review and verification replay on 2026-07-16 and was committed as `d37c97f`. Plan 017's explicit
public policy and migration amendment was approved, implemented, fully gated, and independently
approved on 2026-07-16, then committed as `7678b2a`. The package remained `1.2.0` throughout the
numbered plan queue. Plan 018's versioned inspect/plan contracts, schema artifacts, semantic
validators, compatibility adapter, and adversarial redaction/determinism fixes passed all gates and
independent code/docs approval on 2026-07-16, then committed as `4114f97`.
Plan 019's stale-safe file engine, strict apply contract, compatibility delegation, durable
lock/journal recovery, adversarial fault matrix, exact-Node/package verification, and independent
fault/code/docs reviews passed on 2026-07-16, then committed as `c37c169`; the package version
remains `1.2.0`.
Plan 020's explicit manager/verification authority, exact npm/pnpm/Bun adapters, lockfile
specifier/package/version proof, contained no-shell execution, descendant observation,
identity-bound recovery, legacy migration, real npm/pnpm probes, exact-Node/package/cache gates, and
independent code/security/docs reviews passed on 2026-07-16. The package version remains `1.2.0`
until all open plans are complete.
Plan 021's versioned non-transactional global plan/apply state machine, exact supported-manager
protocols, conservative observation, isolated cache proof, and independent reviews passed on
2026-07-16, then committed as `2694899`. Plan 022's deterministic compatibility, cohort, maturity,
deprecation, completeness, staleness, and passive-presence signals passed schema-forgery,
exact-Node, package, cache, Git-immutability, and independent code/docs/edge review on 2026-07-16.
Plan 023's exact public-npm artifact identity, npm 11.12.x official verifier, isolated
network/process boundary, final lockfile/install binding, independent signature/provenance truth,
fingerprinted policy gates, recovery evidence, schema-forgery tests, package/cache/Git gates, and
independent code/docs approvals passed on 2026-07-16. Pnpm, Bun, JSR, private-registry, unsupported
npm-version, and broader native-verification claims remain explicitly unsupported. Plan 024's
deterministic capabilities schema, packaged skill/recipes/examples, exact runner priority, hardened
machine Action workflows, WUN-style observed apply, package exports, and authority-document
demotion passed exact-Node/package/smoke gates and independent skill/full-diff approvals on
2026-07-16. Plans 011 through 024 are truthfully complete. Final release preparation performed the
single authorized package bump to `2.0.0`, passed the exact-Node, full-coverage, package, cache,
Git-immutability, workflow, documentation, and independent-review gates, and was committed as
`d905747`. The shipped and documented Action examples were then pinned to that immutable release
anchor with retained RED/GREEN coverage and committed as `5a8e5a9`. At that checkpoint, tagging,
pushing, publishing, hosted release creation, and movable Action tags remained unauthorized.

Plan 025 was opened after the first post-release-preparation push exposed two portability defects:
permission-denial tests assumed a non-root Linux runner, and one process-runner test exceeded
Linux's per-argument limit. The same audit found that this ledger was ignored by Git while the
tracked `.superpowers/sdd/progress.md` stopped at Plan 019. Plan 025 restores one version-controlled
truth surface and must return exact-Node Linux CI to green before release preparation can be
considered current again.

Plan 025 tracked the numbered ledger, corrected the stale tracked progress snapshot, moved the
permission-sensitive test job to an unprivileged hosted Linux worker, and removed the Linux
single-argument overflow from the 128 KiB private-output fixture. Exact-Node local and Linux
non-root tests, full coverage, build, smoke, packed-package verification, and independent review
passed. At that checkpoint, its hosted replay remained pending because pushing and hosted workflow
mutation were outside the authorized scope.

Plan 026 was opened from a real 29-package/232-dependency WUN run that appeared frozen after its
discovery message. Exact profiling showed manifest discovery at about 87 ms and the subsequent
unreported repository evidence walk at about 18.45 seconds. The plan owns a generic candidate-only
evidence inventory, phase-aware coordinated progress, coherent counts, and durable summary output;
it does not add repository-specific ignore defaults or a Bun-only native TUI dependency.
It completed with a 1.35-second median repository inspection, immediate four-phase built-CLI
feedback, coordinated durable tables, exact candidate/symlink/unavailable truth, terminal display
containment, full exact-Node/package gates, and two independent approvals. The final WUN replay
preserved Git state and the isolated tarball verifier passed. The subsequent hosted `main` replay
completed successfully in [run 29540136068](https://github.com/vcode-sh/depfresh/actions/runs/29540136068).

Plan 027 was opened by the final release request. A sanitized WUN-shaped demo audit exposed two
release-blocking CLI defects before publication: large machine documents written into a pipe could
be truncated by immediate process exit, and CLI `--ignore-paths` replaced the safety defaults it
was documented to extend. The plan owns those focused fixes, deterministic packed-product proof,
the human-first README and release truth pass, current hosted governance, and the immutable 2.0.0
publication sequence.

Release-preparation commit `75cacb7` and hosted `main` run `29542182146` passed, but immutable tag
run `29542342329` stopped before packing or publishing because its npm bootstrap incorrectly
required the setup-node npm symlink to resolve beside the Node executable. The portable exact-Node
regression and workflow repair are recorded in Plan 027. npm 2.0.0 and the hosted release remain
absent, and the plan remains IN PROGRESS. On 2026-07-17 the maintainer explicitly authorized
replacing the failed public `v2.0.0` tag at newly proven release commits as required to complete the
automated recovery; a movable `v2` tag and manual unverified publishing remain forbidden.

The authorized replacement candidate then passed the disposable-home frozen install, exact Node
24.15.0 schemas/type/lint/build gates, three focused 7-file/144-test runs, the 5-file/98-test
release suite, all 139 files and 1,473 tests with coverage, smoke, built and packed demos, and the
exact npm 11.12.0 53-file artifact verifier. Plan 027 remains IN PROGRESS until hosted publication
and public npm/GitHub evidence pass.

The first authorized replacement targeted `9832e0a` after hosted `main` run `29557337581` passed.
Tag run `29557541254` reached the practical smoke after all prior release gates, then failed because
uppercase isolated `NPM_CONFIG_*` values overrode the fixture registry; publish and release jobs
were skipped. An exact-environment RED reproduced `1 !== 3`, and case-insensitive npm-config
filtering made ordinary and uppercase-isolated 26-check/49-request smoke runs GREEN. The package
artifact is unchanged; Plan 027 remains IN PROGRESS pending a complete hosted replacement run.

Recovery verification then passed the release suite, all 139 files and 1,473 tests with coverage,
the fake-manager integration three times, the exact uppercase release smoke three times, the demo,
and the unchanged exact npm 11.12.0 tarball. The final local coverage observation was 86.96%
statements and 89.36% lines.

The second authorized replacement targeted `3a52eb7` after hosted `main` run `29558365285` passed.
Tag run `29558561833` completed all source and exact-artifact gates, then the packed-demo install
resolved its repository-relative tarball path from a separate temporary prefix and npm interpreted
it as a GitHub shorthand. Publish and release were skipped. The retained release regression now
requires an absolute workspace `file:` specifier. The maintainer explicitly reauthorized replacing
the failed tag after this correction; Plan 027 remains IN PROGRESS until the hosted workflow and
public artifact evidence pass.

The corrected candidate passed the disposable-store exact-Node frozen install, static gates,
three release-suite runs, all 139 files and 1,473 tests at 87.03% statement and 89.40% line
coverage, build, smoke, demo, and exact npm 11.12.0 package verification. Exact npm also installed
the unchanged tarball through the absolute `file:` specifier into a separate prefix and the packed
demo passed. Independent review then found the same ambiguous relative form in the later publish
step before retagging. Both install and publish now require absolute workspace `file:` inputs; an
exact npm 11.12.0 lifecycle-disabled publish dry-run passed.

Final recovery commit `e485ebc` passed hosted `main` run `29561096139`. Annotated tag `v2.0.0`
peels to that exact commit, and release run `29561313135` completed exact verification, trusted npm
publication, public installed-package verification, and curated GitHub release creation. npm
`latest` is `2.0.0`; the workflow artifact, npm download, and GitHub asset are byte-identical, and
the SLSA v1 provenance binds their SHA-512 digest to the tag, release workflow, commit, and hosted
run. Plan 027 is DONE; no movable `v2` tag or manual publish was created.

Plan 028 was opened after the maintainer clarified that the intended product capability is generic
one-off exclusion of any application/workspace or physical catalog, not special treatment for
Expo/native. A read-only audit at `730cc7c` confirmed that the occurrence policy engine already has
the required workspace/catalog identities, but the CLI exposes only dependency-name filters and
discovery ignores while current docs overfit the feature to the earlier native example. The plan
adds exact fail-closed invocation shortcuts, preserves explicit shared-catalog ownership, makes the
effective selection observable, and replaces the native-centric current product framing without
rewriting the published v2.0.0 release history.

Plan 028 completed exact workspace/catalog CLI selection with fail-closed pre-network binding,
physical catalog-ID ownership, durable check receipts, fingerprinted plan v2 selection receipts,
capabilities v2, plan v1/v2 apply compatibility, generic current documentation, and source/built/
installed write/apply proof. The exact Node 24.15.0 focused matrix passed three times, all 141 files
and 1,528 tests passed with coverage, npm 11.12.1 verified the 56-file tarball, immutable v1 and
historical-release bytes remained unchanged, and the final independent review returned `APPROVED`
with no findings. Version remains `2.0.0`; no push, tag, publish, release, branch, worktree, or pull
request was created.

Plan 029 was opened after the maintainer authorized publishing the completed Plan 028 product as
`2.0.1`. Live GitHub and npm checks confirmed that `main` was one reviewed commit ahead of origin,
npm `latest` remained `2.0.0`, and no `v2.0.1` tag, release, or package existed. The plan owns the
version-coupled patch release, exact local and hosted verification, immutable `v2.0.1` tag, trusted
OIDC publication, curated GitHub release, public artifact/provenance proof, and final ledger
closeout. It forbids local publishing, a floating `v2` tag, and force-moving `v2.0.1`.

Plan 029 completed from release commit `6552b1b`, hosted main CI run `29579908968`, annotated tag
object `5d6c278`, and Release run `29580175679`. npm `latest` is `2.0.1`; the workflow artifact,
public npm downloads, and GitHub release asset are byte-identical, the public install and signature
audit passed, and the SLSA v1 attestation binds the exact artifact digest to the tag, workflow,
commit, run, and GitHub-hosted builder. GitHub exposes a non-draft, non-prerelease `v2.0.1`
release. No floating `v2` tag or manual publish was created.

Plans 030 through 036 implement the approved
`docs/superpowers/specs/2026-07-18-safe-write-visual-plus-design.md` contract. A real Spreadu
`bunx depfresh major -w` run proved that the root tracked-file inventory exceeded Node's default
synchronous child-process buffer: 1,250,160 bytes of `git ls-files` output caused `ENOBUFS` after
1,114,112 captured bytes. The compatibility adapter then collapsed `VCS_UNAVAILABLE` into
`WRITE_FAILED`, while package-by-package writes retained 35 applied occurrences across 13 child
manifests before 41 root operations became unknown. The root manifest and Bun catalog remained
unchanged, leaving a partial repository result.

Plan 030 owns the narrow `2.0.2` correctness/trust hotfix: exact-target bounded Git evidence, the
additive `VCS_UNAVAILABLE` legacy reason, one grouped physical-target receipt, and explicit
documentation of the remaining package-by-package limitation. Plan 031 owns the separate immutable
`2.0.2` release proof and must complete before the architectural work begins.

Plan 030 completed at `0c8594a`. Exact-target Git batches, preserved VCS preflight diagnostics,
grouped physical receipts, separate sanitized global blocker details, multi-cause exit guidance,
the self-packing local verifier, oversized-index replay, complete local gates, and independent
code/docs approvals all passed. No JSON or schema contract changed. At that checkpoint the package
remained `2.0.1`, Plan 031 was next, and hosted publication still required separate
push/tag/publish authority.

Plan 031 completed from release commit `45ac1d4`, hosted main run `29631547257`, annotated tag
object `7bfa63b`, and Release run `29631713748`. npm exposes `latest=2.0.2`; Actions artifact
`8425727523`, npm downloads, and GitHub asset `481177182` are byte-identical. Exact npm `11.12.0`
verified the public install, package signature, publish attestation, and SLSA provenance with no
invalid or missing signatures. The public installed CLI passed the oversized-index replay without
Git index mutation or write ambiguity, and the SLSA subject binds the package SHA-512 digest to the
tag, workflow, commit, run, and GitHub-hosted builder. GitHub exposes a non-draft,
non-prerelease release. No floating `v2` tag or manual publish was created.

Plan 032 completed through `4556a06`. The immutable renderer-neutral model and injected local
read-only/error streams passed three focused 185-test runs, full 1,656-test coverage, complete
static/build/smoke/demo/release/package gates, public declaration byte comparison, and independent
lifecycle plus drift reviews with no findings. Legacy write and global invocations emit no
incomplete model stream.

Plan 033 completed through `b54cf95`. One command-level local plan/apply is authoritative,
preflights every selected physical target before the first replacement, and retains exact
structural attempts plus best-effort recovery evidence. The final 397-test focused matrix passed
three times, full coverage passed 149 files and 1,775 tests, all static/build/smoke/demo/release and
56-file package gates passed, and repeated declaration builds exactly matched public `2.0.2`.
Independent authority/model and public-contract reviews reported no findings. Plan 034 completed
through `723cecf`: Tasks 1-3 added immutable capabilities, complete pure sections, and one dormant
live-region/cursor owner; Task 4 routed only the exact eligible local CLI path through Visual+ while
preserving every JSON, silent, library, interactive, global, and veto-capable fallback. Task 5 made
operation results and diagnostics complete, restored dense responsive columns, bounded every
durable human line to the startup width, contained hostile terminal input, and retained exact
zero-mutation/recovery truth. The final focused matrix passed three times at 281/281, full coverage
passed 155 files and 1,976 tests, and all schema/static/build/smoke/demo/release/package/declaration
gates plus independent C0/I0/M0 reviews passed. Plan 035 adds
topology, severity, impact, shared-surface, and major-risk
visualizations plus full built-CLI PTY/fallback proof against the deterministic 66-package,
616-declaration, 76-update, 14-target acceptance fixture. Plan 036 owns the immutable `2.1.0`
release and public installed-product replay. Full-screen Focus TUI/OpenTUI is explicitly outside
this program.

Plan 036 completed from release commit `8c4b9dd`, hosted main run `29699269620`, annotated tag
object `3f8c74b`, and Release run `29699466746`. npm exposes `latest=2.1.0`; the tarball inside
Actions artifact `8446072086`, direct registry and exact npm-pack downloads, and GitHub asset
`482646293` are byte-identical. Exact Node `24.15.0` and npm `11.12.1` passed the public Visual+
replay
50/50, capabilities/exports/assets verification, and signature audit with no invalid or missing
results. SLSA provenance binds the exact package digest to the tag, workflow, commit, run, and
GitHub-hosted builder. Plans 032-036 and the Safe Write/Visual+ v2 program are DONE.

Plan 037 is active after the public 2.1.0 replay showed that the exhaustive Visual+ audit is too
large for the default human journey. Tasks 1 and 2 added deterministic compact/full renderers and
truthful post-discovery repository context. Task 3 added built-CLI compact-default and explicit
`--long` PTY/pipe proof plus current documentation. Task 4 prepared and verified one exact local
2.1.1 candidate. The full 164-file/2,256-test gate, retained 56-file artifact replay, exact Bun
install, 74-line live Spreadoo true-PTY smoke, and initial C0/I0/M0 review passed at `41f0002`.
Final review then required repository-name provenance, lockfile-marker identity, and replay-title
coupling corrections. The corrected gate passed 164 files/2,262 tests, the 5-file/106-test release
suite, and all static/build/package checks. A new isolated 56-file artifact passed the exact
58-test/5-suite installed replay, Bun installed those exact bytes globally, and the current
63-line Spreadoo true-PTY smoke exited 0 without Git changes. The original artifact remains
historical `41f0002` evidence; Plan 037 is DONE on corrected local evidence. No publication, tag,
push, hosted workflow, or public-artifact proof is claimed.

Post-release retained-harness commit `de3c417` deterministically owns the nested PTY line-ending
mapping after diagnostics isolated recurrent BSD `CRCRLF` below bare-LF-only child writes. Exact
hosted run `29702709281` passed macOS and Ubuntu source/packed Visual+ 54/54 without retry plus every
remaining job. This did not move the tag or change the public package and its immutable 50/50 proof.

Docs-only run `29702983469` then preserved every transport assertion but exposed a separate
cleanup-only BSD process-inventory failure after PTY closure. Commit `765443a` keeps exact
numeric-UID scope and fixed resource bounds while including no-TTY processes in the inventory and
retaining only fixed failure categories. It adds no retry and weakens no identity assertion. Exact
hosted run `29703537651` passed macOS and Ubuntu source/installed Visual+ 54/54 without retry plus
Test, Lint, Build, and Distribution Smoke. The immutable release state remains unchanged.

The new queue is strictly ordered. Do not merge Visual+ output before command-level result truth,
do not begin the `2.1.0` work before public `2.0.2` proof, and do not collapse unknown evidence or
recovery ambiguity into success to satisfy a visual snapshot.

## Split coverage map

No requirement from the prior plans was dropped. This map records its new owner.

| Previous plan | New owners | Preserved scope |
| --- | --- | --- |
| 010 runtime truth | 011–014 | invocation authority, malformed input, containment, candidate filtering, downgrade guards, canonical occurrence writes, outcome truth, terminology, redaction |
| 011 repository model | 015–016, 021 | stable repository/source/manifest/occurrence/catalog identities, roots, managers, lockfiles, runtime constraints, VCS evidence, global occurrences, read-only API |
| 012 selectors/policy | 017 | selector vocabulary, ordered last-match-wins rules, catalog policy, decision traces, WUN acceptance fixture |
| 013 agent contract | 018 | inspect/plan commands, schemas, fingerprints, deterministic output, errors, exit codes, library APIs, legacy JSON adapter |
| 014 stale-safe apply | 019–021 | file preconditions and recovery, manager sync and verification, global non-transactional outcomes, migration of existing write flags |
| 015 compatibility/trust | 022–023 | engines, peers, cohorts, maturity, deprecation, passive metadata, verified signatures/provenance, native manager checks |
| 016 official workflow | 010, 024 | action runtime coupling and safe inputs first; capabilities, first-party skill, pinned runners, examples, packaging, authority demotion later |

## Decisions already made

- Policy applies to dependency occurrences, not package names.
- Ordered rules are last-match-wins independently for action and mode and expose both winning rule
  IDs plus stable reason codes.
- The first catalog acceptance case updates broadly while capping `native` catalog consumers at
  `minor`.
- An apply plan is immutable: apply never silently re-resolves versions.
- Repository identity, exact file hashes, and expected occurrence values are write preconditions.
- Requested outcomes are observed and explicit: applied, skipped, conflicted, reverted, failed,
  or unknown.
- Dirty target files block apply by default; unrelated dirty files remain untouched.
- File replacement and lockfile synchronization are separate failure domains. Global updates are
  a third, explicitly non-transactional domain.
- Existing JSON output remains compatible while the versioned inspect/plan envelope is introduced.
- Signature presence, signature verification, provenance presence, and provenance verification are
  distinct states.
- Thin adapters, NDJSON, SARIF, and advanced annotations remain deferred until core schemas and
  apply semantics stabilize.

## Deferred work

- Sequential tag-page fetching for `github:` dependencies remains low priority.
- A runtime-specific SQLite backend needs benchmark evidence after plan 009.
- Major compiler/runtime-client upgrades remain independent maintenance projects.
- TUI signal cleanup, cache circuit breaking, proxy bypass support, and startup lazy loading are
  not part of this queue without new evidence.
