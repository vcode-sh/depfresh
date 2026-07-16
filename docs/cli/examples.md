# CLI Examples

A few real-world incantations for the copy-paste inclined.

## Basic Usage

```bash
# The basics: what's outdated?
depfresh

# Full CLI help and all flags
depfresh help

# Safe minor/patch updates, written to disk
depfresh minor -w

# Review a lockfile sync and exact verification command
depfresh plan --json --sync-lockfile --verify-argv '["pnpm","test"]' > depfresh-plan.json
depfresh apply --json --write --sync-lockfile --verify --plan-file depfresh-plan.json
```

## Filtering

```bash
# Only check a specific package
depfresh --include "typescript"

# Skip fresh releases
depfresh --cooldown 7

# Only production deps
depfresh --deps-only

# Everything except eslint plugins
depfresh --exclude "eslint-plugin-"
```

## Interactive

```bash
# Update everything interactively with explanations
depfresh latest -wIE --long

# Browse and cherry-pick
depfresh -wI
```

## CI / Automation

```bash
# CI pipeline check
depfresh --fail-on-outdated --output json

# JSON output for parsing
depfresh --output json | jq '.summary'

# Machine-discoverability contract
depfresh --help-json

# Safe update for automation
depfresh --write --mode minor
```

## Review Before Mutation

```bash
# Repository structure and evidence only; no registry or subprocess
depfresh inspect --json > depfresh-inspect.json

# Resolve candidates and exact future write operations; still no writes
depfresh plan --json > depfresh-plan.json

# Apply exactly that reviewed plan; no re-resolution
depfresh apply --json --write --plan-file depfresh-plan.json

# Reproducible cooldown evaluation
depfresh plan --json --cooldown 7 --as-of 2026-07-16T10:00:00.000Z
```

Exit `1` from `plan` means the document is valid and contains operations, material risks, or
explicitly incomplete decisions. Parse the document; reserve exit `2` for a fatal command error
document.

Exit `1` from `apply` is also a valid result: at least one operation is conflicted, reverted,
failed, or unknown. Re-plan after a stale conflict. Preserve retained lock and journal evidence
when recovery is incomplete or ownership is unknown.

## Global Packages

```bash
# Global package audit
depfresh -g --all

# Global audit across npm + pnpm + bun
depfresh --global-all --all

# Update all global packages
depfresh -gw

# Update all global package managers in one run
depfresh --global-all --write --output json
```

## Monorepos

```bash
# Specific directory
depfresh -C packages/core -w

# Scan everything
depfresh -r --all
```

---

## Planned Manager and Verification Phases

Manager work is part of an immutable plan, never an inferred post-write hook. Planning fingerprints
the exact declared manager/version, selected parsed lockfile hash, fixed lifecycle-disabled argv,
permitted paths, timeout, and optional verification argv. Apply requires matching fresh grants.

```bash
# Lockfile-only synchronization
depfresh plan --json --sync-lockfile > depfresh-plan.json
depfresh apply --json --write --sync-lockfile --plan-file depfresh-plan.json

# Stronger, explicitly non-transactional dependency install
depfresh plan --json --install > depfresh-plan.json
depfresh apply --json --write --install --plan-file depfresh-plan.json

# Exact verification argv after successful lockfile synchronization
depfresh plan --json --sync-lockfile --verify-argv '["pnpm","test"]' > depfresh-plan.json
depfresh apply --json --write --sync-lockfile --verify --plan-file depfresh-plan.json
```

Supported execution is limited to npm 10/11 with `package-lock.json` or `npm-shrinkwrap.json`, pnpm
10/11 with `pnpm-lock.yaml`, and Bun 1.2 through 1.x with text `bun.lock` on Linux and macOS. Yarn,
`bun.lockb`, Windows manager execution, manager fallback, shell strings, and legacy `--execute`,
`--update`, or `--verify-command` flows are rejected. Manager phases accept only registry-backed
`semver` and `npm:` alias occurrences; unsupported dependency protocols remain available to the
file-only plan and block manager execution before apply.

---

## Progress Display

When resolving dependencies in a TTY, depfresh shows a dual progress bar:

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

Table columns adapt to your terminal width. On wide terminals, everything fits. On narrow terminals, depfresh progressively shrinks columns in priority order: package name first, then current version, then target version, then source. Minimum widths are enforced so nothing collapses entirely -- if your terminal is 40 columns wide, names truncate with `...` but remain readable.

CJK characters and other double-width Unicode are measured correctly for column alignment. Combining marks and zero-width characters are handled. Package names like `@hanzi/测试` won't break the table layout.

Overflow handling only activates in TTY mode. Non-TTY output (JSON, piped text) preserves full column widths regardless of any terminal width setting.

---

## Interactive Mode

`--interactive` (or `-I`) launches a custom terminal UI where you can browse, drill into, and cherry-pick which dependencies to update. No React. No Ink. Just readline and raw mode doing honest work.

```bash
# Browse and select
depfresh -I

# Browse, select, and write
depfresh -wI

# With human-readable explanations
depfresh -wIE
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
- **Signature metadata presence** (presence does not prove verification or trust)

Pick any version with `Space` or `Enter` -- not just the one depfresh suggested. Press `left` / `h` / `Esc` to go back without changing anything.

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
- **minor** -- "Minor release. Review changes."
- **patch** -- "Patch release. Review changes."

Plus deprecation, missing signature-metadata, and unknown repository Node compatibility warnings
when relevant. These notes are review context, not a safety verdict.

### Non-TTY Fallback

Requires a TTY. If you're piping output, running in CI, or inside a non-interactive environment, depfresh falls back to a `@clack/prompts` grouped multiselect. Functional, just less fancy.

---

## Workspaces & Monorepos

### Recursive Scanning

`--recursive` (on by default) scans subdirectories for package manifests (`package.json`, `package.yaml`). It respects the `ignorePaths` config option, which defaults to:

```
**/node_modules/**
**/dist/**
**/coverage/**
**/.git/**
```

Set `--no-recursive` to restrict discovery to root manifest files only (`package.json`, `package.yaml`). In non-recursive mode, workspace catalog files are not loaded.

Use `--ignore-paths` to add extra skip rules without editing config:

```bash
depfresh --ignore-paths "apps/legacy/**,examples/**"
```

### Nested Workspaces

`--ignore-other-workspaces` (on by default) detects when a subdirectory belongs to a separate workspace (has its own workspace root) and skips it. This prevents depfresh from double-processing packages in monorepo-within-monorepo setups.

Disable with `--no-ignore-other-workspaces` if you genuinely want to process everything.

### Cache Refresh

Force fresh registry metadata for one run:

```bash
depfresh --refresh-cache
# alias:
depfresh --no-cache
```

### Catalog Support

depfresh understands workspace catalogs for **pnpm**, **bun**, and **yarn**:

- **pnpm**: Reads `catalog:` and `catalog:<name>` protocol references from `pnpm-workspace.yaml`
- **bun**: Reads `workspaces.catalog` and `workspaces.catalogs` from root `package.json`
- **yarn**: Reads catalog entries from `.yarnrc.yml`

Catalog dependencies are resolved alongside regular dependencies. When writing, depfresh updates
the physical catalog owner; package manifests keep their `catalog:` references unchanged.

Named `peers` catalogs are skipped unless `--peer` is enabled.
