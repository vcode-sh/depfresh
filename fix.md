# depfresh Improvement Plan v2

## Goal

Ship a focused set of changes that make depfresh:

- correct when run from subdirectories or parent folders
- reliable across nested workspaces and private registries
- faster on large repos and monorepos
- truthful when resolution or post-write steps fail
- consistent across runtime behavior, JSON output, docs, and API contracts
- easier to debug in CI and local workflows

This plan is execution-ready. It is ordered by dependency and risk, names the files likely to change, calls out the tests that need to exist, and defines acceptance criteria for each phase.

## Execution rules

These rules apply to every implementation task in this plan.

- Every task starts as `TODO` and is marked `DONE` only after code, tests, and verification are complete.
- Every implementation task must include:
  - unit tests
  - adversarial tests for edge cases and failure paths
  - regression tests for the exact bug or behavior being changed
  - lint and typecheck pass
  - bugfix follow-up in the same task if the change reveals a related defect
- Never close a task at "feature works locally" stage.
- If a task changes public behavior, update docs in the same task or create an immediately-following doc task.

## Definition of done

A task is `DONE` only when all of the following are true:

1. Implementation is merged in local branch and behaves as intended.
2. Unit tests exist for the normal path.
3. Adversarial tests exist for edge cases, broken inputs, and failure behavior.
4. Regression tests exist for the original bug or missing behavior.
5. Newly exposed bugs found during implementation are fixed or explicitly split into a new tracked task.
6. `pnpm test:run` passes, or the affected targeted suite plus full suite passes if the change is broad.
7. `pnpm lint` passes.
8. `pnpm typecheck` passes.
9. The task status is updated from `TODO` to `DONE` in this file.

## Execution backlog

This is the recommended implementation backlog derived from the plan.

- `DONE` Task 0.1: Add regression harness for subdirectory discovery and parent-folder nested workspace discovery.
- `DONE` Task 0.2: Add false-green regression tests for all-resolution-failed cases in table and JSON modes.
- `TODO` Task 0.3: Add regression tests for Bun catalog detection from subdirectories.
- `TODO` Task 0.4: Add regression tests for duplicate cold-cache fetches and repo-wide concurrency behavior.
- `TODO` Task 0.5: Add contract tests for `.npmrc` env expansion and auth parsing behavior.

- `DONE` Task 1.1: Implement root auto-detection for `cwd` inside a project.
- `DONE` Task 1.2: Implement downward project-root discovery for parent folders that are not themselves projects.
- `DONE` Task 1.3: Thread `inputCwd` and `effectiveRoot` through config resolution and runtime.
- `TODO` Task 1.4: Expose root-resolution metadata in debug and JSON output.

- `TODO` Task 2.1: Replace blind recursive manifest globbing with workspace-aware root enumeration where available.
- `TODO` Task 2.2: Keep fallback glob discovery for plain non-workspace directory trees.

- `TODO` Task 3.1: Refactor nested workspace boundary detection to return structured classifications.
- `DONE` Task 3.2: Keep nested workspace roots visible while excluding nested descendants by default.
- `TODO` Task 3.3: Improve discovery debug output with exact skip reasons and affected paths.

- `DONE` Task 4.1: Track resolution errors explicitly in runtime state and JSON summary/meta.
- `DONE` Task 4.2: Prevent false "All dependencies are up to date" output when any resolution error occurred.
- `TODO` Task 4.3: Add table-mode rendering for resolution errors.
- `TODO` Task 4.4: Add `--fail-on-resolution-errors`.

- `TODO` Task 5.1: Introduce shared repo-wide resolver context with a single limiter.
- `TODO` Task 5.2: Add in-flight promise dedupe across packages and duplicate dependency occurrences.
- `TODO` Task 5.3: Preserve deterministic output ordering after concurrent resolution.

- `TODO` Task 6.1: Change cache keys to include protocol and registry identity.
- `TODO` Task 6.2: Add cache migration or cache invalidation path.

