# Plan 018: Inspect and plan contract v1

## Contract

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 011, 013, 014, 015, 016, 017
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Ship distinct read-only `inspect` and registry-aware `plan` commands plus equivalent library APIs,
versioned JSON Schemas, deterministic fingerprints, complete errors, and a compatibility adapter for
existing JSON output.

## Command contract

- `inspect`: repository/model/evidence only; no registry, process execution, or writes.
- `plan`: resolves candidates and policy decisions; still performs no writes or manager commands.
- both write one schema-valid JSON document to stdout in JSON mode and diagnostics to stderr.
- public library functions return typed results/errors and never exit the process.

### Boundary clarifications

- The new `inspect` command/API disables the Plan 016 Git adapter and reports VCS evidence as
  unavailable with a stable `VCS_PROBE_DISABLED` reason. Existing `inspectRepository()` keeps its
  fixed read-only Git evidence behavior for compatibility.
- `plan` may use that fixed read-only Git adapter because it has no process side effects; it must
  never run package-manager, lifecycle, configured, or arbitrary commands.
- Candidate resolution uses an in-memory cache. It must not create or open the user cache.
- Machine commands may read data-only JSON configuration. If the selected configuration would
  require JavaScript or TypeScript evaluation, they fail before evaluation with a stable error;
  executable configuration is never run inside the no-side-effect boundary.
- Exit `0` means a complete plan with no operation, material risk, block, unknown, or error; exit
  `1` means a schema-valid result containing operations, material risks, or non-fatal
  blocked/unknown/error decisions; exit `2` means no trustworthy result could be produced because
  of a fatal contract/runtime error.
- The no-absolute-path, deterministic-output contract applies to the new inspect/plan schemas.
  Legacy JSON v1 retains its documented absolute cwd/discovery fields and timestamp unchanged.

## Fingerprints

- Source hash: lowercase SHA-256 of exact file bytes.
- Repository fingerprint: SHA-256 of UTF-8 canonical JSON containing schema version, canonical root
  identity, and source entries sorted by canonical relative path with their byte hashes.
- Plan fingerprint: SHA-256 of canonical plan JSON excluding `planFingerprint`, `generatedAt`, and
  presentation-only fields. Arrays whose order is semantic retain order; map keys are sorted.
- Fingerprints never contain absolute paths and are recomputed by apply, not trusted from input.

## Required plan content

Repository identity/fingerprint; exact occurrence operations and expected values; candidate and
policy traces; skips/blocks/unknowns; risks/errors; required capabilities; manager/lockfile evidence;
schema/tool versions; and one terminal decision for every inspected occurrence.

## Owned files

- command routing under `src/cli`
- new `src/commands/inspect` and `src/commands/plan`
- schema-owned types, canonical JSON/fingerprint helpers, and packaged JSON Schema artifacts
- compatibility adapter around current `src/commands/check/json-output.ts`
- public exports, output/agent docs, package/build files needed to ship schemas

Apply/write behavior and compatibility/trust collectors not already available are out of scope.

## Implementation tasks

1. Snapshot current JSON output, exit codes, stdout/stderr behavior, and library API behavior.
2. Choose one drift-resistant schema/type source and add a gate that validates shipped schemas
   against representative success, block, partial-evidence, and error fixtures.
3. Implement canonical JSON and fingerprint helpers with golden cross-process/order tests.
4. Implement deterministic `inspect` serialization over plans 015–016.
5. Implement `plan` over candidate truth and policy decisions without mutating or reinterpreting
   targets.
6. Define stable error objects and command-specific exit codes for success, findings/blocked work,
   and fatal contract/runtime errors.
7. Add library entry points and a legacy JSON compatibility adapter with documented deprecations.
8. Package schemas and document consumption, redaction, version negotiation, and fingerprint rules.

## Acceptance evidence

- inspect has zero network/process/write calls; plan has zero write/process side effects;
- identical inputs produce byte-identical stable content and fingerprints across processes;
- every occurrence has exactly one terminal decision;
- outputs contain no absolute paths, volatile timestamps in stable hashes, or secrets;
- shipped schemas validate real CLI and library results and are present in package dry-run;
- legacy JSON characterization and all repository gates pass.

## STOP conditions

Stop if schema and TypeScript types can drift independently, an operation lacks an exact occurrence
or expected value, or deterministic output would require hiding material ambiguity.

Credential-bearing values are never made into operations because an exact apply precondition and a
publicly redacted value cannot be the same contract. Such occurrences receive an explicit blocked
terminal decision while their exact source byte hash remains evidence.

The authoritative schema source is an immutable TypeScript JSON-Schema descriptor. Public result
types are inferred from it, shipped JSON artifacts are generated from it, and a drift gate requires
the packaged artifacts to be byte-equivalent to the descriptor.

## Completion record

Completed locally on 2026-07-16 and committed as `4114f97`. The package version remains `1.2.0`;
the single `2.0.0` bump is
deferred until every numbered plan is complete. No push, publish, tag, release, branch, worktree, or
pull request was created.

### Command, schema, and compatibility contracts

