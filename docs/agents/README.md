# Agent Workflows

Quickstarts for AI coding agents that need deterministic, machine-readable dependency checks.

## Universal Workflows

These commands work across Codex, Claude Code, and Gemini CLI.

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

## Codex Quickstart

Use this prompt pattern:

```text
Run depfresh in JSON mode, summarize summary/meta fields, then propose or apply safe updates.
```

Suggested command:

```bash
depfresh --output json
```

For writes with verification:

```bash
depfresh --write --mode minor --verify-command "pnpm test"
```

## Claude Code Quickstart

Use this prompt pattern:

```text
Check outdated dependencies with depfresh JSON output, group by diff severity, and apply minor/patch updates only.
```

Suggested command:

```bash
depfresh --output json
```

For guarded writes:

```bash
depfresh --write --mode minor --verify-command "pnpm test"
```

## Gemini CLI Quickstart

Use this prompt pattern:

```text
Run depfresh as a machine-readable check and return a change plan from JSON summary/meta fields.
```

Suggested command:

```bash
depfresh --output json
```

For CI enforcement:

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
