# Plan 020: Lockfile synchronization and verification

## Contract

- **Priority**: P1
- **Effort**: M
- **Risk**: CRITICAL
- **Depends on**: 016, 019
- **Planned at**: `8eea9c5` plus completed plan 009, 2026-07-15
- **Status**: DONE

## Objective

Add package-manager lockfile synchronization and optional verification as explicit phases after file
apply. Use the manager and lockfile selected in the immutable plan, execute argument arrays without
shell interpolation, observe every changed path, and recover source/lockfile bytes when a phase fails
where recovery is possible.

## Phase contract

- `sync-lockfile` requires explicit process and lockfile-write authority.
- `install` is a separate stronger capability; it is never implied by sync or config.
- `verify` runs only an exact reviewed command/argv supplied with explicit execute authority.
- Default sync uses the manager's supported lockfile-only/frozen-safe mode and disables lifecycle
  scripts where the manager supports it.
- Before commands, snapshot planned source/lockfile bytes and the permitted path set. After commands,
  inspect hashes and occurrences; unexpected path mutation is a failure.
- Sync or verification failure triggers recovery of planned source/lockfile bytes. Effects outside
  that set, such as a full install store, are reported as non-transactional/unknown, never hidden.

## Owned files

- `src/commands/check/post-write-actions.ts` and new apply sync/verify phase modules
- package-manager command adapters and result types
- plan/apply schema capability and phase-result extensions
- lockfile fixtures, apply/security/recovery docs, and `CHANGELOG.md`

File staging/replacement internals, global updates, Git operations, and arbitrary inferred test/build
commands are out of scope.

## Implementation tasks

1. Characterize current install/execute/verify behavior and add fault cases for missing manager,
   wrong version, command failure, signal/timeout, lockfile drift, unexpected manifest mutation,
   verification failure, and failed recovery.
2. Define a manager adapter returning executable plus fixed argument arrays, allowed outputs,
   lifecycle-script behavior, timeout, and supported sync/install capabilities.
3. Validate manager identity/version and lockfile hash against the immutable plan before file apply.
4. Run sync after successful file replacement, using no shell and a minimal sanitized environment.
5. Inspect all planned and unexpected repository changes; update observed operation results.
6. Run optional verification only after successful sync. Do not infer a command from package scripts
   or repository contents.
7. Recover source and lockfile bytes on sync/verify failure, then re-inspect. Distinguish recovered,
   partial failure, and unknown outcomes.
8. Migrate current `--install`, `--execute`, and `--verify-command` flows to explicit phase authority
   or deprecate them; preserve documented exit codes during transition.

## Implementation amendment (2026-07-16)

### Immutable phase request

`depfresh plan` may request exactly one manager mode, `sync-lockfile` or `install`, plus an optional
verification phase. The plan fingerprints, for every affected boundary, the confirmed boundary ID
and path, exact declared manager name and version, selected parsed lockfile ID/path/hash, fixed
adapter executable/argv, permitted repository paths, lifecycle behavior, and external-effect
classification. Verification is a strict JSON argv array, contained working directory, timeout,
and empty permitted-write set. It is never inferred from scripts, configuration, or repository
contents.

Planning flags describe future intent without granting authority:

- `--sync-lockfile` requests lockfile-only synchronization;
- `--install` requests the stronger install mode and cannot be combined with `--sync-lockfile`;
- `--verify-argv '<JSON array>'` requests one exact command after successful manager work;
- `--phase-timeout <milliseconds>` is fingerprinted and bounds each version/manager/verify process.

`depfresh apply` accepts `--sync-lockfile` or `--install` only as the matching explicit grant and
accepts `--verify` only for the already fingerprinted verification argv. Apply flags cannot add,
replace, or weaken a plan phase. Public library callers grant the same independent
`processExecute`, `lockfileWrite`, `install`, and `verifyCommand` authorities.

### Supported adapter matrix