- Added process-free `depfresh inspect --json` / `inspect()` and registry-aware, memory-cache-only
  `depfresh plan --json` / `plan()`. Inspect disables Git with `VCS_PROBE_DISABLED`; plan permits
  only the fixed read-only Git adapter and never runs package-manager, lifecycle, configured, or
  arbitrary commands.
- Added schema-derived `depfresh.inspect`, `depfresh.plan`, and `depfresh.error` v1 result types,
  runtime validators, and generated draft-07 artifacts at
  `depfresh/schemas/{inspect,plan,error}-v1.json`. The schema drift gate runs before every build.
- Exit `0` is complete with no operation, material risk, block, unknown, or error; exit `1` is a
  schema-valid actionable/risky/incomplete result; exit `2` is one stable fatal error document.
  Library APIs never exit the process.
- Legacy `depfresh --output json` retains its schema-v1 fields, absolute discovery paths, volatile
  timestamp, redaction, formatting, and exit behavior through pure compatibility builders. It does
  not validate as an immutable plan.

### Determinism and exactness

- Repository fingerprints cover schema version, stable root identity, and code-unit-sorted exact
  source-byte hashes. Plan fingerprints cover the canonical semantic document and exclude only the
  allowed top-level volatile/presentation fields.
- Canonical JSON rejects non-finite/non-JSON values, cycles, sparse arrays, hidden/accessor/symbol
  state, non-plain objects, and proxies before traps run. Cross-platform absolute paths and
  contradictory same-path source snapshots fail before a trustworthy contract is emitted.
- Inspect projects resolvable sources, source files, packages, catalogs, boundaries, runtime
  declarations, relationships, evidence values/sources, lockfiles, VCS state, occurrences,
  diagnostics, and risks. Code-unit projection sorting makes cloned repositories byte-identical
  across process roots, timezones, and `en_US`/`sv_SE` collation.
- Every occurrence has exactly one terminal decision. Semantic validation recomputes repository and
  plan fingerprints and validates summaries, references, candidate targets, capabilities, errors,
  exact operation IDs, source hashes, paths, and expected values. True current results are
  unchanged; unsupported/dynamic declarations are skipped; safety filters are blocked; missing or
  inconsistent candidate evidence is unknown.

### Security and adversarial evidence

- Machine outputs contain no absolute paths, stacks, causes, or credential-bearing text. Unsafe
  identity paths fail with `UNSAFE_PUBLIC_PATH`; secret-bearing values, keys, rule IDs, evidence,
  and lockfile format text block or produce material redaction risks without weakening operations.
- Public inspect/plan option containers are checked through descriptors before copying, so proxies,
  accessors, symbols, hidden state, sparse arrays, and cycles cannot execute traps or side effects.
- Hostile JSON keys remain inert own data. Executable configuration fails before evaluation, and
  invalid/command-specific/side-effect CLI flags fail before discovery.
- Independent adversarial and code review returned `APPROVED`; a separate final documentation
  review also returned `APPROVED` after replaying the corrected contract claims.

### Verification

- Isolated temporary-HOME `pnpm install --frozen-lockfile`: pass with pnpm `10.33.0`, using only the
  existing isolated temporary store.
- `pnpm schemas:check`, `pnpm typecheck`, `pnpm lint`, strict
  `biome check --error-on-warnings .`, and `git diff --check`: pass; Biome checked 257 files with
  zero warnings/errors.
- Focused Plan 018/dependency suite: 27 files and 279 tests, passed three consecutive runs.
- Full suite: 121 files and 1,193 tests. Build: pass, 898 kB dist including all three schemas.
  Practical smoke: 26 checks and 52 mock-registry requests.
- Exact Node `24.15.0`: 22 focused files and 208 tests; built CLI inspect/plan validation; built
  library validation; extracted schema-subpath imports; and an isolated installed-tarball library
  import all passed.
- Package dry-run: `depfresh@1.2.0`, 37 files, 149,421 packed bytes and 913,169 unpacked bytes.
  Dist retains `node:sqlite`; `better-sqlite3` is absent.
- Temporary-HOME cold/warm probe: legacy check made one cold and zero warm registry requests; each
  separate plan made one registry request through memory-only cache, left the persistent SQLite
  bytes/mtime unchanged, and created no plan cache state.
- Live Git immutability probe: index hash
  `8ca34c7556b22e5bce9bbfb8af6fba498b1064262f2b323b15c0fcdf56d9e660`, status hash
  `78b791f94e35fc1e2153d59eb50ce6da3fb4934f0fd2b050b4930e43843c42ad`, and tracked diff hash
  `fc50c4800c155d2e06fc626813d6d467c3cd5ce074488b1009407e0520e86f7d` were unchanged.

### Remaining limitations

- Inspect intentionally reports process-free VCS unavailability; callers needing read-only Git
  evidence use `inspectRepository()` or plan. Apply/write semantics remain owned by Plan 019.
- No Windows host replay was available; Windows drive/UNC rejection and mixed-separator behavior
  are covered by platform-independent tests.
- JSON Schema expresses document shape; exported validators additionally enforce the cross-field
  semantic invariants that draft-07 cannot represent.
