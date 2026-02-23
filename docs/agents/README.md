# Agent Workflows

Quickstarts for AI coding agents that need deterministic, machine-readable dependency checks.

## Universal Workflows

These commands work with any AI coding agent.

```bash
# Check-only (read-only report)
depfresh --output json

# Safe write (minor + patch)
depfresh --write --mode minor

# Verify each dependency update, revert failures
depfresh --write --verify-command "pnpm test"

# CI gate mode (exit 1 when outdated deps exist)
depfresh --fail-on-outdated --output json
```

## Prompt Patterns

Tell your agent what to do with the output. Here are some patterns that work well:

**Read-only audit:**

```text
Run depfresh in JSON mode, summarize summary/meta fields, then propose safe updates.
```

```bash
depfresh --output json
```

**Guarded writes:**

```text
Check outdated dependencies with depfresh JSON output, group by diff severity, and apply minor/patch updates only.
```

```bash
depfresh --write --mode minor --verify-command "pnpm test"
```

**CI enforcement:**

```text
Run depfresh as a machine-readable check and return a change plan from JSON summary/meta fields.
```

```bash
depfresh --fail-on-outdated --output json
```

## Contract Discovery

Before automating, fetch the CLI contract directly:

```bash
depfresh --help-json
# or
depfresh capabilities --json
```

The response includes supported flags, valid enum values, defaults, and exit code semantics.
