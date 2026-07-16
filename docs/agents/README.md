# Agent Workflows

Quickstarts for AI coding agents that need deterministic, machine-readable dependency checks.

## Universal Workflows

These commands work with any AI coding agent.

```bash
# Check-only (read-only report)
depfresh --output json

# Deterministic repository evidence, with no registry or subprocess
depfresh inspect --json

# Registry-aware review plan, with no writes
depfresh plan --json > depfresh-plan.json

# Apply that exact reviewed plan under explicit write authority
depfresh apply --json --write --plan-file depfresh-plan.json

# Safe write (minor + patch)
depfresh --write --mode minor

# Plan and grant exact lockfile synchronization plus verification
depfresh plan --json --sync-lockfile --verify-argv '["pnpm","test"]' > depfresh-plan.json
depfresh apply --json --write --sync-lockfile --verify --plan-file depfresh-plan.json

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

For automation that needs exact occurrences and immutable fingerprints, prefer:

```text
Run depfresh inspect and plan in JSON mode. Validate the shipped schema, review every blocked,
unknown, and error decision, and do not treat the legacy check report as an apply plan.
```

```bash
depfresh inspect --json
depfresh plan --json > depfresh-plan.json
```

Validate the plan schema and semantic fingerprint before approval. To mutate, pass the unchanged
document to `apply`; do not rebuild operations, relax hashes, or convert the legacy check report:

```bash
depfresh apply --json --write --plan-file depfresh-plan.json
```

A stale target, dirty target, identity mismatch, or unavailable target Git state prevents every
replacement in that apply run. Re-inspect and re-plan instead of editing preconditions. Unrelated
dirty paths do not block. An incomplete recovery retains root-local lock and journal evidence; keep
it until every target is observed and known.

**Guarded writes:**

```text
Check outdated dependencies with depfresh JSON output, group by diff severity, and apply minor/patch updates only.
```

```bash
depfresh plan --json --mode minor --sync-lockfile --verify-argv '["pnpm","test"]' > depfresh-plan.json
depfresh apply --json --write --sync-lockfile --verify --plan-file depfresh-plan.json
```

The plan fingerprints exact file operations, manager/version/lockfile evidence, fixed no-shell argv,
and verification intent. Apply cannot add or weaken a phase. Legacy shell-string post-write flags
are rejected. Global updates use a separate versioned plan/result contract with manager-specific
authority, pre/post inventory, no downgrade, and no rollback claim.

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

The response includes supported commands, packaged schemas, flags, valid enum values, defaults,
invocation-authority grants, config options that cannot grant side effects, stable error reasons,
and separate legacy/machine exit semantics.
