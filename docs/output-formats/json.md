# Legacy Check JSON Output

This schema-v1 envelope is the compatibility report produced by `check()`. It intentionally keeps
absolute cwd/discovery paths and a volatile timestamp. It is useful for reports, but it is not an
immutable dependency plan and does not validate as `depfresh.plan`. Use
[`depfresh plan --json`](./inspect-plan.md) when exact operations and fingerprints are required.

```bash
depfresh --output json
# or the short version:
depfresh -o json
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
  "errors": [],
  "writeOutcomes": [],
  "summary": {
    "total": 2,
    "major": 0,
    "minor": 1,
    "patch": 1,
    "packages": 1,
    "scannedPackages": 1,
    "packagesWithUpdates": 1,
    "plannedUpdates": 0,
    "appliedUpdates": 0,
    "revertedUpdates": 0,
    "skippedUpdates": 0,
    "conflictedUpdates": 0,
    "failedWrites": 0,
    "unknownWrites": 0,
    "failedResolutions": 0
  },
  "meta": {
    "schemaVersion": 1,
    "cwd": "/path/to/project",
    "effectiveRoot": "/path/to/project",
    "mode": "default",
    "timestamp": "2026-02-22T12:00:00.000Z",
    "noPackagesFound": false,
    "hadResolutionErrors": false,
    "didWrite": false
  },
  "discovery": {
    "inputCwd": "/path/to/project/src",
    "effectiveRoot": "/path/to/project",
    "discoveryMode": "inside-project",
    "matchedManifests": ["/path/to/project/package.json"],
    "loadedPackages": ["/path/to/project/package.json"],
    "skippedManifests": [],
    "loadedCatalogs": []
  },
  "profile": {
    "discoveryMs": 3.1,
    "resolutionMs": 42.7,
    "postWriteMs": 0,
    "totalMs": 48.9,
    "cacheHits": 12,
    "cacheMisses": 4,
    "cacheEntries": 30,
    "networkFetches": 4,
    "dedupeHits": 2,
    "scannedPackages": 2,
    "scannedDependencies": 14,
    "failedResolutions": 0
  }
}
```

## Field Reference

When exact workspace/catalog flags are present, the compatibility envelope adds `selection` with
requested literal identities, matched workspace/catalog/physical-owner counts, bound occurrence
IDs, excluded occurrence count, and eligible shared catalog-owner count. The field is omitted when
no such flag was requested. Counts are derived after repository binding; they are not copied from
argv.

### `packages[]`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Package name (from manifest `name` field in `package.json` or `package.yaml`) |
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
| `scannedPackages` | `number` | Number of package files scanned in this run |
| `packagesWithUpdates` | `number` | Number of scanned packages that had at least one available update |
| `plannedUpdates` | `number` | Number of dependency updates planned for write attempts (`--write`) |
| `appliedUpdates` | `number` | Number of planned updates successfully applied |
| `revertedUpdates` | `number` | Compatibility counter for observed reverted writes; exact machine apply outcomes live in `depfresh.apply` |
| `skippedUpdates` | `number` | Number of physical occurrences intentionally left unchanged |
| `conflictedUpdates` | `number` | Number of occurrences whose observed pre-write value differed from the expected value |
| `failedWrites` | `number` | Number of occurrences with a definite read, parse, write, or observation failure |
| `unknownWrites` | `number` | Number of occurrences whose final physical state could not be proven |
| `failedResolutions` | `number` | Number of dependencies that failed to resolve from the registry |

The six write-state counts are derived from `writeOutcomes`; they always add up to
`plannedUpdates`.

### `writeOutcomes[]`

Each write request is reported by canonical physical occurrence rather than package name alone.
Repeated names in another field, file, catalog, nested override, or global package manager remain
separate records.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Dependency name at this occurrence |
| `occurrence.file` | `string` | Canonical physical file path, or `global:<manager>` for a global occurrence |
| `occurrence.path` | `string[]` | Exact nested field/key path within the physical source |
| `expectedValue` | `string` | Exact value required before mutation |
| `requestedValue` | `string` | Exact value requested by the write |
| `observedValue` | `string` | Value observed after the attempt, when observation succeeded |
| `status` | `string` | `applied`, `skipped`, `conflicted`, `reverted`, `failed`, or `unknown` |
| `reason` | `string` | Stable machine-readable reason for the terminal status |

The complete JSON envelope is redacted immediately before serialization. Credential-bearing
dependency values, observed write outcomes, authorization assignments, URL userinfo, and sensitive
query parameters retain their structural fields but replace secret material with `[REDACTED]`.

### `globalResults[]`

Global write runs add one strict `depfresh.global-apply` result for each compatibility write
projection. Each result contains manager-specific items and commands, reconciled summary totals,
`rollback: "not-supported"`, and a run status derived only from item outcomes. Consumers must not
infer global success from `writeOutcomes` alone. The full contract is documented in
[Global Apply](./global-apply.md).

