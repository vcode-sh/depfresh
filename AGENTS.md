# depfresh

CLI tool and library for checking/updating npm dependencies. Fast, correct, zero-config. TypeScript, ESM-only, Node >= 24.15.0.

## Architecture

Two entry points: `src/cli/index.ts` (CLI via citty) and `src/index.ts` (library exports).

### Flow: CLI -> Config -> Repository -> Policy -> Check -> Resolve -> Plan -> Apply

- **CLI** (`src/cli/`) — Arg parsing with citty, calls `resolveConfig()` then `check()`
- **Config** (`src/config.ts`) — Merges CLI args > `.depfreshrc`/`package.json#depfresh` > defaults (jiti + defu)
- **Invocation authority** (`src/invocation-authority.ts`) — Snapshots explicit CLI/library grants;
  configuration never grants side effects
- **Check** (`src/commands/check/`) — Orchestrates: load packages -> resolve each -> render -> interactive select -> write
- **Package loading** (`src/io/packages.ts`) — Finds `package.json` files via tinyglobby, detects indentation
- **Dependency parsing** (`src/io/dependencies.ts`) — Extracts deps from standard fields + overrides/resolutions, handles npm:/jsr: protocols
- **Resolution** (`src/io/resolve.ts`) — Fetches registry metadata with p-limit concurrency, SQLite cache (`~/.depfresh/cache.db`) with memory fallback
- **Registry** (`src/io/registry.ts`) — npm (abbreviated metadata) and JSR registries, retry with exponential backoff
- **Apply** (`src/commands/apply/`) — Validates immutable plans and exact target evidence, then
  stages, journals, atomically replaces, observes, and recovers local files under explicit authority;
  reviewed manager/verification phases run inside the same lock and journal lifecycle
- **Write compatibility** (`src/io/write/`) — Low-level formatting-preserving writers; normal local
  check writes delegate to the stale-safe apply engine
- **Catalogs** (`src/io/catalogs/`) — Loaders for pnpm/bun/yarn workspace catalogs
- **Addons** (`src/addons/`) — Plugin system with lifecycle hooks
- **Cache** (`src/cache/`) — SQLite-backed cache layer (`node:sqlite`)
- **Repository evidence** (`src/repository/`) — Candidate-only deterministic schema-v1 inspection
  for boundaries, managers, lockfiles, declared runtimes, unavailable directories, and read-only
  target-file Git state
- **Machine contracts** (`src/contracts/`, `src/commands/inspect/`, `src/commands/plan/`) —
  Schema-derived inspect/plan documents, canonical fingerprints, process-free inspection, and
  memory-only registry planning with exact occurrence operations; current plan/capabilities
  producers use v2 while published v1 schema bytes and apply compatibility remain stable
- **Policy** (`src/policy/`) — Strict JSON rule validation, legacy compilation, model-derived
  occurrence context, independent action/mode matching, traces, and candidate finalization
- **Invocation selection** (`src/selection.ts`, `src/cli/scope-exclusions.ts`) — Repeatable exact
  workspace/catalog CLI literals, fail-closed repository binding, internal physical-catalog rules,
  and derived human/JSON/plan receipts; library configuration remains unchanged
- **Signals** (`src/signals/`) — Pure repository-runtime, complete planned-peer-graph, explicit and
  inferred cohort, fixed-clock release/deprecation, evidence completeness, and passive-presence
  evaluation with separate ordered policy effects
- **Artifact trust** (`src/trust/`) — Bounded parser for verified npm 11.12.x and 12.0.x
  public-registry signature and SLSA provenance verification, with exact installed-artifact binding
  and no raw-output export

### Key types (`src/types/`)

- `depfreshOptions` — All config including lifecycle callbacks
- `PackageMeta` — A package.json with raw deps and resolved changes
- `RawDep` -> `ResolvedDepChange` — Before/after registry resolution
- `RangeMode` — `default | major | minor | patch | latest | newest | next`
- `PolicyRuleInput` -> `CompiledPolicyRule` -> `PolicyDecision` — Validated occurrence selection,
  deterministic provenance, independent winners, and exact candidate reasons
- `CohortInput` / `SignalRuleInput` -> `PlanSignal` / `SignalEvidence` — Explicit coordination,
  immutable five-state evidence, stable reasons, and traced `none | warn | block` effects
