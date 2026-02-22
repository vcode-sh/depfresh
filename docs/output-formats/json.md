# JSON Output

```bash
upgr --output json
# or the short version:
upgr -o json
```

Spits out a single JSON envelope to stdout. All log output is automatically suppressed -- `--output json` forces log level to `silent`, so your JSON won't have random info messages photobombing the payload.

## Schema

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

## Field Reference

### `packages[]`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Package name (from `package.json` `name` field) |
| `updates` | `array` | List of outdated dependencies in this package |

### `packages[].updates[]`

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

### `summary`

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total number of outdated dependencies across all packages |
| `major` | `number` | Count of major updates |
| `minor` | `number` | Count of minor updates |
| `patch` | `number` | Count of patch updates |
| `packages` | `number` | Number of packages in the output |

### `meta`

| Field | Type | Description |
|-------|------|-------------|
| `cwd` | `string` | Working directory upgr ran in |
| `mode` | `string` | Range mode used: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next` |
| `timestamp` | `string` | ISO 8601 timestamp of when the check ran |

## Notes

- When `--all` is set, packages with zero updates still appear in the `packages` array with an empty `updates` list.
- The `deprecated` field is only present when the target version is actually deprecated. Don't go looking for `"deprecated": false` -- it just won't be there.
- Same for `publishedAt` and `currentVersionTime` -- they're omitted when the registry doesn't provide time data.

## AI Agent Integration

upgr was built with AI agents in mind. Not because I think they'll replace us -- just because parsing ANSI escape codes is nobody's idea of a good time.

### Recommended Flags

```bash
upgr --output json --loglevel silent
```

Though `--loglevel silent` is redundant with `--output json` since JSON mode forces silent anyway. But explicit is fine. I respect the paranoia.

### TTY Detection

upgr auto-detects non-TTY environments:
- Progress bars (package + dependency resolution) are suppressed
- Interactive TUI falls back to `@clack/prompts` (or is skipped entirely if stdin isn't a TTY)
- Table columns don't truncate (no terminal width to respect)
- `ansis` respects the `NO_COLOR` environment variable

So piping `upgr` output into another process Just Works without extra flags.

### Common Workflows

**Check and parse:**
```bash
upgr --output json | jq '.summary'
```

**Safe update -- minor and patch only:**
```bash
upgr --write --mode minor
```

**Selective update -- specific packages:**
```bash
upgr --write --include "typescript,vitest"
```

**Full update -- everything to latest:**
```bash
upgr --write --mode latest
```

**CI gate -- fail if anything is outdated:**
```bash
upgr --fail-on-outdated --output json
# exits 1 if updates found, 0 if all current
```

### Programmatic API

If flags aren't enough, the library export gives you callbacks for surgical control:

```typescript
import { check } from 'upgr'

await check({
  cwd: process.cwd(),
  mode: 'default',
  output: 'json',
  onDependencyResolved(pkg, dep) {
    // called as each dependency resolves -- streaming progress
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

See the [API documentation](../api/) for the full callback reference.
