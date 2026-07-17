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
| [027](./027-wun-demo-release-proof.md) | WUN-shaped demo and release proof | P1 | M | 026 | IN PROGRESS |

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
absent, and the plan remains IN PROGRESS. On 2026-07-17 the maintainer explicitly authorized one
replacement of the failed public `v2.0.0` tag at the newly proven release commit; a movable `v2`
tag and manual unverified publishing remain forbidden.

The authorized replacement candidate then passed the disposable-home frozen install, exact Node
24.15.0 schemas/type/lint/build gates, three focused 7-file/144-test runs, the 5-file/98-test
release suite, all 139 files and 1,473 tests with coverage, smoke, built and packed demos, and the
exact npm 11.12.0 53-file artifact verifier. Plan 027 remains IN PROGRESS until hosted publication
and public npm/GitHub evidence pass.

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
