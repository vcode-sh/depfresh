# Plan 027: WUN-shaped demo and release proof

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: 026
- **Opened at**: `3ba0066`, 2026-07-17
- **Status**: IN PROGRESS

## Objective

Prove the publishable depfresh 2.0.0 artifact against a small deterministic Bun monorepo shaped
like WUN, including named catalogs, direct native declarations, safe policy exclusions, immutable
machine output, file-only writes, cache reuse, and Git-state boundaries. Fix only defects exposed
by that proof, replace the root README with a short human-first guide grounded in verified
behavior, reconcile release records and automation with current hosted truth, and publish the
exact reviewed artifact only after every gate passes.

## Product design

The demo is generated from sanitized data and never copies WUN files, dependencies, caches,
credentials, lockfiles, or dirty work. It contains a root Bun workspace, a default catalog, a
named `native` catalog, `apps/web`, `apps/worker`, `apps/native`, and one shared package. A local
registry provides fixed metadata so selection, writes, and cold/warm cache behavior are
deterministic. The proof may also run a read-only public-registry probe, but no assertion depends on
current public package versions.

Native safety is occurrence-based:

1. a `catalogName: '^native$'` exclusion freezes the physical named-catalog owner and its linked
   consumers;
2. an `apps/native` plus `catalogRole: 'direct'` exclusion freezes direct native declarations;
3. shared default-catalog owners remain eligible unless an exact owner rule excludes them.

Ignoring a workspace path alone must never be described as freezing a physical catalog owner.
Repository ignore paths are for discovery containment, not dependency-selection policy.

The persistent local copy is created at `/Users/tomrobak/_projects_/depfresh-wun-demo`; automated
verification uses disposable directories and the packed CLI. The persistent copy must finish on
its clean baseline so it remains useful for manual commands.

## Global constraints

- Keep package version `2.0.0`, Node `>=24.15.0`, ESM-only output, and the pinned package manager.
- Never use the real user cache or copy WUN secrets, cache state, lockfiles, generated files, or
  uncommitted content.
- Preserve JSON schemas, exit codes, containment, redaction, invocation authority, formatting,
  catalog ownership, cache fallback, and Git immutability.
- Configuration selects occurrences but never grants writes, commands, installs, or verification.
- Unknown, truncated, ambiguous, unavailable, or stale evidence never becomes success.
- Do not create a movable `v2` Action tag. Release only the immutable `v2.0.0` tag.

## Requirement-to-code/test map

| Requirement | Implementation owner | RED/proof owner |
| --- | --- | --- |
| complete large piped machine JSON | `src/cli/index.ts` | `src/cli/machine-commands.test.ts` backpressure subprocess |
| CLI ignore additions retain safety defaults | `src/config.ts`, `src/repository/inspect.ts` | config precedence plus machine inspect discovery regressions |
| WUN-shaped catalogs and native exclusions | `test/wun-demo-proof.mjs` | built and packed CLI plan/check/write assertions |
| cold/warm cache and Git boundaries | `test/wun-demo-proof.mjs` | request counts, hashes, and status assertions |
| human-first quickstart and native recipe | `README.md` | release/docs truth review and command replay |
| honest release and automation records | changelog, release draft, workflow/docs | release-readiness tests and hosted CI |
| exact published artifact | tag workflow | dry-run, tarball verifier, npm/GitHub post-release probes |

## Implementation tasks

1. Add asynchronous subprocess RED tests that pause stdout while synthetic inspect and plan
   documents grow beyond 64 KiB. Require complete schema-valid JSON and the correct exit code. Replace
   immediate normal-path CLI exits with `process.exitCode` plus returns so Node drains stdout;
   retain explicit signal exits.
2. Change the CLI array-precedence RED test to require `--ignore-paths` to replace configured
   custom paths while retaining the four safety defaults. Implement stable deduplication and replay
   config, discovery, containment, machine-command, and full CLI regressions.
3. Add `test/wun-demo-proof.mjs` and `pnpm test:demo`. Generate the sanitized Bun workspace and
   fixed registry, prove capabilities/inspect/plan/check, assert native owner and direct native
   exclusions, apply allowed file-only writes on a disposable copy, retain native bytes, prove a
   zero-fetch warm run, and verify read-only Git state. Support an explicit empty output directory
   for the persistent local baseline without overwriting existing work.
4. Rewrite `README.md` around one-off use, everyday commands, safe writes, the copy-paste native
   policy, workspaces, CI, and links to advanced contracts. Remove duplicated architectural sales
   copy while preserving attribution and verified limitations.
5. Fold all intended 2.0 work out of `Unreleased`, set the actual release date, record hosted-runner,
   packaging, checkout, demo, and CLI fixes, and replace release-draft metrics only from the final
   tarball. Remove unsupported manual-environment claims from the workflow/docs while preserving
   exact-tag, exact-artifact, isolated npm 11.12.0, OIDC, and public-artifact verification gates.
6. Run exact Node 24.15.0 frozen install with disposable home/cache/store; schemas, typecheck,
   zero-warning Biome, focused suites three times, full coverage, build, smoke, demo, dry-run,
   isolated tarball verification, cold/warm cache, Git immutability, YAML, and `git diff --check`.
   Obtain independent code/demo/docs/release approval and mark this plan DONE.