- `TODO` Task 7.1: Implement `${VAR}` expansion in `.npmrc` values.
- `TODO` Task 7.2: Decide and implement supported `.npmrc` basic-auth formats, or remove the doc claims.
- `TODO` Task 7.3: Match auth config to registries by normalized origin instead of loose substring matching.

- `TODO` Task 8.1: Add `--explain-discovery`.
- `TODO` Task 8.2: Add `--profile`.
- `TODO` Task 8.3: Add `--fail-on-no-packages`.

- `TODO` Task 9.1: Make `--execute` failures fail the run under the chosen contract.
- `TODO` Task 9.2: Make `--install` and `--update` failures fail the run under the chosen contract.
- `TODO` Task 9.3: If needed, introduce `--strict-post-write` as a transition flag.

- `TODO` Task 10.1: Make Bun catalog detection walk upward like pnpm and Yarn.
- `TODO` Task 10.2: Make package-manager detection use `effectiveRoot`.
- `TODO` Task 10.3: Reduce fragile catalog/load/write module coupling while touching these paths.

- `TODO` Task 11.1: Decide the final meaning of `includeWorkspace`.
- `TODO` Task 11.2: Implement the chosen `workspace:` resolution/skip behavior.
- `TODO` Task 11.3: Add regression coverage for published-version comparison or explicit skip semantics.

- `TODO` Task 12.1: Decide whether `packageManager` is supported or removed.
- `TODO` Task 12.2: Implement the chosen path completely, including tests and docs.

- `TODO` Task 13.1: Align JSON docs with actual runtime output and error semantics.
- `TODO` Task 13.2: Align workspace docs with actual `includeWorkspace` behavior.
- `TODO` Task 13.3: Align `.npmrc` docs with actual parser/auth behavior.
- `TODO` Task 13.4: Document `inputCwd` vs `effectiveRoot`.

## Deep audit additions

These items were uncovered in the deeper audit and are now first-class plan inputs.

1. Resolution failures can currently produce a false-green run.
   - JSON mode can emit `errors` with exit `0`.
   - Table mode can still print `All dependencies are up to date`.
   - This must be fixed before calling the tool trustworthy in CI.

2. `includeWorkspace` is not delivering the behavior documented today.
   - Docs say `workspace:` refs can be checked against published versions.
   - Runtime skips dependencies whose names match discovered workspace packages.
   - This needs either implementation or a contract correction.

3. `.npmrc` support is over-documented relative to runtime.
   - `${VAR}` expansion is documented but not implemented.
   - basic auth is documented but not parsed from `.npmrc`
   - token-to-registry matching is hostname-substring based, which is weaker than exact origin matching

4. Discovery/root behavior needs a more explicit output contract.
   - After auto-rooting, one `cwd` field is no longer enough.
   - We need both input cwd and effective root/discovery root.

5. Documentation drift is large enough to deserve its own cleanup track.
   - JSON docs do not fully document the top-level `errors` shape.
   - workspace docs over-promise `includeWorkspace`.
   - catalog docs imply manifest rewrites that do not actually happen.

6. Module boundaries are tighter than they should be.
   - Catalog/load/write code is coupled more than necessary.
   - Cleanup is not the first priority, but it should be handled while touching Bun parity and catalog paths.

## Scope

### In scope

- project root auto-detection
- workspace-aware discovery
- nested workspace filtering fixes
- error-path truthfulness
- repo-wide concurrency and in-flight fetch dedupe
- registry-aware cache keys
- `.npmrc` env/auth contract cleanup
- discovery and performance observability
- stricter automation and post-write failure behavior
- Bun catalog detection parity
- workspace protocol semantics cleanup
- `packageManager` feature decision and implementation cleanup
- doc/schema/API contract alignment
- light architecture cleanup where it directly supports the work above

### Out of scope for this sequence

- UI/TUI redesign
- new registries beyond npm, GitHub, and JSR
- major output schema redesign beyond additive fields and new flags
- large write-pipeline refactors not directly required by the phases below

## Product decisions to lock early

These should be explicitly decided before implementation starts.

