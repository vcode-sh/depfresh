# CLI Flags

Every flag depfresh accepts. All of them. I counted so you don't have to.

## Quick Start

```bash
# Check what's outdated
depfresh

# Check only major updates
depfresh major

# Write minor/patch updates to disk
depfresh --write --mode minor

# Interactive cherry-picking
depfresh -wI

# The full chaos
depfresh plan --json --mode latest --sync-lockfile --verify-argv '["pnpm","test"]'
```

## Help

```bash
# Human-readable usage and all flags
depfresh help
depfresh -h
depfresh --help

# Machine-readable CLI contract (JSON)
depfresh --help-json
depfresh capabilities --json
```

## Positional Arguments

`depfresh <mode>` is shorthand for `depfresh --mode <mode>`. Because typing `--mode` every time is a tax on the human spirit.

```bash
depfresh major     # same as depfresh --mode major
depfresh minor     # same as depfresh --mode minor
depfresh patch     # same as depfresh --mode patch
depfresh latest    # same as depfresh --mode latest
depfresh newest    # same as depfresh --mode newest
depfresh next      # same as depfresh --mode next
```

Valid modes: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`. Invalid values fail fast with exit code `2`.
Machine-discoverability command: `depfresh capabilities --json`.

Reserved machine commands are `depfresh capabilities --json`, `depfresh inspect --json`,
`depfresh plan --json`, and `depfresh apply --json --write --plan-file <path>`. They are not mode
shorthands and use their own exit contracts.

---

## Validation Rules

depfresh validates the complete argv contract before discovery, registry requests, writes, or
commands. Unknown flags, missing values, extra positional arguments, malformed boolean
assignments, and conflicting repeated singleton values are rejected with exit code `2` and a
stable reason code. Enum values are also strict:

- `--mode`
- `--output`
- `--sort`
- `--loglevel`

This applies to both normal flag usage and positional mode shorthand (`depfresh <mode>`).

`--deps-only` conflicts with `--dev-only`. In the machine workflow, `--sync-lockfile` conflicts with
`--install`, `--verify-argv` requires one of those planned phases, and `--verify-artifacts` requires
`--install`. Legacy `--update`,
`--execute`, `--verify-command`, and `--strict-post-write` are rejected; legacy check-mode
`--install` is redirected to plan/apply. `--version` must be used alone. Use `--name=value` when a
string value intentionally starts with `-`, such as `--include=--write`.

Only `--exclude-workspace` and `--exclude-catalog` are repeatable string options. Different values
must repeat the flag; values are not comma-split. Repeating an identical value deduplicates it in
first-seen order.

## Machine Discoverability

For AI agents and other automation, depfresh exposes a JSON capability endpoint:

```bash
depfresh --help-json
# or
depfresh capabilities --json
```

The output includes supported commands, packaged schema paths, flags, defaults, valid enum values,
and the separate legacy-check, inspect/plan, and apply exit semantics.

### Inspect and plan flags

Both machine commands accept `--cwd`, `--recursive`, `--ignore-paths`,
`--ignore-other-workspaces`, and either `--json` or `--output json`. `plan` additionally accepts
selection and registry flags including `--mode`, `--include`, `--exclude`, `--force`, `--peer`,
`--include-locked`, `--deps-only`, `--dev-only`, `--concurrency`, and `--cooldown`. It may also
fingerprint `--sync-lockfile` or `--install`, optional `--verify-argv '<JSON string array>'`, and
`--phase-timeout <milliseconds>`. `--verify-artifacts` requires `--install` and fingerprints exact
public-npm verification; it does not execute the verifier while planning.

| Flag | Command | Description |
| --- | --- | --- |
| `--as-of <timestamp>` | `plan` | Canonical UTC semantic time required when cooldown is positive, for example `2026-07-16T10:00:00.000Z` |
| `--exclude-workspace <path>` | `plan`, normal check/write | Exclude one exact proven repository-relative workspace path; repeat for another path. |
| `--exclude-catalog <name>` | `plan`, normal check/write | Exclude all proven physical catalogs with one exact name; repeat for another name. |

Inspect rejects all phase flags. Plan rejects `--write`, `--interactive`, `--update`, `--execute`,
`--verify`, `--verify-command`, `--strict-post-write`, `--global`, and `--global-all` before
discovery. Planning phase intent grants no authority and runs no process.

### Apply flags

Apply accepts `--cwd`, JSON output selection, explicit `--write`, exactly one `--plan-file <path>`,
and only the matching `--sync-lockfile` or `--install` grant. `--verify` grants only verification
argv already fingerprinted in the plan. `--verify-artifacts` grants only the artifact/network work
already fingerprinted in an install plan. Apply flags cannot add, replace, or weaken a phase. It
validates the immutable plan and current target evidence before mutation. The `--plan-file` flag is
rejected by every other command. Apply rejects selection, registry, interactive, legacy post-write,
and global flags.

Apply exits `0` only for `applied` or `noop`, `1` for a schema-valid `conflicted`, `reverted`,
`failed`, or `unknown` result, and `2` for a fatal command-error document.

---

## Core

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--cwd <path>` | `-C` | string | `process.cwd()` | Working directory. Point depfresh at a different project without leaving your comfortable terminal. |
| `--recursive` | `-r` | boolean | `true` | Recursively search for package manifests (`package.json`, `package.yaml`) in subdirectories. Enabled by default because monorepos are inevitable. |
| `--write` | `-w` | boolean | `false` | Actually write the updated versions to your package files. Without this, depfresh is just showing you what *could* be. |
| `--interactive` | `-I` | boolean | `false` | Interactive grouped selection. Requires a TTY and explicit `--write`; selection alone grants no write authority. |
| `--mode <mode>` | `-m` | string | `default` | Version range mode. See [Mode Reference](./modes.md) for the full existential breakdown. |
| `--force` | `-f` | boolean | `false` | Force update even when the current version satisfies the range. Does not bypass cache reads. |
| `--global` | `-g` | boolean | `false` | Inspect one supported detected global manager; with `--write`, use observed global apply. See [Global Packages](#global-packages). |
| `--global-all` | -- | boolean | `false` | Inspect npm, pnpm, and Bun while retaining each manager-specific occurrence. |

## Filtering

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--include <patterns>` | `-n` | string | -- | Compatibility policy input: exclude by default, then include matching occurrence names. A CLI array replaces configured include patterns. |
| `--exclude <patterns>` | `-x` | string | -- | Compatibility policy input evaluated after include, so a matching exclusion wins. A CLI array replaces configured exclude patterns. |
| `--exclude-workspace <path>` | -- | repeatable string | -- | Exclude direct declarations and catalog consumers owned by one exact workspace path. `.` means the root package. |
| `--exclude-catalog <name>` | -- | repeatable string | -- | Exclude every physical catalog with the exact name plus only consumers linked to those owners. |
| `--ignore-paths <patterns>` | -- | string | -- | Additional ignore glob patterns (comma-separated) merged with default ignore paths. Useful for skipping specific folders during recursive scan. |

Workspace paths may use a safe leading `./` or trailing slash, which canonicalizes away. Absolute
paths, parent traversal, backslashes, control text, missing targets, and catalog names without a
proven physical owner fail with `SELECTION_TARGET_UNPROVEN` before registry/cache/interactive/plan
operation/write work. A root workspace exclusion never captures co-located catalog owners.

CLI ignore paths replace configured custom ignore paths for that invocation, while the built-in
`node_modules`, `dist`, `coverage`, and `.git` safety exclusions are always retained and deduped.
| `--deps-only` | -- | boolean | `false` | Only check `dependencies`. Ignores devDependencies, peerDependencies, and optionalDependencies. |
| `--dev-only` | -- | boolean | `false` | Only check `devDependencies`. The inverse of `--deps-only`. Using both simultaneously is not recommended unless you enjoy empty results. |
| `--peer` | `-P` | boolean | `false` | Include peer declarations and peer-scoped catalogs in selection. Plan signals evaluate peer constraints in each exact owner's proposed graph; ambiguous overrides, hoists, or cross-workspace providers remain unknown. |
| `--include-locked` | `-l` | boolean | `false` | Include pinned dependencies. They follow the selected mode; in `default` mode an exact pin can advance to the highest eligible version. |
| `--cooldown <days>` | -- | string | `0` | Require candidate versions to be at least N days old. Candidates with missing or invalid publish-time metadata are skipped while cooldown is active. `0` disables it. |

## Display

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--output <format>` | `-o` | string | `table` | Output format: `table` or `json`. See [Output Formats](../output-formats/). |
| `--all` | `-a` | boolean | `false` | Show all packages, including the ones that are already up to date. For completionists and auditors. |
| `--group` | `-G` | boolean | `true` | Group output by dependency source (dependencies, devDependencies, etc.). Disable with `--no-group` if you prefer chaos. |
| `--sort <strategy>` | `-s` | string | `diff-asc` | Sort order for the output table. See [Sorting](#sorting). |
| `--timediff` | `-T` | boolean | `true` | Show how long ago each target version was published. Useful for spotting suspiciously fresh packages. Disable with `--no-timediff`. |
| `--nodecompat` | -- | boolean | `true` | Show legacy engine metadata indicators. `?node` means repository compatibility is unknown; authoritative plan signals use repository declarations, never the executor runtime. |
| `--long` | `-L` | boolean | `false` | Show extra details per package -- currently the homepage URL. For when you need to rage-read a changelog. |
| `--explain` | `-E` | boolean | `false` | Show human-readable explanations for update types in interactive mode. Tells you *why* a version change matters. Only works with `--interactive`. |
| `--explain-discovery` | -- | boolean | `false` | Explain how depfresh chose the root, which manifests it matched, which ones it skipped, and which catalogs it loaded. |
| `--profile` | -- | boolean | `false` | Emit runtime timing and cache/network diagnostics for this run. Useful when "it feels slower" is not a bug report, it's a shrug. |
| `--loglevel <level>` | -- | string | `info` | Log level: `silent`, `info`, or `debug`. `silent` suppresses everything except output. `debug` tells you things you didn't ask to know. |
| `--help-json` | -- | boolean | `false` | Print machine-readable CLI capabilities (flags, enums, defaults, exit codes) as JSON. |
| `--json` | -- | boolean | `false` | JSON mode for `capabilities`, `inspect`, `plan`, and `apply`. |
| `--plan-file <path>` | -- | string | -- | Immutable `depfresh.plan` JSON input for `apply`; invalid for every other command. |

`--profile`'s `networkFetches` and `dedupeHits` count real registry fetches and real in-flight cache hits in every output mode, interactive terminal runs included. Before 1.2.0 those two numbers were always `0` on an interactive run, which made them worse than useless -- they were reassuring.

`--profile` is runtime telemetry only. It does not activate or select reusable policy profiles;
named policy profiles are not part of the current policy contract. Policy rules are configured in a
config file or through the library API, not through a JSON CLI flag.

## Planned Manager and Verification Phases

These flags are command-specific. Plan flags describe immutable future intent without authority;
apply flags grant only that reviewed intent.

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--sync-lockfile` | -- | boolean | `false` | On `plan`, fingerprint a supported lifecycle-disabled lockfile-only adapter; on `apply`, grant its process and lockfile writes. |
| `--install` | `-i` | boolean | `false` | On `plan`, fingerprint the stronger full-install adapter; on `apply`, grant process, lockfile, install-tree, and cache effects. |
| `--verify-artifacts` | -- | boolean | `false` | With `--install`, fingerprint or grant exact npm 11.12.x public-registry artifact verification. Configuration cannot supply this authority. |
| `--verify-argv <json>` | -- | string | -- | On `plan`, fingerprint one non-empty public JSON string array such as `'["pnpm","test"]'`; absolute paths and credential/auth-shaped flags, headers, or values are rejected with `INVALID_OPTION_VALUE`. Never inferred from scripts. |
| `--verify` | -- | boolean | `false` | On `apply`, grant only the exact verification argv already in the plan. |
| `--phase-timeout <ms>` | -- | integer | `120000` | Fingerprinted timeout for manager version, manager execution, generic verification, and artifact verification; maximum `600000`. |
| `--execute`, `--update`, `--verify-command`, `--strict-post-write` | legacy | -- | -- | Rejected before discovery. Use plan/apply exact argv and phase results. |

```bash
depfresh plan --json --install --verify-artifacts > depfresh-plan.json
depfresh apply --json --write --install --verify-artifacts --plan-file depfresh-plan.json
```

## Behavior

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--fail-on-outdated` | -- | boolean | `false` | Exit with code `1` when outdated dependencies are found (without `--write`). Built for CI pipelines. See [CI Usage](#ci-usage). |
| `--fail-on-resolution-errors` | -- | boolean | `false` | Exit with code `2` when any dependency fails to resolve from the registry. |
| `--fail-on-no-packages` | -- | boolean | `false` | Exit with code `2` when discovery finds no packages at all. Useful for catching wrong cwd or bad filters in CI. |
| `--ignore-other-workspaces` | -- | boolean | `true` | Skip packages that belong to nested or separate workspaces. Prevents depfresh from trampling someone else's monorepo-within-a-monorepo. |
| `--refresh-cache` | -- | boolean | `false` | Bypass cache reads for this run and fetch fresh registry metadata. Cache is repopulated unless `cacheTTL=0`. |
| `--no-cache` | -- | boolean | `false` | Alias for `--refresh-cache` for migration compatibility. |
| `--concurrency <n>` | `-c` | string | `16` | Maximum concurrent registry requests. Crank it up if you have faith in your network. Crank it down if the registry starts returning 429s. |

---

## Sorting

The `--sort` flag accepts six strategies. Default is `diff-asc`.

| Value | Description |
|-------|-------------|
| `diff-asc` | Patch first, then minor, then major. The default. Smallest changes on top. |
| `diff-desc` | Major first, then minor, then patch. For those who like to see the scary stuff up front. |
| `time-asc` | Oldest publications first. Archaeology mode. |
| `time-desc` | Newest publications first. What just dropped? |
| `name-asc` | Alphabetical A-Z. For the tidy-minded. |
| `name-desc` | Alphabetical Z-A. For the contrarian. |

---

## Global Packages

`--global` checks globally installed packages for one detected package manager.

`--global-all` checks globals across npm, pnpm, and Bun in one run. Presentation may group equal
names, but every manager/package/version remains a distinct physical occurrence for policy and
write decisions.

```bash
# Check global packages
depfresh -g

# Check all global package managers at once
depfresh --global-all

# Update all global packages
depfresh -gw

# Update all detected global managers in one run
depfresh --global-all -w

# Interactive global update
depfresh -gwI
```

Supported package managers: **npm**, **pnpm**, **bun**. Yarn global packages are not supported (yarn has deprecated `yarn global` anyway).

`--global` detection order: if `pnpm` is installed, it checks pnpm globals. Then `bun`. Falls back to `npm`.

`--global-all` scans all three managers. Each occurrence resolves from its own installed version;
an aggregate displayed version never becomes another manager's expected value or target authority.
No occurrence may downgrade.

depfresh runs the appropriate list command for each:

- npm: `npm list -g --depth=0 --json --ignore-scripts`, plus `npm root -g`
- pnpm: `pnpm list -g --depth=0 --json --ignore-scripts`, plus `pnpm root -g`
- bun: `bun pm ls -g`

When writing global updates (`-gw`), depfresh runs the corresponding install command:

- npm: `npm install -g --ignore-scripts --no-audit --no-fund -- <pkg>@<version>`
- pnpm: `pnpm add -g --ignore-scripts --ignore-pnpmfile -- <pkg>@<version>`
- bun: `bun add -g --ignore-scripts <pkg>@<version>`

Supported versions are npm 10/11, pnpm 10/11, and Bun `>=1.2.0 <2.0.0`. Before any command,
depfresh inventories every requested manager and checks explicit global-write, process, and exact
manager authority. It re-inventories immediately before and after each command. Only the observed
post-command version determines `applied`; a zero exit alone does not. Missing/stale/downgrade
preconditions are skipped or conflicted, malformed or lost evidence is unknown, and a later failure
does not roll back an earlier applied global item. See [Global Apply](../output-formats/global-apply.md).

---

## Verification Phase

Verification runs once after every planned source replacement and successful manager phase. It is
an inert argv array, not shell text, and has an empty repository-write allowlist.

```bash
depfresh plan --json --sync-lockfile --verify-argv '["pnpm","test"]' > depfresh-plan.json
depfresh apply --json --write --sync-lockfile --verify --plan-file depfresh-plan.json
```

Nonzero exit, signal, timeout, excessive output, repository mutation, or unconfirmed termination is
not success. Apply restores planned source/lockfile bytes where safe and reports partial or unknown
effects that cannot be rolled back.

---

## CI Usage

### Fail on Outdated

`--fail-on-outdated` makes depfresh exit with code `1` when outdated dependencies are found *without* `--write`. This turns depfresh into a CI check.

```bash
# CI: fail if anything is outdated
depfresh --fail-on-outdated

# CI: fail if any major updates exist
depfresh major --fail-on-outdated

# CI: check and output JSON for parsing
depfresh --fail-on-outdated --output json
```

### Fail on Resolution or Discovery Errors

If partial success is not acceptable in your automation, use the strict flags:

```bash
# CI: fail if any dependency cannot be resolved
depfresh --fail-on-resolution-errors

# CI: fail if discovery found no packages at all
depfresh --fail-on-no-packages

# CI: sync and verify one reviewed plan; any phase failure exits 1
depfresh apply --json --write --sync-lockfile --verify --plan-file depfresh-plan.json
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Everything is up to date, or updates were written successfully. |
| `1` | Outdated dependencies found (only with `--fail-on-outdated` and without `--write`). |
| `2` | Fatal error, strict resolution/discovery failure, invalid authority, or rejected legacy post-write option. |

### Machine-Readable Output

Combine `--output json` with `--fail-on-outdated` for CI pipelines that need to parse the results:

```bash
# GitHub Actions example
depfresh --output json --fail-on-outdated > depfresh-report.json
```

The JSON output includes a `summary` object with counts by diff type, plus full package-level detail. See [Output Formats](../output-formats/) for the schema.

ANSI colors are automatically disabled in non-TTY environments and when `NO_COLOR` is set. No extra flags needed.
