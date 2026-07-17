# Pinned runners

Choose one runner once and keep it as an argument array. Do not use `eval` or a shell command
string.

## 1. Repository-local locked version

Use this only when depfresh is an exact repository dependency resolved by the committed lockfile:

```bash
DEPFRESH=(pnpm exec depfresh)
"${DEPFRESH[@]}" --version
"${DEPFRESH[@]}" capabilities --json
```

Use the equivalent locked local executor for another package manager.

## 2. Exact approved package version

When no locked local copy exists, set an exact reviewed version:

```bash
DEPFRESH_VERSION=2.0.1
DEPFRESH=(npm exec --yes --package="depfresh@$DEPFRESH_VERSION" -- depfresh)
"${DEPFRESH[@]}" --version
"${DEPFRESH[@]}" capabilities --json
```

Reject a missing, ranged, tagged, or mismatched version. The `--` boundary ensures later arguments
belong to depfresh.
