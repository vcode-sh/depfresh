# Migrating from taze

Switching from taze? Here's what you need to know. Most workflows translate directly -- the core CLI experience is intentionally similar.

## Quick Command Mapping

| taze | depfresh | Notes |
|------|----------|-------|
| `taze` | `depfresh` | Default check mode |
| `taze -w` | `depfresh -w` | Write updates |
| `taze -I` | `depfresh -I` | Interactive mode |
| `taze major` | `depfresh major` | Positional mode works the same |
| `taze --fail-on-outdated` | `depfresh --fail-on-outdated` | CI gate mode |
| `taze -C path` | `depfresh -C path` | Alternate working directory |

## Config Migration

### Rename files and config key

| taze | depfresh |
|------|----------|
| `.tazerc` | `.depfreshrc` |
| `taze.config.ts` / `taze.config.js` | `depfresh.config.ts` / `depfresh.config.js` |
| `package.json#taze` | `package.json#depfresh` |

### Update config import

```ts
// before
import { defineConfig } from 'taze'

// after
import { defineConfig } from 'depfresh'
```

Most config fields are compatible: `mode`, `include`, `exclude`, `packageMode`, `depFields`, `ignorePaths`, `peer`, `write`, and more.

## Behavioral Differences

These are the areas where depfresh works differently from taze. None of them should break existing workflows, but they're worth knowing about.

| Area | taze | depfresh |
|------|------|----------|
| Node runtime | Lower baseline | `>=24` |
| Structured output | Table-focused | `--output json` envelope |
| Machine discoverability | Not available | `--help-json` |
| Retry behavior | Limited retry paths | Exponential backoff with typed errors |
| Cache | JSON file | SQLite with WAL mode, memory fallback |
| Per-dependency rollback | Not available | `--verify-command` |
| GitHub deps (`github:`) | Incomplete support | Supported for semver tags |
| Peer-scoped catalogs | Inconsistent behavior | Skipped unless `--peer` is passed |

## depfresh-only Flags Worth Trying

| Flag | Use case |
|------|----------|
| `--output json` | CI pipelines, scripts, AI agents |
| `--help-json` | Machine-readable CLI contract |
| `--verify-command` | Safe incremental updates with per-dep rollback |
| `--execute` | Run a command once after writes |
| `--global-all` | Scan npm + pnpm + bun globals in one run |
| `--refresh-cache` / `--no-cache` | Force fresh metadata for one run |

## Migration Checklist

1. Upgrade Node to `>=24`.
2. Install depfresh and replace command invocations in scripts and CI.
3. Rename config files and config key (`taze` -> `depfresh`).
4. Update `defineConfig` import path.
5. Run `depfresh --help-json` once to validate automation assumptions.
6. Run `depfresh --output json` in CI dry-run and confirm parsers.
7. Run `depfresh -w --verify-command "<your tests>"` before your first large update.

## Validation Commands

```bash
# Basic check
depfresh

# CI-safe structured output
depfresh --output json --fail-on-outdated

# Safe write with per-dep rollback
depfresh -w --verify-command "pnpm test"
```

## Related

- [Coverage Matrix](./coverage-matrix.md) -- Full issue/PR tracking
- [Solved Issues](./solved-issues.md) -- Taze backlog items addressed by depfresh
- [CLI Flags](../cli/flags.md)
- [Troubleshooting](../troubleshooting.md)
