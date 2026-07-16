# Plan 016 implementation report

## Status

DONE

Plan 016 is implemented and committed as `d37c97f` on top of
`6346f328e812b2c1257b6fd57d7c4baed87f71fb`, without pushing, publishing, releasing, or changing
the package version (`1.2.0`). No owned file had overlapping dirty changes when implementation
started. Existing `.superpowers/` files were preserved.

## Implemented contract

- Added stable `confirmed`, `ambiguous`, `missing`, `unsupported`, and `unavailable` evidence
  conclusions with deterministic IDs, candidate arrays, sorted repository-relative sources,
  sorted stable diagnostics, and populated `evidenceRefs`.
- Preserved repository model schema version `1`. New public producer fields are optional for older
  schema-v1 producers; the current inspector always emits them.
- Added the effective root, classified effective/nested workspace/Git boundaries, complete marker
  lists, boundary/package ownership, and lockfile/boundary ownership.
- Added boundary-scoped manager precedence. Conflicting fields and lockfile managers remain
  ambiguous; invalid/unknown declarations are unsupported; no npm default is invented.
- Added exact supported lockfiles: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`,
  `yarn.lock`, JSONC `bun.lock`, and legacy `bun.lockb`. Readable entities retain manager,
  canonical path, exact SHA-256 byte hash, parse state, detected format version, and owning
  boundary. Unreadable files and alias-only ambiguity remain explicit.
- Added exact repository runtime declarations from `engines.node`, `.nvmrc`, `.node-version`, and
  the `nodejs` entry in `.tool-versions`. The executor Node version is excluded.
- Added the fixed read-only Git adapter using argument arrays and NUL-delimited porcelain output.
  It strips inherited Git control/trace variables, disables optional locks, index refresh helpers,
  filesystem monitors, and untracked-cache updates, probes every nested Git boundary, reports
  per-boundary shallow state, every required target status, and unrelated dirty paths, and
  distinguishes missing Git, non-repository, and failed probes.
- Updated root resolution so a nearest nested Git boundary prevents attribution to an outer
  workspace.
- Updated current API, type, repository-model, workspace, troubleshooting, README, architecture,
  review-guidance, and Unreleased changelog documentation.

## RED evidence

1. Initial repository evidence suite:

   ```text
   pnpm test:run src/repository/evidence.test.ts
   Test Files  1 failed (1)
   Tests       12 failed | 1 passed (13)
   Exit code   1
   ```

   Expected reason: current schema-v1 output had no `root`, `boundaries`, `lockfiles`, `evidence`,
   runtime declarations, or boundary relationships.

2. Initial VCS suite:

   ```text
   pnpm test:run src/repository/vcs.test.ts
   Test Files  1 failed (1)
   Tests       3 failed (3)
   Exit code   1
   ```

   Expected reason: current output had no read-only VCS entity, target states, unavailable
   diagnostics, shallow state, or unrelated-dirt reporting.

3. Failed-probe distinction regression:

   ```text
   pnpm test:run src/repository/vcs.test.ts -t 'distinguishes a failed Git probe'
   Tests       1 failed | 3 skipped
   Received    VCS_NOT_REPOSITORY
   Expected    VCS_PROBE_FAILED
   Exit code   1
   ```

4. Phantom clean-target regression:

   ```text
   pnpm test:run src/repository/vcs.test.ts -t 'does not emit absent boundary candidates'
   Tests       1 failed | 4 skipped
   Reason      12 absent boundary candidates were emitted as clean targets
   Exit code   1
   ```

5. Ignored/unrelated dirty manifest regression:

   ```text
   pnpm test:run src/repository/vcs.test.ts -t 'keeps ignored dirty manifests unrelated'
   Tests       1 failed | 5 skipped
   Reason      ignored/package.json incorrectly created an evidence boundary
   Exit code   1
   ```

6. Structurally malformed lockfile regression:

   ```text
   pnpm test:run src/repository/evidence.test.ts -t 'rejects structurally malformed'
   Tests       1 failed | 14 skipped
   Reason      syntactically valid but structurally invalid npm/pnpm/Yarn/Bun files parsed
   Exit code   1
   ```

7. Ignore-path and missing-root regressions:

   ```text
   pnpm test:run src/repository/evidence.test.ts -t 'applies ignore paths|keeps a missing root'
   Tests       2 failed | 15 skipped
   Reasons     ignored evidence files created a nested boundary; missing root was confirmed
   Exit code   1
   ```

8. Independent adversarial review batch:

   ```text
   pnpm test:run src/repository/evidence.test.ts src/repository/vcs.test.ts
   Test Files  2 failed (2)
   Tests       10 failed | 23 passed (33)
   Exit code   1
   ```

   Expected failures covered nested Git false-clean states, hostile inherited Git routing and
   trace variables, cross-manager aliases, Bun JSONC, ignored modeled targets, rename endpoints,
   corrupt exit-128 probes, unreadable evidence, invalid-manager fallback, and filesystem-monitor
   helper execution.

9. Second adversarial status/ownership batch:

   ```text
   pnpm test:run src/repository/evidence.test.ts src/repository/vcs.test.ts \
     -t 'cross-manager aliases ambiguous|partial runtime|corrupt outer|shallow state separate'
   Test Files  2 failed (2)
   Tests       4 failed | 1 passed | 35 skipped (40)
   Exit code   1
   ```

   Expected failures covered alias-only ambiguity, partial unavailable/unsupported runtime
   evidence, and a corrupt outer Git marker probed from a nested package.

10. Workspace/Yarn structural validation batch:

    ```text
    pnpm test:run src/repository/evidence.test.ts \
      -t 'structurally malformed|malformed workspace'
    Test Files  1 failed (1)
    Tests       2 failed | 25 skipped (27)
    Exit code   1
    ```

11. Real tool/workspace syntax batch:

    ```text
    pnpm test:run src/repository/evidence.test.ts -t 'catalog-only|multi-value'
    Test Files  1 failed (1)
    Tests       2 failed | 27 skipped (29)
    Exit code   1
    ```

12. Public workspace-value disclosure batch:

    ```text
    pnpm exec vitest run src/repository/evidence.test.ts \
      -t 'accepts catalog-only|never exposes unrelated Yarn'
    Test Files  1 failed (1)
    Tests       2 failed | 28 skipped (30)
    Exit code   1
    ```

    The failures proved that catalog-only pnpm data and unrelated Yarn registry credentials were
    being serialized into the public workspace conclusion.

13. Partial availability batch:

    ```text
    pnpm exec vitest run src/repository/evidence.test.ts src/repository/vcs.test.ts \
      -t 'visible lockfile|authoritative manager|preserves confirmed root VCS|distinguishes a non-repository'
    Test Files  2 failed (2)
    Tests       4 failed | 43 skipped (47)
    Exit code   1
    ```

    The failures covered false lockfile-derived confirmation after an unreadable subtree, dropped
    partial VCS values, and fabricated `shallow: false` state.

14. Cross-platform root containment batch:

    ```text
    pnpm exec vitest run src/io/packages/root-detection.test.ts
    Test Files  1 failed (1)
    Tests       7 failed | 6 passed (13)
    Exit code   1
    ```

    Mixed Windows separators were not normalized by the previous Git-boundary containment check.

## GREEN and final verification

Focused Plan 016 suite after all regressions:

```text
pnpm exec vitest run src/repository/evidence.test.ts src/repository/vcs.test.ts \
  src/repository/inspect.test.ts src/io/packages/root-detection.test.ts \
  src/io/packages/workspace-discovery.test.ts src/io/packages/workspace-boundary.test.ts