7. Commit and push `main`, wait for every current required check, update the repository ruleset to
   the exact current check names, create and push annotated `v2.0.0`, and monitor the tag workflow
   through npm publication and curated GitHub release creation. Verify npm `latest`, integrity,
   provenance, release body/asset, tag target, and clean synchronized Git state.

## Acceptance evidence

- Piped inspect/plan output larger than 64 KiB parses completely and validates against its schema.
- Additional CLI ignore paths never remove `node_modules`, `dist`, `coverage`, or `.git` defaults.
- The packed CLI selects ordinary/default-catalog updates while every named-native owner/consumer
  and direct native declaration remains skipped for an explicit policy reason.
- A file-only write changes only allowed physical owners/manifests and leaves native files byte
  identical. The persistent demo repository is clean and contains no copied WUN data.
- README commands and claims are replayed against the final tarball.
- Hosted `main` CI and the complete tag release workflow pass on exact Node 24.15.0.
- npm and GitHub expose the same `2.0.0` artifact integrity and provenance-bound release commit.
- Independent review returns `APPROVED` with no Critical or Important findings.

## STOP conditions

Stop before tagging if large JSON is incomplete, native exclusions update a physical native owner,
ignore additions weaken default containment, the final tarball differs from reviewed evidence,
the required-check ruleset is stale, npm trusted publishing rejects the workflow identity, or any
release job is non-success. Never replace a failed release with a manual unverified publish.

## Hosted release attempt

The release-preparation commit `75cacb7` passed every local gate, independent review, and hosted
`main` check in run `29542182146`. The annotated immutable `v2.0.0` tag was then pushed at that exact
commit. Tag run `29542342329` stopped in `Verify exact release artifact` before packing or
publishing: setup-node exposes npm through a symlink into its installed package, so comparing the
resolved parent directories of `node` and `npm` was not a valid executable-identity check. Publish
and hosted-release jobs were skipped; npm and GitHub therefore still expose no depfresh 2.0.0
release.

The regression test retains the failing guard as RED evidence and requires both isolated npm
bootstrap blocks to execute the selected Node binary and observe exactly `v24.15.0`. Plan 027 stays
IN PROGRESS until a provenance-bound immutable release path completes all remaining hosted and
public-artifact gates. On 2026-07-17 the maintainer explicitly authorized replacing the failed
public `v2.0.0` tag at newly proven release commits as required to complete the automated recovery.
This authorization does not permit a movable `v2` tag or a manual unverified publish.

## Authorized replacement preflight

Before replacing the failed tag, the final candidate passed a disposable-home frozen install with
Node 24.15.0 and pnpm 10.33.0; schemas, typecheck, lint, zero-warning Biome, release-workflow
actionlint, workflow YAML, and `git diff --check`; three consecutive focused runs of 7 files and
144 tests; the 5-file, 98-test release suite; all 139 files and 1,473 tests with 87.02% statement
and 89.40% line coverage; build; 26-check smoke; and both built and packed WUN-shaped demos. Exact
npm 11.12.0 reproduced the reviewed 53-file tarball at 259,407 packed and 1,595,185 unpacked bytes,
with SHA-512 integrity
`sha512-J9w5ccxXKpEmtywVyq8Bz2SyqtpC5QrAEP9rIHFDOwRRboQR+ClRLCTyN4SobQy9PHKtIRlYxV+UZ+3mo7M2Zg==`.
The changelog now includes the bootstrap repair in 2.0.0 rather than `Unreleased`.

## Hosted replacement attempt

The first authorized replacement pointed `v2.0.0` to `9832e0a` after hosted `main` run
`29557337581` passed all four required checks. Release run `29557541254` passed bootstrap, install,
schemas, typecheck, lint, build, release tests, and full coverage, then failed the practical CLI
smoke before packing. Its isolated uppercase `NPM_CONFIG_REGISTRY`, `NPM_CONFIG_USERCONFIG`, and
`NPM_CONFIG_GLOBALCONFIG` variables escaped into smoke child processes because the fixture removed
only lowercase `npm_config_*` names. The child used the public registry, producing one result where
the deterministic local fixture required three. Publish and hosted-release jobs were skipped, so
npm 2.0.0 and the GitHub Release remained absent.

The retained regression asserts uppercase removal. Exact release-environment RED reproduced
`1 !== 3`; case-insensitive filtering then produced GREEN in both ordinary and uppercase-isolated
runs, each completing all 26 checks with 49 fixed-registry requests. The package tarball remains
unchanged because the repair is confined to the unpackaged release test harness. Plan 027 remains
IN PROGRESS pending a newly proven commit, replacement tag, and complete public release evidence.

Recovery verification passed schemas, typecheck, lint, zero-warning Biome, release actionlint,
build, the 5-file/98-test release suite, all 139 files and 1,473 tests with 86.96% statement and
89.36% line coverage, the near-timeout fake-manager integration three consecutive times, the exact
uppercase release smoke three consecutive times, the WUN-shaped demo, and `git diff --check`.
Exact npm 11.12.0 reproduced the same 53-file, 259,407-byte tarball and SHA-512 integrity.
