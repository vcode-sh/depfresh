# Table output

The default CLI view shows the selected version changes and a short result. It highlights major
updates and concrete compatibility warnings without requiring a clean working tree.

## Columns

| Column | Meaning |
| --- | --- |
| dependency | Package name, grouped by its manifest or catalog owner. |
| current | The version expression currently in the file. |
| target | The selected replacement expression. |
| severity | Semver difference: Major, Minor, or Patch. |
| age | Publication age, shown only with `--timediff`. |

A major version is a reason to review migration notes, not proof that the application will break.
Conversely, an update within the same major version is not proof that it has no breaking changes.
Missing compatibility information is summarized once rather than repeated on every row.

## Example

The exact widths and separators adapt to the terminal. A small review can look like this:

```text
example - single package - major - read-only
1 package - 2 declared - 2 eligible - 2 updates - 1 file

Major 1 - Minor 1 - Patch 0
Major updates
alpha
  ^1.0.0 -> ^2.0.0 - example

example - package.json
  dependencies
dependency   current -> target   severity
alpha        ^1.0.0 -> ^2.0.0    Major
beta         ^1.0.0 -> ^1.1.0    Minor

Review complete - 2 updates across 1 file - write not attempted
```

Known changes to Node or peer requirements and target deprecation notices are advisory. They do
not claim that depfresh has tested the application against the new version. Registry discovery
failures identify the unresolved dependency and the actual cause; missing optional metadata does
not discard an otherwise resolved update.

## Display Options

| Option | Default | Behavior |
| --- | --- | --- |
| `--group`, `-G` | `true` | Group by dependency source. `--no-group` uses a flat list with a source column. |
| `--sort`, `-s` | `diff-asc` | Sort by semver difference, name, or publication time. |
| `--timediff`, `-T` | `false` | Fetch publication history and show release ages. |
| `--long`, `-L` | `false` | Show detailed operations, owners, occurrences, and write diagnostics. |
| `--all`, `-a` | `false` | Include packages without updates. |
| `--nodecompat` | `true` | Show available Node compatibility information without treating unknown as compatible. |
| `--explain`, `-E` | `false` | Show release-shape and metadata notes in interactive selection. |

Sort values are `diff-asc` (major first), `diff-desc` (patch first), `name-asc`, `name-desc`,
`time-asc` (oldest first), and `time-desc` (newest first). Time-based sorting, `newest`, and a
nonzero `cooldown` still require publication history even when the age column is hidden.

Ordinary checks use compact npm version metadata. `--timediff` opts into an advisory history
request; if it fails, resolved updates remain available and their ages stay unknown. Saved machine plans retain their own evidence
requirements.

## Compatibility Table Write Receipts

Library `check()` calls, interactive selection, global writes, and hook-controlled routes keep
their existing output surfaces. They share the same observed write outcomes. Use
[`--output json`](json.md) for machine-readable counts and per-occurrence results.

## Visual+ Result Journeys

### Complete

A successful write reports how many updates were applied and which files were affected. Existing
local edits do not require a commit or stash. Depfresh preserves unrelated content and the Git
index; `-w` does not run an install or lifecycle scripts.

### Safety block

If a selected file changes during the operation, has an unresolved merge conflict, or cannot be
safely read or written, the result states the cause and affected paths. A failure before any
replacement confirms that no files were changed. Repeated blocked/not-attempted booleans are not
part of the default summary.

### Partial renderer compatibility projection

If some writes were attempted, the result distinguishes applied, failed, and unattempted work.
The short presentation does not convert an incomplete or unobservable result into success.

### Recovery incomplete

When a write fails after replacement starts, the result identifies restored and unrecovered
paths. Preserve recovery evidence and resolve the named failure before retrying. See
[troubleshooting](../troubleshooting.md#apply-reports-a-lock-or-recovery-requirement).

### Counts, preflight, and atomicity

Update counts describe selected physical entries, not necessarily unique package names. Shared
catalog entries are written once. File replacement is atomic per file; a multi-file update is not
one atomic filesystem transaction. A saved `plan/apply` operation retains stricter preconditions
than an ordinary `-w` run.

### Public fallbacks and separate modes

Pipes, CI, `TERM=dumb`, and `NO_COLOR` retain readable output without unsupported terminal control
sequences. Width changes must not hide selected updates or alter their owners and versions.
`--long` exposes additional details; JSON retains structured outcomes.