Test Files  6 passed (6)
Tests       90 passed (90)
Exit code   0
```

The core four-file, 73-test evidence/VCS/inspect/root-detection suite passed three consecutive times
under Vitest's default file parallelism and passed on exact Node `24.15.0`.

Fresh final repository gates:

```text
pnpm install --frozen-lockfile
Lockfile is up to date
Exit code 0

pnpm exec biome check . --error-on-warnings --max-diagnostics=none
Checked 225 files. No fixes applied.
Exit code 0

pnpm lint
Checked 225 files. No fixes applied.
Exit code 0

pnpm typecheck
tsc --noEmit
Exit code 0

pnpm test:run
Test Files 109 passed (109)
Tests      1073 passed (1073)
Exit code  0

pnpm build
Build succeeded for depfresh
Exit code 0

pnpm test:smoke
26 practical CLI checks; 52 mock-registry requests
Exit code 0

pnpm exec vitest run src/cache/sqlite.test.ts
Test Files 1 passed (1)
Tests      15 passed (15)
Exit code 0

npm pack --dry-run --json --ignore-scripts
depfresh@1.2.0; 23 files; 77,258 bytes packed
Exit code 0

git diff --check
Exit code 0
```

Exact Node `24.15.0` verification passed for the 73 focused repository tests, 15 cache tests, built
CLI version (`1.2.0`), and built library import/schema inspection. The built library reported the
real tracked `bun.lock` and `pnpm-lock.yaml` as parsed. A temporary-HOME cold/warm CLI probe made one
registry request on the cold run and zero additional requests on the warm run, with an isolated
persistent SQLite database. Built artifacts retain `node:sqlite` as a builtin import and contain no
`better-sqlite3`; package metadata and the lockfile also contain no `better-sqlite3`.

An exact-Node built-library inspection of the live dirty repository preserved the Git index bytes,
mode, size, inode, mtime, ctime, exact porcelain output, and lock absence. Independent adversarial
review approved the implementation after reproducing the secret-redaction, catalog projection,
partial availability, VCS, and mixed-separator regressions.

## Changed files

Production and public types:

- `src/repository/evidence.ts` (new)
- `src/repository/vcs.ts` (new)
- `src/repository/model.ts`
- `src/repository/inspect.ts`
- `src/io/packages/root-detection.ts`
- `src/types/repository.ts`
- `src/types/index.ts`
- `src/index.ts`
- `package.json`
- `pnpm-lock.yaml`

Adversarial tests:

- `src/repository/evidence.test.ts` (new)
- `src/repository/vcs.test.ts` (new)

Documentation:

- `README.md`
- `docs/api/functions.md`
- `docs/api/repository-model.md`
- `docs/api/types.md`
- `docs/configuration/workspaces.md`
- `docs/troubleshooting.md`
- `AGENTS.md` (repository-local ignored guidance file)
- `CHANGELOG.md` (Unreleased only)

Delivery record:

- `.superpowers/sdd/plan016-report.md` (new)

## Self-review

- Confirmed public `InspectRepositoryOptions` has no executable/runner injection or side-effect
  grant. Public inspection always uses fixed `git`; only the internal adapter accepts a test-only
  binary override.
- Confirmed VCS classification uses an explicit target set derived from modeled sources plus exact
  boundary candidate names. Absent candidates detect deleted/renamed states but are not emitted as
  phantom clean files. Clean requires a tracked target, ignored targets are explicit, and renames
  retain destination and original paths.
- Confirmed every modeled nested Git boundary is probed separately and aggregate evidence retains
  per-boundary availability and shallow state. Outer and nested actual index paths, bytes, mode,
  size, inode, mtime, ctime, lock absence, and exact porcelain bytes remain unchanged.
- Confirmed workspace evidence retains only membership declarations and stable marker metadata;
  unrelated pnpm catalog values and Yarn configuration credentials never enter the public model.
- Confirmed unreadable owned subtrees keep lockfile-derived conclusions unavailable, partial VCS
  values remain present, and unknown effective-root shallow state is omitted rather than defaulted.

## Remaining limitations

- The fixed executable name still trusts the caller's `PATH`; inspection does not attest the Git
  binary itself.
- Filesystem and Git snapshots are read-only but not globally atomic against concurrent external
  mutations.
- No Windows host was available for a runtime replay; platform-independent mixed-separator tests
  cover the corrected containment helper, while the repository CI currently runs on Linux.
- Policy evaluation, compatibility interpretation, apply behavior, and lockfile synchronization
  remain owned by Plans 017 through 020 and later plans.
- Confirmed every inherited `GIT_*` variable is removed before controlled read-only probes. Routing,
  object, config, filesystem-monitor, untracked-cache, and trace sentinels were not used or invoked.
- Confirmed ignored dirty manifests remain unrelated and are not read as modeled boundary evidence.
- Confirmed `ignorePaths` applies to lockfiles, runtime files, workspace markers, and nested Git
  markers before evidence parsing, including dotfiles below an ignored subtree.
- Confirmed a nonexistent inspection root remains serializable with unavailable root and VCS
  evidence plus stable `ROOT_NOT_FOUND`, without leaking its absolute parent path.
- Confirmed runtime unsupported diagnostics are assigned to their nearest boundary exactly once,
  manifest workspace sources retain `['workspaces']`, and duplicate `nodejs` tool entries are
  unsupported rather than producing duplicate IDs. A single multi-value `nodejs` line is retained
  verbatim, and partial unavailable/unsupported runtime evidence is never reported confirmed.
- Confirmed malformed known lockfiles require structural version evidence; Yarn v1 text entries are
  validated beyond the header, Yarn Berry requires metadata version, and Bun JSONC comments,
  string URLs, and trailing commas parse without executing Bun.
- Confirmed all serialized paths, diagnostics, IDs, hashes, and values are deterministic and
  repository-relative. No absolute paths, raw stderr, timestamps, inode data, or `process.version`
  are serialized.
- Confirmed no package-manager or lifecycle sentinel was invoked.

## Known limitations

- Legacy binary `bun.lockb` is intentionally hash-only and unsupported; Bun is never invoked.
- An unreadable lockfile cannot have a byte hash; it remains a path- and manager-backed unavailable
  entity until it can be read.
- Runtime declarations are collected but compatibility policy remains out of scope.
- Registry resolution, lockfile synchronization, install/apply behavior, and every Git mutation
  remain out of scope.
- VCS evidence is unavailable, with a stable diagnostic, when the fixed Git executable is missing,
  the effective root is not a Git repository, or the read-only probe fails.

## STOP conditions

No STOP condition was reached. No manager/root decision required an undocumented heuristic, and no
evidence collection required lifecycle execution, package-manager execution, or Git mutation.
