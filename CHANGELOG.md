# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Semver because I'm not a psychopath.

## Unreleased

### Added

- **First-class exact workspace and catalog exclusions** -- normal check/write and machine plan now
  accept repeatable literal `--exclude-workspace` and `--exclude-catalog` flags. Every request binds
  to deterministic repository entities before registry/cache/interactive/operation/write work,
  compiles as final action-only CLI policy, and emits a derived receipt. Workspace exclusion never
  freezes shared catalog owners; catalog exclusion targets all proven same-name physical owners and
  only their linked consumers. Current plan/capabilities output uses strict schema v2, while v1
  schema bytes and reviewed-plan apply compatibility remain unchanged.

## [2.0.0] - 2026-07-17

### Added

- **Official schema-backed automation workflow** -- `depfresh capabilities --json` now emits a
  deterministic `depfresh.capabilities` v1 document generated from the shipped command, schema,
  selector, signal, manager, and apply-phase registries. The package includes its capabilities
  schema, a concise public-API-only operational skill, pinned-runner and manager/CI recipes, and
  sanitized audit, catalog-policy, stale-plan, trust-review, and protected-apply examples. The
  composite Action preserves legacy check behavior while adding fixed-input capabilities,
  inspect, plan, and exact reviewed apply commands with contained plan-file validation and explicit
  sync/install/artifact grants. The historical broad agent design is demoted to a pointer; no
  workflow infers Git, PR, publishing, or deployment authority.

- **Exact-artifact npm trust verification** -- install plans may fingerprint npm 11.12.x public
  registry artifacts by physical package/version/SHA-512 identity and per-boundary verifier intent.
  Apply rebinds every target to the final npm lockfile and contained installed location, runs fixed
  lifecycle-disabled `npm audit signatures` in an isolated temporary home/cache/config under
  explicit artifact/network authority, and records independent signature and provenance states,
  verifier identity/version, evidence time, and traceable rule effects without raw output or
  credentials. Signature presence is never promoted to pass; exact invalid/missing evidence fails,
  while provenance passes only for one exact SLSA v1 DSSE subject/digest match. Offline, stale,
  unavailable, malformed, and binding failures remain unknown. Unsupported managers, registries,
  npm versions, and missing integrity block planning. Default findings warn; only a fingerprinted
  matching rule blocks and enters observed recovery.

- **Deterministic compatibility and passive-evidence signals** -- every new immutable plan carries
  fingerprinted repository-runtime, exact-owner proposed peer-constraint graph, explicit/inferred cohort,
  release-channel, fixed-clock maturity, current/target deprecation, completeness, staleness, and
  signature/provenance-presence results. Evidence state remains `pass`, `warn`, `fail`, `unknown`,
  or `not-applicable`; ordered rules change only `none`/`warn`/`block` policy effects and retain
  override provenance. Explicit divergent cohorts block without retargeting, inferred shared
  repository families remain non-mutating suggestions, and process runtime/wall-clock state never
  enters plan truth. Physical catalogs and peer declarations project into the proposed graph;
  ambiguous overrides, cross-workspace/hoist topology, malformed fields, and unavailable evidence
  remain unknown. Passive presence never claims artifact verification.

- **Observed global apply state machine** -- strict `depfresh.global-plan` and
  `depfresh.global-apply` schema-v1 contracts retain stable manager/package/version occurrence
  identity, executable and global-realm evidence, fixed no-shell argv, and explicit npm 10/11,
  pnpm 10/11, and Bun `>=1.2.0 <2.0.0` support. Apply requires separate global-write, process, and
  exact manager authority; preflights every requested manager before the first command; forbids
  downgrades; rechecks before each command; and derives applied truth only from post-command
  inventory. Per-item applied, skipped, conflicted, failed, and unknown outcomes reconcile into
  honest applied/noop/partial/conflicted/failed/unknown run states with
  `rollback: "not-supported"`. Legacy `--global[-all] --write` now routes through this engine and
  JSON output exposes the versioned `globalResults`.

- **Reviewed lockfile synchronization and verification phases** -- immutable plans can fingerprint
  supported npm 10/11, pnpm 10/11, or Bun `>=1.2.0 <2.0.0` manager/version evidence, one selected
  parsed lockfile per affected boundary, fixed lifecycle-disabled argv, permitted paths, timeout,
  and one optional exact verification argv. Apply requires matching process, lockfile-write, install, and
  verification grants that configuration cannot supply. Commands run without a shell inside the
  stale-safe lock/journal lifecycle; final lockfiles must change, parse, and match affected manifest
  specifiers plus resolved target versions. Only registry-backed `semver` and `npm:` alias
  occurrence protocols can request manager execution; unsupported protocols block before apply.
  Pnpm output-path configuration is pinned to contained values, and detached descendants are
  observed with marker plus same-user PID/start/process-group evidence on Linux/macOS before
  success. Alias proof binds the manifest key, registry package identity, specifier, and version.
  Results
  record termination, final lockfile hash/parse/occurrence evidence, repository and linked Git
  metadata mutations, recovery paths, and non-transactional install/cache effects. Legacy
  shell-string post-write flags are rejected instead of retaining a second writer.

- **Stale-safe file apply contract** -- `depfresh apply --json --write --plan-file <path>` and the
  public `apply()` API validate a strict immutable plan, explicit invocation authority, contained
  unique physical targets, exact source hashes and occurrence values, and fresh target Git state.
  All changed target files render beside their sources, preserve formatting and mode, and reparse before an
  all-target precommit recheck. Atomic per-file renames retain byte-exact backups under a versioned
  root-local lock and relative-path journal. Commit failures trigger observed best-effort recovery;
  schema-v1 results reconcile `applied`, `skipped`, `conflicted`, `reverted`, `failed`, and `unknown`
  outcomes without claiming repository-wide atomicity. The apply schema ships at
  `depfresh/schemas/apply-v1.json`.

- **Versioned inspect and plan contracts** -- `depfresh inspect --json` and the public `inspect()`
  API emit deterministic process-free repository evidence, while `depfresh plan --json` and
  `plan()` add registry candidate resolution without filesystem writes or persistent cache access.
  Inspect, plan, and fatal command-error JSON Schemas ship at stable package subpaths. Repository
  fingerprints cover canonical root identity plus sorted exact-byte source hashes; plan
  fingerprints cover the complete semantic plan. Every inspected occurrence receives one terminal
  operation, unchanged, skipped, blocked, unknown, or error decision with a policy trace and, when
  registry resolution runs, a candidate trace. Exact operations retain relative file, nested path,
  source hash, expected value, and requested stored value. Credential-bearing occurrences block
  instead of leaking or weakening their preconditions. Inspect projections retain resolvable
  source, package, catalog, boundary,
  relationship, runtime, evidence-value, and evidence-source entities. Runtime validators enforce
  fingerprints, references, summaries, one-decision-per-occurrence, and exact operation links in
  addition to JSON Schema shape.

- **Occurrence-level ordered policy rules** -- JSON-compatible `policyRules` select exact repository
  occurrences by dependency, workspace path, package, catalog, catalog role, dependency field,
  occurrence role, package manager, protocol, current channel, and specifier status. Action and mode
  use independent last-match-wins decisions with stable provenance, all matched rule IDs, separate
  winning rule IDs, and explicit selected, skipped, blocked, and unchanged states. Catalog owners
  and consumers are evaluated independently, direct declarations do not inherit catalog rules, and
  unknown manager evidence blocks only an otherwise matching manager-specific rule. Public pure
  compiler, context, matcher, repository evaluator, and finalizer APIs expose the same behavior used
  by checks.

- **Versioned repository model** -- the public read-only `inspectRepository()` API emits stable
  repository-relative source, manifest, catalog, occurrence, relationship, diagnostic, and
  evidence-reference entities under schema version `1`. Exact source bytes are SHA-256 hashed,
  repeated names remain separate by owner and nested path, catalog owners and consumers are linked
  explicitly, and ambiguous or out-of-root states become deterministic diagnostics. Normal check
  discovery now consumes the model's compatibility projection instead of maintaining a second
  package-discovery path.