1. Discovery should become project-aware by default.
   - If `cwd` is inside a project, depfresh should use the nearest ancestor project root.
   - If `cwd` is not inside a project, depfresh should scan downward for project roots instead of returning empty immediately.

2. Nested workspace roots should remain visible by default.
   - Descendants of other workspaces should be excluded.
   - The nested workspace root itself should still be considered a valid project target.

3. Cache identity must include registry context.
   - Same package name from different registries must never share cache entries.

4. Resolution failures need an explicit contract.
   - Recommended default: depfresh must never report a fully clean result when any dependency failed to resolve.
   - Recommended additive flag: `--fail-on-resolution-errors` for strict CI workflows.
   - Longer-term decision: whether resolution failures should become fatal by default.

5. Post-write failures need an explicit contract.
   - Recommended default: return exit code `2` on `--execute`, `--install`, or `--update` failure.
   - If compatibility risk is considered too high, add `--strict-post-write` first and flip the default later.

6. Root-aware output needs two cwd concepts.
   - Keep the user input directory visible.
   - Add a separate effective root/discovery root field in JSON and debug/profile output.

7. `.npmrc` support must match docs.
   - Either implement `${VAR}` expansion and basic auth parsing, or remove those claims from docs immediately.

8. `includeWorkspace` needs a final meaning.
   - Either actually compare `workspace:` refs against published versions when enabled, or redefine the option so the docs stop promising that.

9. `packageManager` needs a final answer.
   - Recommended: implement it fully as a first-class updatable source.
   - Fallback: remove it from supported-source docs and output claims.

## Delivery order

Implement in this order:

1. Baseline and regression harness
2. Root detection and discovery redesign
3. Nested workspace filtering fix
4. Error-path truthfulness and public contract stabilization
5. Repo-wide concurrency and in-flight dedupe
6. Registry-aware cache keys
7. `.npmrc` contract cleanup
8. Discovery and performance observability
9. Post-write failure semantics
10. Bun parity and root-sensitive package-manager detection
11. Workspace protocol semantics
12. `packageManager` completion or removal
13. Documentation and rollout polish

This order minimizes rework because discovery defines what packages and roots the resolver sees, and truthfulness/contract work should be solved before adding more performance-driven behavior changes.

## Phase 0: Baseline and regression harness

### Objective

Create a safety net before changing behavior.

### Work

- Add focused reproduction tests for the current failures.
- Add small benchmark-style tests or instrumentation helpers for package-level and repo-level throughput.
- Add fixtures covering:
  - root project
  - subdirectory inside a project
  - parent directory containing nested projects only
  - nested pnpm workspace
  - nested `.git` repo
  - Bun workspace with catalog
- Add contract tests for:
  - all dependencies fail to resolve
  - mixed success and failure in one run
  - `workspace:` refs with `includeWorkspace: true`
  - `.npmrc` env var token expansion
  - `.npmrc` basic auth parsing if supported
  - JSON output containing and documenting top-level `errors`

### Files

- `src/io/packages/packages.load.test.ts`
- `src/io/packages/packages.workspace-boundary.test.ts`
- `src/io/packages/workspace-boundary.test.ts`
- `src/io/catalogs/bun.detect.test.ts`
- `src/commands/check/check.core-flow.test.ts`
- `src/commands/check/check.registry.integration.test.ts`
- `src/utils/npmrc.test.ts`
- `src/io/dependencies/dependencies.patterns.test.ts`
- add new dedicated test files where existing files become too dense

### Acceptance criteria

- There are explicit tests covering:
  - `cwd` inside project root lookup
  - parent-folder scan of nested projects
  - nested workspace root visibility
  - Bun catalog detection from subdirectories
  - duplicate fetch suppression
  - repo-wide concurrency behavior
  - no false "up to date" result when all resolutions fail
  - workspace protocol behavior matching the chosen contract
  - `.npmrc` docs only claiming what the parser really supports

## Phase 1: Root auto-detection

### Objective

Make depfresh find the right project root automatically before config loading, package discovery, and post-write commands.

### Design

Add a root resolution layer that returns a normalized discovery target:

- `mode: direct-root`
- `mode: inside-project`
- `mode: parent-folder`

