# CLI Examples

A few real-world incantations for the copy-paste inclined.

## Basic Usage

```bash
# The basics: what's outdated?
upgr

# Safe minor/patch updates, written to disk
upgr minor -w

# Full update with tests
upgr latest -w --execute "pnpm test"

# Paranoid mode: verify each dep individually
upgr -w --verify-command "pnpm test && pnpm typecheck"
```

## Filtering

```bash
# Only check a specific package
upgr --include "typescript"

# Skip fresh releases
upgr --cooldown 7

# Only production deps
upgr --deps-only

# Everything except eslint plugins
upgr --exclude "eslint-plugin-"
```

## Interactive

```bash
# Update everything interactively with explanations
upgr latest -wIE --long

# Browse and cherry-pick
upgr -wI
```

## CI / Automation

```bash
# CI pipeline check
upgr --fail-on-outdated --output json

# JSON output for parsing
upgr --output json | jq '.summary'

# Safe update for automation
upgr --write --mode minor
```

## Global Packages

```bash
# Global package audit
upgr -g --all

# Update all global packages
upgr -gw
```

## Monorepos

```bash
# Specific directory
upgr -C packages/core -w

# Scan everything
upgr -r --all
```

---

## Post-Write Hooks

### Execute

`--execute` runs a shell command once after all package files have been written. Only fires if `--write` is set and at least one file was actually modified.

```bash
# Run tests after updating
upgr -w --execute "pnpm test"

# Run a custom script
upgr -w -e "node scripts/post-update.js"
```

### Install / Update

`--install` and `--update` auto-detect your package manager (via `packageManager` field in `package.json`, then lockfile detection) and run `install` or `update` after writing.

```bash
# Write changes and reinstall
upgr -wi

# Write changes and run update instead
upgr -wu
```

If both are set, `--update` takes priority. Package manager detection order: `packageManager` field > lockfile (`bun.lock`/`bun.lockb` > `pnpm-lock.yaml` > `yarn.lock` > fallback to `npm`).

---

## Progress Display

When resolving dependencies in a TTY, upgr shows a dual progress bar:

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

Table columns adapt to your terminal width. On wide terminals, everything fits. On narrow terminals, upgr progressively shrinks columns in priority order: package name first, then current version, then target version, then source. Minimum widths are enforced so nothing collapses entirely -- if your terminal is 40 columns wide, names truncate with `...` but remain readable.

CJK characters and other double-width Unicode are measured correctly for column alignment. Combining marks and zero-width characters are handled. Package names like `@hanzi/测试` won't break the table layout.

Overflow handling only activates in TTY mode. Non-TTY output (JSON, piped text) preserves full column widths regardless of any terminal width setting.

---

## Interactive Mode

`--interactive` (or `-I`) launches a custom terminal UI where you can browse, drill into, and cherry-pick which dependencies to update. No React. No Ink. Just readline and raw mode doing honest work.

```bash
# Browse and select
upgr -I

# Browse, select, and write
upgr -wI

# With human-readable explanations
upgr -wIE
```

### List View

Dependencies grouped by source (`dependencies`, `devDependencies`, etc.) with colour-coded diff types. Navigate with arrow keys or vim bindings:

| Key | Action |
|-----|--------|
| `j` / `down` | Move down |
| `k` / `up` | Move up |
| `g` | Jump to first |
| `G` | Jump to last |
| `Space` | Toggle selection |
| `a` | Select / deselect all |
| `right` / `l` | Drill into version detail |
| `Enter` | Confirm selection |
| `Esc` / `q` | Cancel |
| `PgDn` / `PgUp` | Page scroll |

The viewport scrolls with your cursor. Overflow indicators (`^ more` / `v more`) appear when the list exceeds your terminal height. Resize your terminal and it adapts. Like furniture from IKEA, except it actually works first time.

### Detail View

Press `right` or `l` on any dependency to see every available version -- newest first, capped at 20. Each version shows:

- **Diff type** (major / minor / patch) with colour
- **Age** since publish (`~3d`, `~2mo`, `~1.5y`)
- **Dist-tags** (`latest`, `next`, etc.)
- **Deprecation** warnings
- **Node engine** requirements
- **Provenance** level

Pick any version with `Space` or `Enter` -- not just the one upgr suggested. Press `left` / `h` / `Esc` to go back without changing anything.

| Key | Action |
|-----|--------|
| `j` / `down` | Move down |
| `k` / `up` | Move up |
| `Space` / `Enter` | Select version and return to list |
| `left` / `h` / `Esc` | Back to list |
| `Ctrl+C` | Cancel everything |

### Explain Mode

Add `--explain` (or `-E`) to show human-readable descriptions next to each version in the detail view:

- **major** -- "Breaking change. Check migration guide."
- **minor** -- "New features. Backwards compatible."
- **patch** -- "Bug fixes only. Safe to update."

Plus deprecation, provenance, and Node compatibility warnings when relevant. For the AI agents and juniors who want context, not just numbers.

### Non-TTY Fallback

Requires a TTY. If you're piping output, running in CI, or inside a non-interactive environment, upgr falls back to a `@clack/prompts` grouped multiselect. Functional, just less fancy.

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

`--ignore-other-workspaces` (on by default) detects when a subdirectory belongs to a separate workspace (has its own workspace root) and skips it. This prevents upgr from double-processing packages in monorepo-within-monorepo setups.

Disable with `--no-ignore-other-workspaces` if you genuinely want to process everything.

### Catalog Support

upgr understands workspace catalogs for **pnpm**, **bun**, and **yarn**:

- **pnpm**: Reads `catalog:` and `catalog:<name>` protocol references from `pnpm-workspace.yaml`
- **bun**: Reads catalog entries from `bunfig.toml`
- **yarn**: Reads catalog entries from `.yarnrc.yml`

Catalog dependencies are resolved and updated alongside regular dependencies. When writing, upgr updates both the catalog source file and any `package.json` files that reference it.
