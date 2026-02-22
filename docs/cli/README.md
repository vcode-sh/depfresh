# CLI Reference

The complete field manual for `depfresh`. Every flag, every trick, every questionable life choice that led to this many options.

## Pages

- **[Flags](./flags.md)** -- All 27+ flags, sorted by category: core, filtering, display, post-write, and behavior. The reference you'll actually bookmark.

- **[Modes](./modes.md)** -- Version range modes explained: `default`, `major`, `minor`, `patch`, `latest`, `newest`, `next`, and `ignore`. The philosophical core of the tool.

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
```

## See Also

- [Configuration](../configuration/) -- `.depfreshrc`, `depfresh.config.ts`, and `package.json#depfresh`
- [Programmatic API](../api/) -- using depfresh as a library with callbacks
- [Output Formats](../output-formats/) -- JSON and SARIF schemas