The resolver should detect:

- nearest ancestor `package.json` or `package.yaml`
- nearest ancestor workspace markers:
  - `pnpm-workspace.yaml`
  - `.yarnrc.yml`
  - Bun root `package.json` with `workspaces`
- repo boundary markers:
  - `.git`

### Behavior

- If `cwd` is inside a project, use the nearest ancestor project root as the effective root.
- If `cwd` is not inside a project, scan downward for project roots.
- Preserve explicit `--cwd`; do not invent new roots outside it.
- Add internal fields like `inputCwd`, `effectiveRoot`, and `discoveryMode`.

### Files

- add `src/io/packages/root-detection.ts`
- update `src/config.ts`
- update `src/io/packages/discovery.ts`
- update `src/commands/check/run-check.ts`

### Test cases

- Running from `repo/packages/app/src` resolves to the correct effective root.
- Running from a parent folder containing only child projects finds those projects.
- Running from a parent folder containing only a nested workspace root finds that root.

### Acceptance criteria

- `depfresh --cwd <repo>/src` no longer returns `noPackagesFound` when the repo contains a valid project.
- Config lookup and manifest discovery use the same effective root model.
- JSON/debug output can expose both input cwd and effective root without ambiguity.

## Phase 2: Workspace-aware discovery

### Objective

Stop treating project discovery as a blind `**/package.json` crawl.

### Design

Split discovery into two stages:

1. find project roots
2. enumerate manifests from each root

Priority order:

1. explicit workspace definitions
2. root manifest files
3. fallback recursive glob only when no workspace model is available

For workspace-aware enumeration:

- pnpm: read `packages` from `pnpm-workspace.yaml`
- npm/Bun: read `workspaces` from `package.json`
- Yarn: read workspace declarations available from root metadata

### Files

- `src/io/packages/discovery.ts`
- add `src/io/packages/workspace-discovery.ts`
- update `src/io/packages/workspace-boundary.ts`

### Test cases

- Workspace manifests are found via workspace definitions without scanning unrelated directories.
- Example, fixture, and vendor trees outside workspace patterns are not scanned by default.
- Fallback glob still works for plain multi-package folders without workspace config.

### Acceptance criteria

- Discovery no longer relies exclusively on `**/package.json` for workspace projects.
- Large repos with unrelated nested folders scan fewer paths in debug/profile output.

## Phase 3: Nested workspace filtering fix

### Objective

Keep nested workspace roots visible while excluding their descendants when appropriate.

### Design

Refactor boundary logic to return structured results instead of a single boolean:

- `same-root`
- `nested-root`
- `nested-descendant`
- `separate-git-root`
- `plain-child`

Filtering rule:

- include `nested-root`
- exclude `nested-descendant`
- configurable behavior for `separate-git-root`

### Files

- `src/io/packages/workspace-boundary.ts`
- `src/io/packages/discovery.ts`

### Test cases

- Parent folder with only nested monorepos returns those monorepo roots.
- Nested packages inside those monorepos are skipped when `ignoreOtherWorkspaces` is enabled.
- `--no-ignore-other-workspaces` includes both roots and descendants.

### Acceptance criteria

- The current false-empty parent-folder case is fixed.
- Debug output can explain which manifests were skipped and why.

## Phase 4: Error-path truthfulness and public contract stabilization

### Objective

Stop producing false-green results and make output contracts honest.

### Problems to fix

- A dependency resolution failure can still end with exit `0`.
- Table output can print `All dependencies are up to date` even when every dependency failed.
- JSON output reports `errors`, but the contract does not model the full outcome clearly enough.
- Root auto-detection will make `meta.cwd` ambiguous unless we split input cwd and effective root.

### Design

- Introduce explicit resolution-error accounting:
  - `summary.failedResolutions`
  - `meta.hadResolutionErrors`
- Never print "All dependencies are up to date" if any resolution error occurred.
- Add table-mode rendering for resolution failures.
- Add `--fail-on-resolution-errors` for CI and strict machine workflows.
- Keep changes additive in JSON rather than breaking existing fields.
- Keep `meta.cwd` as input cwd for compatibility and add `meta.effectiveRoot`.

