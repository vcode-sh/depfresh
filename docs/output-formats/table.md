# Table Output

The default format. A colourful table that makes your outdated dependencies look like a traffic light system for poor life choices.

```bash
depfresh --output table   # default -- for humans with eyeballs
# or just:
depfresh
```

## Columns

When exact workspace/catalog exclusions are requested, depfresh prints one durable line before
registry resolution, for example `Exclusions: 2 workspaces · 1 catalog · 34 occurrences`. If a
workspace exclusion leaves shared catalog owners eligible, a second concise note explains that
`--exclude-catalog` is required to exclude them. Progress rendering suspends around both lines.

| Column    | Description                                                  |
|-----------|--------------------------------------------------------------|
| **name**  | Package name. The thing you `npm install`-ed and forgot about. |
| **source**| Where it lives: `dependencies`, `devDependencies`, `overrides`, etc. Shown when `--group` is off. |
| **current** | What you've got.                                           |
| **target** | What you should have. The changed segments are colour-coded. |
| **diff**  | `major`, `minor`, or `patch`. Colour-coded so you know exactly how scared to be. |
| **age**   | How long ago the target version was published. Enabled by default (`--timediff`). |

## Colour Coding

I use colours like a responsible adult:

- **Red** -- `major` update. Breaking changes ahead. Godspeed.
- **Yellow** -- `minor` update. New features, theoretically backwards-compatible. Theoretically.
- **Green** -- `patch` update. Bug fixes. The safest bet you'll make all day.
- **Gray** -- `none`. Up to date. A rare and beautiful sight.

The target version itself gets partial colouring -- only the segments that actually changed light up. So `^2.1.0 -> ^2.3.0` highlights the `3.0` part. It's the small things.

Age colouring follows a similar scheme: green for recent (< 90 days), yellow for a few months, red for anything old enough to vote.

## Example

```
my-project

  dependencies
    name              current   target    diff     age
    --------------------------------------------------
    express           4.18.2 -> 4.21.0    minor    ~45d
    lodash            4.17.20-> 4.17.21   patch    ~2d

  devDependencies
    name              current   target    diff     age
    --------------------------------------------------
    typescript        5.3.2  -> 5.7.3     minor    ~12d
    vitest            1.2.0  -> 2.1.8     major    ~30d

  2 major | 1 minor | 1 patch  (4 total)
```

*(Actual output has ANSI colours. Your terminal is fancier than this markdown file.)*

## Display Options

**`--group` / `-G`** (default: `true`)
Groups updates by dependency source -- `dependencies`, `devDependencies`, `overrides`, and so on. Disable with `--no-group` for a flat list with a `source` column instead.

**`--sort` / `-s`** (default: `diff-asc`)
Controls row ordering. Options:

| Value       | What it does                             |
|-------------|------------------------------------------|
| `diff-asc`  | Patch first, then minor, then major. Easing you in gently. |
| `diff-desc` | Major first, then minor, then patch. The scary stuff on top. |
| `time-asc`  | Oldest first. Shaming your neglect.      |
| `time-desc` | Newest first. Fresh drama at the top.    |
| `name-asc`  | Alphabetical. For the orderly.           |
| `name-desc` | Reverse alphabetical. For the chaotic.   |

**`--timediff` / `-T`** (default: `true`)
Shows how long ago each target version was published. Disable with `--no-timediff` if ignorance is your coping strategy.

**`--long` / `-L`** (default: `false`)
Shows the package homepage URL beneath each row. For when you need to click through to the changelog and quietly panic.

**`--all` / `-a`** (default: `false`)
Shows all packages, including the ones that are actually up to date. A confidence boost, if you need one.

**`--nodecompat`** (default: `true`)
Displays legacy Node.js engine indicators. A green check or red cross is shown only when a caller
provided an evaluated result; `?node` means engine metadata exists but repository compatibility is
unknown. Use `depfresh plan --json` for the repository-declaration signal contract.

**`--explain` / `-E`** (default: `false`)
In the interactive detail view (`-I`), shows human-readable release-shape notes plus deprecation,
unknown repository Node compatibility, and missing signature-metadata warnings. Release shape and
passive registry presence are not safety or verification results.

