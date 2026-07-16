# Plan 019: Stale-safe file apply

## Contract

- **Priority**: P1
- **Effort**: L
- **Risk**: CRITICAL
- **Depends on**: 014, 018
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Apply immutable plan operations to repository source files with explicit authority, complete stale
and dirty-state preconditions, a run-level lock, prevalidated staging, atomic per-file replacement,
byte-exact recovery, and observed final outcomes.

## File-phase contract

1. Validate schema, plan fingerprint, repository identity, authority, target containment, target VCS
   state, exact file hashes, and expected occurrence values.
2. Acquire an exclusive repository apply lock with owner metadata and safe stale-lock handling.
3. Render every target into same-filesystem temporary files; reparse and validate all staged files.
4. Immediately before the first replacement, recheck every source hash/identity. Any mismatch means
   zero replacements and a conflicted run.
5. Replace files individually by atomic rename while retaining byte-exact backups and a journal.
6. On failure, recover already replaced files where possible, then inspect every target and report
   `reverted`, `failed`, or `unknown` honestly. Never claim repository-wide atomicity.

## Owned files

- new `src/commands/apply` file-phase modules and public API
- typed physical operations, staging, lock, journal, recovery, and final inspection helpers
- existing `src/io/write` adapters and `src/commands/check/write-flow.ts` delegation
- capability/schema extensions, apply/security/recovery docs, and `CHANGELOG.md`

Lockfile/package-manager commands, verification commands, global updates, Git changes, and publishing
are out of scope.

## Implementation tasks

1. Add adversarial tests for stale plan/file/value, dirty target, unrelated dirt, symlink swap,
   concurrent apply, crash/failure at every replacement boundary, failed recovery, and unknown state.
2. Define typed file operations and validate them against the plan/schema and invocation authority.
3. Implement exclusive lock ownership and conservative stale-lock recovery without deleting a lock
   belonging to a live/unknown process.
4. Stage all files on the same filesystem, preserve mode/newlines/formatting, and reparse them before
   any replacement.
5. Close the TOCTOU window with the all-target precommit recheck described above.
6. Journal backups and replacements durably enough for deterministic in-process recovery and a
   documented manual recovery path.
7. Inspect final bytes/occurrences and derive every result from evidence.
8. Route existing file write flags through this engine or deprecate them explicitly; do not maintain
   a second unsafe writer path.

## Contract amendment (2026-07-16)

The public file phase is `apply(plan, options, authority)` and returns a strict
`depfresh.apply` schema-v1 document. `options` selects an explicit repository root; only the
snapshotted `authority.write` grant authorizes mutation. CLI application reads one JSON plan from an
explicit file, requires `--write` plus either `--json` or the equivalent `--output json`, and emits
the same result document. Invalid or forged plans and missing authority are fatal errors;
operational stale, dirty, lock, staging, commit, recovery, and observation states remain visible in
the result.

Repository identity and fingerprints remain clone-stable. Apply recomputes their internal validity
but does not invent an absolute checkout identifier or compare unrelated source bytes. Safety binds
the selected root through contained canonical target paths, unique physical identities, exact target
hashes and expected occurrence values, and fresh target-only VCS evidence. Confirmed clean targets
may proceed; dirty or changed target state blocks the run. A definite non-Git repository may proceed
from exact file evidence, while an unavailable or ambiguous Git probe cannot be treated as clean.
Unrelated dirty paths never block and are never touched.

Operations are grouped by physical file, rendered once, staged and reparsed beside the target, and
backed up byte-for-byte before any replacement. A root-local exclusive lock contains versioned owner
metadata. Only a valid same-host owner proven dead and without unresolved journal state may be
reclaimed; live, foreign, malformed, unreadable, or recovery-bearing owners block. The versioned
journal contains only repository-relative paths, hashes, modes, and phase states. Replacement and
recovery use same-directory atomic renames, recheck lock ownership plus target and owned-artifact
identity immediately before each rename, and derive the result from final bytes and occurrences.
This is per-file atomicity with best-effort multi-file recovery, never a repository transaction.

The legacy local `--write` path delegates to the file engine. The direct `writePackage()` library
export remains only as an explicitly deprecated compatibility surface. Manager/lockfile commands,
install/update/execute/verify phases, global commands, and trust verification retain their Plan
020–023 owners.

## Acceptance evidence

- stale/dirty/escaped targets cause zero writes;
- unrelated dirty files are untouched and do not block safe target files;
- every staged file parses before first replacement;
- fault injection covers each commit/recovery boundary and reports no assumed success;
- final summaries reconcile with observed bytes;
- focused adversarial tests and all repository gates pass.

## STOP conditions

Stop if an operation lacks exact preconditions, a target cannot be atomically replaced on its
filesystem, the lock owner is ambiguous, or recovery state cannot be reported without guessing.

## Completion record

Completed locally on 2026-07-16 without publishing, tagging, pushing, branching, or opening a pull
request.

### Delivered contract