- npm `10.x` and `11.x`, selected `package-lock.json` or `npm-shrinkwrap.json`:
  `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
- pnpm `10.x` and `11.x`, selected `pnpm-lock.yaml`:
  `pnpm install --lockfile-only --ignore-scripts --ignore-pnpmfile --no-frozen-lockfile` plus fixed
  contained lockfile/modules/virtual-store/linker/workspace-lock configuration arguments.
- Bun `>=1.2.0 <2.0.0`, selected text `bun.lock`:
  `bun install --lockfile-only --ignore-scripts --no-progress --no-summary`.
- Manager execution reconciles only direct registry-backed `semver` and `npm:` alias occurrences in
  standard dependency fields. Other protocols and occurrence roles block the manager phase before
  apply. Alias proof binds the manifest alias key, exact registry package identity, exact specifier,
  and exact resolved version; a same-version identity swap is a mismatch.
- Full install uses the same supported manager/version evidence and script/config suppression but
  is a stronger, explicitly non-transactional phase whose dependency tree and manager-cache
  effects are not recoverable.
- Yarn Classic has no documented lockfile-only mode. Yarn Berry can load repository/ancestor
  plugins or a redirected `yarnPath` before the command. Both are unsupported until those execution
  surfaces can be disabled and proven. Legacy `bun.lockb`, missing/ambiguous managers, managers
  without an exact version, unparsed/ambiguous lockfiles, and manager/version mismatches are also
  unsupported. Windows execution is unsupported until equivalent inherited-descendant observation
  exists. There is no npm fallback.

### Engine and result contract

Manager/version/lockfile/authority preflight runs before any source replacement. The fixed manager
command runs inside the Plan 019 lock and durable journal lifecycle, after file replacement but
before final observation and cleanup. Lockfile backups and phase evidence live in the owned run
directory, so a crash retains recovery evidence and blocks later mutation. Source and lockfile
identity are rechecked before every command and recovery rename.

Apply schema-v1 records aggregate `manager-preflight`, `sync-lockfile` or `install`, and `verify`
phases with exact public argv, termination (`exit`, `signal`, `timeout`, or unavailable), observed
changed/unexpected paths, lifecycle behavior, and non-transactional effects. Failure restores only
planned source and lockfile bytes where identity evidence permits. Unexpected files, install trees,
manager caches, surviving descendants, or ambiguous recovery remain partial/unknown and are never
hidden by a successful source restoration. Exit `0` requires all requested phases and final
observations to pass; schema-valid conflict/revert/failure/unknown exits `1`; malformed input or
missing authority exits `2`.

Linux/macOS process supervision takes one same-user PID/start/process-group baseline before spawn
and a final observation after termination. An unavailable baseline prevents spawn. After spawn,
unavailable observation or a surviving unattributed process is unknown; unrelated concurrent
process creation can therefore conservatively reject a phase.

The legacy `--update`, `--execute`, and shell-string `--verify-command` flows are deprecated and
rejected rather than retained as an unsafe second writer. Legacy `--install` is likewise redirected
to the explicit plan/apply workflow. Plain compatibility `--write` remains the Plan 019 file-only
path.

### Requirement-to-code/test map

| Requirement | Implementation owner | RED/proof owner |
| --- | --- | --- |
| selected manager/version/lockfile and phase fingerprint | plan builder, schemas, fingerprint validator | plan/schema tests |
| fixed no-shell manager commands and sanitized environment | apply manager adapters and process runner | adapter/process tests |
| preflight before writes and continuous lock ownership | apply engine phase coordinator | sync and cross-process tests |
| complete path observation and unexpected mutation failure | repository snapshot/compare helper | sync mutation matrix |
| lockfile/source recovery and retained crash evidence | phase journal plus apply recovery integration | injected recovery/crash matrix |
| exact verification argv after successful manager phase | plan/apply phase coordinator | ordering/injection/timeout tests |
| independent authority and CLI exit semantics | invocation authority, machine CLI, capabilities | authority/CLI tests |
| legacy migration without a second shell path | check validation and docs | legacy characterization tests |
| security/API/CLI/recovery documentation | current docs, AGENTS, changelog, matching v2 draft sections | independent docs review |

## Acceptance evidence

- command injection strings remain inert argv values;
- wrong/missing manager or stale lockfile blocks before writes;
- lockfile sync and verification order is deterministic;
- every fault boundary has observed recovery/partial/unknown output;
- lifecycle/install authority is never implicit;
- focused integration tests and all repository gates pass.

## STOP conditions

Stop if a supported manager lacks a safe documented sync mode, mutates unbounded paths, or cannot be
identified from plan evidence. Mark the adapter unsupported instead of guessing commands.

## Completion record

Completed on 2026-07-16 at package version `1.2.0`; the version remains unchanged until final v2.0
release preparation.

### Delivered contract

- Immutable plan execution records exact npm 10/11, pnpm 10/11, or Bun `>=1.2.0 <2.0.0`
  manager/version evidence, one selected parsed lockfile per affected boundary, fixed no-shell argv,
  lifecycle suppression, permitted paths, timeout, external-effect classes, and optional exact
  verification argv.
- Apply requires matching explicit process, lockfile-write, install, and verification grants that
  configuration cannot provide. Manager preflight runs before source replacement, then manager and
  verification phases remain inside the Plan 019 lock/journal lifecycle.
- Exact lockfile proof binds manifest field/key, stored specifier, resolved registry package
  identity for aliases, and target version. Only standard dependency fields using direct `semver`
  or `npm:` alias protocols can become manager-ready; unsupported roles/protocols remain valid file
  operations but block the requested manager phase before apply.
- Process execution uses a pinned executable identity, sanitized environment, bounded output,
  timeout/escalation, private run marker, process-group termination, and before/after same-user
  PID/start/process-group observations on Linux/macOS. Missing baseline observation prevents spawn;
  surviving or unobservable descendants after spawn are unknown.
- Source/lockfile recovery is physical-identity-bound and re-observed. Manager caches and full
  install trees are explicit non-transactional effects. After any manager command starts, a later
  manager or verification failure remains top-level `unknown` even when planned bytes recover.
- Legacy check-mode `--install`, `--update`, `--execute`, `--verify-command`, and
  `--strict-post-write` are rejected. Practical smoke now covers file-only plan/apply, manager sync
  with exact verification, and legacy rejection instead of exercising the removed second writer.

### Adversarial proof

- RED/GREEN tests cover wrong/missing manager versions, stale/malformed/mismatched lockfiles,
  unsupported fields and protocols, forged self-fingerprinted operations, npm alias identity swaps,
  missing pnpm package/snapshot evidence, Bun descriptor identity, source/lock loss, unexpected
  repository and linked-Git mutations, install-tree symlink escapes, partial recovery, and every
  manager/verification ordering boundary.
- Process tests cover inert hostile argv, unavailable/swapped executables, nonzero exit, signal,
  timeout, output bounds, SIGTERM escalation, ordinary descendants, detached descendants that clear
  environment and change cwd, and concurrent processes attributable to a baseline ancestor.
- Public argv tests reject separated, attached, clustered, inline, proxy, header, cookie,
  passphrase, certificate/key, URI-userinfo, IPv6, Unicode-host, and standalone named credential
  forms while retaining ordinary package protocols, scoped names, and user-agent arguments.
- Real pnpm `10.33.0` probes under isolated HOME/cache/store proved hostile project configuration
  containment, lifecycle suppression, peer/snapshot evidence, and exact npm-alias representation.
  Real npm `11.12.1` produced alias lock evidence with the manifest alias key, real package `name`,
  and exact version; wrong-identity fixtures fail.
- Independent code/security, manager-probe, and documentation reviewers returned `APPROVED` after
  the final protocol, alias, descendant, cache-effect, and credential-serialization corrections.

### Verification

- Isolated exact-Node temporary-HOME/store `pnpm install --frozen-lockfile` passed with pnpm
  `10.33.0` and 210 packages. The first noninteractive attempt stopped before mutation because pnpm
  required `CI=true` to recreate `node_modules` for the isolated store; the fail-fast rerun passed.
- Exact Node `24.15.0` passed `pnpm typecheck`, `pnpm lint`, strict
  `biome check --error-on-warnings .`, `pnpm schemas:check`, and `git diff --check`; Biome checked
  274 files with zero warnings.
- The 10-file, 205-test Plan 020 focused suite passed three consecutive exact-Node runs. The
  dependency/repository regression set passed 36 files and 377 tests. The full suite passed 127
  files and 1,312 tests.
- Exact Node build passed with 36 files and 1,193,974 bytes in `dist`; shipped apply/plan schemas
  were present, `node:sqlite` remained external, and `better-sqlite3` was absent. Practical built-CLI
  smoke passed 25 checks and 51 mock-registry requests.
- Built CLI version/help and built library plan/apply/schema assertions passed. Package dry-run
  reported `depfresh@1.2.0`, 39 files, 194,582 packed bytes, and 1,211,022 unpacked bytes. An actual
  tarball installed into an isolated exact-Node consumer; root/schema imports and CLI version/help
  passed, with no source, test, plan, or draft files packed.
- A temporary-HOME exact-Node cache probe made one cold registry request and zero warm requests; the
  SQLite cache remained 16,384 bytes. Read-only built `inspect` left index/status/diff/staged hashes
  unchanged: `c2eb02a17b60e9e04830bc72e02f85fd3ad90e8dca6c9cac88e74d9f5a1dd10c`,
  `a2f81466c154969c48113964869be00f0be2857412fcbd2c0fa4260cd06146c5`,
  `822eb73be084408cd5b3133b68a043ccd53e9f24ce5b0919b4809149f2f8e046`, and the empty staged hash
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

### Remaining limitations

- Manager caches cannot be rolled back; full install trees are also non-transactional. Recovery is
  best effort across multiple files and never presented as repository-wide atomicity.
- Same-user process census is intentionally conservative. An unrelated new process group can make
  a phase unknown. Windows manager execution remains unsupported; no Linux host replay was
  available in this run.
- Yarn, legacy `bun.lockb`, nonstandard occurrence roles, and protocols other than direct `semver`
  and `npm:` aliases remain manager-phase unsupported. No live Bun, npm 10, pnpm 11, or Bun 1.x host
  replay was available; their adapters and exact lock representations are covered by fixtures and
  adversarial contract tests.
- The sanitized environment excludes arbitrary proxy and credential variables. Private registries
  must use manager-readable configuration; no package-trust claim is made by synchronization.