- **Repository evidence conclusions** -- schema version `1` now additively emits effective and
  nested boundaries, boundary-owned package-manager and lockfile conclusions, exact lockfile byte
  hashes and parse states, repository-declared Node constraints, and read-only Git target states.
  Ambiguous, missing, unsupported, and unavailable evidence remains explicit; inspection never
  runs package managers or lifecycle scripts, evaluates compatibility, synchronizes lockfiles, or
  mutates Git state. Bun JSONC lockfiles, unreadable evidence, ignored targets, rename endpoints,
  nested Git repositories, hostile Git environment variables, and per-boundary shallow state are
  handled without guessing or invoking repository helpers. Partial directory and nested Git probe
  failures preserve known evidence without reporting unknown state as confirmed, and workspace
  conclusions never expose unrelated pnpm catalog or Yarn configuration values.

### Security

- **Policy input is data, never authority** -- policy rules reject unknown or authority-shaped
  fields, non-JSON values, duplicate or reserved IDs, invalid patterns and enums, and invalid
  action/mode combinations. Configuration can select occurrences and modes but cannot authorize
  writes, commands, installs, global mutation, or verification. Ambiguous, missing, unsupported,
  and unavailable manager evidence is retained rather than guessed.

- **Machine contracts withhold non-public repository data** -- inspect and plan results reject
  absolute or credential-bearing identity paths, redact non-public occurrence/evidence/lockfile
  text with material risks, reject proxy-backed canonical input before traps run, and emit stable
  fatal reasons without paths, secrets, causes, or stacks.

- **Repository discovery is contained to one canonical root** -- workspace patterns containing
  parent traversal or absolute paths are rejected before globbing, and package, workspace-marker,
  lockfile, and catalog symlinks must resolve inside the selected repository. In-root symlinks are
  canonicalised and deduplicated; cross-format catalog aliases that claim one physical file as
  multiple manager formats are blocked as ambiguous, and external candidates are reported without
  parsing their contents. Write runs cannot mutate nested repository roots or descendants unless
  that repository is targeted by a separate invocation.

- **Invocation authority is separate from configuration** -- config files can no longer grant
  write, install, update, command execution, verification-command, or global-write authority.
  Unknown and malformed CLI input now fails before discovery or side effects with stable reason
  codes. Human failure rendering and complete JSON envelopes centrally redact credentials,
  authorization values, sensitive URLs, environment assignments, nested causes, and observed
  write-outcome values.

- **The GitHub Action now treats every input as data** -- the Action validates exact booleans,
  commands, modes, Node versions, workspace-contained directories, phase relationships, and
  contained regular plan files before installation or writes. The shell-split `extra-args` escape
  hatch remains absent; machine inspect cannot receive authority, plan cannot receive write
  authority, and apply requires both explicit write authority and the exact reviewed plan.
  Include and exclude patterns remain single inert arguments even when they contain spaces,
  quotes, newlines, option-looking text, or shell syntax. Fatal install, runtime, contract/exit,
  and JSON errors return stable annotations without replaying raw output, and temporary diagnostic
  files are cleaned on every path.

### Changed

- **Immediate large-repository progress** -- recursive checks now inventory only files that can
  contribute repository evidence instead of retaining and glob-testing every repository file.
  Unavailable-directory, containment, boundary, lockfile, runtime, and Git evidence remains
  conservative. Interactive output starts with discovery and repository-inspection phases,
  coalesces registry ticks, distinguishes declared, eligible, pinned, and other skipped
  declarations, suspends cursor ownership around durable tables, and finishes with one compact run
  summary. JSON, redirected output, exit codes, cache behavior, and library results are unchanged.

- **Simpler human-first documentation** -- the README now leads with exact one-off commands,
  everyday check/write usage, safe plan/apply, and a copy-paste Bun native/Expo exclusion policy.
  It makes recursive discovery, physical catalog ownership, machine exit codes, and deliberate
  platform/trust limits explicit without hiding the advanced reference documentation.

- **Deterministic Bun monorepo proof** -- a sanitized WUN-shaped demo exercises a default catalog,
  named `native` catalog, direct native declarations, and local workspace links against a fixed
  registry. It proves native owner/consumer and direct-app exclusions, ordinary catalog updates,
  explicit apply authority, stale-plan conflicts, zero-fetch warm cache reuse, byte-identical
  native files, and unchanged read-only Git state with both the built and packed CLI.

- **Hosted, lower-cost automation** -- CI uses GitHub-hosted Ubuntu workers only, no longer uploads
  coverage to Codecov, and pins every checkout consumer to the reviewed `actions/checkout` v7
  commit. The release workflow retains exact Node, isolated npm, immutable artifact, trusted
  publishing, and post-publication verification gates without claiming undeclared GitHub
  environments.

- **Legacy local writes use the stale-safe file engine** -- normal manifest and catalog `--write`
  calls now block every replacement in that package/apply invocation if any selected occurrence is
  stale, instead of applying a known subset within that invocation. Earlier package invocations are
  not a repository transaction and are not rolled back by a later stale package. The direct
  `writePackage()` library export remains as a deprecated compatibility surface without the apply
  lock/journal contract. Manager, lockfile, install, execute, and verification phases remain
  separate compatibility behavior.

- **Legacy check JSON is an explicit compatibility contract** -- `depfresh --output json` keeps its
  schema-v1 fields, absolute cwd/discovery paths, timestamp, formatting, redaction, and exit
  behavior. Public pure builders expose that envelope separately; it is not an immutable plan and
  is not accepted as one. Machine planning reads only declarative JSON configuration and rejects
  executable JavaScript/TypeScript configuration before evaluation.

- **Legacy selection inputs compile into the ordered policy** -- global mode remains the default;
  `packageMode` retains exact-name priority and first-pattern behavior; legacy `ignore` becomes an
  exclusion; include creates an allow-list; later exclude rules win; and explicit policy rules
  follow compatibility rules within their source layer. CLI include/exclude arrays continue to
  replace configured arrays. Skipped and blocked local occurrences never reach registry resolution,
  selected occurrences use their policy mode. True current/no-match outcomes become unchanged,
  unsupported declarations are skipped, safety-filtered candidates are blocked, and incomplete or
  inconsistent candidate evidence remains unknown. Every result retains the exact candidate
  reason. Global manager/package occurrences now evaluate independently from their own observed
  version and confirmed manager; grouped presentation never replaces physical policy identity.

- **Writes now report observed physical outcomes** -- manifest, YAML, catalog, nested override,
  package-manager, and global writes use canonical file-plus-path identities, require the exact
  pre-write value, and re-read the physical source before reporting `applied`. JSON and human
  summaries are derived from itemized `applied`, `skipped`, `conflicted`, `reverted`, `failed`, and
  `unknown` records. Repeated package names remain separate across fields, catalog owners, files,
  and global managers; global updates are guarded individually against downgrades and partial
  failure is reported without transactional claims.

- **Resolution now selects from one authoritative eligible set** -- direct dependencies, catalogs,
  overrides, and global occurrences share normalization, prerelease-channel, mode, deprecation,
  cooldown, and downgrade checks. Every exact semver spelling, including equals-prefixed and
  prerelease pins, requires `--include-locked` for manifest updates, while globally observed exact
  versions still resolve in default mode. Global-all retains each manager's installed version for
  candidate selection and downgrade checks; missing or malformed publish times remain unknown while
  cooldown is active instead of being treated as safe.

- **Registry signature data is described as presence, not proof** -- current output and public
  types report `present`, `absent`, or `unknown` signature metadata without claiming verification or
  trust. Provenance presence remains independent and unknown when the registry contract supplies no
  authoritative field. Legacy provenance labels remain deprecated compatibility input and are not
  converted into signature evidence.

- **The registry cache now uses Node's built-in SQLite** -- `node:sqlite` replaces the native `better-sqlite3` dependency while preserving the existing WAL-backed cache and memory fallback. depfresh no longer needs a native cache build or a matching Node ABI. The minimum supported runtime is now Node 24.15.0, the first Node 24 release where `node:sqlite` is a release candidate and imports without an experimental warning.
- **The GitHub Action is revision-coupled and self-contained** -- each Action revision reads the
  exact depfresh version from its reviewed `package.json`, installs that exact npm release, and
  verifies the installed CLI version before use. The default runtime is exactly Node 24.15.0,
  output parsing uses Node instead of assuming `jq`, and cleanup runs even when an earlier step
  fails.

### Fixed

- **Portable isolated npm bootstrap in the release workflow** -- exact-Node verification checks
  the Node 24.15.0 executable directly instead of requiring the setup-node `npm` symlink to resolve
  beside it. The previous directory-identity guard stopped the first tag workflow before npm
  installation; publish and hosted-release jobs were skipped.
