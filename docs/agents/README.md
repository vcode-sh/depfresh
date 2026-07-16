# Official automation workflow

The packaged [`depfresh` skill](../../skills/depfresh/SKILL.md) is the operational entry point.
It uses only public CLI commands, library exports, and versioned schemas.

## Pin the runner

Prefer the repository-local binary only when depfresh is an exact dependency resolved by the
committed lockfile:

```bash
DEPFRESH=(pnpm exec depfresh)
```

Otherwise use one exact approved package version:

```bash
DEPFRESH_VERSION=1.2.0
DEPFRESH=(npm exec --yes --package="depfresh@$DEPFRESH_VERSION" -- depfresh)
```

Keep the runner as an argument array. Do not use a floating version, `eval`, or word splitting.
Verify `"${DEPFRESH[@]}" --version`, then discover the installed surface:

```bash
"${DEPFRESH[@]}" capabilities --json > depfresh-capabilities.json
```

The deterministic `depfresh.capabilities` v1 document names every shipped schema, selector,
signal, supported manager/version/lockfile, apply phase, authority grant, workflow, runner, and
package asset. Validate it with `depfresh/schemas/capabilities-v1.json`.

## Inspect, plan, review, apply, observe

```bash
"${DEPFRESH[@]}" inspect --output json > depfresh-inspect.json
"${DEPFRESH[@]}" plan --output json > depfresh-plan.json || test "$?" -eq 1
```

Exit `1` is a valid inspect/plan document containing findings; exit `2` is fatal. Review operations,
all skipped/blocked/unknown/error decisions, compatibility/trust signals, diagnostics, risks,
manager evidence, `requiredCapabilities`, and `planFingerprint`. Unknown and warning states are not
success. Validate the plan shape with `depfresh/schemas/plan-v1.json`; apply also validates semantic
references and the fingerprint.

```bash
"${DEPFRESH[@]}" apply --output json --write \
  --plan-file depfresh-plan.json > depfresh-apply.json
```

Pass the unchanged plan and only its reviewed phase grants. For example, an approved lockfile sync
adds `--sync-lockfile` to both plan and apply. Config can shape policy but cannot grant file,
process, install, verification, artifact/network, or global authority.

Apply exit `0` is locally `applied` or `noop`. Exit `1` is a schema-valid conflict, recovery,
failure, or unknown result. Exit `2` is fatal. Stale/dirty/identity mismatch requires a fresh
inspect, plan, and review; never weaken or edit plan evidence. Compare results with observed files
or a fresh global inventory.

## Complete examples

The packaged [examples](../../skills/depfresh/examples/README.md) cover:

- read-only audit;
- broad latest with a `native` catalog minor cap;
- immutable plan review and least-authority apply;
- stale-plan re-plan;
- trust warning and exact artifact-verification review;
- read-only CI and opt-in environment-protected apply.

Manager and CI details are in the packaged
[recipes](../../skills/depfresh/recipes/manager-phases.md). Report local evidence separately from
CI, provider, deployment, or production evidence. depfresh never grants or infers authority to
stage, commit, push, open a PR, merge, tag, publish, or deploy.
