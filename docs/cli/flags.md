# CLI Flags

Every flag depfresh accepts. All 27+ of them. I counted so you don't have to.

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
depfresh latest -wI --explain --long --verify-command "pnpm test"
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

---

## Validation Rules

depfresh validates enum flags strictly. Invalid values are rejected with exit code `2`:

- `--mode`
- `--output`
- `--sort`
- `--loglevel`

This applies to both normal flag usage and positional mode shorthand (`depfresh <mode>`).

## Machine Discoverability

For AI agents and other automation, depfresh exposes a JSON capability endpoint:

```bash
depfresh --help-json
# or
depfresh capabilities --json
```

The output includes supported flags, defaults, valid enum values, and exit-code semantics.

---

## Core

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--cwd <path>` | `-C` | string | `process.cwd()` | Working directory. Point depfresh at a different project without leaving your comfortable terminal. |
| `--recursive` | `-r` | boolean | `true` | Recursively search for `package.json` files in subdirectories. Enabled by default because monorepos are inevitable. |
| `--write` | `-w` | boolean | `false` | Actually write the updated versions to your package files. Without this, depfresh is just showing you what *could* be. |
| `--interactive` | `-I` | boolean | `false` | Interactive mode -- a grouped multiselect for hand-picking which deps to update. Requires a TTY, obviously. |
| `--mode <mode>` | `-m` | string | `default` | Version range mode. See [Mode Reference](./modes.md) for the full existential breakdown. |
| `--force` | `-f` | boolean | `false` | Force update even when the current version satisfies the range. For when you want to live dangerously. |
| `--global` | `-g` | boolean | `false` | Check globally installed packages instead of local ones. See [Global Packages](#global-packages). |

## Filtering

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--include <patterns>` | `-n` | string | -- | Only include packages matching these regex patterns (comma-separated). Everything else gets ghosted. |
| `--exclude <patterns>` | `-x` | string | -- | Exclude packages matching these regex patterns (comma-separated). Pretend they don't exist. |
| `--deps-only` | -- | boolean | `false` | Only check `dependencies`. Ignores devDependencies, peerDependencies, and optionalDependencies. |
| `--dev-only` | -- | boolean | `false` | Only check `devDependencies`. The inverse of `--deps-only`. Using both simultaneously is not recommended unless you enjoy empty results. |
| `--peer` | `-P` | boolean | `false` | Include peer dependencies in the check. Off by default because peer deps are a diplomatic minefield. |
| `--include-locked` | `-l` | boolean | `false` | Include pinned (locked) dependencies -- those without a range prefix like `^` or `~`. Normally skipped because someone pinned them for a reason. Probably. |
| `--cooldown <days>` | -- | string | `0` | Skip versions published less than N days ago. A paranoia dial. Set to `7` if you prefer your packages slightly aged, like cheese. `0` disables it. |