- **Release smoke fixtures contain parent npm configuration** -- practical CLI smoke subprocesses
  now remove both lowercase `npm_config_*` and uppercase `NPM_CONFIG_*` variables before loading
  their fixture-local registry. The release workflow's isolated npm configuration can no longer
  redirect deterministic smoke requests to the public registry.
- **Release tarball consumers are workspace-absolute** -- the release workflow installs and
  publishes the verified tarball through absolute `file:` specifiers. Neither a separate temporary
  install prefix nor npm publish can reinterpret the repository-relative artifact path as a GitHub
  shorthand.
- **Large machine JSON is fully drained** -- inspect, plan, apply, capabilities, and compatibility
  JSON no longer call immediate normal-path process exits that could truncate piped output at 64
  KiB. A backpressure subprocess regression proves a schema-valid inspect document larger than the
  pipe buffer reaches the reader intact.
- **CLI ignore additions retain containment defaults** -- `--ignore-paths` continues to replace
  project-specific configured paths, but now always retains the built-in `node_modules`, `dist`,
  `coverage`, and `.git` exclusions with stable deduplication.
- **Contained terminal rendering** -- manifest and registry text is stripped of terminal control,
  OSC/CSI, zero-width, and bidirectional-control payloads before table, error, interactive, and
  detail rendering. Narrow progress and package-title rows stay within the reported terminal width,
  while selections still return the original dependency records.
- **Portable exact-Node CI evidence** -- permission-sensitive repository tests run on an
  unprivileged hosted Linux worker, and the bounded 128 KiB verifier fixture is created inside the
  child so Linux's single-argument limit cannot prevent startup.
- **npm 12 dry-run compatibility** -- package verification accepts npm 12's current pack manifest
  representation while preserving exact file, size, integrity, export, schema, and installed
  artifact checks.
- **Tracked implementation progress** -- numbered plans are versioned again and the plan ledger
  reflects the completed implementation instead of presenting Plans 020-024 as future work.
- **Rejected registry candidates cannot return through a fallback** -- deprecated, too-recent,
  unknown-age, wrong-channel, missing-tag, and downgrade candidates remain rejected after mode
  selection. A present valid `next` tag never falls back after rejection, named and numeric
  prerelease channels cannot cross, stable reason codes record why selection stopped, and malformed
  current specs are skipped when a safe comparison cannot be proven.
- **Prerelease and JSR version truth is preserved** -- prerelease increments and same-core stable
  transitions classify as patch changes, JSR uses its explicit `latest` field rather than object
  order, and JSR publish times and yanked versions feed the same candidate safety checks as npm.

## [1.2.0] - 2026-07-10

The "stop rewriting things you don't understand" release. Three security holes closed -- one of which let a registry hand depfresh a string that ended up in a shell -- plus depfresh finally admits that `>=1.2.0` is not a version it knows how to update, and stops flattening it into a pin. Interactive runs got the concurrency the piped ones have had since 1.1.0, which means the progress bar is no longer the slowest way to use this tool. No API breaks.

### Security

- **Global package updates no longer run through a shell** -- `depfresh -gw` used to build `npm install -g ${name}@${version}` as a string and hand it to `execSync`. It now calls `execFileSync` with an argument array for npm, pnpm, and bun, and validates the package name and target version before doing even that. A registry serving a crafted dist-tag can no longer smuggle a command past your shell.
- **Dist-tag values are semver-validated before becoming update targets** -- `latest` and `next` now have to parse as real semver versions to be used at all. Previously depfresh used whatever string the registry handed it, which is a lot of trust to place in a stranger.
- **Vulnerable dependencies bumped past their advisories** -- `undici` 7.24.6 -> 7.28.0 (TLS certificate-validation bypass, GHSA-vmh5-mc38-953g; cross-origin request routing, GHSA-hm92-r4w5-c3mj), `defu` 6.1.4 -> 6.1.7 (prototype pollution via `__proto__`, GHSA-737v-mqg7-c878), and `picomatch` 4.0.3 -> 4.0.5 (ReDoS, GHSA-c2c7-rcm5-vvqj). undici carries your `.npmrc` auth tokens on every registry request and defu merges your config files, so none of this was academic. Declared floors were raised for `undici`, `defu`, and `tinyglobby` -- picomatch arrives via tinyglobby, so that's where its floor had to go -- meaning a fresh install can't quietly resolve back down into a vulnerable version.
- **The published GitHub Action passes its inputs via `env:`** -- instead of interpolating `${{ inputs.* }}` directly into a shell script, which is the Actions script-injection classic. `mode` is now validated against the known enum before anything else runs.
- **Every workflow action is pinned to a commit SHA** -- tags move. Commits don't.

### Fixed

- **Complex version ranges are no longer rewritten to bare pins** -- comparator, compound, OR, hyphen, and wildcard ranges now stay untouched when depfresh cannot preserve their semantics faithfully. Preservable x-ranges still update in place while keeping their shape, so `1.x` can become `2.x` and `1.2.x` can become `1.9.x` instead of collapsing to exact pins.
- **`--profile` reports real numbers on interactive runs** -- `networkFetches` and `dedupeHits` were always `0` in a terminal, because the interactive path resolved packages without the shared context that counts them. Two metrics that are silently zero are worse than two metrics you don't have: they're reassuring.

### Changed

- **Interactive runs now resolve packages concurrently** -- all packages fan out through one shared limiter, with in-flight registry fetches deduplicated across workspace packages. That's the same path piped and JSON output have used since 1.1.0; the progress-bar path had been resolving one package at a time this whole while. Watching a progress bar used to cost you the thing it was measuring.

### Internal

- **Test suite no longer assumes a specific Node version** -- better-sqlite3's native-module tests skip cleanly when the compiled binary doesn't match the running Node, and CLI stderr assertions filter out `DeprecationWarning`/`ExperimentalWarning` noise instead of failing on it. The smoke test now reads the expected version from `package.json` instead of hardcoding one, which is why nobody had to remember to update it today.
- **Characterization tests for both `run-check` resolution paths** -- written before the two paths were unified, so the unification had something to be measured against rather than vibes.

## [1.1.2] - 2026-03-31

### Fixed

- **Dist-tag versions no longer cause false resolution errors** -- dependencies using dist-tags as their version (e.g., `npm:@fumadocs/base-ui@latest`, `next`, `canary`) are now correctly skipped instead of failing with "Failed to resolve from registry". Dist-tags resolve dynamically at install time, so there is nothing to update.
- **`packageManager` write no longer crashes with `Cannot use 'in' operator`** -- the `packageManager` field is a string (e.g., `bun@1.3.10`), not an object. The write loop now guards against non-object source fields instead of blindly using the `in` operator on them.

## [1.1.0] - 2026-03-29

The "stop lying about where you are and what just failed" release. depfresh now understands project roots instead of blindly trusting the current directory, keeps nested workspace roots visible instead of pretending they don't exist, and stops reporting a clean run when every dependency resolution just exploded. First slice only.

### Added

- **Project root auto-detection** — when you run depfresh from a child directory, it now resolves the effective project root instead of treating `cwd` as gospel. The runtime tracks both the input cwd and the derived root so discovery and config loading finally agree on where the project actually is.
- **Root-detection test coverage** — dedicated regression tests for child-directory runs, parent-folder project discovery, nested workspace roots, and false-green resolution failures. The sort of tests you add after getting annoyed enough times.
- **`--fail-on-resolution-errors`** — strict mode for CI and automation. If any dependency fails to resolve from the registry, depfresh now exits `2` instead of quietly carrying on like nothing happened.
- **`--explain-discovery`** — discovery diagnostics on demand. depfresh can now tell you which root it picked, which manifests it matched, which ones it skipped, and which catalogs it loaded. Finally, a flag for people tired of reading source just to answer "why didn't it see my package?".
- **`--fail-on-no-packages`** — strict mode for the other embarrassing CI case: wrong cwd, empty folder, or overly aggressive filters. depfresh can now fail loudly instead of smiling and pretending an empty scan was success.
- **Workspace-aware manifest discovery** — when the effective root declares workspace package patterns, depfresh now uses those patterns to enumerate manifests before falling back to blind recursive globbing. Translation: fewer accidental `examples/` and `fixtures/` packages showing up just because they happened to exist under the repo root.
- **`--strict-post-write`** — opt-in strict mode for post-write automation. If `--execute`, `--install`, or `--update` fails, depfresh can now return exit code `2` instead of treating that failure as a warning bolted onto an otherwise green run.
- **`--profile`** — runtime diagnostics on demand. depfresh can now emit timing, cache, network-fetch, dedupe, and package/dependency count metrics instead of forcing you to benchmark the thing by hand every time it feels weird.
- **Root-aware package-manager detection** — install/update package-manager detection now works from nested child directories too, by checking the nearest ancestor manifest and lockfiles instead of pretending the current working directory is the whole world.

