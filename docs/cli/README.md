# CLI Reference

The complete field manual for `depfresh`. Every flag, every trick, every questionable life choice that led to this many options.

## Pages

- **[Flags](./flags.md)** -- All CLI flags, sorted by category: core, filtering, display, post-write, and behavior. The reference you'll actually bookmark.

- **[Modes](./modes.md)** -- Version range modes explained: `default`, `major`, `minor`, `patch`, `latest`, `newest`, and `next`, plus the legacy `packageMode` ignore translation.

- **[Examples](./examples.md)** -- Real-world incantations, interactive mode, workspaces, progress display, table rendering, and CI usage. The copy-paste page.

## Quick Start

```bash
# Check what's outdated
depfresh

# Safe minor/patch updates
depfresh minor -w

# Interactive cherry-picking
depfresh -wI

# CI pipeline
depfresh --fail-on-outdated --output json

# Process-free repository evidence
depfresh inspect --json

# Registry-aware plan without writes
depfresh plan --json
```

## Machine Commands

`inspect` and `plan` are commands, not range modes. Both require `--json` or `--output json`, write
one versioned schema-valid document to stdout, and reject write, interactive, post-write, and global
flags before discovery. See [Inspect and Plan Contracts](../output-formats/inspect-plan.md) for
schemas, fingerprints, side-effect boundaries, and exit codes.

## See Also

- [Configuration](../configuration/) -- `.depfreshrc`, `depfresh.config.ts`, and `package.json#depfresh`
- [Programmatic API](../api/) -- using depfresh as a library with callbacks
- [Output Formats](../output-formats/) -- legacy JSON, inspect/plan schemas, and table behavior
