# Plan 013: Resolution candidate truth and downgrade prevention

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: 011
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Build one authoritative eligible-candidate set per dependency occurrence and select only from that
set. Correct known resolution truth gaps without expanding into the later policy or repository
model architecture.

## Known defects owned here

- `--include-locked` candidate behavior;
- prerelease-to-stable diff classification;
- JSR latest selection;
- deprecated-current metadata lookup;
- catalog filtering consistency;
- fallback to a candidate rejected by safety filters;
- implicit downgrade selection, including global-all inputs before their later state-machine plan.

## Owned files

- `src/io/resolve/version-filter.ts`, `src/io/resolve/resolve-dependency.ts`
- `src/utils/versions.ts`, `src/io/registry.ts` where metadata interpretation is required
- `src/io/resolve-mode.ts` and catalog filtering adapters only for candidate semantics
- `src/io/global-targets.ts` only for shared no-downgrade candidate logic
- focused colocated tests, resolution docs, and `CHANGELOG.md`

CLI authority, containment, physical writers, selectors, and new schemas are out of scope.

## Implementation tasks

1. Add one failing regression per listed defect using fixed metadata and time; no live registry tests.
2. Define a pure pipeline: normalize versions, classify channels, apply protocol/range/mode filters,
   apply deprecation/age/safety filters, then select. A rejected candidate may never re-enter.
3. Define downgrade as `target < current` under the normalized registry/version semantics. Block it
   unless a future explicit authority and policy both request it; no current implicit path may do so.
4. Make prerelease/stable comparison and `DiffType` derive from the same normalized pair.
5. Use the correct registry/JSR latest and current-version metadata records. Missing metadata must
   produce unknown/skip/error truth, not a fabricated safe candidate.
6. Apply the same candidate set to direct, catalog-backed, override, and global occurrences where
   those paths already exist.
7. Expose stable selection/skip reason codes for later policy and plan schemas without introducing
   those schemas now.

## Acceptance evidence

- each known defect has a red-before/green-after regression;
- property cases prove selected targets belong to the final eligible set and do not downgrade;
- missing/deprecated/prerelease/JSR/catalog cases produce deterministic reasons;
- resolution-focused tests and all repository gates pass.

## STOP conditions

Stop if a fix requires silently changing range-write semantics, adding policy precedence, or
inventing unavailable registry evidence. Move that requirement to its owning later plan.

## Completion record

Completed and independently approved on 2026-07-16. The former frozen-install blocker was
reproduced and is resolved: an isolated `pnpm install --frozen-lockfile` reports that the lockfile is
up to date.

### Corrected defects

- One pure selector normalizes registry versions, applies channel and mode rules, applies
  deprecation and maturity safety, blocks downgrades, and selects only from the final eligible set.
- Direct, catalog, override, global, and global-all occurrences use the same candidate truth.
  Globally observed exact versions resolve in default mode without treating manifest pins as
  implicitly authorized.
- Every exact semver spelling, including `=1.2.3` and prerelease identifiers containing `x`, is
  classified as locked. Equals-prefixed selection compares against the normalized current version.
- Named and numeric prerelease channels require an exact first-identifier match. Stable current
  versions cannot enter prerelease channels; prerelease versions may advance within the same
  channel or move to stable.
- A valid present `next` tag rejected by channel or later safety checks never falls back to
  `latest`. Fallback remains limited to an absent or invalid `next` tag.
- npm timestamp metadata retains only string values, and cooldown accepts only valid RFC 3339
  timestamps with valid calendar components. Coercive or malformed values remain unknown.
- JSR uses only an explicit semver-valid `latest` present in its version set, records `createdAt`,
  treats yanked versions as deprecated, and never derives latest from object insertion order.
- Global-all starts from the highest installed manager version, so shared resolution cannot
  downgrade a manager that is already ahead.
- Invalid current specs without a provable normalized version are skipped instead of fabricating a
  safe comparison or update.

### Stable reasons

`SELECTED`, `CURRENT_VERSION_SELECTED`, `CURRENT_VERSION_INVALID`, `NO_VALID_VERSIONS`,
`PRERELEASE_CHANNEL_BLOCKED`, `DIST_TAG_MISSING`, `DIST_TAG_NOT_ELIGIBLE`, `MODE_NO_MATCH`,
`DEPRECATED_CANDIDATE_BLOCKED`, `MISSING_PUBLISH_TIME`, `MATURITY_CANDIDATE_BLOCKED`, and
`DOWNGRADE_BLOCKED`.

Blocking reasons survive when the current version remains eligible but every upgrade was rejected.
Tag selection reports `PRERELEASE_CHANNEL_BLOCKED` when channel safety is the actual cause.

### Red-before evidence

- The original implementation retained its documented red-before regressions for the seven known
  defect classes, x-range compatibility, and blocking-reason preservation.
- Final adversarial review produced 11 focused failures across exact-pin authority, prerelease
  advancement, rejected `next` fallback, numeric channel crossing, coercive timestamps, and npm
  metadata normalization.
- Global and global-all default-mode integration then failed 2/2 before global observations were
  scoped separately from manifest pins.
- An equals-prefixed pure-selector case failed with `Invalid Version: =1.2.3` before normalized
  comparison was used.
- The first full-suite replay exposed one catalog-peer integration false negative under parallel
  load. The same test passed three isolated runs but exceeded its incidental one-second request
  budget; raising only the fixture timeout to five seconds preserved all production behavior and
  assertions. The full suite then passed, and the test-only change was independently approved.

### Final verification

- Isolated `pnpm install --frozen-lockfile`: pass; lockfile up to date.
- `pnpm typecheck`: pass.
- `pnpm lint` and strict zero-warning Biome: pass, 225 files checked.
- Resolution-focused suite: pass three consecutive runs, 10 files and 148 tests each.
- Independent adversarial matrix: pass, 56 mode/current/candidate cases; reviewer verdict
  `APPROVED` with no remaining findings.
- `pnpm test:run`: pass, 109 files and 1,094 tests.
- `pnpm build`: pass.
- `pnpm test:smoke`: pass, 26 practical CLI checks and 52 mock-registry requests, including global
  and global-all default-mode checks.
- Exact Node 24.15.0: pass, 10 focused files and 148 tests; built CLI reports `1.2.0`; built library
  import succeeds.
- Dist inspection: pass; `node:sqlite` remains external and no `better-sqlite3` reference exists.
- `npm pack --dry-run --json`: pass, `depfresh@1.2.0`, 23 files, 77,902 bytes.
- Exact-Node temporary-HOME cache probe: pass, one cold registry request and zero additional warm
  requests. The real user cache was never used.
- Git status and index bytes were unchanged by package and cache probes; `git diff --check` passed.

### Remaining limitations

No Plan 013 blocker remains. Later policy, plan-schema, apply, verification, and global state-machine
semantics remain owned by Plans 017 through 024. The package version remains `1.2.0` until final
release preparation.