### Changed

- **Nested workspace filtering semantics** — nested workspace and nested repo roots are now preserved while their descendants remain filtered by default. Previously depfresh could walk a parent folder full of real projects and conclude that absolutely nothing existed. Deeply philosophical. Also wrong.
- **JSON execution metadata** — JSON output now includes `meta.effectiveRoot`, `meta.hadResolutionErrors`, and `summary.failedResolutions`. Machine consumers can now distinguish "clean", "updates available", and "resolution went sideways" without reading tea leaves.
- **Discovery diagnostics in JSON** — when `--explain-discovery` is enabled, JSON output now includes a `discovery` block with input cwd, effective root, discovery mode, matched manifests, skipped manifests, loaded packages, and loaded catalogs.
- **Profile diagnostics in JSON** — when `--profile` is enabled, JSON output now includes a `profile` block with timings, cache stats, network fetch counts, dedupe hits, scanned package/dependency counts, and failed resolution counts.
- **Bun catalog lookup parity** — Bun catalog detection and loading now walk upward from nested working directories like pnpm and Yarn instead of pretending the catalog only exists when you stand in exactly the right folder.
- **Resolver scheduling** — in non-progress runs, dependency resolution now fans out across packages through a shared limiter, while rendering and writing stay ordered. Faster where it matters, predictable where it counts.
- **`.npmrc` parsing** — `${VAR}` references in parsed `.npmrc` string values are now expanded before registry and auth handling. Private-registry setups finally stop carrying literal `${NPM_TOKEN}` strings around like decorative syntax.
- **Registry auth matching** — auth entries from `.npmrc` now match registries by exact host + path instead of loose hostname substring checks. If your registry lives at `/internal/`, the auth must target `/internal/` too. Sensible, finally.
- **Structured discovery classification** — nested manifests are now classified instead of reduced to a dumb boolean. Discovery diagnostics can distinguish nested roots from nested descendants and show the marker that caused the decision.
- **Catalog/write module decoupling** — the Bun catalog loader no longer reaches through the write barrel just to get line-ending detection. Less fragile coupling, fewer chances to trip an import cycle in sidecar code paths.
- **Workspace protocol semantics** — explicit-version workspace refs like `workspace:^1.2.3`, `workspace:~1.2.3`, and `workspace:1.2.3` are now checked against the registry even when the package also exists locally in the workspace. Prefix-only forms like `workspace:^` and `workspace:*` stay local-only and are skipped on purpose.
- **`packageManager` as a first-class source** — the parser now emits `packageManager` as a real updatable source instead of just exposing it in types/docs and hoping nobody noticed the gap. That means `pnpm@9.x`, `npm@10.x`, `bun@1.x`, and `yarn@x` can now flow through check output and writes like the rest of the system.
- **Cache identity** — registry cache lookups now use composite keys (`protocol + registry + package`) instead of plain package names. Public npm and private registry packages no longer share cache rows just because they happen to be called the same thing.

### Fixed

- **False-green resolution failures** — depfresh no longer reports `All dependencies are up to date` when dependencies failed to resolve. Table output surfaces the failure state, and JSON output marks the run accordingly instead of pretending the absence of updates means success.
- **Child-directory discovery misses** — running depfresh from paths like `packages/app/src` now resolves against the actual project root instead of returning `noPackagesFound` because you had the audacity to be one folder too deep.
- **Parent-folder nested workspace misses** — scanning a parent directory that only contains nested monorepos or nested git repos now keeps those roots visible instead of filtering the entire tree into oblivion.
- **Duplicate cold-cache fetches** — repeated concurrent resolutions for the same dependency now collapse behind one in-flight registry request instead of stampeding the registry for identical data.
- **Multi-package non-TTY throughput** — JSON and other non-progress runs no longer serialize every package's registry work one package at a time. Monorepos with many small packages finally get to use the concurrency flag they were promised.
- **Basic auth from `.npmrc`** — `_auth` and `username` + `_password` now produce real `Basic` authorization headers instead of being documented fantasies.
- **Workspace protocol writes** — when an explicit-version `workspace:` dependency is updated with `--write`, depfresh now preserves the `workspace:` prefix instead of rewriting it into a plain semver range.
- **`packageManager` no longer missing from runtime checks** — the field was already writable and already documented in JSON output, but parse-time support was missing. It's now actually implemented, which is the sort of detail users tend to notice eventually.
- **Legacy cache row invalidation** — old cache entries keyed only by package name are now dropped on startup instead of hanging around forever as stale ghosts after the key-format change.

## [1.0.0] - 2026-02-23

The "it's either 1.0 or therapy" release. Full taze backlog audit done, every claim backed by code and tests, 624 tests passing, docs rewritten by someone who's read them. If you've been waiting for the "stable enough to bet on" signal -- this is it. We stopped adding features and started proving the ones we have actually work.

### Added

- **GitHub dependency support** — `github:owner/repo#tag` dependencies resolve against GitHub tags, flow through check/write like first-class citizens, and preserve your `refs/tags/` and `v` prefix style on rewrite. Because someone had to finish what taze started.
- **Coverage matrix** — every open taze issue and PR tracked with `shipped` / `partial` / `missing` status and evidence links. Receipts, not promises. See `docs/compare/coverage-matrix.md`.

### Changed

- **Peer catalog semantics** — `peers` catalogs in pnpm workspaces are now skipped by default. Pass `--peer` to include them. Previously they'd sneak in uninvited, like a dependency you didn't ask for at a party you didn't want to attend.
- **Protocol parsing** — npm/jsr/github alias metadata now flows consistently through the entire pipeline, including overrides. The kind of fix you don't notice until the day it would've ruined your afternoon.
- **Documentation overhaul** — Bun catalog docs corrected, taze comparisons consolidated into `docs/compare/`, README trimmed to something a human might actually read, and every doc page reviewed for accuracy and tone.

### Fixed

- **GitHub API rate limits** — explicit detection with reset-time hints and token guidance (`GITHUB_TOKEN`/`GH_TOKEN`) instead of cryptic retry failures that teach you nothing.
- **GitHub ref writes** — protocol-preserving rewrites keep `refs/tags/` prefixes and `v` conventions intact. Your `github:` deps come back looking the same way they went in.

### Breaking

- Nothing. `1.0.0` marks stability, not a contract reset. Your `0.11.x` configs, flags, and workflows carry over unchanged.

### Migration Notes

- If you use `github:` dependencies and hit API rate limits, set `GITHUB_TOKEN` or `GH_TOKEN`.
- If you keep peer-only versions in workspace catalogs, pass `--peer` to include them in checks and writes.

## [0.11.1] - 2026-02-23

The "your help command wasn't helping" patch. `bunx depfresh help` blew up with a mode validation error because `help` leaked through as a positional arg. The raw-args normalization works fine in node, works fine in bun direct — but `bunx` had other plans. Belt-and-suspenders fix: if `help` survives past normalization and lands as `mode_arg`, the run handler catches it and shows usage instead of screaming about invalid enums. Two layers of defence because trusting one code path is how you got here.

### Fixed

- **`bunx depfresh help` crash** — `help` as positional arg now caught in the run handler as a fallback when raw-args normalization is bypassed. Shows usage and exits cleanly instead of throwing `Invalid value for --mode: "help"`.

## [0.11.0] - 2026-02-23

The "close every gap or shut up" release. Ran a full codebase audit against taze, found 5 gaps, closed all 5 in one pass. Verified with real code inspection, runtime test runs, and CLI smoke checks on actual repos. Not vibes. Not a roadmap. Shipped code with 598 passing tests.

### Added

