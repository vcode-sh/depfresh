# Output Formats

Because apparently "printing text to a terminal" needs a whole document now. depfresh supports three output formats. Well, two and a half -- one of them doesn't exist yet.

## Pages

- **[Table](./table.md)** -- The default. Colourful tables, colour-coded diffs, sorting options, and display flags. For humans with eyeballs.

- **[JSON](./json.md)** -- Machine-readable envelope with packages, summary, and metadata. Plus AI agent integration notes. For scripts, CI, and robots.

- **[SARIF](./sarif.md)** -- Static Analysis Results Interchange Format. Coming eventually. The type exists. The implementation doesn't.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | All dependencies are up to date, or updates were written successfully with `--write` |
| `1`  | Outdated dependencies found (only when `--fail-on-outdated` is set, without `--write`) |
| `2`  | Something went wrong -- network error, parse failure, registry timeout, etc. |

The `--fail-on-outdated` flag is designed for CI pipelines. Without it, finding outdated deps still exits `0` because I'm not here to break your build over a patch depfresh.

## Quick Reference

```bash
depfresh --output table   # default -- for humans
depfresh --output json    # for machines, scripts, and AI agents
depfresh --output sarif   # for... eventually
```
