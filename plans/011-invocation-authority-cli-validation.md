# Plan 011: Invocation authority, CLI validation, and redaction

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Separate resolved option values from explicit runtime authority, reject unknown or malformed CLI
input before side effects, correct passive trust terminology, and redact secret-bearing failures.
This establishes the authority boundary used by every later write-capable plan.

## Invariants

- Config and defaults may shape behavior but cannot grant write, install, execute, global-write, or
  verification-command authority.
- Authority is derived from the active API/CLI invocation and is immutable after normalization.
- Unknown options, missing values, invalid combinations, and malformed enums fail with stable
  machine reason codes before registry, filesystem, process, or global side effects.
- Error details may identify a field or host but never expose credentials, auth headers, tokens,
  registry URLs with userinfo, or complete environment values.
- Metadata presence is not described as verified signature or provenance.

## Owned files

- `src/cli/raw-args.ts`, `src/cli/args-schema.ts`, `src/cli/normalize-args.ts`
- `src/cli/capabilities.ts`, `src/config.ts`, `src/validate-options.ts`
- public option/error/capability types and their focused tests
- `src/io/registry.ts` only for redaction and terminology at error boundaries
- affected CLI/config/security docs and `CHANGELOG.md`
- `src/invocation-authority.ts`, `src/utils/redact.ts`, and focused tests for the new authority and
  redaction contracts
- `src/commands/check/{run-check,process-package,write-flow,json-output,post-write-actions}.ts` only
  to enforce immutable authority at existing side-effect and error-rendering boundaries
- `src/io/resolve/resolve-dependency.ts` and current render/TUI metadata helpers only to replace
  passive provenance claims with explicit signature-presence terminology

Containment, resolution algorithms, writers, and new inspect/plan schemas are out of scope.

## Drift check

Compare the owned files with `8eea9c5`, characterize current CLI/config precedence, and inventory
every side-effect flag and programmatic entry point. Stop on overlapping CLI work.

## Implementation tasks

1. Write characterization tests for current valid invocations and failing tests proving that config
   cannot grant each side-effect capability.
2. Introduce a typed invocation-authority object separate from `depfreshOptions`. Construct it only
   at CLI/library boundaries and thread it to existing side-effect validation without widening
   permissions.
3. Make raw parsing consume the complete argv contract. Reject unknown flags, missing values,
   repeated singleton conflicts, malformed booleans/enums, and unsupported flag combinations.
4. Add stable error/reason codes and preserve exit code 2 for input errors. JSON mode must emit one
   valid redacted error object; human mode must not leak a stack trace.
5. Rename passive registry metadata fields and messages so presence and verification are distinct.
   Preserve compatibility aliases only where the public API requires them, with deprecation notes.
6. Centralize redaction for URLs, headers, tokens, and nested error causes; cover both JSON and human
   rendering.
7. Update capabilities/help output and docs to state which explicit invocation grants each current
   side effect.

## Acceptance evidence

- a config file containing write/execute/install values never grants authority;
- all supported valid CLI shapes remain characterized;
- unknown/malformed input fails before mocked registry, write, or process calls;
- JSON errors are schema-consistent and redacted; human errors contain no raw stack;
- passive trust terminology makes no verification claim;
- focused tests and all repository gates pass.

## STOP conditions

Stop if a public compatibility requirement would force config-derived authority, or if redaction
cannot be applied without losing the stable error code. Record the conflict instead of weakening
the invariant.

## Completion record

Implementation completed on 2026-07-15 without changing package version `1.2.0`:

- Added the public readonly `InvocationAuthority` contract. `check()` snapshots every supplied
  authority object before asynchronous work, and side effects require both resolved invocation
  intent and the matching immutable grant. Config-file values cannot grant write, install,
  update, execute, verification-command, or global-write authority.
- Raw argv validation now rejects unknown options, missing values, conflicting singleton repeats,
  malformed booleans, extra positionals, invalid enums/numbers, and unsupported combinations
  before discovery. Exact boolean assignments, grouped boolean aliases, attached short values,
  negative numeric validation, option-looking inline string values, and discoverability JSON
  failures have adversarial coverage.