- `apply(plan, options, authority)` and the CLI apply command return the strict
  `depfresh.apply` schema-v1 result. The generated package schema is exported at
  `depfresh/schemas/apply-v1.json`; semantic validation additionally reconciles phases,
  operations, occurrence evidence, recovery state, summaries, safe public text, and status.
- File operations retain exact source hashes, expected values, physical identities, modes, and
  repository-relative paths. Apply validates authority, immutable-plan fingerprints, containment,
  fresh target-only Git state, exact bytes, values, and unique target/source identity before
  mutation. Unavailable or ambiguous evidence never becomes clean or successful.
- The root-local `.depfresh/runs` area uses private-directory and private-file modes, an exclusive
  tokenized lock, no-follow durable owner reads, and inode/device/link-count ownership checks.
  Stale reclamation is limited to a valid same-host owner proven dead with no unresolved recovery
  state; successor locks and ambiguous owners are preserved.
- Each run durably records relative-path journal state, same-directory stages, byte-exact backups,
  hashes, modes, and owned inode identities. Parent directories and persisted owner/journal files
  are synced. Target, stage, backup, run, journal, and lock ownership are rechecked at the relevant
  rename and cleanup boundaries.
- Every target is staged and reparsed before the first replacement. Apply then performs per-file
  atomic replacement, best-effort byte-exact recovery, lock-last cleanup, and final byte/value
  observation. A failed or ambiguous cleanup, recovery, pathname, identity, hard-link, or final
  observation is reported as `failed` or `unknown`, never assumed successful.
- Normal local compatibility writes delegate to this engine. Direct `writePackage()` remains a
  deprecated low-level compatibility surface. Manager/lockfile verification, global updates, and
  artifact trust remain owned by Plans 020, 021, and 023.

### Adversarial and review evidence

- The 37-test file-engine suite covers stale values and bytes, dirty targets and unrelated dirt,
  symlink and hard-link escapes, duplicate physical/source paths, malformed and successor locks,
  cross-process exclusion, stage/backup/target swaps, every replacement and recovery boundary,
  crash recovery, orphaned and swapped journals, cleanup failures, restored-target ambiguity,
  and observed result reconciliation.
- Additional schema, command, CLI, and legacy-flow tests cover forged plans, missing authority,
  command-specific flag rejection, exit `0/1/2` semantics, JSON redaction, compatibility
  delegation, and strict result semantics.
- Independent fault, code, and documentation reviewers each returned `APPROVED` after replaying
  the final journal-identity, cross-process, schema, CLI, and documentation corrections. No
  validated finding remains.

### Verification

- Isolated temporary-HOME `pnpm install --frozen-lockfile` passed with pnpm `10.33.0`; its
  typecheck also passed and no user cache was used.
- `pnpm typecheck`, `pnpm lint`, strict `biome check --error-on-warnings .`,
  `pnpm schemas:check`, and `git diff --check` passed. Biome checked 265 files with zero warnings.
- The 4-file, 84-test Plan 019 contract suite passed three consecutive current-runtime runs. The
  55-file dependency regression set passed all 494 tests. The full suite passed 122 files and
  1,236 tests.
- `pnpm build` passed with 39 files and 1,068,703 bytes in `dist`; the apply schema is present,
  `node:sqlite` remains external, and `better-sqlite3` is absent. Practical smoke passed all 26
  checks and 52 mock-registry requests.
- Exact Node `24.15.0` passed the 4-file, 84-test focused suite, a fresh build, built CLI
  plan/apply validation, built library validation, and installed-tarball root/schema imports.
- Package dry-run reported `depfresh@1.2.0`, 42 files, 170,374 packed bytes, and 1,084,798
  unpacked bytes. A separately packed and isolated consumer installed and validated the library,
  apply schema subpath, capabilities document, and CLI on exact Node `24.15.0`.
- A temporary-HOME exact-Node cache probe made one cold registry request and zero warm requests;
  the SQLite cache remained 16,384 bytes. Git index hash
  `e35c4ebe297ca9ba5ebebb56ddfa6ff8a4869f5d9723f53f0600b0b717120d7c`, status hash
  `e5fa3ba61f88a6c9387dd26856bda65d377ba00e5b5655276c64f8f445a4c8ee`, tracked-diff hash
  `870906176fe0d5d070c2ace70312545bdba32553f4259da26eca17b8ced0c26f`, and empty staged-diff
  hash remained unchanged throughout the live Git immutability probe.

### Remaining limitations

- Multi-file application is not a repository transaction. Each rename is atomic on its own
  filesystem, and recovery is best effort with explicit partial or unknown outcomes.
- A hostile ancestor-directory replacement after the last portable pathname/identity check
  remains an operating-system boundary; the engine fails closed when it can observe the change.
- No Windows host replay was available. Cross-platform path rejection, containment, and fault
  behavior remain covered by platform-independent tests.
- Lockfile/process verification and global manager mutation are intentionally not performed by this
  phase; their separate failure domains are implemented by Plans 020 and 021.