- **Addon/plugin system** -- first-class `addons` with deterministic lifecycle ordering, async hooks, and per-package write veto. Failures surface as `AddonError` (`ERR_ADDON`) with addon name + hook metadata. Debugging no longer requires telepathy.
- **`package.yaml` support** -- full pipeline: discovery, resolve, write. Both `package.json` and `package.yaml` load, with deterministic same-directory precedence (YAML wins). Overrides, `pnpm.overrides`, `packageManager`, protocol-preserving rewrites, CRLF/trailing-newline preservation -- all work. Workspace-boundary parity included.
- **`--global-all`** -- scans npm + pnpm + bun global packages in one run. Dedupes by package name, maps write targets back to every matching manager. `--global` still works for single-manager mode.
- **`--ignore-paths`** -- exclude directories from package discovery. The flag taze had that we didn't. Now we do.
- **`--refresh-cache` / `--no-cache`** -- explicit cache bypass without overloading `--force` semantics. Fresh registry metadata, no guessing.

### Fixed

- **`.npmrc` transport fidelity** -- registry requests now actually use `proxy`, `https-proxy`, `strict-ssl`, and `cafile` via `undici` transport. Previously parsed, politely ignored. HTTPS prefers `https-proxy`, HTTP prefers `proxy`, CA bundles loaded once and reused.
- **Non-transient transport failures fail fast** -- broken `cafile` paths no longer waste retry attempts. `ResolveError` immediately. You're welcome.
- **JSON output cleaned** -- `--output json` forces silent logging. No ANSI cursor restore leaking into stdout in non-TTY. Machine-parseable means machine-parseable.

### Changed

- **Docs parity** -- all new flags documented in README, CLI reference, and configuration docs. No "added the flag, forgot the docs" energy.

### Stats

- 60 new tests (538 -> 598). 77 test files. Build, typecheck, lint clean. Verified against taze v19.9.2 (55 tests, 13 test files). The numbers speak.

## [0.10.1] - 2026-02-23

The "your age column was a decoration" patch. Turns out npm's abbreviated metadata endpoint doesn't return the `time` field, so the age column was rendering headers with no data like a restaurant menu with no prices. Switched to full metadata. The cache means you pay the bandwidth once per TTL, cry about it never.

### Added

- **`depfresh help` command alias** -- `help` is now normalized to `--help`, so `depfresh help` prints the same full usage and flag list as `depfresh -h` / `depfresh --help` instead of failing enum validation as an invalid mode.

### Fixed

- **Empty age column** -- registry fetcher was using abbreviated metadata (`application/vnd.npm.install-v1+json`) which doesn't include per-version publish timestamps. Switched to full metadata (`application/json`). The `time` field now actually exists in responses, so `publishedAt`, `currentVersionTime`, and the age column work as intended. The SQLite cache absorbs the extra payload size.
- **Provenance detection for full metadata** -- abbreviated metadata uses `hasSignatures` on version objects, full metadata uses `dist.signatures[]`. Now checks both formats so provenance tracking works regardless of registry response shape.

### Stats

- 538 tests passing. Build, typecheck, lint clean.

## [0.10.0] - 2026-02-23

The "contracts are contracts, not vibes" release. Tightened CLI behavior so invalid inputs fail fast, made machine output explicit enough for automation that doesn't enjoy guesswork, and stopped pretending SARIF existed when it didn't. Then went back and made the whole thing properly agent-friendly because half-measures are for people who commit on Fridays.

### Breaking

- **`--output sarif` removed from runtime contract** -- SARIF was advertised but not implemented. That's trust debt. `OutputFormat` now supports only `table` and `json`, and `--output sarif` is rejected with exit code `2` like any other invalid enum.
- **Invalid enum flags now hard-fail** -- `--mode`, positional mode shorthand (`depfresh <mode>`), `--output`, `--sort`, and `--loglevel` no longer silently fall back. Invalid values now return exit code `2` with a clear error message.

### Added

- **Machine-discoverability endpoint** -- `depfresh --help-json` and `depfresh capabilities --json` now expose a JSON contract with flags, aliases, defaults, enum values, and exit-code semantics. AI agents can discover behavior without scraping prose docs like it's 2009.
- **Versioned JSON envelope metadata** -- `meta.schemaVersion` added (`1`) so downstream automation can lock to a known contract.
- **Explicit execution-state fields in JSON output** -- added:
  - `meta.noPackagesFound`
  - `meta.didWrite`
  - `summary.scannedPackages`
  - `summary.packagesWithUpdates`
  - `summary.plannedUpdates`
  - `summary.appliedUpdates`
  - `summary.revertedUpdates`
  This removes ambiguity between "no packages", "up to date", and "planned updates reverted by verify-command".
- **Non-TTY stderr breadcrumb** -- when stdout isn't a TTY and output is `table`, depfresh now prints `Tip: Use --output json for structured output. Run --help-json for CLI capabilities.` to stderr. Agents are stateless. They don't remember your last hint. This fires every time, goes to stderr so it never pollutes piped stdout, and stays silent in JSON mode because that would be insulting.
- **Structured JSON errors** -- when `--output json` is active and something explodes, you now get a proper JSON error envelope instead of a plaintext stderr scream. Includes `error.code`, `error.message`, `error.retryable`, and the usual `meta` block. Works in both the check command catch and the CLI top-level catch. Because an agent parsing `"Fatal error: something"` from stderr is not "machine-readable", it's "machine-suffering".
- **Resolution errors surfaced in JSON envelope** -- deps that fail registry resolution (diff: `error`) were silently filtered out. Now they appear in the `errors[]` array with `name`, `source`, `currentVersion`, and `message`. Your agent can see what broke instead of wondering why a dependency vanished from the output.
- **Enhanced capabilities schema** -- `--help-json` now includes:
  - `version` -- CLI version from package.json, so agents know what they're talking to
  - `workflows` -- 4 pre-built agent recipes: `checkOnly`, `safeUpdate`, `fullUpdate`, `selective`. Copy-paste commands, no guesswork
  - `flagRelationships` -- which flags require or conflict with others (`install` requires `write`, `deps-only` conflicts with `dev-only`). Agents stop generating invalid flag combinations
  - `configFiles` -- every supported config file pattern so agents know where to look
  - `jsonOutputSchema` -- concise field descriptions of the JSON envelope shape. A schema for the schema. We've gone full meta
- **Agent and integration docs** -- added quickstarts for Codex/Claude Code/Gemini CLI (`docs/agents/README.md`) plus GitHub Actions and thin MCP wrapper guidance (`docs/integrations/README.md`).

### Fixed

- **`recursive: false` now actually means root-only** -- discovery now loads only root `package.json` in non-recursive mode and skips workspace catalog loading there. Previously `recursive` was effectively ignored during package file discovery.

### Changed

- **Docs/runtime parity sweep** -- CLI, configuration, API, troubleshooting, and output docs now match actual runtime behavior (strict enum validation, JSON schema v1 fields, capabilities endpoint, no SARIF claims).
- **package.json keywords** -- added `ai`, `agent`, `machine-readable`, `json`, `automation`. SEO for robots, by robots.

### Stats

- 22 new tests. Total suite now 537 passing tests. Build, typecheck, lint clean.

## [0.9.2] - 2026-02-22

The "fine, it's called depfresh now" release. Final naming cleanup, zero feature work.

### Changed

- **Last rename sweep** -- replaced remaining `bump` references with `depfresh` across docs, CLI/API naming, and config conventions. Same behavior, less identity crisis.

## [0.9.1] - 2026-02-22

The "every file was too long and I have standards" release. Full codebase modularisation. Every production file that crept past 200 LOC got split into focused single-responsibility modules. Every test file over 250 LOC got the same treatment. Docs too, because why stop. Zero behaviour changes, zero new features, zero regressions. Just a codebase that doesn't make you scroll for 30 seconds to find the function you're looking for.

### Changed

- **Codebase modularisation** -- 10 production files split into focused directories with barrel re-exports. `types.ts`, `cli.ts`, `format.ts`, `dependencies.ts`, `resolve.ts`, `write.ts`, `packages.ts`, `check/index.ts`, `render.ts`, and `tui/renderer.ts` all decomposed into single-responsibility modules. No file above 200 LOC. Import paths unchanged because barrel exports exist for a reason.
- **Shared pattern engine** -- deduplicated glob-to-regex logic from `dependencies.ts` and `resolve-mode.ts` into `src/utils/patterns.ts`. One pattern compiler to rule them all.
- **Test suite split** -- 5 oversized test files (largest: 1,522 LOC) broken into 33 focused test files grouped by behaviour. Same 515 tests, just organised like an adult wrote them.
- **Documentation split** -- `api.md`, `cli.md`, `configuration.md`, and `output-formats.md` each split into subdirectories with index pages. For the 3 people who read docs, you're welcome.

