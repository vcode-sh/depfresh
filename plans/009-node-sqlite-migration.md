# Plan 009: Replace `better-sqlite3` with `node:sqlite`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: none
- **Planned at**: commit `8eea9c5`, 2026-07-15
- **Status**: DONE

## Objective

Remove depfresh's final native dependency by migrating the cache from `better-sqlite3` to Node's
built-in `node:sqlite`, while preserving the existing `Cache` contract, persistence behavior,
fallback behavior, and error semantics.

The migration must raise the supported runtime floor from Node `>=24.0.0` to `>=24.15.0`. Node
`24.15.0` is the first Node 24 release in which `node:sqlite` is Release Candidate and imports
without an `ExperimentalWarning`. Do not suppress Node warnings and do not require Node 26.

## Evidence and decision record

Verified locally on 2026-07-15:

```text
Node 24.0.0  -> API works, ExperimentalWarning emitted
Node 24.15.0 -> API works, no warning
Node 24.18.0 -> API works, no warning
Node 26.5.0  -> API works, no warning
```

Official reference:

- [Node 24 SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Node release status](https://nodejs.org/en/about/previous-releases)

The prior plan's Node 26 LTS revisit condition is obsolete. The real compatibility boundary is the
Node 24 patch level, not the next major line.

## Current state

- `src/cache/sqlite.ts` imports and constructs `better-sqlite3`.
- `src/cache/index.ts` exports the stable `Cache` interface and `createSqliteCache`.
- `build.config.ts` externalizes `better-sqlite3`.
- `package.json` declares `better-sqlite3`, `@types/better-sqlite3`, and an
  `onlyBuiltDependencies` entry.
- `package.json#engines.node` is `>=24.0.0`.
- CI workflows request `24.x`, which floats to a supported patch but does not prove the exact
  minimum.
- `src/cache/sqlite.test.ts` contains native-ABI skip behavior that becomes obsolete after the
  migration.

## In scope

- `src/cache/sqlite.ts`
- `build.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- exact Node-version declarations in CI or local tool files when required to prove `24.15.0`
- cache and installation documentation that names `better-sqlite3` or Node `24.0.0`
- `CHANGELOG.md`
- cache tests

## Out of scope

- changing the public `Cache` interface
- changing cache callers
- introducing `bun:sqlite` or runtime backend selection
- suppressing `ExperimentalWarning`
- requiring Node 26
- unrelated cache redesign, eviction policy changes, or performance tuning

## Execution boundaries

- Suggested branch name, only when the maintainer assigns branch work:
  `advisor/009-node-sqlite-migration`.
- Do not switch branches, stage, commit, push, publish, or open a pull request unless explicitly
  requested in the active task.
- Re-check the owned-file set and shared-checkout status immediately before manifest, lockfile, CI,
  or documentation edits.

## Owned behavior

The implementation must preserve:

- file-backed cache persistence under the existing cache path;
- WAL and `synchronous = NORMAL` pragmas;
- schema and legacy-key pruning;
- TTL enforcement and hit/miss/size accounting;
- corrupt JSON row deletion followed by a cache miss;
- memory fallback when the directory or database cannot be opened;
- `CacheError` boundaries for operational failures;
- idempotent, guarded close behavior in fallback paths.

## Implementation steps

### 1. Re-probe the exact runtime boundary

Run the same minimal `DatabaseSync` open, schema, insert, select, WAL, and close probe under Node
`24.0.0`, `24.15.0`, the latest Node 24 patch, and the local current Node. Capture stdout and
stderr separately.

Expected result: `24.0.0` warns; all versions at or above `24.15.0` used in the probe are silent.
If `24.15.0` warns or lacks required APIs, stop and re-defer the plan with evidence.

### 2. Make the runtime floor truthful

Change `package.json#engines.node` to `>=24.15.0`. Pin the minimum-version CI lane to `24.15.0`
instead of relying exclusively on floating `24.x`; a floating latest-24 lane may remain as a
second compatibility check. Update exact documentation claims that still say Node 24 without the
patch boundary.

Do not alter unrelated action SHAs or workflow structure.

### 3. Swap the cache engine

Replace the native import with `DatabaseSync` from `node:sqlite`. Preserve the current startup,
statement, error, and fallback structure. Coerce aggregate results such as `COUNT(*)` with
`Number(...)` because SQLite numeric output types may be wider than the current annotation.

Do not export a second backend or change callers. If parity requires a public contract change,
stop and amend this plan.

### 4. Remove native build requirements

- Remove `better-sqlite3` and `@types/better-sqlite3` from `package.json`.
- Remove `better-sqlite3` from `pnpm.onlyBuiltDependencies`; preserve `esbuild`.
- Remove the explicit native external from `build.config.ts`.
- Refresh `pnpm-lock.yaml` once with the repository package manager.

Review the lockfile diff. It must be limited to the removed native dependency and its now-unused
transitive graph plus deterministic metadata caused by the manifest edit.

### 5. Prove the test contract

Remove ABI-dependent skips and prove the cache contract against the real `node:sqlite` backend.
Required coverage:

- persistence across cache instances and across processes;
- TTL expiry and size accounting;
- corrupt JSON removal;
- legacy-key pruning;
- memory fallback parity;
- failure during open/schema setup closes safely and returns fallback;
- import is silent at the declared minimum Node version.

The implementation cannot be marked done until the focused cache suite is green with zero
native-load skips.

### 6. Update product truth

Update cache, installation, troubleshooting, architecture, and changelog text that names the old
native module or the old Node floor. State the user-visible benefit precisely: no native compilation
or Node ABI dependency for depfresh's cache.

### 7. Verify the distributable

Run the focused typecheck, lint, build, smoke, and cache acceptance commands. Inspect the built
files to confirm `better-sqlite3` is absent and `node:sqlite` remains a
Node builtin import rather than bundled code.

Run a cold and warm real CLI check against a temporary cache home. The warm run must demonstrate
cache hits and no unnecessary registry fetches. Do not delete the user's real cache.

## Verification

After the test owner completes the focused cache contract, run the repository typecheck, lint,
focused cache suite, full suite, build, and practical CLI smoke once. Run the exact Node `24.15.0`
import and CLI probes with stdout and stderr captured separately. Inspect the packed/built artifact
and a temporary-home cold/warm cache run; do not use or delete the user's real cache.

Compare the final manifest, lockfile, and built files to the owned scope. Any unrelated dependency
or build-output change is a lockfile/build drift blocker, not cleanup work.

## Done criteria

- `package.json#engines.node` is `>=24.15.0`.
- A minimum-runtime lane executes on exactly Node `24.15.0`.
- No source, manifest, build config, or current documentation reference requires
  `better-sqlite3`.
- `pnpm.onlyBuiltDependencies` retains `esbuild` and removes the native cache dependency.
- Built output imports `node:sqlite` and contains no `better-sqlite3` reference.
- The focused cache suite passes with no native-load skips.
- Typecheck, lint, build, full test suite, and practical CLI smoke pass.
- A temporary-home cold/warm run proves file-backed persistence.
- Importing the real check path on Node `24.15.0` emits no warning.

## STOP conditions

Stop and update the plan if:

- Node `24.15.0` emits an experimental warning in the actual CLI import path;
- required WAL, statement, or close behavior differs materially from the current contract;
- preserving behavior requires changing `Cache` or its callers;
- the lockfile refresh changes unrelated packages;
- the built artifact bundles the builtin module or fails on the exact minimum runtime.

## Maintenance notes

- After completion, adding any new native runtime dependency should require an explicit product and
  distribution review.
- Keep a latest Node 24 compatibility lane in addition to the exact minimum lane so patch-level
  drift is visible.
- Consider `bun:sqlite` only after a reproducible benchmark demonstrates a material benefit over
  Bun's `node:sqlite` compatibility implementation.

## Completion record

Completed locally on 2026-07-15 without staging, committing, or publishing.

- Runtime probes passed on Node `24.0.0`, `24.15.0`, `24.18.0`, and `26.5.0`; only `24.0.0`
  emitted the expected experimental warning.
- The cache now uses `DatabaseSync` from `node:sqlite`; schema, WAL, TTL, pruning, corrupt-row,
  persistence, statistics, and memory-fallback behavior remain covered.
- The manifest, lockfile, build configuration, CI minimum lane, issue template, README,
  repository instructions, troubleshooting/configuration docs, and changelog reflect the
  `>=24.15.0` runtime floor.
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, 15 focused cache tests, all 841
  repository tests, `pnpm build`, `pnpm test:smoke`, `npm pack --dry-run --json`, and
  `git diff --check` passed.
- Focused cache tests, the built CLI, and the library import passed under exact Node `24.15.0`.
- A temporary-home cold/warm CLI probe made one registry request on the cold run and zero on the
  warm run. The user's real cache was not used.
- Built and packed artifacts contain `node:sqlite` and no current `better-sqlite3` dependency.