### Files

- `src/commands/check/process-package.ts`
- `src/commands/check/run-check.ts`
- `src/commands/check/json-output.ts`
- render files under `src/commands/check/render/`
- CLI arg files and docs

### Test cases

- All dependencies fail to resolve:
  - table output does not claim success
  - JSON includes error count and flags
  - strict mode returns the chosen error exit code
- Mixed success and failure:
  - updates are still reported
  - errors are visible
  - exit code follows the chosen contract

### Acceptance criteria

- depfresh never reports a fully clean result when resolution errors occurred.
- JSON consumers can distinguish:
  - no packages found
  - packages found and up to date
  - updates available
  - resolution errors present

## Phase 5: Repo-wide concurrency and in-flight dedupe

### Objective

Use available concurrency across the whole repo, not just within one package.

### Design

Introduce a shared resolver context:

- one `p-limit` instance per run
- one in-flight promise map
- one shared memory cache layer for the process
- one shared SQLite cache backend

Keys for in-flight dedupe should include:

- protocol
- resolved package name
- resolved registry URL

### Implementation notes

- Keep package rendering and write phases ordered and deterministic.
- Resolution can happen concurrently while final output remains stable.
- Preserve callback semantics or explicitly document any changed ordering.

### Files

- `src/commands/check/run-check.ts`
- `src/commands/check/process-package.ts`
- `src/io/resolve/resolve-package.ts`
- `src/io/resolve/resolve-dependency.ts`
- add `src/io/resolve/context.ts`

### Test cases

- Two packages with one dep each resolve concurrently.
- Same dependency appearing twice in one package or across packages only fetches once on cold cache.
- Callback and JSON output remain deterministic.

### Acceptance criteria

- Monorepos with many small packages show lower wall-clock time.
- Duplicate fetch count drops to one per cache key in debug/profile output.

## Phase 6: Registry-aware cache keys

### Objective

Prevent incorrect cache reuse across registries and protocols.

### Design

Change the cache key format from:

- `package`

to something like:

- `protocol|registry-url|package`

For GitHub and JSR, use explicit synthetic registry identities.

### Migration

- Simplest path: invalidate the old cache table and recreate it.
- Better path: add a `cache_key` column and read old rows only as fallback during one transition release.

### Files

- `src/cache/sqlite.ts`
- `src/io/resolve/resolve-dependency.ts`
- `src/io/registry.ts`

### Test cases

- Same package name resolved from two different registries yields two distinct cache entries.
- Refresh and TTL behavior still works.
- Memory fallback behavior remains identical.

### Acceptance criteria

- Private-registry and public-registry packages with the same name no longer collide.

## Phase 7: `.npmrc` contract cleanup

### Objective

Make private-registry behavior match docs and reduce silent auth mistakes.

### Problems to fix

- `${VAR}` expansion in `.npmrc` is documented but not implemented.
- basic auth is documented but not parsed from `.npmrc`.
- token-to-registry mapping uses hostname substring matching rather than normalized origin matching.

### Design

- Implement `${VAR}` expansion for parsed `.npmrc` values before registry/auth processing.
- Decide whether to support npm `_auth` and related basic-auth forms now.
- Match auth config to registries by normalized origin, not raw substring.
- Add clear tests for home `.npmrc`, project `.npmrc`, env overrides, bearer auth, and basic auth.

### Files

- `src/utils/npmrc.ts`
- `src/io/registry.ts`
- `src/utils/npmrc.test.ts`
- registry integration tests
- docs under `docs/configuration/` and `docs/troubleshooting.md`

### Acceptance criteria

- `.npmrc` support claims and runtime behavior match.
- Private-registry auth setup is deterministic and test-covered.

## Phase 8: Discovery and performance observability

### Objective

Make correctness and performance issues visible without reading code.

### Features

- `--explain-discovery`
  - discovered roots
  - loaded manifests
  - skipped manifests
  - skip reasons
  - catalogs loaded