### Stats

- 141 source files (up from ~30). 62 test files (up from 29). 515/515 tests passing. Typecheck, lint, build all clean. The codebase grew in files and shrank in complexity. That's the whole point.

## [0.9.0] - 2026-02-22

The "make it pretty and throw proper errors" release. Progress bars so you can watch your dependencies resolve in real time. CJK character width handling so the table doesn't fall apart when someone names their package in kanji. Terminal overflow so narrow terminals get truncated columns instead of broken layouts. And a typed error hierarchy because `catch (e: any)` was getting embarrassing. 19 new tests across 5 new test files. The kind of release that sounds cosmetic until you try using the tool in a 60-column tmux pane.

### Added

- **Multi-bar progress display** -- dual progress bars during dependency resolution. Top bar tracks packages, bottom bar tracks individual deps within the current package plus a running total. Updates in real-time as registry calls complete. Suppressed automatically for `--output json`, `--silent`, and non-TTY environments. Labels truncate on narrow terminals. Clears itself when done, leaving a clean terminal for the results table. Zero new dependencies.
- **CJK / Unicode-aware column alignment** -- `visualLength()` handles double-width CJK characters (Hangul, CJK Unified Ideographs, fullwidth forms), zero-width combining marks, variation selectors, and control characters. Table columns now align correctly regardless of whether your package names contain ASCII, Japanese, Korean, or emoji. The `padEnd` and `padStart` utilities are Unicode-aware. `visualTruncate()` adds `…` at the correct visual boundary without splitting a wide character.
- **Terminal overflow handling** -- table columns shrink to fit your terminal width. Priority order: name column first, then current version, then target version, then source. Minimum widths enforced so nothing collapses entirely. Only activates in TTY mode -- non-TTY output preserves full widths. `render-layout.ts` calculates optimal column widths, `render.ts` applies them. CJK-aware throughout.
- **Error class hierarchy** -- `depfreshError` base class with `code: string` for reliable branching. Five subclasses: `RegistryError` (HTTP failures, includes `.status` and `.url`), `CacheError` (SQLite issues), `ConfigError` (invalid patterns, bad config files), `WriteError` (file system failures), `ResolveError` (network timeouts, DNS failures). All include `.cause` for wrapping lower-level errors. Integrated into registry, config, write, cache, and pattern compilation paths. Exported from the public API for `instanceof` checks.
- **Strict pattern validation** -- `parseDependencies()` now throws `ConfigError` for invalid `include`/`exclude` regex patterns instead of silently skipping them. The public `compilePatterns()` utility retains silent skip behaviour for backwards compatibility. Invalid `/regex/flags` syntax is caught and wrapped with the original error as `cause`.

### Stats

- 19 new tests across 5 new files (496 → 515 total, 24 → 29 test files). Progress bar rendering, terminal overflow truncation, CJK visual width, Unicode-aware padding/truncation, error class hierarchy, strict pattern validation. All passing. All colocated.

## [0.8.0] - 2026-02-22

The "I built a TUI from scratch because Ink ships React" release. The interactive mode got evicted from its `@clack/prompts` flat-list apartment and moved into a custom readline penthouse with vim navigation, per-dependency version drill-down, viewport scrolling, and a keyboard help bar. Also replaced the config loader, wrote a docs site, and rewrote the README. 69 new tests because apparently I have a compulsion.

### Added

- **Custom interactive TUI** -- full readline-based terminal UI replacing the `@clack/prompts` checkbox list. Two views: a grouped list with colour-coded severity, and a detail drill-down showing every available version per dependency. All rendered in-place below the table output. Zero new dependencies. `@clack/prompts` preserved as a non-TTY fallback because not everyone deserves nice things.
- **Per-dependency version drill-down** -- press `→` or `l` on any dependency to see its full version history. Diff type, age, dist-tags, deprecation warnings, Node engine compatibility, provenance level. Pick any version, not just the one I picked for you. Press `←` to go back. Revolutionary UX from 1985.
- **Vim navigation** -- `j`/`k` to move, `g`/`G` to jump to first/last, `space` to toggle, `a` to select all, `h`/`l` for drill-down. Page up/down for the scroll wheel enthusiasts. Because arrow keys are for people who haven't seen the light.
- **Viewport scrolling** -- handles terminal resize, follow-scroll cursor tracking, overflow indicators. Works in terminals smaller than your ambitions. `SIGWINCH` handled because I'm not an animal.
- **`--explain` / `-E` flag** -- human-readable explanations in the version detail view. "Breaking change. Check migration guide." for majors. "Bug fixes only. Safe to update." for patches. Deprecation and provenance warnings appended. For the AI agents and juniors who want to know *why*, not just *what*.
- **Keyboard help bar** -- context-aware help at the bottom of both views. Changes between list and detail mode. Because discoverability isn't a dirty word, it's just usually ignored.
- **State machine architecture** -- pure functional state transitions, modular decomposition (model, list, detail, layout), thin facade pattern. Every state change is a pure function. No side effects. No "it works if you squint". Testable by design. Largest module: 167 LOC.
- **Documentation site** (`docs/`) -- CLI reference, configuration guide, programmatic API docs, output format specs, and a troubleshooting page. Split into five files so you can pretend you'll read more than one.
- **README rewrite** -- features section, proper structure, less rambling. Still sarcastic. Just organised sarcasm now.

### Changed

- **Config loader rewrite** -- replaced `unconfig` (antfu) with a custom loader using `jiti` for TypeScript files and native `import()` for JavaScript. Supports 15 config file patterns including `depfresh.config.ts`, `.depfreshrc.json`, and `package.json#depfresh`. One fewer dependency. Same behaviour. Better error messages when your config file is cursed.

### Stats

- 69 new tests (427 → 496 total, 18 → 24 test files). TUI module fully covered: viewport, detail, state, keymap, renderer, index. Interactive gate tests for TTY and fallback paths. All passing. All colocated. The test-to-line ratio is now genuinely concerning.

## [0.7.0] - 2026-02-22

The "correctness nobody asked for" release. Five features that fix the paper cuts real users actually hit. Windows line endings, nested monorepos, CI exit codes, working directories, and timestamps for your current deps. The kind of stuff that sounds boring until you waste 45 minutes debugging why git shows every line changed in your `package.json`. 22 new tests because I'm not shipping vibes.

### Breaking

- **Exit code 1 is now opt-in** -- `depfresh` no longer returns exit code 1 when outdated deps are found. This surprised every CI pipeline that just wanted to *check* without failing the build. Add `--fail-on-outdated` to get the old behavior. If you're piping exit codes in scripts, update them. If you weren't, congrats, nothing changes.

### Added

- **`--cwd` / `-C` flag** -- run depfresh from any directory. `depfresh --cwd ./packages/foo` checks that package without `cd`-ing around like it's 2004. Scripts and monorepo tooling can now point depfresh at specific paths without changing the working directory.
- **`--fail-on-outdated` flag** -- opt-in exit code 1 when updates are available. For CI pipelines that want to gate on outdated deps. Off by default because "your deps are slightly behind" shouldn't be a build failure.
- **CRLF line ending preservation** -- Windows users no longer get every line flagged as changed in git after depfresh writes. Detects `\r\n` in the original file, preserves it after `JSON.stringify`. Also applied to Bun catalog writes. The fix took 3 lines. The debugging took 3 hours. Classic.
- **`--ignore-other-workspaces`** (on by default) -- stops depfresh from wandering into nested monorepos. If your project contains a git submodule or a separate workspace root, those packages are now skipped automatically. Walks up from each `package.json` looking for `.git`, `pnpm-workspace.yaml`, `.yarnrc.yml`, or `workspaces` in a parent `package.json`. Disable with `--no-ignore-other-workspaces` if you enjoy chaos.
- **`currentVersionTime` in resolve output** -- the publish timestamp of your *currently installed* version, not just the target. JSON output now includes `currentVersionTime` when available. AI agents and scripts can calculate how old your current deps are without a second registry call.
- 42 new tests (385 -> 427 total, 18 test files). CRLF detection, line ending preservation, nested workspace filtering, exit code behavior, cwd config resolution, currentVersionTime population. Plus 20 bug-hunting tests for edge cases: wildcard version coercion, mixed line endings, CRLF without trailing newlines, CRLF with protocol prefixes, deeply nested workspace detection, JSON output envelope coverage, config defaults for new options, bun catalog CRLF writes. Zero bugs found. The code is annoyingly correct.

