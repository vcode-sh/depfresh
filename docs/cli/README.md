# CLI Reference

The complete field manual for `depfresh`. Every flag, every trick, every questionable life choice that led to this many options.

## Pages

- **[Flags](./flags.md)** -- All CLI flags, sorted by category: core, filtering, display, planned manager phases, and behavior. The reference you'll actually bookmark.

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
depfresh plan --json > depfresh-plan.json

# Apply one reviewed immutable plan with explicit authority
depfresh apply --json --write --plan-file depfresh-plan.json
```

## Machine Commands

`inspect`, `plan`, and `apply` are commands, not range modes. They require `--json` or
`--output json` and write one versioned schema-valid document to stdout. Inspect and plan reject
write, interactive, legacy post-write, and global flags before discovery. Apply requires explicit
`--write` plus one `--plan-file`, and rejects unrelated command flags. See
[Inspect and Plan Contracts](../output-formats/inspect-plan.md) and
[Apply Contract](../output-formats/apply.md) for schemas, fingerprints, side-effect boundaries,
recovery, and exit codes.

## See Also

- [Configuration](../configuration/) -- `.depfreshrc`, `depfresh.config.ts`, and `package.json#depfresh`
- [Programmatic API](../api/) -- using depfresh as a library with callbacks
- [Output Formats](../output-formats/) -- legacy JSON, inspect/plan/apply schemas, and table behavior
