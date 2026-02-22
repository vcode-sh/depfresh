# Output Formats

Because apparently "printing text to a terminal" needs a whole document now.

bump supports three output formats. Well, two and a half — one of them doesn't exist yet. I'll explain.

```bash
bump --output table   # default — for humans with eyeballs
bump --output json    # for machines, scripts, and AI agents
bump --output sarif   # for... eventually (not implemented yet)
```

---

## Table Output (default)

The default format. A colourful table that makes your outdated dependencies look like a traffic light system for poor life choices.

### Columns

| Column    | Description                                                  |
|-----------|--------------------------------------------------------------|
| **name**  | Package name. The thing you `npm install`-ed and forgot about. |
| **source**| Where it lives: `dependencies`, `devDependencies`, `overrides`, etc. Shown when `--group` is off. |
| **current** | What you've got.                                           |
| **target** | What you should have. The changed segments are colour-coded. |
| **diff**  | `major`, `minor`, or `patch`. Colour-coded so you know exactly how scared to be. |
| **age**   | How long ago the target version was published. Enabled by default (`--timediff`). |

### Colour Coding

I use colours like a responsible adult:

- **Red** — `major` update. Breaking changes ahead. Godspeed.
- **Yellow** — `minor` update. New features, theoretically backwards-compatible. Theoretically.
- **Green** — `patch` update. Bug fixes. The safest bet you'll make all day.
- **Gray** — `none`. Up to date. A rare and beautiful sight.

The target version itself gets partial colouring — only the segments that actually changed light up. So `^2.1.0 -> ^2.3.0` highlights the `3.0` part. It's the small things.

Age colouring follows a similar scheme: green for recent (< 90 days), yellow for a few months, red for anything old enough to vote.

### Example

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

### Display Options

**`--group` / `-G`** (default: `true`)
Groups updates by dependency source — `dependencies`, `devDependencies`, `overrides`, and so on. Disable with `--no-group` for a flat list with a `source` column instead.

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

### Contextual Tips

When updates exist, bump helpfully reminds you of things you probably already know:

- If you're in `default` mode: *"Run `bump major` to check for major updates"*
- If you haven't written: *"Add `-w` to write changes to package files"*

These only appear in table output. JSON users are assumed to know what they're doing.

---

## JSON Output

```bash
bump --output json
# or the short version:
bump -o json
```

Spits out a single JSON envelope to stdout. All log output is automatically suppressed — `--output json` forces log level to `silent`, so your JSON won't have random info messages photobombing the payload.

### Schema

```json
{
  "packages": [
    {
      "name": "my-project",
      "updates": [
        {
          "name": "express",
          "current": "^4.18.2",
          "target": "^4.21.0",
          "diff": "minor",
          "source": "dependencies",
          "publishedAt": "2024-10-08T14:23:00.000Z",
          "currentVersionTime": "2024-01-15T10:00:00.000Z"
        },
        {
          "name": "leftpad",
          "current": "^1.0.0",
          "target": "^1.0.1",
          "diff": "patch",
          "source": "dependencies",
          "deprecated": "no longer maintained",
          "publishedAt": "2016-03-28T00:00:00.000Z"
        }
      ]
    }
  ],
  "summary": {
    "total": 2,
    "major": 0,
    "minor": 1,
    "patch": 1,
    "packages": 1
  },
  "meta": {
    "cwd": "/path/to/project",
    "mode": "default",
    "timestamp": "2026-02-22T12:00:00.000Z"
  }
}
```

### Field Reference

#### `packages[]`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Package name (from `package.json` `name` field) |
| `updates` | `array` | List of outdated dependencies in this package |

#### `packages[].updates[]`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Dependency name |
| `current` | `string` | Current version (including range prefix) |
| `target` | `string` | Target version to update to |
| `diff` | `string` | One of `major`, `minor`, `patch` |
| `source` | `string` | Where the dep lives: `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`, `pnpm.overrides`, `catalog`, `packageManager` |
| `deprecated` | `string \| boolean` | Deprecation notice, if the target is deprecated. Omitted when not deprecated. |
| `publishedAt` | `string` | ISO 8601 date when the target version was published. Omitted if unavailable. |
| `currentVersionTime` | `string` | ISO 8601 date when the current version was published. Omitted if unavailable. |

#### `summary`

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total number of outdated dependencies across all packages |
| `major` | `number` | Count of major updates |
| `minor` | `number` | Count of minor updates |
| `patch` | `number` | Count of patch updates |
| `packages` | `number` | Number of packages in the output |

#### `meta`

| Field | Type | Description |
|-------|------|-------------|
| `cwd` | `string` | Working directory bump ran in |
| `mode` | `string` | Range mode used: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next` |
| `timestamp` | `string` | ISO 8601 timestamp of when the check ran |

### Notes

- When `--all` is set, packages with zero updates still appear in the `packages` array with an empty `updates` list.
- The `deprecated` field is only present when the target version is actually deprecated. Don't go looking for `"deprecated": false` — it just won't be there.
- Same for `publishedAt` and `currentVersionTime` — they're omitted when the registry doesn't provide time data.

---

## SARIF Output

```bash
bump --output sarif
```

The type exists in the codebase. The implementation does not. It's on the roadmap.

SARIF (Static Analysis Results Interchange Format) would make bump's output consumable by GitHub Code Scanning, VS Code, and other tools that speak the format. When it lands, you'll be the first to know. Well, second — I'll know first.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | All dependencies are up to date, or updates were written successfully with `--write` |
| `1`  | Outdated dependencies found (only when `--fail-on-outdated` is set, without `--write`) |
| `2`  | Something went wrong — network error, parse failure, registry timeout, etc. |

The `--fail-on-outdated` flag is designed for CI pipelines. Without it, finding outdated deps still exits `0` because I'm not here to break your build over a patch bump.

---

## AI Agent Integration

bump was built with AI agents in mind. Not because I think they'll replace us — just because parsing ANSI escape codes is nobody's idea of a good time.

### Recommended Flags

```bash
bump --output json --loglevel silent
```

Though `--loglevel silent` is redundant with `--output json` since JSON mode forces silent anyway. But explicit is fine. I respect the paranoia.

### TTY Detection

bump auto-detects non-TTY environments:
- Progress bars (package + dependency resolution) are suppressed
- Interactive TUI falls back to `@clack/prompts` (or is skipped entirely if stdin isn't a TTY)
- Table columns don't truncate (no terminal width to respect)
- `ansis` respects the `NO_COLOR` environment variable

So piping `bump` output into another process Just Works without extra flags.

### Common Workflows

**Check and parse:**
```bash
bump --output json | jq '.summary'
```

**Safe update — minor and patch only:**
```bash
bump --write --mode minor
```

**Selective update — specific packages:**
```bash
bump --write --include "typescript,vitest"
```

**Full update — everything to latest:**
```bash
bump --write --mode latest
```

**CI gate — fail if anything is outdated:**
```bash
bump --fail-on-outdated --output json
# exits 1 if updates found, 0 if all current
```

### Programmatic API

If flags aren't enough, the library export gives you callbacks for surgical control:

```typescript
import { check } from 'bump-cli'

await check({
  cwd: process.cwd(),
  mode: 'default',
  output: 'json',
  onDependencyResolved(pkg, dep) {
    // called as each dependency resolves — streaming progress
  },
  beforePackageWrite(pkg) {
    // return false to skip writing this package
    return true
  },
  afterPackageWrite(pkg) {
    // called after each package file is written
  },
})
```

See the [API documentation](./api.md) for the full callback reference.
