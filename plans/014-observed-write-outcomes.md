# Plan 014: Canonical writes and observed outcomes

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: 011, 012, 013
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Make every existing manifest, YAML, catalog, override, and global write address a canonical
dependency occurrence and report the state actually observed afterward. This is a corrective bridge
to the later transactional apply engine, not that engine itself.

## Owned files

- `src/io/write/package-json.ts`, `src/io/write/package-yaml.ts`, `src/io/write/catalog.ts`
- override/resolution write-path helpers
- dependency/catalog/global parser adapters only to retain the exact raw pre-write value
- write occurrence/outcome types and their current JSON summary adapter
- `src/commands/check/write-flow.ts` and existing write result types
- `src/io/global-targets.ts` and current global write adapter for per-occurrence downgrade guards
- focused writer/write-flow tests, output docs, and `CHANGELOG.md`

Lockfile synchronization, verification commands, multi-file atomicity, new `apply` command, and
global rollback are out of scope.

## Required semantics

- Identify an occurrence by canonical file plus exact nested path/field/key, not package name alone.
- Capture expected pre-write value and requested value.
- Re-read the physical source after the write and derive the terminal result from observed state.
- Results are `applied`, `skipped`, `conflicted`, `reverted`, `failed`, or `unknown`; summaries are
  computed from those results only.
- A repeated package name in another field, workspace, catalog, override, or manager remains a
  separate occurrence.
- Global writes are individually no-downgrade guarded and never reported as transactional.

## Implementation tasks

1. Add adversarial failures for duplicate names across fields/files, nested overrides, catalog
   owners/consumers, partial writer failure, no-op writes, and mixed global versions.
2. Introduce a typed canonical occurrence path compatible with the later repository model.
3. Require expected current value before mutation; return `conflicted` when it differs.
4. Update JSON/YAML/catalog/override writers to return typed physical results and preserve original
   formatting/indentation behavior.
5. Re-read changed files and map each request to an observed terminal status. Never infer success
   from a writer call returning.
6. Apply per-occurrence no-downgrade checks to global targets and report partial/unknown states
   honestly.
7. Derive JSON/human summary counts from result records and preserve existing exit-code contracts.

## Acceptance evidence

- duplicate-name fixtures update only the exact requested occurrence;
- requested/observed mismatch is never counted as applied;
- partial and global outcomes remain itemized and totals reconcile exactly;
- formatting, catalog round-trip, and existing write regression tests remain green;
- all repository gates pass.

## STOP conditions

Stop if correctness requires multi-file atomic replacement or lockfile recovery; those belong to
plans 019 and 020. Stop on a writer path that cannot provide an exact occurrence identity.

## Completion record

Completed locally on 2026-07-15. The package version remains `1.2.0`; versioning is deferred until
all open plans are complete. The previously concurrent dependency-range update was preserved and
its lockfile graph was synchronized before the final verification replay.

### Occurrence and outcome contract

- A physical occurrence is `{ file, path }`: `file` is the canonical real path and `path` is the
  exact nested field/key sequence. Global occurrences use `global:<manager>` plus
  `['dependencies', name]`.
- Parsers retain `rawVersion` before protocol/range normalization. Every writer compares that exact
  expected value with a fresh read, computes the exact requested stored value, writes only the
  addressed occurrence, and re-reads the physical source.
- Terminal results are `applied`, `skipped`, `conflicted`, `reverted`, `failed`, or `unknown`, with
  stable reasons and expected/requested/observed values. A thrown writer or manager command is
  still observed, so a side effect completed before an error is reported from physical state.
- JSON exposes itemized `writeOutcomes`; JSON and human totals are derived only from those records.
  Conflicted, failed, or unknown writes exit `2` and suppress execute/install/update follow-ups.
- Global package-manager occurrences retain their individual installed versions, receive separate
  downgrade guards, continue after partial failure, and are never reported as transactional.

### Adversarial evidence

- Duplicate names across JSON and YAML fields update only the requested field.
- Nested override parents identify the exact leaf; stale expected values conflict without mutation.
- No-op writes remain byte-identical and report skipped.
- Symlinked manifests report the physical file identity.
- Repeated names in Bun named catalogs update only the matching owner; consumer manifests remain
  untouched.
- A successful catalog write plus a missing later catalog produces separate applied/failed records.
- Mixed global versions prove per-manager downgrade prevention, partial command failure, continued
  application, unknown observation, and nonzero-exit commands that nevertheless reached the target.
- JSON totals reconcile with itemized records, and post-write actions do not run after conflicts.
- The practical smoke package-manager fixtures now persist simulated global state so cold and
  post-write observations exercise the same physical-state contract.

### Verification

- `pnpm install --frozen-lockfile`: pass with pnpm 10.33.0.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass, 221 files checked; 23 non-blocking suppression warnings and one configuration
  deprecation notice remain visible under the updated formatter.
- Combined Plan 014/015 adversarial suite: pass, 4 files and 27 tests.
- Exact Node 24.15.0 focused cache/write/model suite: pass, 5 files and 42 tests.
- `pnpm test:run`: pass, 107 files and 1,019 tests.
- `pnpm build`: pass; public exports include `summarizeWriteOutcomes` and occurrence/outcome types.
- `pnpm test:smoke`: pass, 26 practical CLI checks and 52 mock-registry requests.
- Exact Node 24.15.0 built CLI: reports `1.2.0` with empty stderr; built library import and schema
  inspection pass with empty stderr.
- Package dry-run: pass, package `depfresh@1.2.0`, 23 files, 66,359 bytes packed.
- Dist inspection: `node:sqlite` remains a builtin import and `better-sqlite3` is absent.
- Temporary-HOME CLI persistence probe on exact Node 24.15.0: one cold registry request, zero warm
  requests, and an isolated persistent SQLite database.
- `git diff --check`: pass after the final ledger update.

### Remaining limitations

Multi-file atomic replacement, lockfile synchronization, and global rollback remain intentionally
deferred to plans 019–021.
