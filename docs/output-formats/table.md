# Table Output

The default format. A colourful table that makes your outdated dependencies look like a traffic light system for poor life choices.

```bash
bump --output table   # default -- for humans with eyeballs
# or just:
bump
```

## Columns

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
Displays Node.js engine compatibility indicators next to each update. A green checkmark means you're fine. A red cross means the target version has opinions about your Node version.

**`--explain` / `-E`** (default: `false`)
In the interactive detail view (`-I`), shows human-readable explanations next to each version: "Breaking change. Check migration guide." for majors, "Bug fixes only. Safe to update." for patches. Plus deprecation and provenance warnings. Patronising? Maybe. Useful when you're staring at 6 versions of typescript at midnight? Definitely.

## Contextual Tips

When updates exist, bump helpfully reminds you of things you probably already know:

- If you're in `default` mode: *"Run `bump major` to check for major updates"*
- If you haven't written: *"Add `-w` to write changes to package files"*

These only appear in table output. JSON users are assumed to know what they're doing.