### Credits

Ideas informed by the taze ecosystem:

- taze issue [#183](https://github.com/antfu/taze/issues/183) -- CRLF line ending preservation on Windows
- taze issue [#56](https://github.com/antfu/taze/issues/56) -- exit code 1 should be opt-in for CI

## [0.6.0] - 2026-02-22

The "run whatever you want after" release. One feature. Clean. Surgical. No scope creep. The antithesis of every sprint planning meeting you've ever attended.

### Fixed

- **Post-write hooks false positives** -- `--execute`, `--install`, and `--update` hooks fired when updates were *detected* but never actually *written*. Three scenarios: `beforePackageWrite` returns `false` for all packages, interactive mode with 0 selections, or `--verify-command` reverts every dep. Hooks now track whether anything was actually written to disk. Exit code logic unchanged -- still reports updates available when they exist, even if you chose not to write them. The kind of bug that only bites you at 2am when you're wondering why your post-update script ran on an untouched codebase.

### Added

- **Execute command** (`--execute` / `-e`) -- runs any shell command once after all packages are written. `depfresh -w --execute "pnpm test"` updates your deps then runs your tests. `depfresh -w --execute "git add -A && git commit -m 'chore: deps'"` for the dangerously automated. Runs before `--install`/`--update` so your custom command operates on freshly written files before lockfile regeneration. If the command fails, depfresh logs it and moves on -- your deps were already updated, the command is a bonus. Different from `--verify-command` which runs per-dep with rollback. This one is fire-and-forget, post-write, no safety net. You asked for it.
- 18 new tests (367 -> 385 total). Guards: skips on no write, no updates, undefined, empty string. Order: runs before install, runs before update. Isolation: execute failure doesn't block install. Scope: runs exactly once across multiple packages. Edge case: fires even when `beforePackageWrite` blocks all writes (consistent with install/update). All passing.

## [0.5.0] - 2026-02-22

The "I trust nothing" release. Four features that let you verify every single dependency update before committing, manage global packages like a real CLI should, and group your interactive selections so you can actually see what you're about to break. 41 new tests because paranoia is a feature, not a bug. 367 total. At this point the tests outnumber the lines they're testing.

### Added

- **Enhanced interactive mode** -- `p.groupMultiselect` replaces the flat list. Dependencies grouped by severity: major (red), minor (yellow), patch (green). Click a group header to select/deselect all. Because scrolling through 47 deps in a flat list is not "interactive", it's "punishment". Falls back to flat multiselect for edge cases.
- **Global package support** (`--global` / `-g`) -- checks npm, pnpm, or bun global packages. Auto-detects your package manager. `depfresh -g` lists outdated globals, `depfresh -gw` updates them. Parses three different output formats because every PM had to be special. Yarn skipped because Berry deprecated global packages and I respect that decision more than they do.
- **Verify command** (`--verify-command` / `-V`) -- runs a command after each individual dep update. Fails? Reverts. Passes? Keeps it. `depfresh -w -V "pnpm test"` updates one dep at a time, runs your tests, and rolls back the ones that break. Bisecting dependency issues manually is for people who enjoy suffering.
- **Update flag** (`--update` / `-u`) -- runs `pm update` instead of `pm install` after writing. Takes precedence over `--install`. For when you want your lockfile to actually reflect what you just changed instead of optimistically hoping `install` figures it out.
- **Backup and restore** -- `backupPackageFiles()` and `restorePackageFiles()` exported from the write module. Captures file contents before mutations, restores on failure. Powers the verify flow but available for API users who enjoy living dangerously.
- 41 new tests (326 -> 367 total, 16 -> 18 test files). Interactive tests mock @clack/prompts. Global tests mock child_process. Verify tests mock the entire write pipeline. All passing. All colocated.

## [0.4.0] - 2026-02-22

The "trust issues" release. Provenance tracking, Node engine compatibility, auto-install, and seven other features I implemented because taze had 28 open issues and 14 unmerged PRs collecting dust. 326 tests now. More tests than some companies have engineers.

### Added

- **Provenance tracking** -- npm Sigstore attestations classified as `trusted`, `attested`, or `none`. If your target version has *less* provenance than your current version, you get a yellow warning. Because downgrading your supply chain security silently is the kind of thing that makes security researchers cry. Credit: sxzz (Kevin Deng, Vue core) for the concept ([taze#198](https://github.com/antfu/taze/pull/198)).
- **Node engine compatibility** (`--nodecompat`) -- extracts `engines.node` from the registry for each target version, checks against your running Node with `semver.satisfies()`. Green checkmark if compatible, red cross if not. On by default because shipping broken code to production is someone else's brand, not mine. Credit: GeoffreyParrier ([taze#165](https://github.com/antfu/taze/pull/165)).
- **Auto-install** (`--install` / `-i`) -- detects your package manager from `packageManager` field or lockfile, runs `${pm} install` after writing. Catches errors gracefully because your install failing shouldn't tank the whole run. `depfresh -wi` is now the entire workflow. You're welcome.
- **Long display mode** (`--long` / `-L`) -- shows homepage URL under each dependency. For when you need to know where that package lives before you trust it with your codebase. Renders as an indented gray `↳ https://...` because I have aesthetic standards.
- **pnpm override key parsing** -- handles `name@version-range` format from `pnpm audit --fix`. If pnpm writes `"tar-fs@>=2.0.0 <2.1.2"` into your overrides, depfresh now parses the package name correctly instead of treating the whole thing as a name. Credit: taze issue [#173](https://github.com/antfu/taze/issues/173).
- **`npm_config_userconfig` support** -- respects the environment variable for custom `.npmrc` location. Enterprise setups with non-standard config paths now work. Credit: taze issue [#118](https://github.com/antfu/taze/issues/118).
- **Extra lifecycle callbacks** -- `afterPackagesLoaded`, `afterPackageEnd`, `afterPackagesEnd`. Three new hooks for the API users who want fine-grained control over the pipeline. `afterPackageEnd` fires for every package, even ones with no updates, because consistency matters.
- 50 new tests (276 -> 326 total, still 16 test files). All passing. All colocated. The test-to-feature ratio is getting suspicious.

### Credits

Ideas and bug reports from the taze ecosystem that informed this release:

- **sxzz** (Kevin Deng, Vue core) -- provenance downgrade warning concept ([taze#198](https://github.com/antfu/taze/pull/198))
- **GeoffreyParrier** -- engines.node compatibility column ([taze#165](https://github.com/antfu/taze/pull/165))
- **runyasak** -- auto-install concept discussion
- taze issues [#173](https://github.com/antfu/taze/issues/173) (override parsing), [#118](https://github.com/antfu/taze/issues/118) (npmrc config), [#48](https://github.com/antfu/taze/issues/48) (auto-install)

## [0.3.0] - 2026-02-22

The "feature parity but better" release. Twelve features, 276 tests, zero excuses. Taze has been building these for 4 years across scattered PRs. Thanks to everyone who contributed.

### Added

- **Version diff colorization** -- only the changed portion lights up red. `1.2.3` -> `1.2.`**`4`**. Taze colors the entire string. I have taste.
- **Time diff display** (`--timediff`) -- shows `~3d` (green), `~2mo` (yellow), `~1.5y` (red) next to each update. Know instantly if that "latest" version was published 3 hours ago or 3 years ago.
- **Grouping** (`--group`) -- deps grouped under `dependencies`, `devDependencies`, `optionalDependencies`, etc. On by default because chaos isn't a layout strategy. `--no-group` if you prefer a flat list.
- **Sorting** (`--sort`) -- 6 strategies: `diff-asc` (default), `diff-desc`, `time-asc`, `time-desc`, `name-asc`, `name-desc`. Major updates at top by default. Alphabetical if you're that person.
- **Cooldown period** (`--cooldown`) -- skip versions published less than N days ago. `--cooldown 7` means "I don't trust anything that's been alive for less than a week." Same. If all versions would be filtered, keeps the originals instead of failing. Taze would just shrug and error out.
- **`--all` flag** -- show all packages including up-to-date ones. Green "up to date" message for the ones that don't need your attention. JSON output includes them with empty `updates` array.
- **Progress indicator** -- `Resolving dependencies... 3/47` counter during resolution. TTY-only, respects `--output json` and `--silent`. Preserves user-supplied `onDependencyResolved` callback because I'm not a monster.
- **Catalog integration** -- pnpm, Bun, and Yarn workspace catalogs now fully wired into the resolve + write pipeline. Catalogs get resolved alongside regular deps, written back to their respective files. No manual sync. No clobbering.
- **Bun named catalogs** -- both `workspaces.catalog` (singular, default) and `workspaces.catalogs` (plural, named). `workspaces.catalogs.ui`, `workspaces.catalogs.testing`, whatever you want. Matches taze PR #238 except ours actually works end-to-end.
- **Glob patterns** -- `--include "@types/*"` and `packageMode: { "@types/*": "ignore" }` now work alongside regex. Auto-detects glob vs regex vs `/regex/flags` syntax. Taze only supports regex. Good luck typing `^@types\/.*$` in your terminal.
- **Private package filtering** -- auto-detects workspace package names from your monorepo and skips them during resolution. No more 404 errors from trying to fetch `@my-org/internal-lib` from the public registry. Taze makes you manually exclude these. I don't think you should have to.
- **Prerelease channel detection** -- if you're on `2.0.0-rc.103`, depfresh only suggests newer `rc` versions. Not `alpha`. Not `beta`. Just your channel. Taze suggests all prereleases regardless and lets you sort it out.
- **Positional mode argument** -- `depfresh major` is now shorthand for `depfresh --mode major`. Less typing. Same result.
- **`defineConfig()` export** -- typed config helper for `depfresh.config.ts`. Identity function with full type inference because we're not animals.
- **Cursor restoration** -- `restoreCursor()` on SIGINT, SIGTERM, and exit. Interactive mode will never leave your terminal cursor invisible again.
- **Wider API exports** -- `loadPackages`, `resolvePackage`, `writePackage`, `parseDependencies` all exported. Build whatever workflow you want.
- **Contextual tips** -- after checking, shows "Run `depfresh major` to check for major updates" and "Add `-w` to write changes to package files" when relevant. Only in table mode, only when there are updates, only when you haven't already done it. Subtle, not annoying.
- **`publishedAt` in JSON output** -- timestamps for when each target version was published. Useful for scripts that care about age.
- 117 new tests (159 -> 276 total, 12 -> 16 test files). All passing. All colocated.

### Credits

Ideas, bugs, and concepts borrowed from the taze ecosystem. These contributors filed PRs and issues that informed our implementation:

- **runyasak** -- cooldown/maturity period concept ([taze#205](https://github.com/antfu/taze/pull/205), [taze#229](https://github.com/antfu/taze/issues/229))
- **leny-mi** (Lennart Mischnaewski) -- unsorted version array bug identification ([taze#217](https://github.com/antfu/taze/pull/217))
- **sxzz** (Kevin Deng, Vue core) -- provenance downgrade warning concept ([taze#198](https://github.com/antfu/taze/pull/198))
- **hyoban** (Stephen Zhou) -- packageManager hash preservation ([taze#234](https://github.com/antfu/taze/pull/234))

## [0.2.0] - 2026-02-22

The "actually test your code" release. Went from 54 tests to 159 and fixed bugs I didn't know I had. Classic.

### Fixed

- `shouldSkipDependency` had inverted logic for `workspace:` and `catalog:` protocols. It was skipping things it shouldn't and keeping things it should skip. Impressive, really.
- `cache.stats()` was called after `cache.close()` in the resolve pipeline. Worked by accident. Fixed it before it didn't.
- `JSON.parse` in `cache.get()` now handles corrupt entries instead of exploding. Deletes the bad row and moves on like a mature adult.
- 4xx registry errors (404, 403) no longer trigger retries. Because retrying "package not found" three times won't make it appear. That's not how reality works.

### Changed

- Cache and `.npmrc` loading lifted from per-package to per-run in `check()`. One SQLite open, one `.npmrc` read, regardless of monorepo size. Taze still opens one per package. I sleep well.
- Include/exclude patterns now pre-compiled once via `compilePatterns()` instead of `new RegExp()` on every dependency. Micro-optimisation? Sure. But it's the principle.
- Removed `package-manager-detector` dependency -- was imported in package.json but never used in source. Ghost dependency. Spooky.
- Removed unused `_options` parameter from `renderTable()`. Dead code is dead.
- Tests colocated with source files. `foo.ts` gets `foo.test.ts` in the same directory. The separate `test/` folder has been ritually cremated. It's not 2017.

### Added

- 105 new tests across 8 new test files. Total: 159 tests, 12 files. All passing.
- Tests for: dependencies parsing, version resolution, SQLite cache (including memory fallback and corrupt data), registry fetching with retry logic, package discovery, write operations, check command integration, and table rendering.
- Exported `parsePackageManagerField` and `shouldSkipDependency` for direct testing.

### Credits

Bugs and improvements informed by taze contributors who filed issues and PRs that never got merged:

- **leny-mi** (Lennart Mischnaewski) -- unsorted version array bug ([taze#217](https://github.com/antfu/taze/pull/217))
- **runyasak** -- deprecated version filtering ([taze#199](https://github.com/antfu/taze/pull/199))
- **hyoban** (Stephen Zhou) -- packageManager hash preservation ([taze#234](https://github.com/antfu/taze/pull/234))
- **sxzz** (Kevin Deng) -- provenance downgrade warning ([taze#198](https://github.com/antfu/taze/pull/198))

## [0.1.0] - 2026-02-22

First release. Wrote it from scratch because waiting for PRs to get merged in taze was aging me faster than JavaScript frameworks.

### Added

- Full CLI with 15 flags that actually make sense. Powered by citty because I have taste.
- Config resolution via unconfig + defu. Supports `depfresh.config.ts`, `.depfreshrc`, or `package.json#depfresh`. Pick your poison.
- Registry fetching with p-limit concurrency. 16 parallel requests by default because patience is not a virtue, it's a bottleneck.
- SQLite cache (better-sqlite3, WAL mode). Falls back to memory if native modules aren't available. No JSON file race conditions. You're welcome.
- `.npmrc` parsing that actually works. Scoped registries, auth tokens, the whole thing. Taze ignored this for 4 years. I fixed it on day one.
- Retry with exponential backoff. 2 retries by default. I won't accidentally DDoS the npm registry.
- `--output json` for scripts and AI agents. Clean structured envelope. No ANSI codes. No log noise. Just data.
- Interactive mode with @clack/prompts. Pick what to update like a civilised person.
- Workspace catalog support for pnpm, Bun, and Yarn. Catalogs get depfreshaded alongside your deps. No manual sync.
- 7 range modes: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`. From cautious to chaotic, your choice.
- Include/exclude regex filtering. Update what you want, ignore what you don't. Revolutionary.
- `--deps-only` and `--dev-only` because sometimes you only want half the pain.
- Semantic exit codes: `0` = chill, `1` = updates available, `2` = something broke.
- Programmatic API with lifecycle callbacks. `beforePackageStart`, `onDependencyResolved`, `beforePackageWrite`, `afterPackageWrite`. Build whatever workflow your heart desires.
- `npm:` and `jsr:` protocol support. Because the ecosystem wasn't confusing enough.
- Nested override/resolution flattening for the brave souls running complex monorepos.
- TTY detection. No spinners in your CI logs. `NO_COLOR` respected.
- 54 tests. More than some production apps I've seen.

[Unreleased]: https://github.com/vcode-sh/depfresh/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/vcode-sh/depfresh/releases/tag/v2.0.0
[1.0.0]: https://github.com/vcode-sh/depfresh/releases/tag/v1.0.0
[0.11.1]: https://github.com/vcode-sh/depfresh/releases/tag/v0.11.1
[0.11.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.11.0
[0.10.1]: https://github.com/vcode-sh/depfresh/releases/tag/v0.10.1
[0.10.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.10.0
[0.9.2]: https://github.com/vcode-sh/depfresh/releases/tag/v0.9.2
[0.9.1]: https://github.com/vcode-sh/depfresh/releases/tag/v0.9.1
[0.9.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.9.0
[0.8.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.8.0
[0.7.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.7.0
[0.6.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.6.0
[0.5.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.5.0
[0.4.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.4.0
[0.3.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.3.0
[0.2.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.2.0
[0.1.0]: https://github.com/vcode-sh/depfresh/releases/tag/v0.1.0
