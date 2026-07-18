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

## Write Receipts

Write mode ends with one receipt grouped by repository-relative physical target, status, and
reason. Repeated occurrences with the same physical cause do not produce repeated warnings. For
example, a 2.0.x run that applied earlier package files before a later root preflight block reports:

```text
Partial result · 35 updates applied across 13 files; 1 file blocked
package.json · 41 updates not attempted
Preflight could not confirm Git state (VCS_UNAVAILABLE / VCS_OUTPUT_LIMIT_EXCEEDED)
Exit 2 · inspect the changed files before rerunning
```

`applied` means the requested occurrence value was observed after replacement. `reverted` means the
original value was observed after recovery, so the requested update was not retained; a receipt
with any reverted outcome is partial, reports reverted operation and physical-file counts, and
exits with code `2`. `failed` means a known operation failed; `unknown` means required evidence or
final state could not be confirmed. `VCS_UNAVAILABLE` is the compatibility outcome for a Git
preflight whose evidence could not be confirmed. The human receipt may add its narrower sanitized
cause, such as `VCS_OUTPUT_LIMIT_EXCEEDED`.

The 2.0.x compatibility flow still processes package writes sequentially. This receipt groups the
observed results; it does not claim command-level preflight or repository-wide atomicity. A partial,
failed, or unknown write exits with code `2`. Inspect the changed files before rerunning a partial
write. `Safety block · no files were changed` appears only when no applied or reverted outcome
exists and every blocked group proves replacement was not attempted. The receipt's `Exit` line uses
the final normal command exit code, including strict resolution or post-write failures; it is not
inferred from write outcomes alone.

## Contextual Tips

When updates exist, depfresh helpfully reminds you of things you probably already know:

- If you're in `default` mode: *"Run `depfresh major` to check for major updates"*
- If you haven't written: *"Add `-w` to write changes to package files"*

These only appear in table output. JSON users are assumed to know what they're doing.