- `--profile`
  - discovery time
  - resolution time
  - write time
  - cache hits and misses
  - network fetch count
  - duplicate fetch suppressions
  - failed resolution count
  - package count
  - dependency count

- `--fail-on-no-packages`
  - return exit code `2` when no packages are found

### Files

- `src/cli/args-schema.ts`
- `src/cli/normalize-args.ts`
- `src/types/options.ts`
- `src/io/packages/discovery.ts`
- `src/commands/check/run-check.ts`
- possibly add `src/commands/check/profile.ts`

### Test cases

- JSON output includes additive metadata when profile mode is enabled.
- `--fail-on-no-packages` returns exit `2`.
- Discovery explanations are emitted in both table and JSON-compatible forms.
- Profile output includes resolution-error and duplicate-suppression metrics.

### Acceptance criteria

- A user can explain a miss or slowdown from CLI output alone.

## Phase 9: Post-write failure semantics

### Objective

Make automation results trustworthy.

### Recommended behavior

- If `--execute` fails, return exit code `2`.
- If `--install` fails, return exit code `2`.
- If `--update` fails, return exit code `2`.

If compatibility concerns are high, gate this behind `--strict-post-write` for one release, then flip default behavior.

### Files

- `src/commands/check/post-write-actions.ts`
- `src/commands/check/package-manager.ts`
- `src/commands/check/run-check.ts`

### Test cases

- Failing execute/install/update returns exit `2` in strict mode or default mode, depending on the final decision.
- Successful writes still return `0`.

### Acceptance criteria

- CI can trust depfresh to fail when post-write actions fail.

## Phase 10: Bun parity and root-sensitive package-manager detection

### Objective

Remove subdirectory inconsistencies.

### Work

- Make Bun catalog detection walk upward like pnpm and Yarn.
- Make package-manager detection use effective root rather than raw `cwd`.
- Prefer root package-manager metadata and lockfiles consistently.
- Reduce unnecessary loader coupling by importing narrow write helpers directly instead of write barrels where possible.

### Files

- `src/io/catalogs/bun.ts`
- `src/commands/check/package-manager.ts`
- `src/io/packages/discovery.ts`
- related write helper imports if touched

### Test cases

- Bun catalog is detected from `apps/foo/src`.
- Post-write install/update selects the correct package manager when run from a child folder.
- Catalog-loading code paths do not rely on fragile import ordering.

### Acceptance criteria

- pnpm, Yarn, and Bun behave consistently from nested working directories.

## Phase 11: Workspace protocol semantics

### Objective

Make `includeWorkspace` mean something precise and true.

### Problems to fix

- Docs say `workspace:` dependencies can be checked against published versions.
- Runtime currently skips dependencies whose names match discovered workspace packages, so that documented behavior does not actually happen.

### Design options

### Option A: true published-version comparison

- Parse `workspace:` protocol explicitly.
- Resolve against the registry when `includeWorkspace` is enabled.
- Do not blanket-skip dependencies merely because the name matches a discovered local package.
- Add a separate policy for skipping truly private/local-only packages.

### Option B: narrower contract

- Keep current skip behavior for local workspace package names.
- Redefine `includeWorkspace` as "include workspace protocol entries in parsing/output only when resolvable".
- Update docs to stop promising published-version comparison.

### Recommendation

Option A is stronger and more useful, but only if combined with a clear local-vs-published policy.

### Files

- `src/io/dependencies/parse.ts`
- protocol parsing helpers
- `src/io/resolve/resolve-dependency.ts`
- docs for workspaces and options
- tests for workspace refs

### Acceptance criteria

- `includeWorkspace` behavior is consistent, documented, and test-covered.
- A user can predict whether a `workspace:` dependency will be resolved or skipped.

## Phase 12: `packageManager` decision

### Option A: implement fully

Treat `packageManager` as a supported dependency source.

Work:

- parse `packageManager`
- resolve version targets
- preserve format and hash suffix behavior
- write updates safely
- document edge cases

Files:

- `src/io/dependencies/parse.ts`
- `src/io/packages/load-package.ts`
- write-path files as needed
- docs and JSON output docs

