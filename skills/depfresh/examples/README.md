# Sanitized workflows

Select `DEPFRESH` from `../recipes/runners.md`. Store outputs outside tracked source files or in an
explicit CI artifact directory.

## Read-only audit and broad catalog policy

Copy `catalog-policy.json` to `.depfreshrc.json`. It applies `latest` broadly while capping only the
physical `native` catalog owner at `minor`; catalog consumers stay references and direct same-name
dependencies remain independent.

```bash
"${DEPFRESH[@]}" inspect --output json > depfresh-inspect.json
"${DEPFRESH[@]}" plan --output json > depfresh-plan.json || test "$?" -eq 1
```

Review `summary`, `operations`, every non-selected decision, `signals`, `diagnostics`, `risks`,
`requiredCapabilities`, `execution`, and `planFingerprint`. Validate the document with
`depfresh/schemas/plan-v1.json`; `apply` also enforces semantic and fingerprint invariants.

## Reviewed apply and stale re-plan

For a reviewed file-only plan:

```bash
"${DEPFRESH[@]}" apply --output json --write \
  --plan-file depfresh-plan.json > depfresh-apply.json
```

For an approved lockfile sync, add `--sync-lockfile` to both plan and apply. If apply exits `1` with
a stale/dirty/conflicted result, do not modify or retry the plan. Preserve it, re-run inspect and
plan against current bytes, compare all changes, and apply only the newly reviewed plan.

## Trust review

Passive signature/provenance presence signals are not verification. Review every `warn`, `fail`,
`unknown`, or blocking signal. Exact artifact verification requires a plan created with
`--install --verify-artifacts` and an apply with those same explicit grants. Treat unavailable,
offline, stale, incomplete, or mismatched evidence as non-success.

## CI

Use `read-only-gate.yml` for an unprivileged gate. `protected-apply.yml` is an opt-in second job that
requires a protected environment and an already reviewed plan artifact. Neither workflow stages,
commits, pushes, opens a PR, merges, tags, publishes, or deploys.