## Display

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--output <format>` | `-o` | string | `table` | Output format: `table` or `json`. See [Output Formats](../output-formats/). |
| `--all` | `-a` | boolean | `false` | Show all packages, including the ones that are already up to date. For completionists and auditors. |
| `--group` | `-G` | boolean | `true` | Group output by dependency source (dependencies, devDependencies, etc.). Disable with `--no-group` if you prefer chaos. |
| `--sort <strategy>` | `-s` | string | `diff-asc` | Sort order for the output table. See [Sorting](#sorting). |
| `--timediff` | `-T` | boolean | `true` | Show how long ago each target version was published. Useful for spotting suspiciously fresh packages. Disable with `--no-timediff`. |
| `--nodecompat` | -- | boolean | `true` | Show Node.js engine compatibility for target versions. Warns you before you install something that hates your runtime. Disable with `--no-nodecompat`. |
| `--long` | `-L` | boolean | `false` | Show extra details per package -- currently the homepage URL. For when you need to rage-read a changelog. |
| `--explain` | `-E` | boolean | `false` | Show human-readable explanations for update types in interactive mode. Tells you *why* a version depfresh matters. Only works with `--interactive`. |
| `--loglevel <level>` | -- | string | `info` | Log level: `silent`, `info`, or `debug`. `silent` suppresses everything except output. `debug` tells you things you didn't ask to know. |
| `--help-json` | -- | boolean | `false` | Print machine-readable CLI capabilities (flags, enums, defaults, exit codes) as JSON. |
| `--json` | -- | boolean | `false` | JSON mode for the `depfresh capabilities` discoverability command. |

## Post-Write

These flags only do anything when `--write` is also present. Without `--write`, they sit there silently judging you.

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--execute <command>` | `-e` | string | -- | Run a shell command after all updates are written. Runs once, after everything. E.g. `--execute "pnpm test"`. |
| `--install` | `-i` | boolean | `false` | Auto-detect your package manager and run `install` after writing. Mutually exclusive with `--update` (update wins). |
| `--update` | `-u` | boolean | `false` | Auto-detect your package manager and run `update` instead of `install` after writing. Takes priority over `--install`. |
| `--verify-command <cmd>` | `-V` | string | -- | Run a command after *each individual* dependency update. If the command fails, that update is reverted. The nuclear option for cautious people. See [Verify Command](#verify-command). |

## Behavior

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--fail-on-outdated` | -- | boolean | `false` | Exit with code `1` when outdated dependencies are found (without `--write`). Built for CI pipelines. See [CI Usage](#ci-usage). |
| `--ignore-other-workspaces` | -- | boolean | `true` | Skip packages that belong to nested or separate workspaces. Prevents depfresh from trampling someone else's monorepo-within-a-monorepo. |
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

`--global` checks globally installed packages instead of local project dependencies.

```bash
# Check global packages
depfresh -g

# Update all global packages
depfresh -gw

# Interactive global update
depfresh -gwI
```

Supported package managers: **npm**, **pnpm**, **bun**. Yarn global packages are not supported (yarn has deprecated `yarn global` anyway).

Detection order: if `pnpm` is installed, it checks pnpm globals. Then `bun`. Falls back to `npm`. depfresh runs the appropriate list command for each:

- npm: `npm list -g --depth=0 --json`
- pnpm: `pnpm list -g --json`
- bun: `bun pm ls -g`

When writing global updates (`-gw`), depfresh runs the corresponding install command:

- npm: `npm install -g <pkg>@<version>`
- pnpm: `pnpm add -g <pkg>@<version>`
- bun: `bun add -g <pkg>@<version>`

---

## Verify Command

`--verify-command` is the careful version of `--execute`. Instead of running once at the end, it runs after *each individual dependency update*. If the command fails, that specific update is reverted from the package file.

```bash
# Update each dep one at a time, run tests, revert failures
depfresh -w --verify-command "pnpm test"

# Type-check after each update
depfresh -w -V "pnpm typecheck"
```

The flow for each dependency:
1. Back up the package file
2. Write the single dependency update
3. Run the verify command
4. If the command exits `0` -- keep it
5. If the command fails -- restore from backup

This is slower (one command per dep), but it means you end up with only the updates that actually work. A summary of applied vs. reverted is printed at the end.

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

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Everything is up to date, or updates were written successfully. |
| `1` | Outdated dependencies found (only with `--fail-on-outdated` and without `--write`). |
| `2` | Fatal error. Something went properly wrong. |

### Machine-Readable Output

Combine `--output json` with `--fail-on-outdated` for CI pipelines that need to parse the results:

```bash
# GitHub Actions example
depfresh --output json --fail-on-outdated > depfresh-report.json
```

The JSON output includes a `summary` object with counts by diff type, plus full package-level detail. See [Output Formats](../output-formats/) for the schema.

ANSI colors are automatically disabled in non-TTY environments and when `NO_COLOR` is set. No extra flags needed.