### Option B: remove claims

Work:

- remove `packageManager` from supported source docs
- remove it from output contract docs
- remove dead types or mark as internal only

### Recommendation

Choose Option A only if you want depfresh to manage toolchain/runtime pinning explicitly. Otherwise choose Option B now and revisit later.

## Phase 13: Documentation and contract cleanup

### Objective

Bring public docs, JSON schema docs, and API docs back into sync with runtime behavior.

### Known mismatches to resolve

- JSON output docs need explicit top-level `errors` coverage.
- workspace docs currently over-promise `includeWorkspace`.
- catalog docs currently imply referenced manifests are rewritten, not just source catalogs.
- `.npmrc` docs claim env expansion and basic auth support beyond what runtime currently guarantees.
- root auto-detection requires docs to distinguish input cwd from effective root.

### Files to update

- `README.md`
- `docs/troubleshooting.md`
- `docs/configuration/workspaces.md`
- `docs/configuration/files.md`
- `docs/configuration/options.md`
- `docs/cli/flags.md`
- `docs/output-formats/json.md`
- `docs/api/*` if public options or return semantics change

### Acceptance criteria

- No public doc claims behavior that is not implemented and covered by tests.

## Rollout strategy

### Release 1

- root auto-detection
- workspace-aware discovery
- nested workspace filter fix
- error-path truthfulness
- Bun parity
- `--explain-discovery`

### Release 2

- repo-wide concurrency
- in-flight dedupe
- registry-aware cache key migration
- `.npmrc` contract cleanup
- `--profile`

### Release 3

- post-write failure behavior
- workspace protocol semantics
- `packageManager` completion or removal
- docs cleanup and migration notes

This staged rollout lowers risk by separating behavior correctness from caching and performance internals.

## Backward-compatibility notes

- Discovery results will change. Some users will see more packages than before.
- `noPackagesFound` cases may disappear for child directories.
- If resolution errors become stricter, some previously green CI runs will start failing correctly.
- If post-write failures become fatal, CI behavior changes and must be called out in changelog and docs.
- Cache format changes should be treated as a one-time invalidation event.
- If `includeWorkspace` semantics change, workspace-heavy repos need explicit migration notes.

## Success metrics

Track these before and after:

- `noPackagesFound` incidence on valid repos
- average discovery time on large repos
- average end-to-end time on monorepos with many small packages
- duplicate fetch count per run
- cache hit rate
- false-green rate on resolution failures
- number of support reports about missing packages
- number of support reports about wrong registry/private package results
- number of support reports about `.npmrc` auth confusion

## Minimum acceptance checklist

- Running from a nested subdirectory inside a project works.
- Running from a parent folder containing nested workspaces works.
- Nested workspace roots are visible by default.
- Resolution failures are surfaced honestly in both table and JSON output.
- Duplicate fetches are deduped during a run.
- Cache keys are registry-safe.
- Bun catalog detection matches pnpm/Yarn behavior from subdirectories.
- `workspace:` handling matches documented behavior.
- `.npmrc` support claims match runtime behavior.
- Discovery misses are explainable from CLI output.
- CI can fail explicitly on no packages, resolution failures, and post-write command failures.

## Suggested implementation branch sequence

1. `codex/root-detection`
2. `codex/workspace-discovery`
3. `codex/error-truthfulness`
4. `codex/repo-wide-concurrency`
5. `codex/cache-key-fix`
6. `codex/npmrc-contract`
7. `codex/discovery-observability`
8. `codex/post-write-semantics`
9. `codex/bun-parity`
10. `codex/workspace-protocol`
11. `codex/package-manager-decision`

## Suggested immediate next action

Start with Phase 0 and Phase 1 in one PR:

- add failing tests for subdirectory and parent-folder discovery
- add the first false-green resolution-error tests
- introduce root auto-detection
- wire config and package discovery to the effective root
- add initial JSON metadata separation for input cwd vs effective root

That gives the biggest correctness win with the least architectural risk and unlocks the rest of the plan.
