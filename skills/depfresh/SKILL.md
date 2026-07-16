---
name: depfresh
description: Use when auditing, planning, applying, or automating npm dependency updates with depfresh in repositories or CI.
---

# depfresh operational workflow

Use only the installed CLI, package exports, and shipped schemas. Never reproduce policy or write
logic in automation.

## Start safely

1. Select a runner from [recipes/runners.md](recipes/runners.md): prefer a repository-local,
   lockfile-pinned depfresh; otherwise use an exact approved package version.
2. Run `depfresh capabilities --json`. Validate it with
   `depfresh/schemas/capabilities-v1.json` and use only advertised commands, schemas, selectors,
   managers, phases, and grants.
3. Run `inspect --output json`, then `plan --output json`. Exit `1` is a valid machine result with
   findings; exit `2` is fatal. Neither command grants writes or process execution.

## Review before authority

Review the immutable plan's operations, skipped/blocked/unknown/error decisions, compatibility and
trust signals, diagnostics, risks, required capabilities, manager evidence, and fingerprint. An
unknown or warning is never success. Configuration can shape policy but cannot grant authority.

Request only the flags required by the reviewed phases. Pass the unchanged plan to
`apply --output json --write --plan-file ...`. Add `--sync-lockfile`, `--install`, `--verify`, or
`--verify-artifacts` only when that exact phase was planned and approved. Apply validates schema,
semantics, fingerprint, repository identity, target bytes, and invocation authority.

## Observe and report

Treat apply exit `0` as locally `applied` or `noop`; inspect its operations, phases, recovery, and
observed files. Exit `1` is a schema-valid conflict/failure/unknown result. Exit `2` is fatal. On
stale or dirty evidence, preserve the result, inspect again, create a new plan, and re-review. Never
edit a plan to force it through.

Compare global work with a fresh observed inventory. Report local evidence separately from CI,
provider, deployment, or production evidence. Never infer permission to stage, commit, push, open a
PR, merge, tag, publish, or deploy.

Use [recipes/manager-phases.md](recipes/manager-phases.md), [recipes/ci.md](recipes/ci.md), and the
[sanitized examples](examples/README.md) for complete flows.
