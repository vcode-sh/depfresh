# CI recipes

## Read-only gate

Use an exact runner and no write inputs:

```bash
"${DEPFRESH[@]}" --output json \
  --fail-on-outdated \
  --fail-on-resolution-errors \
  --fail-on-no-packages > depfresh-check.json
```

Exit `0` means current, `1` means outdated, and `2` means fatal/incomplete. A plan job may publish an
immutable plan for review, but it must not apply it.

## Protected apply

Use a separate environment-protected job. Download the exact reviewed plan and verify its artifact
digest, check out the reviewed commit, and run one apply command with only its approved grants. A
stale result must return to planning; never regenerate and apply inside the privileged job.

The job stops after observed local changes and verification. Git, PR, merge, publish, and deployment
need separate explicit authority outside depfresh.