- `ArtifactVerificationTarget` -> `ArtifactTrustResult` — Exact public npm artifact/location input
  and independent sanitized signature/provenance result
- `DiffType` — `major | minor | patch | none | error`
- `DEFAULT_OPTIONS` — Exported defaults (concurrency: 16, timeout: 10s, cacheTTL: 30min, retries: 2)

## Code Style

**Biome** enforces everything:
- 2-space indent, single quotes, no semicolons, trailing commas
- 100 char line width, LF line endings, arrow parens always
- `noUnusedImports: error`, `noUnusedVariables: error`, `useImportType: error`
- `noConsole: warn` — use logger, not console.log
- `noAccumulatingSpread: error` — no spreading in loops

**TypeScript** strict mode:
- `noUncheckedIndexedAccess` — array/object access returns `T | undefined`
- `verbatimModuleSyntax` — explicit `import type` required
- `noUnusedLocals`, `noUnusedParameters`
- Module: ESNext, moduleResolution: bundler

## Testing

**Vitest** with colocated tests (`src/**/*.test.ts` next to source files). Additional integration tests in `test/`.

Coverage: v8 provider, reporters: text + lcov. Excludes `src/cli.ts`, type declarations, and test files themselves.

```bash
pnpm test              # Vitest watch mode
pnpm test:run          # Single run
pnpm test:run --coverage  # With coverage
```

## Commands

```bash
pnpm build             # tsdown -> dist/ (cli.mjs + index.mjs)
pnpm dev               # Run CLI via tsx
pnpm test              # Vitest watch
pnpm test:run          # Single test run
pnpm lint              # Biome check
pnpm lint:fix          # Biome auto-fix
pnpm format            # Biome format
pnpm typecheck         # tsc --noEmit
```

## Dependencies

**Runtime:** @clack/prompts, ajv, ansis, citty, defu, detect-indent, find-up-simple, ini, jiti, jsonc-parser, p-limit, pathe, pnpm-workspace-yaml, semver, tinyglobby, undici, yaml

**Dev:** @biomejs/biome, @vitest/coverage-v8, json-schema-to-ts, tsdown, tsx, typescript, vitest

**Build:** tsdown with Rolldown and external declared dependencies; `node:sqlite` remains a built-in
import

**Package manager:** pnpm — see the `packageManager` field in `package.json` for the pinned version

## Review Guidelines

- **Cache correctness** — SQLite cache has TTL and cooldown logic; verify cache invalidation on changes
- **Registry protocol handling** — npm:, jsr:, workspace: protocols have special parsing; test edge cases
- **Candidate truth** — Exact pins include equals-prefixed and prerelease semver spellings; global
  observations are not manifest pins, `next` falls back only when absent or invalid, and malformed
  publish times remain unknown
- **Indentation preservation** — Write operations must preserve original file formatting (detect-indent)
- **Concurrency** — p-limit controls parallel registry fetches; watch for race conditions in cache writes
- **Error boundaries** — Custom error hierarchy (RegistryError, CacheError, etc.); errors should never leak raw stack traces to CLI users
- **SQLite fallback** — the cache directory or database may be unavailable; memory fallback must work identically
- **Exit codes** — Legacy check uses 0 for complete/no blocking failure, optional 1 for outdated,
  and 2 for error or incomplete write. Inspect/plan/apply and global result contracts have their own
  documented schema-valid non-success mappings. Never collapse unknown into success. Normal CLI
  exits must set `process.exitCode` and return so large piped JSON drains completely; reserve
  immediate exits for signal termination.
- **Discovery ignore safety** — Invocation-specific ignore paths may replace configured custom
  paths, but must retain the built-in `node_modules`, `dist`, `coverage`, and `.git` exclusions.
  Repository discovery ignores never substitute for occurrence policy.
- **YAML/JSON write safety** — Catalog writes touch workspace config files; verify no data loss on round-trip
- **Evidence ambiguity** — Never select a manager, lockfile, workspace declaration, or runtime by
  filename/enumeration order; retain every candidate and stable physical source identity
- **Evidence inventory performance** — Walk every observable non-ignored directory needed for
  unavailable evidence, but retain and glob-check only manifest, workspace, lockfile, runtime, and
  Git-boundary candidates. Never follow directory symlinks or trade unavailable truth for speed.