- Added stable reasons: `UNKNOWN_OPTION`, `MISSING_OPTION_VALUE`, `CONFLICTING_OPTION`,
  `INVALID_BOOLEAN`, `INVALID_OPTION_VALUE`, `UNSUPPORTED_COMBINATION`, `AUTHORITY_REQUIRED`,
  `CONFIG_LOAD_FAILED`, `CONFIG_PARSE_FAILED`, `INVALID_CONFIG`, `REGISTRY_REQUEST_FAILED`,
  `CACHE_FAILURE`, `WRITE_FAILURE`, `RESOLUTION_FAILURE`, `ADDON_FAILURE`, and `UNKNOWN_ERROR`.
- Centralized rendering redaction for URL userinfo, sensitive query parameters, bearer/basic auth,
  common token/secret/password/API-key spellings, environment-style assignments, nested errors,
  circular values, commands, and invalid JSON metadata. Raw causes remain available to library
  callers but are never rendered directly by CLI error boundaries.
- Replaced active provenance claims with passive `SignaturePresence` (`present | absent`) fields
  and UI wording. Deprecated provenance types/fields remain as compatibility input only and are
  explicitly documented as non-verifying.

Passing evidence:

- `pnpm typecheck` — passed.
- `pnpm lint` — passed, 205 files checked.
- focused Node 24.15.0 suite — 12 files, 162 tests passed.
- `pnpm test:run` — 99 files, 958 tests passed.
- `pnpm build` — passed; public exports include authority and reason contracts.
- `pnpm test:smoke` — passed, 26 checks and 52 registry requests.
- exact Node 24.15.0 built CLI — reported `1.2.0`; library import passed.
- exact Node 24.15.0 temporary-HOME probe — invalid argv created no HOME state; config-derived
  write/install/execute values produced `didWrite: false` and ran no command.
- dist inspection and `npm pack --dry-run --json` — passed; 23 files, both entry points present,
  `node:sqlite` remains a builtin import, and `better-sqlite3` is absent.
- `git diff --check` — passed.

Final verification replay completed on 2026-07-16 without changing package version `1.2.0`:

- The former lockfile blocker was reproduced after the dependency synchronization commit.
  `pnpm install --frozen-lockfile` passed under isolated home, cache, and pnpm-store directories;
  pnpm reported that the lockfile was up to date.
- Independent review found one later regression: observed write-outcome strings bypassed the JSON
  redaction boundary. A retained RED test exposed URL userinfo, sensitive query values, bearer
  tokens, and environment assignments. The complete JSON envelope is now copied through the
  centralized redactor immediately before serialization; the focused security/output suite passed
  26 tests, and re-review returned `APPROVED` with no findings.
- `pnpm typecheck`, `pnpm lint`, and strict warning-as-error Biome checks passed; Biome checked 225
  files with no warnings or fixes.
- The 19-file Plan 011 focused suite passed 215 tests in each of three consecutive runs. The same
  215 tests passed on exact Node `24.15.0`.
- `pnpm test:run` passed 109 files and 1,074 tests. `pnpm build` and `pnpm test:smoke` passed; smoke
  exercised 26 CLI checks and 52 mock-registry requests.
- The exact-Node built CLI reported `1.2.0`; the built library exposed `check()`,
  `createInvocationAuthority()`, and all 16 stable reason codes.
- Dist inspection retained `node:sqlite`, excluded `better-sqlite3`, and included the authority,
  reason, and signature-presence declarations. `npm pack --dry-run --json --ignore-scripts` passed
  with 23 files and a 77,268-byte archive.
- Isolated exact-Node probes proved one cold registry request and zero additional warm requests;
  malformed argv left the temporary home empty; config-supplied side-effect values left the
  manifest unchanged, reported `didWrite: false`, and executed no command.
- The index remained unchanged, only the owned tracked files were modified, `git diff --check`
  passed, and the pre-existing untracked `.superpowers/` directory was preserved.
