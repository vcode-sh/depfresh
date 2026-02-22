# CLI Reference

The complete field manual for `bump`. Every flag, every trick, every questionable life choice that led to this many options.

## Quick Start

```bash
# Check what's outdated
bump

# Check only major updates
bump major

# Write minor/patch updates to disk
bump --write --mode minor

# Interactive cherry-picking
bump -wI

# The full chaos
bump latest -wI --explain --long --verify-command "pnpm test"
```

## Positional Arguments

`bump <mode>` is shorthand for `bump --mode <mode>`. Because typing `--mode` every time is a tax on the human spirit.

```bash
bump major     # same as bump --mode major
bump minor     # same as bump --mode minor
bump patch     # same as bump --mode patch
bump latest    # same as bump --mode latest
bump newest    # same as bump --mode newest
bump next      # same as bump --mode next
```

Valid modes: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`. Anything else gets ignored and the default mode kicks in. No errors, no drama.

---

## Flags

### Core

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--cwd <path>` | `-C` | string | `process.cwd()` | Working directory. Point bump at a different project without leaving your comfortable terminal. |
| `--recursive` | `-r` | boolean | `true` | Recursively search for `package.json` files in subdirectories. Enabled by default because monorepos are inevitable. |
| `--write` | `-w` | boolean | `false` | Actually write the updated versions to your package files. Without this, bump is just showing you what *could* be. |
| `--interactive` | `-I` | boolean | `false` | Interactive mode -- a grouped multiselect for hand-picking which deps to update. Requires a TTY, obviously. |
| `--mode <mode>` | `-m` | string | `default` | Version range mode. See [Mode Reference](#mode-reference) below for the full existential breakdown. |
| `--force` | `-f` | boolean | `false` | Force update even when the current version satisfies the range. For when you want to live dangerously. |
| `--global` | `-g` | boolean | `false` | Check globally installed packages instead of local ones. See [Global Packages](#global-packages). |

### Filtering

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--include <patterns>` | `-n` | string | -- | Only include packages matching these regex patterns (comma-separated). Everything else gets ghosted. |
| `--exclude <patterns>` | `-x` | string | -- | Exclude packages matching these regex patterns (comma-separated). Pretend they don't exist. |
| `--deps-only` | -- | boolean | `false` | Only check `dependencies`. Ignores devDependencies, peerDependencies, and optionalDependencies. |
| `--dev-only` | -- | boolean | `false` | Only check `devDependencies`. The inverse of `--deps-only`. Using both simultaneously is not recommended unless you enjoy empty results. |
| `--peer` | `-P` | boolean | `false` | Include peer dependencies in the check. Off by default because peer deps are a diplomatic minefield. |
| `--include-locked` | `-l` | boolean | `false` | Include pinned (locked) dependencies -- those without a range prefix like `^` or `~`. Normally skipped because someone pinned them for a reason. Probably. |
| `--cooldown <days>` | -- | string | `0` | Skip versions published less than N days ago. A paranoia dial. Set to `7` if you prefer your packages slightly aged, like cheese. `0` disables it. |

### Display

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--output <format>` | `-o` | string | `table` | Output format: `table`, `json`, or `sarif`. See [Output Formats](./output-formats.md). |
| `--all` | `-a` | boolean | `false` | Show all packages, including the ones that are already up to date. For completionists and auditors. |
| `--group` | `-G` | boolean | `true` | Group output by dependency source (dependencies, devDependencies, etc.). Disable with `--no-group` if you prefer chaos. |
| `--sort <strategy>` | `-s` | string | `diff-asc` | Sort order for the output table. See [Sorting](#sorting). |
| `--timediff` | `-T` | boolean | `true` | Show how long ago each target version was published. Useful for spotting suspiciously fresh packages. Disable with `--no-timediff`. |
| `--nodecompat` | -- | boolean | `true` | Show Node.js engine compatibility for target versions. Warns you before you install something that hates your runtime. Disable with `--no-nodecompat`. |
| `--long` | `-L` | boolean | `false` | Show extra details per package -- currently the homepage URL. For when you need to rage-read a changelog. |
| `--explain` | `-E` | boolean | `false` | Show human-readable explanations for update types in interactive mode. Tells you *why* a version bump matters. Only works with `--interactive`. |
| `--loglevel <level>` | -- | string | `info` | Log level: `silent`, `info`, or `debug`. `silent` suppresses everything except output. `debug` tells you things you didn't ask to know. |

### Post-Write

These flags only do anything when `--write` is also present. Without `--write`, they sit there silently judging you.

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--execute <command>` | `-e` | string | -- | Run a shell command after all updates are written. Runs once, after everything. E.g. `--execute "pnpm test"`. |
| `--install` | `-i` | boolean | `false` | Auto-detect your package manager and run `install` after writing. Mutually exclusive with `--update` (update wins). |
| `--update` | `-u` | boolean | `false` | Auto-detect your package manager and run `update` instead of `install` after writing. Takes priority over `--install`. |
| `--verify-command <cmd>` | `-V` | string | -- | Run a command after *each individual* dependency update. If the command fails, that update is reverted. The nuclear option for cautious people. See [Verify Command](#verify-command). |

### Behavior

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--fail-on-outdated` | -- | boolean | `false` | Exit with code `1` when outdated dependencies are found (without `--write`). Built for CI pipelines. See [CI Usage](#ci-usage). |
| `--ignore-other-workspaces` | -- | boolean | `true` | Skip packages that belong to nested or separate workspaces. Prevents bump from trampling someone else's monorepo-within-a-monorepo. |
| `--concurrency <n>` | `-c` | string | `16` | Maximum concurrent registry requests. Crank it up if you have faith in your network. Crank it down if the registry starts returning 429s. |

---

## Mode Reference

The `--mode` flag controls how bump picks target versions. It's the philosophical core of the tool -- how aggressive do you want to be?

### `default`

Respects existing range prefixes. If your `package.json` says `^1.2.3`, bump finds the latest version that satisfies `^1.x.x`. If it says `~1.2.3`, you get the latest `1.2.x`. This is the polite, society-approved mode.

### `major`

Only shows major version bumps. Filters out minor and patch updates entirely. Use this when you're feeling brave and want to see what breaking changes await. `bump major` is the shorthand.

### `minor`

Shows minor and patch updates within the current major version. Skips anything that would cross a major boundary. The "I want new features but I also want to sleep tonight" mode.

### `patch`

Only patch updates within the current minor version. The most conservative option. Security fixes and bug patches, nothing else. For the risk-averse and the production-adjacent.

### `latest`

Ignores range prefixes entirely and resolves to the latest version on the `latest` dist-tag. `^1.2.3` might become `4.0.0` if that's what's out there. This is `default` mode with the safety off.

### `newest`

The most recently published version by timestamp, regardless of dist-tags. If someone published `2.0.0-beta.3` five minutes ago, that's what you get. Chaotic neutral energy.

### `next`

Resolves to whatever the `next` dist-tag points at. Useful for testing pre-release versions of frameworks that use the `next` tag convention (React, etc.). Returns nothing if the package doesn't have a `next` tag.

### `ignore`

Not available via CLI flags -- this one's for the config file's `packageMode` option. Set a package to `ignore` and bump will skip it entirely. Useful for pinning a specific package while letting everything else update.

```json
{
  "bump": {
    "packageMode": {
      "typescript": "minor",
      "react": "ignore"
    }
  }
}
```

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

## Filtering

### Include / Exclude

Both `--include` and `--exclude` accept comma-separated regex patterns. They match against the package name.

```bash
# Only check typescript and vitest
bump --include "typescript,vitest"

# Check everything except eslint plugins
bump --exclude "eslint-plugin-"

# Regex works too
bump --include "^@my-org/"
bump --exclude "^@types/"
```

`--include` is applied first, then `--exclude`. If both match the same package, exclude wins.

### Dependency Type Filters

```bash
# Only production dependencies
bump --deps-only

# Only dev dependencies
bump --dev-only

# Include peer dependencies (excluded by default)
bump --peer
```

### Cooldown

The `--cooldown` flag skips versions published less than N days ago. It's a freshness filter -- if a version was published yesterday, maybe wait a bit before adopting it.

```bash
# Skip anything published in the last 7 days
bump --cooldown 7

# Skip anything published in the last 30 days (very conservative)
bump --cooldown 30
```

Set to `0` (the default) to disable. This is useful for avoiding being the first person to discover a broken release.

### Locked Dependencies

By default, bump skips pinned versions -- dependencies without a range prefix (`1.2.3` instead of `^1.2.3`). Someone locked that version deliberately. Pass `--include-locked` to override this and check them anyway.

---

## Post-Write Hooks

### Execute

`--execute` runs a shell command once after all package files have been written. Only fires if `--write` is set and at least one file was actually modified.

```bash
# Run tests after updating
bump -w --execute "pnpm test"

# Run a custom script
bump -w -e "node scripts/post-update.js"
```

### Install / Update

`--install` and `--update` auto-detect your package manager (via `packageManager` field in `package.json`, then lockfile detection) and run `install` or `update` after writing.

```bash
# Write changes and reinstall
bump -wi

# Write changes and run update instead
bump -wu
```

If both are set, `--update` takes priority. Package manager detection order: `packageManager` field > lockfile (`bun.lock`/`bun.lockb` > `pnpm-lock.yaml` > `yarn.lock` > fallback to `npm`).

### Verify Command

`--verify-command` is the careful version of `--execute`. Instead of running once at the end, it runs after *each individual dependency update*. If the command fails, that specific update is reverted from the package file.

```bash
# Update each dep one at a time, run tests, revert failures
bump -w --verify-command "pnpm test"

# Type-check after each update
bump -w -V "pnpm typecheck"
```

The flow for each dependency:
1. Back up the package file
2. Write the single dependency update
3. Run the verify command
4. If the command exits `0` -- keep it
5. If the command fails -- restore from backup

This is slower (one command per dep), but it means you end up with only the updates that actually work. A summary of applied vs. reverted is printed at the end.

---

## Global Packages

`--global` checks globally installed packages instead of local project dependencies.

```bash
# Check global packages
bump -g

# Update all global packages
bump -gw

# Interactive global update
bump -gwI
```

Supported package managers: **npm**, **pnpm**, **bun**. Yarn global packages are not supported (yarn has deprecated `yarn global` anyway).

Detection order: if `pnpm` is installed, it checks pnpm globals. Then `bun`. Falls back to `npm`. bump runs the appropriate list command for each:

- npm: `npm list -g --depth=0 --json`
- pnpm: `pnpm list -g --json`
- bun: `bun pm ls -g`

When writing global updates (`-gw`), bump runs the corresponding install command:

- npm: `npm install -g <pkg>@<version>`
- pnpm: `pnpm add -g <pkg>@<version>`
- bun: `bun add -g <pkg>@<version>`

---

## Progress Display

When resolving dependencies in a TTY, bump shows a dual progress bar:

```
Packages         [========----------------] 1/3
Deps (my-app)    [================--------] 12/24  total 12/47
```

The top bar tracks packages processed, the bottom tracks individual dependency resolutions within the current package (plus a running total). Both update in real-time as registry calls complete.

Progress is suppressed automatically when:
- Output is `--output json` (machines don't need encouragement)
- Log level is `--silent` (you asked for silence, you got it)
- stdout is not a TTY (pipes, CI, AI agents)

Labels truncate gracefully on narrow terminals. CJK package names are measured correctly (double-width characters get proper accounting). The progress bars clear themselves when resolution finishes, leaving a clean terminal for the results table.

---

## Table Rendering

### Terminal Overflow

Table columns adapt to your terminal width. On wide terminals, everything fits. On narrow terminals, bump progressively shrinks columns in priority order: package name first, then current version, then target version, then source. Minimum widths are enforced so nothing collapses entirely -- if your terminal is 40 columns wide, names truncate with `…` but remain readable.

CJK characters and other double-width Unicode are measured correctly for column alignment. Combining marks and zero-width characters are handled. Package names like `@hanzi/测试` won't break the table layout.

Overflow handling only activates in TTY mode. Non-TTY output (JSON, piped text) preserves full column widths regardless of any terminal width setting.

---

## Interactive Mode

`--interactive` (or `-I`) launches a custom terminal UI where you can browse, drill into, and cherry-pick which dependencies to update. No React. No Ink. Just readline and raw mode doing honest work.

```bash
# Browse and select
bump -I

# Browse, select, and write
bump -wI

# With human-readable explanations
bump -wIE
```

### List View

Dependencies grouped by source (`dependencies`, `devDependencies`, etc.) with colour-coded diff types. Navigate with arrow keys or vim bindings:

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `g` | Jump to first |
| `G` | Jump to last |
| `Space` | Toggle selection |
| `a` | Select / deselect all |
| `→` / `l` | Drill into version detail |
| `Enter` | Confirm selection |
| `Esc` / `q` | Cancel |
| `PgDn` / `PgUp` | Page scroll |

The viewport scrolls with your cursor. Overflow indicators (`^ more` / `v more`) appear when the list exceeds your terminal height. Resize your terminal and it adapts. Like furniture from IKEA, except it actually works first time.

### Detail View

Press `→` or `l` on any dependency to see every available version -- newest first, capped at 20. Each version shows:

- **Diff type** (major / minor / patch) with colour
- **Age** since publish (`~3d`, `~2mo`, `~1.5y`)
- **Dist-tags** (`latest`, `next`, etc.)
- **Deprecation** warnings
- **Node engine** requirements
- **Provenance** level

Pick any version with `Space` or `Enter` -- not just the one bump suggested. Press `←` / `h` / `Esc` to go back without changing anything.

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `Space` / `Enter` | Select version and return to list |
| `←` / `h` / `Esc` | Back to list |
| `Ctrl+C` | Cancel everything |

### Explain Mode

Add `--explain` (or `-E`) to show human-readable descriptions next to each version in the detail view:

- **major** -- "Breaking change. Check migration guide."
- **minor** -- "New features. Backwards compatible."
- **patch** -- "Bug fixes only. Safe to update."

Plus deprecation, provenance, and Node compatibility warnings when relevant. For the AI agents and juniors who want context, not just numbers.

### Non-TTY Fallback

Requires a TTY. If you're piping output, running in CI, or inside a non-interactive environment, bump falls back to a `@clack/prompts` grouped multiselect. Functional, just less fancy.

---

## CI Usage

### Fail on Outdated

`--fail-on-outdated` makes bump exit with code `1` when outdated dependencies are found *without* `--write`. This turns bump into a CI check.

```bash
# CI: fail if anything is outdated
bump --fail-on-outdated

# CI: fail if any major updates exist
bump major --fail-on-outdated

# CI: check and output JSON for parsing
bump --fail-on-outdated --output json
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
bump --output json --fail-on-outdated > bump-report.json
```

The JSON output includes a `summary` object with counts by diff type, plus full package-level detail. See [Output Formats](./output-formats.md) for the schema.

ANSI colors are automatically disabled in non-TTY environments and when `NO_COLOR` is set. No extra flags needed.

---

## Workspaces & Monorepos

### Recursive Scanning

`--recursive` (on by default) scans subdirectories for `package.json` files. It respects the `ignorePaths` config option, which defaults to:

```
**/node_modules/**
**/dist/**
**/coverage/**
**/.git/**
```

### Nested Workspaces

`--ignore-other-workspaces` (on by default) detects when a subdirectory belongs to a separate workspace (has its own workspace root) and skips it. This prevents bump from double-processing packages in monorepo-within-monorepo setups.

Disable with `--no-ignore-other-workspaces` if you genuinely want to process everything.

### Catalog Support

bump understands workspace catalogs for **pnpm**, **bun**, and **yarn**:

- **pnpm**: Reads `catalog:` and `catalog:<name>` protocol references from `pnpm-workspace.yaml`
- **bun**: Reads catalog entries from `bunfig.toml`
- **yarn**: Reads catalog entries from `.yarnrc.yml`

Catalog dependencies are resolved and updated alongside regular dependencies. When writing, bump updates both the catalog source file and any `package.json` files that reference it.

---

## Examples

A few real-world incantations for the copy-paste inclined.

```bash
# The basics: what's outdated?
bump

# Safe minor/patch updates, written to disk
bump minor -w

# Full update with tests
bump latest -w --execute "pnpm test"

# Paranoid mode: verify each dep individually
bump -w --verify-command "pnpm test && pnpm typecheck"

# Only check a specific package
bump --include "typescript"

# Skip fresh releases
bump --cooldown 7

# CI pipeline check
bump --fail-on-outdated --output json

# Update everything interactively with explanations
bump latest -wIE --long

# Global package audit
bump -g --all

# Monorepo: specific directory
bump -C packages/core -w
```

---

## See Also

- [Configuration](./configuration.md) -- `.bumprc`, `bump.config.ts`, and `package.json#bump`
- [Programmatic API](./api.md) -- using bump as a library with callbacks
- [Output Formats](./output-formats.md) -- JSON and SARIF schemas
