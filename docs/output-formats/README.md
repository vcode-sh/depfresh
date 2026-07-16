# Output Formats

Because apparently "printing text to a terminal" needs a whole document now. depfresh has a human
table, a legacy check JSON envelope, and versioned inspect/plan/apply machine contracts.

## Pages

- **[Table](./table.md)** -- The default. Colourful tables, colour-coded diffs, sorting options, and display flags. For humans with eyeballs.

- **[JSON](./json.md)** -- Compatibility check envelope with packages, summary, volatile metadata,
  and optional write outcomes.

- **[Inspect and Plan](./inspect-plan.md)** -- Deterministic schema-v1 repository evidence and
  immutable plan operations with canonical fingerprints.
- **[Compatibility Signals](./compatibility-signals.md)** -- Repository-runtime, exact-owner peer
  constraints with conservative unknown topology, cohort, release, deprecation, completeness, and
  passive-presence evidence in plans.
- **[Apply](./apply.md)** -- Explicitly authorized stale-safe file application, phase evidence,
  observed outcomes, and recovery limits.
- **[Global Apply](./global-apply.md)** -- Manager-specific immutable global plans, observed item
  results, honest partial/unknown states, and non-transactional limits.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | All dependencies are up to date, or updates were written successfully with `--write` |
| `1`  | Outdated dependencies found (only when `--fail-on-outdated` is set, without `--write`) |
| `2`  | Something went wrong -- network error, parse failure, registry timeout, etc. |

The `--fail-on-outdated` flag is designed for CI pipelines. Without it, finding outdated deps still exits `0` because I'm not here to break your build over a patch update.

`inspect` and `plan` use a separate contract: `0` means no operation, material risk, block,
unknown, or error;
`1` means the JSON document is valid but contains actionable operations, material risks, or
non-fatal incomplete decisions; `2` means a fatal error prevented a trustworthy result.

`apply` exits `0` for an observed `applied` or `noop` result, `1` for a schema-valid `conflicted`,
`reverted`, `failed`, or `unknown` result, and `2` for a fatal command-error document.

Legacy `--global[-all] --write` exits `0` only when every selected global item is observed applied
or skipped. Any conflicted, failed, or unknown item makes the compatibility command exit `2`; the
embedded `globalResults` retain the versioned item truth.

## Quick Reference

```bash
depfresh --output table   # default -- for humans
depfresh --output json    # for machines, scripts, and AI agents
depfresh inspect --json   # deterministic repository evidence
depfresh plan --json > depfresh-plan.json
depfresh apply --json --write --plan-file depfresh-plan.json
```