### `meta`

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `number` | JSON contract schema version (`1`) |
| `cwd` | `string` | Original cwd requested by the user |
| `effectiveRoot` | `string` | Derived root used for discovery and root-aware operations |
| `mode` | `string` | Range mode used: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next` |
| `timestamp` | `string` | ISO 8601 timestamp of when the check ran |
| `noPackagesFound` | `boolean` | `true` when no package files were discovered in the target workspace |
| `hadResolutionErrors` | `boolean` | `true` when at least one dependency failed to resolve |
| `didWrite` | `boolean` | `true` when at least one update was written and kept on disk |

### `errors[]`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Dependency name that failed to resolve |
| `source` | `string` | Dependency field where it came from |
| `currentVersion` | `string` | The current version/range seen in the manifest |
| `message` | `string` | Error description |

Fatal input and runtime failures use a single error envelope instead of `packages`:

```json
{
  "error": {
    "code": "ERR_CONFIG",
    "reason": "UNKNOWN_OPTION",
    "message": "Unknown option: --wat",
    "retryable": false
  },
  "meta": {
    "schemaVersion": 1,
    "cwd": "/path/to/project",
    "mode": "default",
    "timestamp": "2026-07-15T12:00:00.000Z"
  }
}
```

`reason` is the stable machine-specific classification. Messages and nested failure details use the
same whole-envelope redaction boundary described above.

### `discovery`

Present only when `--explain-discovery` is enabled.

| Field | Type | Description |
|-------|------|-------------|
| `inputCwd` | `string` | Original cwd requested by the user |
| `effectiveRoot` | `string` | Derived root used for discovery |
| `discoveryMode` | `string` | One of `direct-root`, `inside-project`, `parent-folder` |
| `matchedManifests` | `string[]` | Manifest paths matched during discovery |
| `loadedPackages` | `string[]` | Package manifests successfully loaded |
| `skippedManifests` | `array` | Manifest paths skipped with reasons |
| `loadedCatalogs` | `string[]` | Catalog identifiers loaded during discovery |

### `profile`

Present only when `--profile` is enabled.

| Field | Type | Description |
|-------|------|-------------|
| `discoveryMs` | `number` | Time spent discovering packages and catalogs |
| `resolutionMs` | `number` | Time spent resolving dependencies |
| `postWriteMs` | `number` | Compatibility timing field; legacy shell post-write paths are rejected |
| `totalMs` | `number` | Total wall-clock time for the run |
| `cacheHits` | `number` | Cache hits during the run |
| `cacheMisses` | `number` | Cache misses during the run |
| `cacheEntries` | `number` | Number of live cache entries after the run |
| `networkFetches` | `number` | Actual network fetches started |
| `dedupeHits` | `number` | In-flight dedupe hits during the run |
| `scannedPackages` | `number` | Number of packages discovered |
| `scannedDependencies` | `number` | Number of update-eligible dependencies scanned |
| `failedResolutions` | `number` | Number of dependency resolution failures |

## Notes

- When `--all` is set, packages with zero updates still appear in the `packages` array with an empty `updates` list.
- The `deprecated` field is only present when the target version is actually deprecated. Don't go looking for `"deprecated": false` -- it just won't be there.
- Same for `publishedAt` and `currentVersionTime` -- they're omitted when the registry doesn't provide time data.
- You can distinguish all major outcomes without guessing:
  - `meta.noPackagesFound: true` means no package files were found.
  - `meta.noPackagesFound: false` and `summary.total: 0` means packages were found but already up to date.
  - `meta.hadResolutionErrors: true` means the run had registry resolution failures even if `summary.total` is `0`.
  - `summary.plannedUpdates > 0` and `summary.appliedUpdates: 0` with `summary.revertedUpdates > 0` means the compatibility write flow observed recovery to the original values.
  - Any conflicted, failed, or unknown compatibility write exits with code `2`; retired post-write options are rejected
    after such an outcome.

## AI Agent Integration

depfresh was built with AI agents in mind. Not because I think they'll replace us -- just because parsing ANSI escape codes is nobody's idea of a good time.

### Recommended Flags

```bash
depfresh --output json --loglevel silent
```

Though `--loglevel silent` is redundant with `--output json` since JSON mode forces silent anyway. But explicit is fine. I respect the paranoia.

Discover supported flags/values before automation:

```bash
depfresh --help-json
```

### TTY Detection

depfresh auto-detects non-TTY environments:
- Progress bars (package + dependency resolution) are suppressed
- Interactive TUI falls back to `@clack/prompts` (or is skipped entirely if stdin isn't a TTY)
- Table columns don't truncate (no terminal width to respect)
- `ansis` respects the `NO_COLOR` environment variable

So piping `depfresh` output into another process Just Works without extra flags.

### Common Workflows

**Check and parse:**
```bash
depfresh --output json | jq '.summary'
```

**Safe update -- minor and patch only:**
```bash
depfresh --write --mode minor
```

**Selective update -- specific packages:**
```bash
depfresh --write --include "typescript,vitest"
```

**Full update -- everything to latest:**
```bash
depfresh --write --mode latest
```

**CI gate -- fail if anything is outdated:**
```bash
depfresh --fail-on-outdated --output json
# exits 1 if updates found, 0 if all current
```

### Programmatic API

If flags aren't enough, the library export gives you callbacks for surgical control:

```typescript
import { check } from 'depfresh'

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