- **Read-only VCS** — Use the fixed Git executable with argument arrays and optional locks disabled;
  inspection must leave index/worktree bytes and status unchanged
- **Compatibility truth** — Evaluate all owning-boundary runtime declarations and the complete
  proposed peer-constraint graph for each exact owner. Project physical catalogs, but keep
  unproven cross-workspace/hoist topology unknown. Never use the executor runtime, a wall-clock
  fallback, or a minimum version as an installed/final version.
- **Signal authority** — Only explicit cohorts or rules may block; inferred families never mutate
  targets. Unknown never becomes success, an override never changes state, and passive signature
  or provenance presence never claims verification.
- **Artifact trust** — Exact verification is currently limited to public npm artifacts with npm
  11.12.x or verified npm 12.0.x. Bind final lockfile SHA-512 integrity and contained installed
  location before the fixed lifecycle-disabled audit command. Isolate npm home/cache/config, keep
  stdout/stderr private and bounded, retain signature/provenance truth independently, and require
  explicit artifact/network authority. Unsupported, offline, stale, unavailable, or ambiguous
  evidence never passes.
- **Official automation** — Discover the supported machine surface with
  `depfresh capabilities --json`. Prefer the exported
  `depfresh/skills/depfresh/SKILL.md` instructions and its two-tier runner priority (locked local
  `pnpm exec`, then exact-version `npm exec`) instead of inventing command variants. The
  packaged workflow remains read-only until an explicit plan and invocation-authority grants are
  supplied; it never commits, pushes, publishes, or rewrites Git state.
- **Action machine results** — The Action accepts only its fixed command/input matrix and validates
  complete semantic results with validators imported from the exact installed package. Plan paths
  must resolve to contained regular non-symlink files, and contract/exit mismatches remain errors.
- **Stale-safe apply** — Recheck every target before the first replacement and before each rename;
  a stale or dirty target blocks the run while unrelated dirt does not. Preserve root-local lock,
  relative journal, same-directory backup, observed final-state, and unknown-on-ambiguity guarantees.
- **Apply atomicity** — Claim atomic replacement only per file. Recovery is best effort across files;
  incomplete or unobservable recovery must retain evidence and never become success.
- **Manager phases** — Require exact ready-plan manager/version/lockfile evidence and independent
  process/lockfile/install/verification grants. Use fixed no-shell argv, disabled lifecycle hooks,
  marker plus before/after same-user PID/start/process-group observation, continuous
  lock/journal/source identity checks, final
  lockfile parse/specifier/resolved-target reconciliation, complete repository and linked Git
  metadata observation, and identity-bound recovery. Fix manager output paths to contained values;
  only registry-backed semver/npm-alias occurrences are supported; install trees and manager caches
  remain non-transactional effects.
- **Machine planning** — `inspect()` must not execute Git or registry work; `plan()` may read the
  registry and fixed read-only Git evidence but never persistent cache, executable config,
  manager/lifecycle commands, or file writes. Every occurrence needs exactly one terminal decision.
- **Contract integrity** — JSON Schema descriptors are the type source. Regenerate shipped schema
  artifacts, recompute fingerprints instead of trusting input, retain semantic array order, and
  block secret-bearing operations rather than weakening exact preconditions.
- **Policy dimensions** — Action and mode are independent last-match-wins dimensions; retain all
  matched IDs and both winners
- **Legacy policy compatibility** — Include matches clear only their allow-list default; they never
  bypass global/package `ignore`, filters, or explicit exclusions. Exact `packageMode` names beat
  patterns, and otherwise the first insertion-order pattern wins.
- **Catalog policy** — Consumers are explanatory; workspace/package consumer rules never
  propagate into a shared physical owner
- **Manager ambiguity** — An otherwise matching manager-specific rule blocks on ambiguous,
  missing, unsupported, or unavailable evidence unless a later definite rule overrides its dimension
- **Global boundary** — Global manager/package/version occurrences retain distinct stable identities
  even when presentation groups equal names. Mutation requires explicit global-write, process, and
  exact manager authority; fixed no-shell commands are accepted only when post-command inventory
  proves the requested version. No downgrade or rollback is claimed.