## Compatibility Table Write Receipts

This section describes the grouped compatibility receipt used when Visual+ is not eligible, such
as library `check()` calls and routes with a direct or addon `beforePackageWrite` hook. The
underlying command-level write safety is shared, but the current eligible CLI journey has a
different final projection; see [Visual+ result journeys](#visual-result-journeys).

Write mode ends with one receipt grouped by repository-relative physical target, status, and
reason. Repeated occurrences with the same physical cause do not produce repeated warnings. For
example, a command whose later target becomes stale after an earlier per-file replacement reports:

```text
Partial result · 0 updates applied across 0 files; 1 update reverted across 1 file; 1 file blocked
package.json · 1 update reverted
Write reverted (COMMIT_FAILED_REVERTED)
packages/package.json · 1 update not attempted
Write conflicted (SOURCE_CHANGED)
Exit 2 · inspect the changed files and correct each blocked target before rerunning
```

`applied` means the requested occurrence value was observed after replacement. `reverted` means the
original value was observed after recovery, so the requested update was not retained; a receipt
with any reverted outcome is partial, reports reverted operation and physical-file counts, and
exits with code `2`. `failed` means a known operation failed; `unknown` means required evidence or
final state could not be confirmed. `VCS_UNAVAILABLE` is the compatibility outcome for a Git
preflight whose evidence could not be confirmed. The human receipt may add its narrower sanitized
cause, such as `VCS_OUTPUT_LIMIT_EXCEEDED`.

One local write command collects its selected physical targets, preflights all of them, and uses one
lock and journal lifecycle. Every individual file replacement is an atomic same-directory rename;
the repository as a whole is not an atomic transaction. A failure after one replacement starts
best-effort recovery, and incomplete recovery or final observation remains `unknown`. A partial,
failed, or unknown write exits with code `2`.

Inspect changed files before rerunning a partial write. `Safety block · no files were changed`
appears only when no applied or reverted outcome exists, exact command evidence proves every
blocking group was not attempted, and no journal, recovery path, external effect, or cleanup
uncertainty remains. The receipt's `Exit` line uses the final normal command exit code, including
strict resolution or post-write failures; it is not inferred from write outcomes alone. Guidance
says to fix the Git evidence problem only when every local blocking group is `VCS_UNAVAILABLE` and
no strict resolution, global write, or strict post-write failure also causes the final exit. Mixed
local causes use blocked-target guidance. When one of those non-local causes also exists, the
position-neutral guidance is
`Exit 2 · review all reported errors and correct each blocked target before rerunning`; for a
partial write it also tells the operator to review the changed files. Each receipt group retains
its exact local status and cause.

Global package-manager outcomes are rendered separately on stdout. Every sanitized non-applied
item uses its manager, package, status, and exact available reason, including failures detected
before a manager command can be planned and exact executor reasons when a global apply result
exists:

```text
Global write outcomes
npm · typescript · unknown · INVENTORY_TIMEOUT
```

These lines are not physical-file receipt groups and make no file-count or atomicity claim. Global
outcomes remain in their state-machine summary and are never counted as physical files.

The complete receipt is one ordered durable stdout block: headline, physical groups and reasons,
then final exit guidance. Receipt fragments are never split across stdout and stderr, including in
CI and pipes.

<a id="visual-result-journeys"></a>

## Visual+ Result Journeys

Visual+ is the eligible local CLI table journey. It renders repository topology, update
distribution, major-risk cards, owner impact, shared dependencies, the complete change list,
physical targets, lifecycle facts, and one final receipt. The Complete and Safety block examples
use the deterministic 76-operation, 14-target renderer fixture. Partial and Recovery incomplete
use smaller renderer-contract inputs; Partial remains the synthetic/future-producer projection
qualified below. All are exact final-receipt excerpts. Long maps and change rows are omitted from
this page, not hidden by the command.

The journey is eligible only through CLI progress routing with table output, a non-silent log
level, local non-global operation, no interactive selection, and no direct or addon
`beforePackageWrite` hook. Library `check()` calls and veto-capable hook routes use the
compatibility table surface above.

A capable terminal uses Unicode separators, colour, and replaceable lifecycle frames. A plain
fallback is append-only and colourless. Its map sections use ASCII, while existing receipt
punctuation still follows Unicode capability: CI and ordinary pipes can retain `·`, and
`TERM=dumb` makes the whole journey ASCII. Width changes wrapping only. These snippets pair the
capable form with the public plain `TERM=dumb` form.

### Complete

Capable terminal:

```text
Complete · 76 updates applied across 14 files
Applied 76  Blocked 0  Not attempted 0  Failed 0  Unknown 0
All 14 target files were observed at the requested values. Recovery was not needed. 2.4s.
Exit 0
```

Plain `TERM=dumb` fallback:

```text
Complete - 76 updates applied across 14 files
Applied 76  Blocked 0  Not attempted 0  Failed 0  Unknown 0
All 14 target files were observed at the requested values. Recovery was not needed. 2.4s.
Exit 0
```

`Exit 0` means every selected value was observed at its requested final value and recovery was not
needed. The duration is measured, so its value varies.

### Safety block

Capable terminal:

```text
Safety block · no files were changed
Applied 0  Blocked 0  Not attempted 76  Failed 0  Unknown 76
Preflight could not confirm Git state for packages/target-0/package.json.
Preflight could not confirm Git state for packages/target-1/package.json.
Preflight could not confirm Git state for packages/target-2/package.json.
Preflight could not confirm Git state for packages/target-3/package.json.
Preflight could not confirm Git state for packages/target-4/package.json.
Preflight could not confirm Git state for packages/target-5/package.json.
Preflight could not confirm Git state for packages/target-6/package.json.
Preflight could not confirm Git state for packages/target-7/package.json.
Preflight could not confirm Git state for packages/target-8/package.json.
Preflight could not confirm Git state for packages/target-9/package.json.
Preflight could not confirm Git state for packages/target-10/package.json.
Preflight could not confirm Git state for packages/target-11/package.json.
Preflight could not confirm Git state for packages/target-12/package.json.
Preflight could not confirm Git state for packages/target-13/package.json.
Exit 2
```

Plain `TERM=dumb` fallback:

```text
Safety block - no files were changed
Applied 0  Blocked 0  Not attempted 76  Failed 0  Unknown 76
Preflight could not confirm Git state for packages/target-0/package.json.
Preflight could not confirm Git state for packages/target-1/package.json.
Preflight could not confirm Git state for packages/target-2/package.json.
Preflight could not confirm Git state for packages/target-3/package.json.
Preflight could not confirm Git state for packages/target-4/package.json.
Preflight could not confirm Git state for packages/target-5/package.json.
Preflight could not confirm Git state for packages/target-6/package.json.
Preflight could not confirm Git state for packages/target-7/package.json.
Preflight could not confirm Git state for packages/target-8/package.json.
Preflight could not confirm Git state for packages/target-9/package.json.
Preflight could not confirm Git state for packages/target-10/package.json.
Preflight could not confirm Git state for packages/target-11/package.json.
Preflight could not confirm Git state for packages/target-12/package.json.
Preflight could not confirm Git state for packages/target-13/package.json.
Exit 2
```

This headline is reserved for exact evidence that no replacement was attempted, no selected file
changed, and no recovery, journal, external-effect, or cleanup uncertainty remains. Here all 76
operations are both not attempted and unknown because Git evidence could not be confirmed; the 14
reasons identify physical targets rather than duplicating one line per operation.

### Partial renderer compatibility projection

`Partial` is a canonical renderer projection retained for compatibility with synthetic/internal
inputs and a possible future producer. The current command apply engine does not produce this
headline in an eligible Visual+ CLI run: after any replacement starts, a failure enters recovery
and the renderer prioritizes `Recovered`, `Recovery incomplete`, or `Recovery unknown`. The
currently reachable human partial surface is the
[compatibility `Partial result`](#compatibility-table-write-receipts) shown above.

Capable terminal:

```text
Partial
Applied 1  Blocked 0  Not attempted 1  Failed 1  Unknown 0
Applied: package.json
Restored: none
Unrecovered: none
Exit 2
```

Plain `TERM=dumb` fallback:

```text
Partial
Applied 1  Blocked 0  Not attempted 1  Failed 1  Unknown 0
Applied: package.json
Restored: none
Unrecovered: none
Exit 2
```

For this renderer contract, `Partial` means at least one requested value was retained while another
operation remained incomplete. Recovery was not needed or executed in the synthetic projection, so
there is no journal, restored path, unrecovered path, or external effect. Do not treat this example
as evidence that the current eligible CLI engine can reach the headline.

### Recovery incomplete

Capable terminal:

```text
Recovery incomplete
Applied 1  Blocked 1  Not attempted 1  Failed 0  Unknown 0  Reverted 1
Applied: mixed/package.json
Restored: reverted/package.json
Unrecovered: mixed/package.json
Journal: journal-mixed
External effects: install tree may have changed
Exit 2
```

Plain `TERM=dumb` fallback:

```text
Recovery incomplete
Applied 1  Blocked 1  Not attempted 1  Failed 0  Unknown 0  Reverted 1
Applied: mixed/package.json
Restored: reverted/package.json
Unrecovered: mixed/package.json
Journal: journal-mixed
External effects: install tree may have changed
Exit 2
```

For the current eligible CLI engine, a post-replacement failure enters recovery and this recovery
headline takes precedence over the renderer compatibility projection above. A fully restored run
uses `Recovered`; unobservable recovery uses `Recovery unknown`. Preserve the journal, inspect all
named paths and external effects, and stop competing writers before retrying. Never delete retained
evidence merely to make a later run proceed.

### Counts, preflight, and atomicity

The totals line counts selected operations, not files:

- `Applied` -- the requested value was observed after replacement.
- `Blocked` -- authoritative policy or safety evidence blocked the operation.
- `Not attempted` -- replacement was proved not to have started.
- `Failed` -- a known operation failed.
- `Unknown` -- required evidence or final state could not be confirmed.
- `Skipped` and `Reverted` appear when nonzero; `Mixed targets` is a physical-target count.

These are evidence flags, not a partition: one operation can be both blocked and not attempted, or
both unknown and not attempted. Headlines and `across N files` clauses provide physical-file
counts.

Before the first replacement, one local write command collects and preflights every selected
physical target, including exact target Git state. It rechecks target evidence before replacement,
then uses one lock and journal lifecycle. Each file is staged beside its source and replaced by an
atomic same-directory rename. Multiple renames do not make the repository atomic. A later failure
therefore starts best-effort recovery across files; unobservable or incomplete recovery stays
unknown and exits `2`.

### Public fallbacks and separate modes

- A capable local TTY uses colour and motion. `NO_COLOR` removes colour but retains recognized
  lifecycle motion. A narrow capable TTY changes wrapping only and also retains motion.
- Non-TTY pipes and CI are colourless, append-only, and complete. Direct table pipes also print a
  stderr hint recommending `--output json` for structured consumption.
- `TERM=dumb` is append-only ASCII. Narrow terminals wrap semantic fields rather than dropping
  rows, targets, paths, counts, or final evidence.
- `--interactive` uses its selection UI and does not use Visual+.
- `--output json` keeps the schema-v1 compatibility envelope and `writeOutcomes`; it does not add
  Visual+ maps, frames, or receipt-only fields.
- `--global` and `--global-all` keep manager-specific outcomes and non-transactional global
  semantics. Global items are never counted as local files.

For compatibility and Visual+ local table writes, a complete write exits `0`; a safety block,
failed result, unknown result, or recovery result exits `2`. A reachable compatibility
`Partial result` also exits `2`. A read-only check still exits `0` unless `--fail-on-outdated`
requests `1`. Versioned `apply --json` uses its separate `0`/`1`/`2` machine contract.

## Contextual Tips

When updates exist, depfresh helpfully reminds you of things you probably already know:

- If you're in `default` mode: *"Run `depfresh major` to check for major updates"*
- If you haven't written: *"Add `-w` to write changes to package files"*

These only appear in table output. JSON users are assumed to know what they're doing.
